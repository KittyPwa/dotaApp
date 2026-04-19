import dotenv from "dotenv";
import { join } from "node:path";
import { z } from "zod";

dotenv.config();

const defaultDatabasePath = process.env.LOCALAPPDATA
  ? join(process.env.LOCALAPPDATA, "DotaLocalAnalytics", "dota-analytics.sqlite")
  : "./app/backend/.data/dota-analytics.sqlite";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  BACKEND_PORT: z.coerce.number().default(3344),
  FRONTEND_PORT: z.coerce.number().default(5173),
  DATABASE_PATH: z.string().default(defaultDatabasePath),
  PLAYER_RECENT_MATCHES_TTL_MINUTES: z.coerce.number().default(30),
  REFERENCE_DATA_TTL_HOURS: z.coerce.number().default(168),
  OPEN_BROWSER: z.string().default("true"),
  OPENDOTA_API_KEY: z.string().optional(),
  STRATZ_API_KEY: z.string().optional()
});

const env = envSchema.parse(process.env);

export const config = {
  nodeEnv: env.NODE_ENV,
  backendPort: env.BACKEND_PORT,
  frontendPort: env.FRONTEND_PORT,
  databasePath: env.DATABASE_PATH,
  openBrowser: env.OPEN_BROWSER === "true",
  staleWindows: {
    playerRecentMatchesMs: env.PLAYER_RECENT_MATCHES_TTL_MINUTES * 60 * 1000,
    referenceDataMs: env.REFERENCE_DATA_TTL_HOURS * 60 * 60 * 1000
  },
  envKeys: {
    openDotaApiKey: env.OPENDOTA_API_KEY ?? null,
    stratzApiKey: env.STRATZ_API_KEY ?? null
  }
};
