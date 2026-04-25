import { mkdirSync } from "node:fs";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { config } from "../utils/config.js";
import { schema } from "./schema.js";

const dbPath = resolve(process.cwd(), config.databasePath);
mkdirSync(dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);
try {
  sqlite.pragma("journal_mode = WAL");
} catch {
  try {
    sqlite.pragma("journal_mode = DELETE");
  } catch {
    // OneDrive-backed folders can reject journal mode changes; continue with SQLite defaults.
  }
}
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
export const sqliteDb: BetterSqlite3.Database = sqlite;

function ensureColumn(table: string, column: string, definition: string) {
  const rows = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!rows.some((row) => row.name === column)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function runMigrations() {
  const migrationSql = readFileSync(
    resolve(process.cwd(), "app/backend/drizzle/migrations/0000_initial.sql"),
    "utf8"
  );
  sqlite.exec(migrationSql);
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS teams (
      id integer primary key,
      name text not null,
      tag text,
      created_at integer not null default (unixepoch() * 1000),
      updated_at integer not null default (unixepoch() * 1000)
    );
    CREATE TABLE IF NOT EXISTS provider_request_events (
      id integer primary key autoincrement,
      provider text not null,
      requested_at integer not null
    );
    CREATE INDEX IF NOT EXISTS provider_request_events_provider_requested_at_idx
      ON provider_request_events(provider, requested_at);
    CREATE TABLE IF NOT EXISTS draft_plans (
      id text primary key,
      owner_key text not null,
      league_id integer not null,
      name text not null,
      first_team_id integer,
      second_team_id integer,
      slots_json text not null,
      created_at integer not null default (unixepoch() * 1000),
      updated_at integer not null default (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS draft_plans_owner_league_idx
      ON draft_plans(owner_key, league_id);
  `);
  ensureColumn("players", "rank_tier", "integer");
  ensureColumn("players", "leaderboard_rank", "integer");
  ensureColumn("match_players", "gold_t_json", "text");
  ensureColumn("match_players", "xp_t_json", "text");
  ensureColumn("match_players", "lh_t_json", "text");
  ensureColumn("match_players", "dn_t_json", "text");
  ensureColumn("match_players", "ability_upgrades_json", "text");
  ensureColumn("match_players", "item_uses_json", "text");
  ensureColumn("match_players", "purchase_log_json", "text");
  ensureColumn("match_players", "obs_log_json", "text");
  ensureColumn("match_players", "sen_log_json", "text");
  ensureColumn("match_players", "obs_placed", "integer");
  ensureColumn("match_players", "sen_placed", "integer");
  ensureColumn("match_players", "hero_healing", "integer");
  ensureColumn("match_players", "observer_kills", "integer");
  ensureColumn("match_players", "camps_stacked", "integer");
  ensureColumn("match_players", "courier_kills", "integer");
  ensureColumn("match_players", "lobby_type", "integer");
  ensureColumn("match_players", "item_neutral", "integer");
  ensureColumn("matches", "radiant_team_id", "integer");
  ensureColumn("matches", "dire_team_id", "integer");
  ensureColumn("heroes", "icon_path", "text");
  ensureColumn("heroes", "portrait_path", "text");
  ensureColumn("items", "image_path", "text");
}

export function closeDb() {
  sqlite.close();
}

export function checkDbHealth() {
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS app_health_checks (
        id integer primary key autoincrement,
        checked_at integer not null
      );
    `);
    const result = sqlite
      .prepare("insert into app_health_checks (checked_at) values (?) returning id")
      .get(Date.now()) as { id?: number } | undefined;
    if (result?.id) {
      sqlite.prepare("delete from app_health_checks where id = ?").run(result.id);
    }
    return true;
  } catch {
    return false;
  }
}
