#!/bin/zsh -l
# Double-click to start Kompass and open it in the browser.
# Closing this Terminal window (or pressing Ctrl+C) stops the app.

# Work from the folder this file really lives in, even when started through a shortcut.
cd "${0:A:h}" || exit 1
URL="http://127.0.0.1:3210"

if ! command -v npm >/dev/null 2>&1; then
  echo "Could not find Node.js (npm). Install it from https://nodejs.org and try again."
  read -r "?Press Return to close."
  exit 1
fi

# Already running? Then just open it.
if curl -s -o /dev/null -m 2 "$URL"; then
  echo "Kompass is already running. Opening $URL"
  open "$URL"
  exit 0
fi

if [ ! -d node_modules ]; then
  echo "First start: installing packages (takes a minute)…"
  npm ci || { read -r "?Installation failed. Press Return to close."; exit 1; }
fi

# Open the browser as soon as the app answers.
( for i in {1..90}; do curl -s -o /dev/null -m 2 "$URL" && { open "$URL"; break; }; sleep 1; done ) &

echo "Starting Kompass at $URL"
echo "Keep this window open while you use it. Close it, or press Ctrl+C, to stop."
echo
exec npm run dev
