# syntax=docker/dockerfile:1

# --- Build stage: compile TypeScript and native deps ---
FROM node:20-bookworm-slim AS build
WORKDIR /app

# Force a dev install here even if NODE_ENV=production is injected at build time
# (production would skip devDependencies like typescript/tsc and break the build).
ENV NODE_ENV=development

# Build toolchain for better-sqlite3 (native module).
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
# --include=dev guarantees devDependencies install regardless of NODE_ENV.
RUN npm ci --include=dev

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Prune to production dependencies (keeps compiled better-sqlite3 binary).
RUN npm prune --omit=dev

# --- Runtime stage: minimal image ---
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Create the data directory owned by the non-root user before dropping perms.
RUN mkdir -p /app/data && chown -R node:node /app

# Run as the built-in non-root user.
USER node

COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node public ./public

# Match state persists here; mount a volume in production.
VOLUME ["/app/data"]

ENV PORT=3000 \
    COURT_COUNT=4 \
    DB_PATH=/app/data/komet.db \
    TZ=Europe/Stockholm

EXPOSE 3000

# Lightweight container healthcheck against /healthz.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:'+ (process.env.PORT||3000) +'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
