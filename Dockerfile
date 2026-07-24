FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --cache /tmp/npm-cache

FROM dependencies AS builder
WORKDIR /app
COPY . .
RUN npm run build

FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=5173
ENV OMA_PUBLIC_DEMO=1

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --cache /tmp/npm-cache \
  && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server-dist ./server-dist
COPY --from=builder /app/fixtures ./fixtures

USER node
EXPOSE 5173
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:5173/healthz >/dev/null || exit 1
CMD ["node", "server-dist/server/index.js"]
