#!/bin/bash
# Checks the promise start.command makes: it brings both services up, and
# closing the window takes both down with nothing left behind.
#
#   bash tests/launcher.sh

cd "$(dirname "$0")/.." || exit 1
pass=0
fail=0
check() {
  if [ "$2" = "$3" ]; then
    printf '  ok  %s\n' "$1"
    pass=$((pass + 1))
  else
    printf 'FAIL  %s - expected %s, got %s\n' "$1" "$3" "$2"
    fail=$((fail + 1))
  fi
}
strays() { pgrep -f 'scripts/serv[e].mjs|scripts/prox[y].mjs' | wc -l | tr -d ' '; }
# curl already prints 000 when it cannot connect; do not add a second one.
code() {
  out=$(curl -s --max-time 2 -o /dev/null -w '%{http_code}' "$1" 2>/dev/null)
  echo "${out:-000}"
}

check "no leftovers before starting" "$(strays)" "0"

./start.command >/tmp/nodespace-launcher-test.log 2>&1 &
LAUNCHER=$!
sleep 3

check "page server answers" "$(code http://localhost:8080/)" "200"
check "gateway answers" "$(code http://localhost:8787/health)" "200"

kill -HUP "$LAUNCHER"   # what closing the Terminal window sends
sleep 2

check "page server stops on close" "$(code http://localhost:8080/)" "000"
check "gateway stops on close" "$(code http://localhost:8787/health)" "000"
check "nothing is left running" "$(strays)" "0"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
