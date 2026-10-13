# Okul Nöbet Programı – ortak (bulut) sunucu
# Veritabanı DATA_DIR'deki kalıcı diskte tutulur; konteyner yenilense de veri kaybolmaz.

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build \
 && npx esbuild server.ts --bundle --platform=node --format=cjs --target=node22 \
      --define:process.env.NODE_ENV='"production"' \
      --external:better-sqlite3 --external:lightningcss --external:vite \
      --outfile=server.cjs \
 && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/data \
    TRUST_PROXY=1 \
    PORT=3000
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server.cjs ./server.cjs
EXPOSE 3000
CMD ["node", "server.cjs"]
