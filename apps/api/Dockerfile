# Build stage — has devDependencies (tsc, esbuild, tsx) and the full source.
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
RUN npm ci --workspaces --include-workspace-root
COPY apps/api ./apps/api
COPY packages/shared ./packages/shared
# Type gate before emit — a build that ships from broken types is worse than
# no build. esbuild strips types without checking them, so this is the check.
RUN npm run typecheck -w @opushr/api
RUN npm run build:prod -w @opushr/api

# Runtime stage — production dependencies and compiled JS only. No npm wrapper,
# no tsx, no esbuild: on 2026-07-28 those three held ~48 MB of a 256 MB machine
# and added ~11s to every boot.
FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache postgresql16-client
ENV NODE_ENV=production
COPY package*.json tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
RUN npm ci --workspaces --include-workspace-root --omit=dev
COPY --from=builder /app/apps/api/dist ./apps/api/dist
# Migration SQL is read from disk at runtime by scripts/migrate.ts, which
# resolves `new URL('../db/migrations', import.meta.url)` — relative to ITSELF.
# Compiled, that file is dist/scripts/migrate.js, so the folder has to land at
# dist/db/migrations. Source of truth is drizzle.config.ts `out:
# './src/db/migrations'` (57 .sql files plus meta/_journal.json, which the
# migrator needs). This is on the release_command path: get it wrong and every
# deploy fails.
COPY apps/api/src/db/migrations ./apps/api/dist/db/migrations

# WORKDIR stays at the monorepo root: fly.toml's [processes] and
# release_command are absolute-from-root node invocations, and node resolves
# node_modules by walking up from the script anyway.
EXPOSE 8080
USER node
CMD ["node", "apps/api/dist/index.js"]
