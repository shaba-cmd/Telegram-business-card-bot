# ---------- сборка ----------
FROM node:20-bookworm-slim AS build
WORKDIR /app

# Инструменты для сборки better-sqlite3, если готовый бинарник недоступен
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---------- запуск ----------
FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    DB_PATH=/app/data/bot.db

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
VOLUME ["/app/data"]

CMD ["node", "dist/index.js"]
