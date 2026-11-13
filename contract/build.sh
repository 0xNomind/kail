#!/usr/bin/env bash
# Builds the contract: contract/target/near/contract.wasm
#
#   bash contract/build.sh        or: npm run build:contract
#
# Source paths are mapped to fixed names (/home, /kail), so the file comes out the same wherever the project
# sits on the machine that builds it. Deploying is a separate step.
set -euo pipefail
cd "$(dirname "$0")"
[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
root="$(cd .. && pwd)"
cargo near build non-reproducible-wasm --env "RUSTFLAGS=--remap-path-prefix=$HOME=/home --remap-path-prefix=$root=/kail" "$@"
wasm=target/near/contract.wasm
if strings -n 4 "$wasm" | grep -q -F -e "$HOME" -e "$(basename "$HOME")"; then echo "The paths were not mapped: the build is not the same on every machine. Do not deploy it."; exit 1; fi
echo "Built $wasm ($(wc -c < "$wasm" | tr -d ' ') bytes)."
