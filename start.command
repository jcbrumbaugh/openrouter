#!/bin/bash
# Double-click this file in Finder to start Node Space.
#
# It starts two small local programs and opens your browser:
#   - the page server  (http://localhost:8080)  serves the app itself
#   - the API gateway  (http://localhost:8787)  relays calls to Tripo and Runway
#
# Both stop when you close this window. Nothing is installed and nothing keeps
# running in the background.

cd "$(dirname "$0")" || exit 1

GATEWAY_PORT=8787

# Homebrew and the official installer put node in places Finder may not have
# on PATH when it launches this file.
export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin"

say() { printf '  %s\n' "$1"; }

printf '\n  Node Space\n  ==========\n\n'

if ! command -v node >/dev/null 2>&1; then
  cat <<'MSG'
  Node is not installed on this Mac yet.

  It is a one-time install and it is what runs the little programs this app
  needs. Nothing else on your Mac is affected, and it can be removed later.

    1. Go to  https://nodejs.org
    2. Download the button on the LEFT that says "LTS"
    3. Open the downloaded file and click through the installer
       (it will ask for your Mac password - that is the Apple installer,
        not this app)
    4. Come back here and double-click start.command again

MSG
  read -r -p "  Press Return to close this window. " _
  exit 1
fi

# Stop both programs when this window closes or you press Control-C.
# HUP is the signal a closing Terminal window sends, so it has to be trapped
# too. Children are killed by pid rather than with "kill 0", which would also
# take out whatever launched this script.
CLEANED=""
cleanup() {
  trap '' HUP INT TERM
  [ -n "$CLEANED" ] && return 0     # EXIT fires after HUP; only say this once
  CLEANED=1
  printf '\n  Shutting down...\n'
  [ -n "$GATEWAY_PID" ] && kill "$GATEWAY_PID" 2>/dev/null
  [ -n "$PAGE_PID" ] && kill "$PAGE_PID" 2>/dev/null
  wait 2>/dev/null
  return 0
}
trap cleanup EXIT HUP INT TERM

# Reuse a gateway that is already running rather than starting a second one.
if curl -s --max-time 2 "http://localhost:$GATEWAY_PORT/health" >/dev/null 2>&1; then
  say "API gateway   already running on port $GATEWAY_PORT"
else
  node scripts/proxy.mjs >/dev/null 2>&1 &
  GATEWAY_PID=$!
  sleep 1
  if curl -s --max-time 2 "http://localhost:$GATEWAY_PORT/health" >/dev/null 2>&1; then
    say "API gateway   started on port $GATEWAY_PORT"
  else
    say "API gateway   could not start - Tripo and Runway will not work"
    say "              (run 'node scripts/proxy.mjs' by hand to see why)"
  fi
fi

# Find a port that is either free or already serving this same app, so we never
# open someone else's page or fight another copy for a port.
PAGE_PORT=""
REUSE_PAGE=""
for candidate in 8080 8081 8082 8083 8084; do
  body=$(curl -s --max-time 1 "http://localhost:$candidate/" 2>/dev/null)
  if [ -z "$body" ]; then
    PAGE_PORT=$candidate
    break
  fi
  case "$body" in
    *"<title>Node Space"*)
      PAGE_PORT=$candidate
      REUSE_PAGE=1
      break
      ;;
  esac
done

if [ -z "$PAGE_PORT" ]; then
  say "Could not find a free port between 8080 and 8084."
  say "Close other apps using those ports and try again."
  read -r -p "  Press Return to close this window. " _
  exit 1
fi

URL="http://localhost:$PAGE_PORT"

if [ -n "$REUSE_PAGE" ]; then
  say "Node Space is already running on port $PAGE_PORT"
  printf '\n  Opening %s in your browser.\n' "$URL"
  printf '  The window that started it is the one to close when you are done.\n\n'
  open "$URL" 2>/dev/null
  exit 0
fi

say "Page server   starting on port $PAGE_PORT"
printf '\n  Opening %s\n' "$URL"
printf '  Leave this window open while you work.\n'
printf '  To stop everything: close this window, or press Control-C.\n\n'

( sleep 1; open "$URL" 2>/dev/null ) &

# Started as a child we can signal, then waited on, so the cleanup trap still
# runs when the window is closed.
node scripts/serve.mjs --port "$PAGE_PORT" &
PAGE_PID=$!
wait "$PAGE_PID"
