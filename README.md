# Dota Local Analytics

Local-first Dota 2 analytics built with Node.js, Fastify, React, Vite, SQLite, Drizzle, Zod, and TanStack Query.

## Concise architecture summary

- `app/backend`: local Fastify API, SQLite persistence, Drizzle schema/migrations, provider adapters, ingestion pipeline, analytics queries.
- `app/frontend`: browser UI served locally, React Router pages for home, dashboard, player, match, hero stats, and settings.
- `app/shared`: shared API contracts and response types so frontend and backend agree on normalized models.

Runtime flow:

1. User launches the app locally.
2. Backend starts on `localhost`.
3. Frontend opens in the browser and talks only to the local backend.
4. Backend checks SQLite first, fetches upstream only if data is missing or stale, stores raw payloads plus normalized tables, then returns local-domain responses.

## Folder structure

```text
.
├─ app
│  ├─ backend
│  │  ├─ drizzle/migrations
│  │  └─ src
│  │     ├─ adapters
│  │     ├─ analytics
│  │     ├─ api
│  │     ├─ db
│  │     ├─ domain
│  │     ├─ services
│  │     └─ utils
│  ├─ frontend
│  │  └─ src
│  │     ├─ api
│  │     ├─ components
│  │     ├─ hooks
│  │     ├─ lib
│  │     ├─ pages
│  │     └─ styles
│  └─ shared
│     └─ src
├─ scripts
└─ .env.example
```

## Database schema

Normalized tables:

- `players`
- `heroes`
- `matches`
- `match_players`
- `items`
- `patches`
- `leagues`
- `drafts`
- `raw_api_payloads`
- `settings`

`raw_api_payloads` stores:

- `provider`
- `entity_type`
- `entity_id`
- `fetched_at`
- `raw_json`
- `parse_version`
- `request_context`

## Domain model summary

- Provider adapters own authentication, request construction, retries, and provider-specific payloads.
- Services normalize provider payloads into local entities and cache-aware view models.
- Analytics run separately from ingestion and compute:
  - hero winrate
  - player hero usage
  - average first core timing where available
  - draft overview
  - dashboard aggregates

## MVP implementation plan

Phase 1:

- workspace scaffolding
- backend server
- frontend app
- SQLite setup and migration
- OpenDota adapter
- player lookup with recent matches
- raw payload persistence
- normalized storage

Phase 2:

- match fetch and match page
- hero analytics page
- dashboard
- analytics service

Phase 3:

- STRATZ adapter scaffold and test route
- settings page with local credential storage
- staleness logic
- clearer loading/error states

## Configuration

Copy `.env.example` to `.env` if you want to customize ports or the database path.
If `DATABASE_PATH` is left blank, the backend defaults to a machine-local SQLite file under `%LOCALAPPDATA%\\DotaLocalAnalytics\\dota-analytics.sqlite`, which avoids OneDrive sync issues.

API keys:

- OpenDota API key: optional
- STRATZ API key: optional until you use STRATZ-backed features

Where keys are stored:

- Environment variables can seed startup defaults.
- The settings page persists keys locally in the `settings` SQLite table.
- No cloud sync or remote persistence is used.

## Install

```bash
npm install
```

## Run in development

Starts the local backend, starts the Vite frontend, and opens the browser.

```bash
npm run dev
```

Backend: `http://localhost:3344`
Frontend: `http://localhost:5173`

## Build and run locally

```bash
npm run build
npm run start
```

In production mode the backend serves the built frontend and opens the browser to the local backend URL.

## Recommended public deployment

Recommended stack:

- GitHub as source control
- GitHub Actions for CI/CD
- GHCR (`ghcr.io`) for container images
- A small Linux VPS for runtime
- Docker Compose for app orchestration
- Caddy for HTTPS and reverse proxy

Why this stack:

- it keeps the deployment simple
- it is easy to update from `main`
- SQLite remains local to the server volume
- there is no extra cloud application platform to fight with
- you can keep using the app as a single full-stack service

### What is included in this repository

- `Dockerfile`
- `deploy/docker-compose.yml`
- `deploy/Caddyfile`
- `deploy/.env.production.example`
- `deploy/update.sh`
- `.github/workflows/deploy.yml`

### Recommended production flow

1. Push working changes to `main`
2. GitHub Actions builds and publishes a Docker image to GHCR
3. Your server pulls the new image
4. Docker Compose restarts the app
5. Caddy keeps the app available on your domain over HTTPS

## Server setup

