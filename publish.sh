#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: ./publish.sh YOUR-GITHUB-USERNAME"
  exit 1
fi

USER_NAME="$1"
REPO_NAME="${USER_NAME}.github.io"
REMOTE_URL="https://github.com/${USER_NAME}/${REPO_NAME}.git"

if [ ! -d .git ]; then
  git init
fi

git add .
if ! git diff --cached --quiet; then
  git commit -m "Publish LexiLift mobile vocabulary coach"
fi

git branch -M main
if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$REMOTE_URL"
else
  git remote add origin "$REMOTE_URL"
fi

git push -u origin main

echo "After GitHub Pages deploys, open https://${USER_NAME}.github.io/"
