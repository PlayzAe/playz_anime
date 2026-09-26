# Production multi-stage Dockerfile for PlayzAnime Web & API
FROM node:24-alpine AS builder

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./
COPY server/package*.json ./server/

# Install dependencies (ignoring playwright browsers since server uses HTTP embeds)
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci && npm --prefix server ci

# Copy full source
COPY . .

# Build frontend and server
RUN npm run build
RUN npm --prefix server run build

# ── Runtime Stage ─────────────────────────────────────────────────────────────
FROM node:24-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=5310
ENV PLAYZANIME_RELAY=on

# Copy built artifacts and minimal package files
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server/package.json ./server/package.json
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/server/blocklist.json ./server/blocklist.json
COPY --from=builder /app/server/node_modules ./server/node_modules

EXPOSE 5310

CMD ["node", "server/dist/index.mjs"]
