#!/bin/bash
# Double-click to start the app on a Mac.
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "Node.js is not installed. Opening nodejs.org: install the LTS version, then double-click start.command again."
  open https://nodejs.org
  read -r -p "Press Enter to close."
  exit 1
fi

if ! node scripts/start.mjs; then
  echo
  read -r -p "Something went wrong. Copy the messages above to get help. Press Enter to close."
fi
