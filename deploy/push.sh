#!/usr/bin/env bash
# Sends Kail from this machine to the machine that hosts it, over SSH. Run in the project's folder:
#
#   deploy/push.sh user@machine --setup kail.example.com    once: make the machine ready (runs deploy/setup.sh there)
#   deploy/push.sh user@machine --keys                      the code AND the keys, then a start
#   deploy/push.sh user@machine                             the code only (after a change), then a start
#   deploy/push.sh user@machine --look                      only say what would be sent
#
# The code is exactly what git tracks here (so nothing ignored travels by accident: no settings file, no
# node_modules). The keys go only with --keys, straight into folders only the user "kail" can read, and are
# never shown: server/.dev.vars (the server's key and the boats' names), and the key files of the welcome
# account and of every boat named in NPCS, from ~/.near-credentials/<network>/.
#
# The login must be root or able to use sudo without a password. Run the boats in one place only: once they
# run on the hosting machine, stop the game on this one (or start it without keys, see README.md).
set -euo pipefail
cd "$(dirname "$0")/.."

HOST="${1:-}"; shift || true
[ -n "$HOST" ] && [ "${HOST#-}" = "$HOST" ] || { sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 1; }
KEYS=0; LOOK=0; SETUP=""
while [ $# -gt 0 ]; do
  case "$1" in
    --keys) KEYS=1 ;;
    --look) LOOK=1 ;;
    --setup) SETUP="${2:-}"; [ -n "$SETUP" ] || { echo "--setup needs the address people will open."; exit 1; }; shift ;;
    *) echo "Not known: $1"; exit 1 ;;
  esac
  shift
done
export COPYFILE_DISABLE=1      # macOS: no ._ files in what is sent
# on the other side: "sudo" in front of everything unless the login is root already
AS_ROOT='if [ "$(id -u)" = 0 ]; then S=""; else S="sudo -n"; fi'

if [ -n "$SETUP" ]; then
  echo "Making $HOST ready for https://$SETUP …"
  [ "$LOOK" = 1 ] && { echo "(--look: would send deploy/setup.sh and deploy/kail.service and run the first as root)"; exit 0; }
  tar -czf - -C deploy setup.sh kail.service | ssh "$HOST" 'rm -rf /tmp/kail-setup && mkdir -p /tmp/kail-setup && tar -xzf - -C /tmp/kail-setup'
  ssh "$HOST" "$AS_ROOT; \$S bash /tmp/kail-setup/setup.sh '$SETUP'; rm -rf /tmp/kail-setup"
  exit 0
fi

# ---- the code: what git tracks, as it is in this folder now
files="$(git ls-files | wc -l | tr -d ' ')"
[ -z "$(git status --porcelain --untracked-files=no)" ] || echo "Note: there are changes here that are not committed; they are sent as they are."
[ -z "$(git ls-files --others --exclude-standard)" ] || echo "Note: new files git does not track yet are NOT sent (git add them first): $(git ls-files --others --exclude-standard | head -5 | tr '\n' ' ')"
echo "Code: $files files to $HOST:/opt/kail"

# ---- the keys: which files they are (names only)
keyfiles=()
if [ "$KEYS" = 1 ]; then
  vars=server/.dev.vars
  [ -f "$vars" ] || { echo "No $vars here: this machine has no keys to send."; exit 1; }
  read_var() { grep -E "^$1=" "$vars" | tail -1 | cut -d= -f2- | tr -d '\r' || true; }
  network="$(read_var NEAR_NETWORK)"; network="${network:-testnet}"
  accounts="$(read_var NPCS | tr ',' '\n' | cut -d= -f1 | tr -d ' ')"
  welcome="$(read_var WELCOME)"
  missing=0
  for account in $welcome $accounts; do
    f="$HOME/.near-credentials/$network/$account.json"
    if [ -f "$f" ]; then keyfiles+=("$account.json"); else echo "  no key file here for $account"; missing=1; fi
  done
  echo "Keys: $vars and ${#keyfiles[@]} key files ($network): $(echo $welcome $accounts | tr '\n' ' ')"
  [ "$missing" = 0 ] || { echo "Some keys are missing on this machine: nothing was sent."; exit 1; }
fi
[ "$LOOK" = 1 ] && { echo "(--look: nothing was sent)"; exit 0; }

ssh "$HOST" "$AS_ROOT; \$S test -d /opt/kail && id kail >/dev/null" || { echo "That machine is not ready yet (no /opt/kail or no user kail). First:  deploy/push.sh $HOST --setup <address>"; exit 1; }

git ls-files -z | tar --null -T - -czf - | ssh "$HOST" "$AS_ROOT; \$S rm -rf /opt/kail.incoming && \$S mkdir -p /opt/kail.incoming && \$S tar -xzf - -C /opt/kail.incoming --no-same-owner"
if [ "$KEYS" = 1 ]; then
  ssh "$HOST" "$AS_ROOT; \$S install -d -o kail -g kail -m 700 /home/kail/.near-credentials /home/kail/.near-credentials/$network"
  tar -czf - -C "$HOME/.near-credentials/$network" "${keyfiles[@]}" | ssh "$HOST" "$AS_ROOT; \$S tar -xzf - -C /home/kail/.near-credentials/$network --no-same-owner && \$S chown -R kail:kail /home/kail/.near-credentials && \$S chmod 600 /home/kail/.near-credentials/$network/*.json"
  # the settings go straight from this machine into their place, readable by the service's user only
  ssh "$HOST" "$AS_ROOT; \$S install -d -o root -g kail -m 750 /opt/kail /opt/kail/server && \$S install -o kail -g kail -m 600 /dev/stdin /opt/kail/server/.dev.vars" < "$vars"
  echo "Keys are in place."
fi

# ---- put the new code in place (the settings, the installed packages and the address stay), install, start
ssh "$HOST" "$AS_ROOT; set -e
  \$S rsync -a --delete --exclude node_modules --exclude server/.dev.vars --exclude .address /opt/kail.incoming/ /opt/kail/
  \$S rm -rf /opt/kail.incoming
  cd /opt/kail
  \$S env HOME=/root npm ci --omit=dev --no-audit --no-fund --ignore-scripts 2>&1 | tail -2
  # the code and the packages belong to root; the service's user may read them and nothing more
  \$S chown -R root:kail /opt/kail
  \$S chmod -R u=rwX,g=rX,o= /opt/kail
  [ -f /opt/kail/server/.dev.vars ] && \$S chown kail:kail /opt/kail/server/.dev.vars && \$S chmod 600 /opt/kail/server/.dev.vars
  \$S systemctl restart kail
  sleep 6
  \$S systemctl is-active kail >/dev/null && echo 'The service is running.' || { echo 'THE SERVICE DID NOT START:'; \$S journalctl -u kail -n 25 --no-pager; exit 1; }
  \$S journalctl -u kail -n 6 --no-pager -o cat | cut -c1-160
  echo \"Address: https://\$(cat /opt/kail/.address 2>/dev/null || echo '<the address given to setup.sh>')\""
