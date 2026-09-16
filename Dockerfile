FROM node:20-bookworm-slim AS deps

WORKDIR /app

# better-sqlite3 a un binaire natif : outils de compilation si le prebuild n'est pas dispo
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY server.js db.js content.js seed.js ./
COPY public ./public

RUN mkdir -p /app/data && chown -R node:node /app

USER node

EXPOSE 3000
VOLUME ["/app/data"]

CMD ["node", "server.js"]
