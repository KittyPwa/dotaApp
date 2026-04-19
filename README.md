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
