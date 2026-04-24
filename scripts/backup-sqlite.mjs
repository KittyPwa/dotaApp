import { mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import Database from "better-sqlite3";

const databasePath = resolve(process.cwd(), process.env.DATABASE_PATH ?? "/data/dota-analytics.sqlite");
const backupDirectory = resolve(process.cwd(), process.env.BACKUP_DIRECTORY ?? "/backups");
const retentionDays = Math.max(1, Number(process.env.BACKUP_RETENTION_DAYS ?? "7"));
const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
const prefix = process.env.BACKUP_PREFIX ?? "dota-analytics";

mkdirSync(dirname(databasePath), { recursive: true });
mkdirSync(backupDirectory, { recursive: true });

const timestamp = new Date().toISOString().replace(/[:]/g, "-");
const finalPath = join(backupDirectory, `${prefix}-${timestamp}.sqlite`);
const tempPath = `${finalPath}.tmp`;
const escapedTempPath = tempPath.replace(/'/g, "''");

const sqlite = new Database(databasePath);
sqlite.pragma("busy_timeout = 5000");
sqlite.exec(`VACUUM INTO '${escapedTempPath}'`);
sqlite.close();

renameSync(tempPath, finalPath);

const now = Date.now();
for (const fileName of readdirSync(backupDirectory)) {
  if (!fileName.endsWith(".sqlite")) continue;
  const fullPath = join(backupDirectory, fileName);
  const stats = statSync(fullPath);
  if (now - stats.mtimeMs > retentionMs) {
    rmSync(fullPath, { force: true });
  }
}

console.log(JSON.stringify({ level: "info", message: "SQLite backup created", path: finalPath }));
