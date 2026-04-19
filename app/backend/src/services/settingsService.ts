import { eq } from "drizzle-orm";
import type { SettingsPayload } from "@dota/shared";
import { db } from "../db/client.js";
import { settings } from "../db/schema.js";
import { config } from "../utils/config.js";

const OPEN_DOTA_KEY = "openDotaApiKey";
const STRATZ_KEY = "stratzApiKey";
const PRIMARY_PLAYER_ID_KEY = "primaryPlayerId";
const FAVORITE_PLAYER_IDS_KEY = "favoritePlayerIds";

function parsePlayerIdList(value: string | null | undefined) {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => Number(entry.trim()))
    .filter((value, index, list) => Number.isInteger(value) && value > 0 && list.indexOf(value) === index);
}

export class SettingsService {
  async getSettings(): Promise<SettingsPayload> {
    const rows = await db.select().from(settings);
    const map = new Map(rows.map((row) => [row.key, row.value ?? null]));
    return {
      openDotaApiKey: map.get(OPEN_DOTA_KEY) ?? config.envKeys.openDotaApiKey,
      stratzApiKey: map.get(STRATZ_KEY) ?? config.envKeys.stratzApiKey,
      primaryPlayerId: map.get(PRIMARY_PLAYER_ID_KEY) ? Number(map.get(PRIMARY_PLAYER_ID_KEY)) : null,
      favoritePlayerIds: parsePlayerIdList(map.get(FAVORITE_PLAYER_IDS_KEY))
    };
  }

  async updateSettings(input: SettingsPayload): Promise<SettingsPayload> {
    const now = new Date();

    await db
      .insert(settings)
      .values({ key: OPEN_DOTA_KEY, value: input.openDotaApiKey, updatedAt: now })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: input.openDotaApiKey, updatedAt: now }
      });

    await db
      .insert(settings)
      .values({ key: STRATZ_KEY, value: input.stratzApiKey, updatedAt: now })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: input.stratzApiKey, updatedAt: now }
      });

    await db
      .insert(settings)
      .values({
        key: PRIMARY_PLAYER_ID_KEY,
        value: input.primaryPlayerId ? String(input.primaryPlayerId) : null,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: input.primaryPlayerId ? String(input.primaryPlayerId) : null, updatedAt: now }
      });

    await db
      .insert(settings)
      .values({
        key: FAVORITE_PLAYER_IDS_KEY,
        value: input.favoritePlayerIds.join(","),
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: input.favoritePlayerIds.join(","), updatedAt: now }
      });

    return this.getSettings();
  }

  async getSettingValue(key: "openDotaApiKey" | "stratzApiKey") {
    const [row] = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
    return row?.value ?? null;
  }
}
