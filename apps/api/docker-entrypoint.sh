#!/bin/sh
set -eu

echo "[api] Applying versioned Prisma migrations (migrate deploy)..."
pnpm exec prisma migrate deploy

echo "[api] Starting NestJS..."
exec "$@"
