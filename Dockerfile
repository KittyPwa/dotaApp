FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY app/shared/package.json app/shared/package.json
COPY app/backend/package.json app/backend/package.json
COPY app/frontend/package.json app/frontend/package.json

RUN npm ci

COPY . .

RUN npm run build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY app/shared/package.json app/shared/package.json
COPY app/backend/package.json app/backend/package.json
COPY app/frontend/package.json app/frontend/package.json

RUN npm ci --omit=dev

COPY --from=build --chown=node:node /app/app/shared/dist /app/app/shared/dist
COPY --from=build --chown=node:node /app/app/backend/dist /app/app/backend/dist
COPY --from=build --chown=node:node /app/app/backend/drizzle /app/app/backend/drizzle
COPY --from=build --chown=node:node /app/app/frontend/dist /app/app/frontend/dist
COPY --from=build --chown=node:node /app/scripts /app/scripts

RUN mkdir -p /data /backups && chown -R node:node /app /data /backups

ENV NODE_ENV=production
ENV APP_MODE=public
ENV BACKEND_HOST=0.0.0.0
ENV BACKEND_PORT=3344
ENV DATABASE_PATH=/data/dota-analytics.sqlite
ENV BACKUP_DIRECTORY=/backups
ENV OPEN_BROWSER=false

EXPOSE 3344

USER node

CMD ["node", "app/backend/dist/server.js"]
