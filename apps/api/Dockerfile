FROM node:22-bookworm-slim

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/

RUN pnpm install --filter api...

COPY apps/api ./apps/api

WORKDIR /app/apps/api

EXPOSE 3000

# --no-shell: evita processo Node órfão no Linux/Docker (EADDRINUSE no restart)
# watchOptions no tsconfig: polling para bind mounts no Docker Desktop
CMD ["pnpm", "exec", "nest", "start", "--watch", "--no-shell"]
