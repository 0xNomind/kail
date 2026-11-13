#!/usr/bin/env bash
# Makes a fresh Debian or Ubuntu machine ready to run Kail. Run once, on that machine, as root:
#
#   sudo bash setup.sh kail.example.com
#
# The one argument is the address people will open. It must already point at this machine (an A record), because
# Caddy asks for the HTTPS certificate as soon as it starts. With no name of your own, <the machine's IP with
# dashes>.sslip.io works without signing up anywhere, e.g. 203-0-113-7.sslip.io.
#
#   sudo bash setup.sh kail.example.com --cloudflare
#
# With --cloudflare the address is one that Cloudflare's proxy answers for (the DNS record is "Proxied", and the
# zone's SSL/TLS mode is "Full"), so the machine's own IP stays out of the DNS. Then Caddy does not ask anybody for
# a certificate: it makes its own, which Cloudflare accepts in that mode; it answers Cloudflare's addresses only;
# and it tells the game the visitor's address as Cloudflare reports it, so the limits still count for each visitor.
#
# What it does: installs Node 22 and Caddy from their own package sources, makes a user "kail" that cannot log
# in, the folders /opt/kail (the code) and /home/kail/.near-credentials (the keys), the service (kail.service)
# and Caddy's settings for the address. It does not copy the code or any key (deploy/push.sh does, from your own
# machine) and it does not touch the firewall: ports 80 and 443 must be open, and nothing else needs to be.
# Safe to run again.
set -euo pipefail

ADDRESS="${1:-}"; BEHIND="${2:-}"
here="$(cd "$(dirname "$0")" && pwd)"
[ -n "$ADDRESS" ] || { echo "Say the address people will open:  sudo bash setup.sh kail.example.com"; exit 1; }
case "$ADDRESS" in *://*|*/*|*" "*) echo "Only the name, without https:// or a path: $ADDRESS"; exit 1 ;; esac
[ -z "$BEHIND" ] || [ "$BEHIND" = "--cloudflare" ] || { echo "Not known: $BEHIND (the only option is --cloudflare)"; exit 1; }
[ "$(id -u)" = 0 ] || { echo "Run this as root (sudo)."; exit 1; }
command -v apt-get >/dev/null || { echo "This script knows Debian and Ubuntu only (it needs apt-get). On another system: install Node 20 or newer and Caddy, then follow the rest of this file by hand."; exit 1; }
[ -f "$here/kail.service" ] || { echo "kail.service should be next to this script."; exit 1; }

# Something else already answering on the web ports would stop Caddy from starting: say so instead of breaking it.
if command -v ss >/dev/null; then
  taken="$(ss -ltnpH 'sport = :80 or sport = :443' 2>/dev/null | grep -v caddy || true)"
  if [ -n "$taken" ]; then
    echo "Another program already listens on port 80 or 443 on this machine:"; echo "$taken" | sed 's/^/  /'
    echo "Kail was NOT set up, so that program is left alone. Either stop it, or let it pass the address on to"
    echo "127.0.0.1:3000 (a reverse proxy) and run this again with KAIL_NO_CADDY=1 in front."
    [ "${KAIL_NO_CADDY:-}" = 1 ] || exit 1
  fi
fi

export DEBIAN_FRONTEND=noninteractive
echo "1. Packages…"
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg rsync >/dev/null

# The service runs /usr/bin/node as the user "kail". A Node somewhere else on the machine (in a home folder, say)
# is not one that user can run, so only the system's own counts here; another one is left as it is.
node_major() { /usr/bin/node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }
if [ "$(node_major)" -lt 20 ]; then
  echo "   Node 22 (from deb.nodesource.com)…"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
echo "   node $(/usr/bin/node -v), npm $(/usr/bin/npm -v)"

if [ "${KAIL_NO_CADDY:-}" != 1 ]; then
  if ! command -v caddy >/dev/null; then
    echo "   Caddy (from its own package source)…"
    apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https >/dev/null
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq
    apt-get install -y -qq caddy >/dev/null
  fi
  echo "   $(caddy version | cut -d' ' -f1)"
fi

echo "2. The user and the folders…"
id kail >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/kail --shell /usr/sbin/nologin kail
install -d -o root -g kail -m 750 /opt/kail /opt/kail/server
install -d -o kail -g kail -m 700 /home/kail/.near-credentials /home/kail/.near-credentials/testnet /home/kail/.near-credentials/mainnet

