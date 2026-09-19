#!/bin/sh
set -eu

echo "[entrypoint] Applying versioned Prisma migrations (migrate deploy)..."
pnpm exec prisma migrate deploy

echo "[entrypoint] Starting process..."
exec "$@"
