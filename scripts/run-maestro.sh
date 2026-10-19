#!/usr/bin/env bash
# Runs the example app's Maestro flows. The app must be installed and Metro running.
#   scripts/run-maestro.sh android [device-id]
#   scripts/run-maestro.sh ios [simulator-udid]
set -euo pipefail

platform="${1:-android}"
device="${2:-}"
root="$(cd "$(dirname "$0")/.." && pwd)"
maestro="${MAESTRO:-$(command -v maestro || echo "$HOME/.maestro/bin/maestro")}"

case "$platform" in
  android) app_id="com.pdfjsiexample" ;;
  ios) app_id="org.reactjs.native.example.PdfJsiExample" ;;
  *) echo "usage: $0 android|ios [device]" >&2; exit 2 ;;
esac

args=(test -e "APP_ID=$app_id")
if [[ -n "$device" ]]; then
  args=(--device "$device" "${args[@]}")
fi
exec "$maestro" "${args[@]}" "$root/example/maestro"
