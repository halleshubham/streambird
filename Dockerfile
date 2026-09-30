# --- web (React SPA) build stage ---
FROM node:22-alpine AS web-builder
WORKDIR /app/web-app

COPY web-app/package.json web-app/package-lock.json ./
RUN npm ci

COPY web-app/ ./
RUN npm run build
# vite.config.ts's outDir ('../dist-web') lands this at /app/dist-web

# --- build stage ---
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# --- runtime stage ---
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=web-builder /app/dist-web ./dist-web
COPY migrations ./migrations

EXPOSE 3000

# Migrations are idempotent (schema_migrations tracks what's applied), so
# running them on every container start is safe and keeps the DB in sync
# without a separate deploy step.
CMD ["sh", "-c", "npm run migrate:prod && node dist/main.js"]
