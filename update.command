#!/bin/bash
# Double-click this to get the latest version of the app.
# It only downloads updates. It never deletes your work, your keys or your
# exported graphs.

cd "$(dirname "$0")" || exit 1
export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin"

printf '\n  Updating Node Space\n  ===================\n\n'

if ! command -v git >/dev/null 2>&1; then
  echo "  git is not available. Open Terminal and run: xcode-select --install"
  read -r -p "  Press Return to close this window. " _
  exit 1
fi

BEFORE=$(git rev-parse --short HEAD 2>/dev/null)

# --ff-only means: take the new version as-is, never invent a merge.
if git pull --ff-only 2>&1 | sed 's/^/  /'; then
  AFTER=$(git rev-parse --short HEAD 2>/dev/null)
  if [ "$BEFORE" = "$AFTER" ]; then
    printf '\n  Already up to date. Nothing to do.\n'
  else
    printf '\n  Updated: %s -> %s\n' "$BEFORE" "$AFTER"
    printf '\n  What changed:\n'
    git log --oneline "$BEFORE..$AFTER" | sed 's/^/    /'
    printf '\n  Now: double-click start.command, then in the browser press\n'
    printf '  Command + Shift + R to load the new version.\n'
  fi
else
  cat <<'MSG'

  The update could not be applied automatically.

  That usually means files here were changed locally. Nothing has been lost -
  your copy is untouched. Send this whole window to Claude and it can sort out
  which changes to keep.
MSG
fi

printf '\n'
read -r -p "  Press Return to close this window. " _
