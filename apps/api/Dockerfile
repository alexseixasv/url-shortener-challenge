FROM node:22-bookworm-slim

RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/

RUN pnpm install --filter api...

COPY apps/api ./apps/api

WORKDIR /app/apps/api

# Client generation at build time — not repeated on every container start.
RUN pnpm exec prisma generate

# Entrypoint lives outside the bind-mounted ./apps/api path.
COPY apps/api/docker-entrypoint.sh /docker-entrypoint.sh
RUN sed -i 's/\r$//' /docker-entrypoint.sh && chmod +x /docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/docker-entrypoint.sh"]

# --no-shell: evita processo Node órfão no Linux/Docker (EADDRINUSE no restart)
# watchOptions no tsconfig: polling para bind mounts no Docker Desktop
# migrate deploy runs in entrypoint after postgres is healthy (compose depends_on).
CMD ["pnpm", "exec", "nest", "start", "--watch", "--no-shell"]
