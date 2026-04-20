import { eq } from "drizzle-orm";
import type { SettingsPayload } from "@dota/shared";
import { db } from "../db/client.js";
import { settings } from "../db/schema.js";
import { config } from "../utils/config.js";

const OPEN_DOTA_KEY = "openDotaApiKey";
const STRATZ_KEY = "stratzApiKey";
const STEAM_KEY = "steamApiKey";
const PRIMARY_PLAYER_ID_KEY = "primaryPlayerId";
const FAVORITE_PLAYER_IDS_KEY = "favoritePlayerIds";
const SAVED_LEAGUES_KEY = "savedLeagues";
const LIMIT_TO_RECENT_PATCHES_KEY = "limitToRecentPatches";
const RECENT_PATCH_COUNT_KEY = "recentPatchCount";
const AUTO_REFRESH_PLAYER_IDS_KEY = "autoRefreshPlayerIds";
const COLORBLIND_MODE_KEY = "colorblindMode";
const STRATZ_DAILY_REQUEST_CAP_KEY = "stratzDailyRequestCap";

function parsePlayerIdList(value: string | null | undefined) {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => Number(entry.trim()))
    .filter((value, index, list) => Number.isInteger(value) && value > 0 && list.indexOf(value) === index);
}

function parseSavedLeagues(value: string | null | undefined): SettingsPayload["savedLeagues"] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as SettingsPayload["savedLeagues"];
    return parsed.filter(
      (league, index, list) =>
        Number.isInteger(league.leagueId) &&
        league.leagueId > 0 &&
        typeof league.slug === "string" &&
        typeof league.name === "string" &&
        list.findIndex((entry) => entry.leagueId === league.leagueId) === index
    );
  } catch {
    return [];
  }
}

export class SettingsService {
  async getSettings(): Promise<SettingsPayload> {
    const rows = await db.select().from(settings);
    const map = new Map(rows.map((row) => [row.key, row.value ?? null]));
    const parsedRecentPatchCount = Number(map.get(RECENT_PATCH_COUNT_KEY));
    const parsedStratzDailyRequestCap = Number(map.get(STRATZ_DAILY_REQUEST_CAP_KEY));
    return {
      openDotaApiKey: map.get(OPEN_DOTA_KEY) ?? config.envKeys.openDotaApiKey,
      stratzApiKey: map.get(STRATZ_KEY) ?? config.envKeys.stratzApiKey,
      steamApiKey: map.get(STEAM_KEY) ?? config.envKeys.steamApiKey,
      primaryPlayerId: map.get(PRIMARY_PLAYER_ID_KEY) ? Number(map.get(PRIMARY_PLAYER_ID_KEY)) : null,
      favoritePlayerIds: parsePlayerIdList(map.get(FAVORITE_PLAYER_IDS_KEY)),
      savedLeagues: parseSavedLeagues(map.get(SAVED_LEAGUES_KEY)),
      limitToRecentPatches: map.get(LIMIT_TO_RECENT_PATCHES_KEY) !== "false",
      recentPatchCount: Number.isFinite(parsedRecentPatchCount) ? Math.max(0, parsedRecentPatchCount) : 2,
      autoRefreshPlayerIds: parsePlayerIdList(map.get(AUTO_REFRESH_PLAYER_IDS_KEY)),
      colorblindMode: map.get(COLORBLIND_MODE_KEY) === "true",
      stratzDailyRequestCap: Number.isFinite(parsedStratzDailyRequestCap)
        ? Math.min(100000, Math.max(1, parsedStratzDailyRequestCap))
        : 10000
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
      .values({ key: STEAM_KEY, value: input.steamApiKey, updatedAt: now })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: input.steamApiKey, updatedAt: now }
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

    await db
      .insert(settings)
      .values({
        key: SAVED_LEAGUES_KEY,
        value: JSON.stringify(input.savedLeagues),
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: JSON.stringify(input.savedLeagues), updatedAt: now }
      });

    await db
      .insert(settings)
      .values({
        key: LIMIT_TO_RECENT_PATCHES_KEY,
        value: input.limitToRecentPatches ? "true" : "false",
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: input.limitToRecentPatches ? "true" : "false", updatedAt: now }
      });

    await db
      .insert(settings)
      .values({
        key: RECENT_PATCH_COUNT_KEY,
        value: String(Math.max(0, input.recentPatchCount)),
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: String(Math.max(0, input.recentPatchCount)), updatedAt: now }
      });

    await db
      .insert(settings)
      .values({
        key: AUTO_REFRESH_PLAYER_IDS_KEY,
        value: input.autoRefreshPlayerIds.join(","),
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: input.autoRefreshPlayerIds.join(","), updatedAt: now }
      });

    await db
      .insert(settings)
      .values({
        key: COLORBLIND_MODE_KEY,
        value: input.colorblindMode ? "true" : "false",
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: input.colorblindMode ? "true" : "false", updatedAt: now }
      });

    await db
      .insert(settings)
      .values({
        key: STRATZ_DAILY_REQUEST_CAP_KEY,
        value: String(Math.min(100000, Math.max(1, input.stratzDailyRequestCap))),
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: settings.key,
        set: {
          value: String(Math.min(100000, Math.max(1, input.stratzDailyRequestCap))),
          updatedAt: now
        }
      });

    return this.getSettings();
  }

  async getSettingValue(key: "openDotaApiKey" | "stratzApiKey") {
    const [row] = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
    return row?.value ?? null;
  }
}
