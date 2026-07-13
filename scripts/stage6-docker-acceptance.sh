#!/usr/bin/env sh
set -eu

PROJECT_NAME="${COMPOSE_PROJECT_NAME:-newbiechat-stage6}"
HOST_PORT="${NEWBIECHAT_ACCEPTANCE_HOST_PORT:-3100}"
BASE_URL="${NEWBIECHAT_ACCEPTANCE_URL:-http://127.0.0.1:${HOST_PORT}}"
COMPOSE_FILES="-f docker-compose.yml -f docker-compose.stage6-acceptance.yml"

export HOST_PORT

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required" >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "docker compose v2 is required" >&2
  exit 1
fi

cleanup() {
  if [ "${KEEP_STAGE6_ACCEPTANCE_STACK:-0}" != "1" ]; then
    docker compose -p "$PROJECT_NAME" $COMPOSE_FILES down --volumes >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

docker compose -p "$PROJECT_NAME" $COMPOSE_FILES up -d --build

attempt=1
until curl -fsS "$BASE_URL/api/config" >/tmp/newbiechat-stage6-config.json; do
  if [ "$attempt" -ge 60 ]; then
    docker compose -p "$PROJECT_NAME" $COMPOSE_FILES logs --tail=200
    echo "NewbieChat did not become ready at $BASE_URL" >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep 2
done

if grep -E "stage6-mock-provider-key|stage6-admin-password|stage6-admin-secret" /tmp/newbiechat-stage6-config.json >/dev/null; then
  echo "/api/config leaked a server secret" >&2
  exit 1
fi

curl -fsS \
  -H "Content-Type: application/json" \
  -d '{"accessKey":"stage6-key"}' \
  "$BASE_URL/api/employee-auth" >/tmp/newbiechat-stage6-employee-auth.json

grep '"ok":true' /tmp/newbiechat-stage6-employee-auth.json >/dev/null
grep '"id":"emp-stage6"' /tmp/newbiechat-stage6-employee-auth.json >/dev/null

curl -fsS -N \
  -H "Authorization: Bearer nk-stage6-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-5.5","messages":[{"role":"user","content":"ping"}],"stream":true}' \
  "$BASE_URL/api/gateway/openai/v1/chat/completions" >/tmp/newbiechat-stage6-gateway-stream.txt

grep "pong" /tmp/newbiechat-stage6-gateway-stream.txt >/dev/null
grep "\[DONE\]" /tmp/newbiechat-stage6-gateway-stream.txt >/dev/null

echo "stage6-docker-acceptance: ok"
echo "validated: container startup, /api/config secret safety, employee key auth, gateway streaming"

if [ "${KEEP_STAGE6_ACCEPTANCE_STACK:-0}" = "1" ]; then
  echo "acceptance stack kept running under compose project: $PROJECT_NAME"
fi
