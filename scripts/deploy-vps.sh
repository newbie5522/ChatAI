#!/usr/bin/env sh
set -eu

COMPOSE_FILE="docker-compose.prod.yml"

echo "[NewbieChat] Pulling prebuilt Docker image..."
docker compose -f "$COMPOSE_FILE" pull

echo "[NewbieChat] Starting service..."
docker compose -f "$COMPOSE_FILE" up -d

echo "[NewbieChat] Current containers:"
docker compose -f "$COMPOSE_FILE" ps

echo "[NewbieChat] Done."