On a fresh Ubuntu VPS:

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-plugin
sudo usermod -aG docker $USER
```

Clone the repo on the server, then:

```bash
cd dotaApp/deploy
cp .env.production.example .env.production
```

Fill in:

- `DOMAIN`
- `APP_IMAGE`
- `BASIC_AUTH_USER`
- `BASIC_AUTH_HASH`
- `ADMIN_PASSWORD`
- optional API keys
- `BACKUP_RETENTION_DAYS`
- `BACKUP_INTERVAL_SECONDS`

Generate the Caddy password hash on any machine with Docker:

```bash
docker run --rm caddy:2.10-alpine caddy hash-password --plaintext "choose-a-strong-password"
```

Put the resulting hash in `BASIC_AUTH_HASH`.

### First deploy

1. Set `ADMIN_PASSWORD` in `deploy/.env.production` before the first public start.
2. Set `BASIC_AUTH_USER` and `BASIC_AUTH_HASH` so Caddy protects the whole site.
3. Start the stack:

```bash
docker compose up -d
```

4. Confirm the app container is healthy:

```bash
docker compose ps
docker compose logs app --tail=50
```

5. Confirm the admin password hash was seeded:

```bash
docker compose logs app --tail=50 | grep "Seeded admin password hash from environment"
```

6. Open the domain in a fresh browser session:
   - Caddy should prompt for basic auth before the app loads.
   - `POST /api/admin/setup` should be blocked in public mode.
   - `Settings` should require the seeded `ADMIN_PASSWORD` for admin unlock.

The app will be available through Caddy on your configured domain.

## GitHub Actions deployment

The workflow in `.github/workflows/deploy.yml` does two things on pushes to `main`:

1. builds and pushes the Docker image to GHCR
2. optionally SSHes into your server and runs `deploy/update.sh`

To enable automatic server deploys, add these repository secrets:

- `DEPLOY_HOST`
- `DEPLOY_USER`
- `DEPLOY_SSH_KEY`
- `DEPLOY_PATH`

`DEPLOY_PATH` should point to the server folder containing `deploy/docker-compose.yml` and `deploy/update.sh`.

If you only want image publishing and not automatic deploy yet, do not set those secrets. The workflow will still publish the image.

## Backups and restore

The production Compose stack includes a `backup` container that creates timestamped SQLite snapshots under the `dota_backups` Docker volume using `VACUUM INTO`. Old backups are pruned automatically based on `BACKUP_RETENTION_DAYS`.

### Verify backups are being created

```bash
docker compose logs backup --tail=50
docker compose run --rm backup sh -c 'ls -lah /backups'
```

### Restore from backup

1. Stop the app stack:

```bash
docker compose stop app backup caddy
```

2. Copy the chosen backup over the live database:

```bash
docker compose run --rm app sh -c 'cp /backups/<backup-file>.sqlite /data/dota-analytics.sqlite'
```

3. Start the stack again:

```bash
docker compose up -d
```

4. Confirm the data is present after restart by checking the dashboard or a known match/player.

### Verify persistence after restart

```bash
docker compose restart app
docker compose exec app node -e "fetch('http://127.0.0.1:3344/api/health').then(r=>r.text()).then(console.log)"
```

The SQLite file lives in the persistent `dota_data` volume, so container recreation should not erase stored matches or settings.

## Publishing recommendation

For this project, the cleanest path is:

- keep day-to-day work on `dev`
- merge stable snapshots into `main`
- let `main` be the only branch that publishes containers and deploys to the public server

That gives you:

- a safe working branch
- a stable deployment branch
- a clean CI/CD story for future updates

## One-click launcher on Windows

Use one of these from the project root:

- `Launch-DotaLocalAnalytics.ps1`
- `Launch-DotaLocalAnalytics.cmd`

The PowerShell launcher:

- builds the app if the production files are missing
- starts the local backend in production mode
- waits for the local health endpoint
- opens the homepage automatically

The `.cmd` wrapper is included because Windows is often more reliable at double-clicking a `.cmd` file than a `.ps1` file directly.

## Local data pipeline

For player and match requests:

1. Route validates input with Zod.
2. Service checks normalized SQLite tables and freshness windows.
3. If stale or missing, adapter fetches from upstream.
4. Raw payload is written to `raw_api_payloads`.
5. Normalized rows are upserted into relational tables.
6. Analytics read only from local tables.
7. Response returns `source: "cache"` or `source: "fresh"` so the UI can show provenance.

## Future extension points

- Add deeper STRATZ-backed enrichments via `StratzAdapter`.
- Add more item timing analytics and lane-specific views.
- Add provider provenance per row if dual-source reconciliation becomes important.
- Add background refresh jobs while still staying local-first.

## Notes

- Version 1 intentionally avoids replay parsing, scraping, cloud deployment, and user accounts.
- Hero stats are based only on matches stored locally, not on global Dota match populations.