echo "3. The service…"
install -m 644 "$here/kail.service" /etc/systemd/system/kail.service
systemctl daemon-reload
systemctl enable kail >/dev/null 2>&1

if [ "${KAIL_NO_CADDY:-}" != 1 ]; then
  echo "4. HTTPS for $ADDRESS…"
  certificate=""; visitors=""; passing="	reverse_proxy 127.0.0.1:3000"
  if [ "$BEHIND" = "--cloudflare" ]; then
    # Cloudflare's addresses as it publishes them; the list of November 2026 stands in if they cannot be fetched
    ranges="$( { curl -fsS --max-time 15 https://www.cloudflare.com/ips-v4; echo; curl -fsS --max-time 15 https://www.cloudflare.com/ips-v6; } 2>/dev/null | tr -s '\r\n' '  ' || true)"
    count="$(echo "$ranges" | tr ' ' '\n' | grep -c . || true)"
    wrong="$(echo "$ranges" | tr ' ' '\n' | grep . | grep -Evc '^[0-9a-fA-F:.]+/[0-9]{1,3}$' || true)"
    if [ "$count" -lt 10 ] || [ "$wrong" != 0 ]; then
      echo "   (Cloudflare's list of addresses could not be fetched: using the one this script came with)"
      ranges="173.245.48.0/20 103.21.244.0/22 103.22.200.0/22 103.31.4.0/22 141.101.64.0/18 108.162.192.0/18 190.93.240.0/20 188.114.96.0/20 197.234.240.0/22 198.41.128.0/17 162.158.0.0/15 104.16.0.0/13 104.24.0.0/14 172.64.0.0/13 131.0.72.0/22 2400:cb00::/32 2606:4700::/32 2803:f800::/32 2405:b500::/32 2405:8100::/32 2a06:98c0::/29 2c0f:f248::/32"
    fi
    echo "   behind Cloudflare's proxy ($(echo "$ranges" | wc -w | tr -d ' ') ranges of addresses)"
    certificate="	# Cloudflare stands in front (SSL/TLS mode \"Full\"): a certificate of Caddy's own making is enough
	tls internal"
    visitors="	# only Cloudflare is answered: nobody reaches the game around it, or says who they are themselves
	@around not remote_ip $ranges
	abort @around"
    passing="	reverse_proxy 127.0.0.1:3000 {
		# the visitor's own address, as Cloudflare reports it
		header_up X-Forwarded-For {http.request.header.CF-Connecting-IP}
	}"
  fi
  cat > /etc/caddy/kail.caddy <<EOF
# Kail (written by deploy/setup.sh): HTTPS for the address, everything passed on to the game on this machine.
$ADDRESS {
$certificate
	encode zstd gzip
	# nothing the game sends is bigger than this; more is turned away before it reaches the game
	request_body {
		max_size 128KB
	}
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options nosniff
		X-Frame-Options DENY
		Referrer-Policy same-origin
		-Server
	}
$visitors
$passing
}
EOF
  main=/etc/caddy/Caddyfile
  if ! grep -q 'import /etc/caddy/kail.caddy' "$main" 2>/dev/null; then
    if [ ! -s "$main" ] || grep -q 'The Caddyfile is an easy way to configure your Caddy web server' "$main"; then
      # nothing of anybody's in it: the file Caddy came with (its welcome page on port 80) makes way
      [ -s "$main" ] && cp "$main" "$main.before-kail"
      echo 'import /etc/caddy/kail.caddy' > "$main"
    else
      # somebody's own settings: they stay, and Kail is added under them
      cp "$main" "$main.before-kail"
      printf '\nimport /etc/caddy/kail.caddy\n' >> "$main"
    fi
  fi
  caddy validate --config "$main" --adapter caddyfile >/dev/null 2>&1 || { echo "   Caddy does not accept its settings. See: caddy validate --config $main --adapter caddyfile"; exit 1; }
  systemctl enable caddy >/dev/null 2>&1
  systemctl reload caddy 2>/dev/null || systemctl restart caddy
fi
[ "$BEHIND" = "--cloudflare" ] && echo "   In Cloudflare: the DNS record of $ADDRESS is Proxied, and SSL/TLS is set to Full."
echo "$ADDRESS" > /opt/kail/.address; chown root:kail /opt/kail/.address; chmod 640 /opt/kail/.address

echo
echo "Ready. From your own machine, in the project's folder:"
echo "  deploy/push.sh <user>@<this machine> --keys      the code, the keys, and a start"
echo "Then open https://$ADDRESS"
