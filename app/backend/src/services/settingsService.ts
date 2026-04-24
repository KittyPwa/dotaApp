import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
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
const FAVORITE_LINKS_BY_OWNER_KEY = "favoriteLinksByOwner";
const SAVED_LEAGUES_KEY = "savedLeagues";
const LIMIT_TO_RECENT_PATCHES_KEY = "limitToRecentPatches";
const RECENT_PATCH_COUNT_KEY = "recentPatchCount";
const AUTO_REFRESH_PLAYER_IDS_KEY = "autoRefreshPlayerIds";
const COLORBLIND_MODE_KEY = "colorblindMode";
const DARK_MODE_KEY = "darkMode";
const STRATZ_PER_SECOND_CAP_KEY = "stratzPerSecondCap";
const STRATZ_PER_MINUTE_CAP_KEY = "stratzPerMinuteCap";
const STRATZ_PER_HOUR_CAP_KEY = "stratzPerHourCap";
const STRATZ_DAILY_REQUEST_CAP_KEY = "stratzDailyRequestCap";
const ADMIN_PASSWORD_HASH_KEY = "adminPasswordHash";

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, storedValue: string) {
  const [salt, expectedHash] = storedValue.split(":");
  if (!salt || !expectedHash) return false;
  const derived = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHash, "hex");
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

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

function parseFavoriteLinksByOwner(
  value: string | null | undefined
): Record<string, number[]> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).map(([ownerId, favoriteIds]) => [
        ownerId,
        Array.isArray(favoriteIds)
          ? favoriteIds
              .map((entry) => Number(entry))
              .filter((entry, index, list) => Number.isInteger(entry) && entry > 0 && list.indexOf(entry) === index)
          : []
      ])
    );
  } catch {
    return {};
  }
}

export class SettingsService {
  async getSettings(options?: {
    adminUnlocked?: boolean;
    includeProtected?: boolean;
    browserPreferences?: {
      primaryPlayerId?: number | null;
      favoritePlayerIds?: number[] | null;
      autoRefreshPlayerIds?: number[] | null;
    };
  }): Promise<SettingsPayload> {
    const rows = await db.select().from(settings);
    const map = new Map(rows.map((row) => [row.key, row.value ?? null]));
    const parsedRecentPatchCount = Number(map.get(RECENT_PATCH_COUNT_KEY));
    const parsedStratzPerSecondCap = Number(map.get(STRATZ_PER_SECOND_CAP_KEY));
    const parsedStratzPerMinuteCap = Number(map.get(STRATZ_PER_MINUTE_CAP_KEY));
    const parsedStratzPerHourCap = Number(map.get(STRATZ_PER_HOUR_CAP_KEY));
    const parsedStratzDailyRequestCap = Number(map.get(STRATZ_DAILY_REQUEST_CAP_KEY));
    const storedAdminPasswordHash = map.get(ADMIN_PASSWORD_HASH_KEY);
    const adminProtectionEnabled = Boolean(storedAdminPasswordHash);
    const adminUnlocked = options?.includeProtected === true || !adminProtectionEnabled || options?.adminUnlocked === true;
    const payload: SettingsPayload = {
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
      darkMode: map.get(DARK_MODE_KEY) === "true",
      stratzPerSecondCap: Number.isFinite(parsedStratzPerSecondCap) ? Math.min(1000, Math.max(1, parsedStratzPerSecondCap)) : 20,
      stratzPerMinuteCap: Number.isFinite(parsedStratzPerMinuteCap) ? Math.min(10000, Math.max(1, parsedStratzPerMinuteCap)) : 250,
      stratzPerHourCap: Number.isFinite(parsedStratzPerHourCap) ? Math.min(100000, Math.max(1, parsedStratzPerHourCap)) : 2000,
      stratzDailyRequestCap: Number.isFinite(parsedStratzDailyRequestCap)
        ? Math.min(100000, Math.max(1, parsedStratzDailyRequestCap))
        : 10000,
      appMode: config.appMode,
      adminUnlocked,
      adminPasswordConfigured: adminProtectionEnabled
    };

    const sanitizedPayload =
      adminProtectionEnabled && !adminUnlocked
        ? {
        ...payload,
        openDotaApiKey: null,
        stratzApiKey: null,
        steamApiKey: null,
        primaryPlayerId: null,
        favoritePlayerIds: [],
        autoRefreshPlayerIds: []
          }
        : payload;

    return {
      ...sanitizedPayload,
      primaryPlayerId: options?.browserPreferences?.primaryPlayerId ?? null,
      favoritePlayerIds:
        options?.browserPreferences?.primaryPlayerId !== undefined &&
        options?.browserPreferences?.primaryPlayerId !== null
          ? this.getFavoritePlayersForOwnerFromMap(
              parseFavoriteLinksByOwner(map.get(FAVORITE_LINKS_BY_OWNER_KEY)),
              options.browserPreferences.primaryPlayerId
            )
          : [],
      autoRefreshPlayerIds: options?.browserPreferences?.autoRefreshPlayerIds ?? []
    };
  }

