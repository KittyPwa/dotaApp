FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY app/shared/package.json app/shared/package.json
COPY app/backend/package.json app/backend/package.json
COPY app/frontend/package.json app/frontend/package.json

RUN npm ci

COPY . .

RUN npm run build

ENV NODE_ENV=production
ENV APP_MODE=public
ENV BACKEND_HOST=0.0.0.0
ENV BACKEND_PORT=3344
ENV DATABASE_PATH=/data/dota-analytics.sqlite
ENV OPEN_BROWSER=false

EXPOSE 3344

CMD ["node", "app/backend/dist/server.js"]
