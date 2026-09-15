#!/bin/bash
# Double-click this file in Finder to start Node Space and open it in your browser.
# (Or run ./start.command from Terminal.)

cd "$(dirname "$0")" || exit 1

PORT=8080
URL="http://localhost:$PORT"

open_browser() {
  # Give the server a moment to bind before the browser asks for the page.
  sleep 1
  open "$URL" 2>/dev/null || true
}

echo ""
echo "  Node Space"
echo "  ----------"

if command -v python3 >/dev/null 2>&1; then
  echo "  Serving this folder with python3 on $URL"
  echo "  Press Control-C to stop."
  echo ""
  open_browser &
  exec python3 -m http.server "$PORT" --bind 127.0.0.1
fi

if command -v node >/dev/null 2>&1; then
  echo "  Serving this folder with node on $URL"
  echo ""
  exec node scripts/serve.mjs --port "$PORT" --open
fi

cat <<'MSG'
  Neither python3 nor node was found on this Mac.

  Pick one of these, then double-click this file again:

    1. Install Apple's command line tools (includes python3):
         xcode-select --install

    2. Or install Node from https://nodejs.org

  Both are one-time installs.
MSG
echo ""
read -r -p "  Press Return to close this window. " _
