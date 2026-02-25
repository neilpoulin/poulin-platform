#!/usr/bin/env bash

set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:54321/functions/v1}"
GAME_ID="${GAME_ID:-00000000-0000-0000-0000-000000000000}"
COMMAND_TYPE="${COMMAND_TYPE:-order.submit}"
INVITE_TOKEN="${INVITE_TOKEN:-dummy-token}"

echo "Using BASE_URL=${BASE_URL}"
echo "Smoke testing secret-toaster-apply-command"

curl -sS -i "${BASE_URL}/secret-toaster-apply-command" \
  -H "Content-Type: application/json" \
  -d "{\"gameId\":\"${GAME_ID}\",\"commandType\":\"${COMMAND_TYPE}\",\"payload\":{\"source\":\"smoke-script\"}}"

echo
echo "Smoke testing secret-toaster-join-game"

curl -sS -i "${BASE_URL}/secret-toaster-join-game" \
  -H "Content-Type: application/json" \
  -d "{\"inviteToken\":\"${INVITE_TOKEN}\"}"

echo
echo "Done."