  private getFavoritePlayersForOwnerFromMap(linksByOwner: Record<string, number[]>, ownerPlayerId: number) {
    return linksByOwner[String(ownerPlayerId)] ?? [];
  }

  async getFavoritePlayersForOwner(ownerPlayerId: number) {
    const [row] = await db.select().from(settings).where(eq(settings.key, FAVORITE_LINKS_BY_OWNER_KEY)).limit(1);
    return this.getFavoritePlayersForOwnerFromMap(parseFavoriteLinksByOwner(row?.value), ownerPlayerId);
  }

  async setFavoritePlayersForOwner(ownerPlayerId: number, favoritePlayerIds: number[]) {
    const [row] = await db.select().from(settings).where(eq(settings.key, FAVORITE_LINKS_BY_OWNER_KEY)).limit(1);
    const linksByOwner = parseFavoriteLinksByOwner(row?.value);
    const normalizedFavoriteIds = favoritePlayerIds.filter(
      (entry, index, list) => Number.isInteger(entry) && entry > 0 && entry !== ownerPlayerId && list.indexOf(entry) === index
    );
    linksByOwner[String(ownerPlayerId)] = normalizedFavoriteIds;
    const now = new Date();
    await db
      .insert(settings)
      .values({
        key: FAVORITE_LINKS_BY_OWNER_KEY,
        value: JSON.stringify(linksByOwner),
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: JSON.stringify(linksByOwner), updatedAt: now }
      });
    return normalizedFavoriteIds;
  }

  async getFavoriteLinksByOwner() {
    const [row] = await db.select().from(settings).where(eq(settings.key, FAVORITE_LINKS_BY_OWNER_KEY)).limit(1);
    return parseFavoriteLinksByOwner(row?.value);
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
        key: DARK_MODE_KEY,
        value: input.darkMode ? "true" : "false",
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: input.darkMode ? "true" : "false", updatedAt: now }
      });

    await db
      .insert(settings)
      .values({
        key: STRATZ_PER_SECOND_CAP_KEY,
        value: String(Math.min(1000, Math.max(1, input.stratzPerSecondCap))),
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: String(Math.min(1000, Math.max(1, input.stratzPerSecondCap))), updatedAt: now }
      });

    await db
      .insert(settings)
      .values({
        key: STRATZ_PER_MINUTE_CAP_KEY,
        value: String(Math.min(10000, Math.max(1, input.stratzPerMinuteCap))),
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: String(Math.min(10000, Math.max(1, input.stratzPerMinuteCap))), updatedAt: now }
      });

    await db
      .insert(settings)
      .values({
        key: STRATZ_PER_HOUR_CAP_KEY,
        value: String(Math.min(100000, Math.max(1, input.stratzPerHourCap))),
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: String(Math.min(100000, Math.max(1, input.stratzPerHourCap))), updatedAt: now }
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

  async verifyAdminPassword(password: string | null | undefined) {
    const [row] = await db.select().from(settings).where(eq(settings.key, ADMIN_PASSWORD_HASH_KEY)).limit(1);
    const storedHash = row?.value ?? null;
    if (!storedHash) return true;
    if (!password) return false;
    return verifyPassword(password, storedHash);
  }

  async hasAdminPasswordConfigured() {
    const [row] = await db.select().from(settings).where(eq(settings.key, ADMIN_PASSWORD_HASH_KEY)).limit(1);
    return Boolean(row?.value);
  }

  async setAdminPassword(password: string) {
    const trimmed = password.trim();
    if (trimmed.length < 10) {
      throw new Error("Admin password must be at least 10 characters.");
    }
    if (await this.hasAdminPasswordConfigured()) {
      throw new Error("Admin password is already configured.");
    }

    const now = new Date();
    await db
      .insert(settings)
      .values({
        key: ADMIN_PASSWORD_HASH_KEY,
        value: hashPassword(trimmed),
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: hashPassword(trimmed), updatedAt: now }
      });

    return this.getSettings({ adminUnlocked: true });
  }
}
