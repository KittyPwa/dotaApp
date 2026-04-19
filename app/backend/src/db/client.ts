import { mkdirSync } from "node:fs";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
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
  ensureColumn("heroes", "icon_path", "text");
  ensureColumn("heroes", "portrait_path", "text");
  ensureColumn("items", "image_path", "text");
}

export function closeDb() {
  sqlite.close();
}
