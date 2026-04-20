import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type {
  HeroOverview,
  LeagueOverview,
  LeagueSummary,
  LeagueSyncResponse,
  MatchOverview,
  PlayerCompareResponse,
  PlayerOverview
} from "@dota/shared";
import { OpenDotaAdapter, type OpenDotaLeagueMatch, type OpenDotaRecentMatch } from "../adapters/openDota.js";
import { StratzAdapter, type StratzLeagueMatch, type StratzMatchTelemetry, type StratzMatchTelemetryPlayer } from "../adapters/stratz.js";
import { ValveDotaAdapter, type ValveLeagueMatch, type ValveMatchDetails } from "../adapters/valveDota.js";
import { AnalyticsService } from "../analytics/analyticsService.js";
import { db, sqliteDb } from "../db/client.js";
import { drafts, heroes, items, leagues, matchPlayers, matches, patches, players, rawApiPayloads } from "../db/schema.js";
import { config } from "../utils/config.js";
import { buildAssetProxyUrl, defaultHeroIconPath, defaultHeroPortraitPath, defaultItemImagePath } from "../utils/assets.js";
import { logger } from "../utils/logger.js";
import { RawPayloadService } from "./rawPayloadService.js";
import { ReferenceDataService } from "./referenceDataService.js";
import { SettingsService } from "./settingsService.js";

function parseJsonValue<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

type MatchParticipant = MatchOverview["participants"][number];

type TelemetryProviderStatus = MatchOverview["telemetryStatus"]["openDota"];

type MatchParsedData = PlayerOverview["matches"][number]["parsedData"];

export class DotaDataService {
  private readonly rawPayloads = new RawPayloadService();
  private readonly settingsService = new SettingsService();
  private readonly analyticsService = new AnalyticsService();

  private async createOpenDotaAdapter() {
    const settings = await this.settingsService.getSettings();
    return new OpenDotaAdapter(settings.openDotaApiKey);
  }

  private async createStratzAdapter() {
    const settings = await this.settingsService.getSettings();
    return new StratzAdapter(settings.stratzApiKey);
  }

  private async createValveAdapter() {
    const settings = await this.settingsService.getSettings();
    return new ValveDotaAdapter(settings.steamApiKey);
  }

  private async getCachedStratzMatchTelemetry(matchId: number): Promise<StratzMatchTelemetry | null> {
    const [row] = await db
      .select({ rawJson: rawApiPayloads.rawJson })
      .from(rawApiPayloads)
      .where(
        and(
          eq(rawApiPayloads.provider, "stratz"),
          eq(rawApiPayloads.entityType, "match_telemetry"),
          eq(rawApiPayloads.entityId, String(matchId))
        )
      )
      .orderBy(desc(rawApiPayloads.fetchedAt))
      .limit(1);

    if (!row?.rawJson) return null;

    try {
      return JSON.parse(row.rawJson) as StratzMatchTelemetry;
    } catch {
      return null;
    }
  }

  private getTelemetryFlags(participants: MatchParticipant[]) {
    return {
      timelines: participants.some(
        (player) =>
          player.goldTimeline.length > 0 ||
          player.xpTimeline.length > 0 ||
          player.lastHitsTimeline.length > 0 ||
          player.heroDamageTimeline.length > 0 ||
          player.damageTakenTimeline.length > 0
      ),
      itemTimings: participants.some(
        (player) => Object.keys(player.firstPurchaseTimes).length > 0 || player.purchaseLog.length > 0
      ),
      vision: participants.some(
        (player) =>
          player.observerLog.length > 0 ||
          player.sentryLog.length > 0 ||
          (player.observerWardsPlaced ?? 0) > 0 ||
          (player.sentryWardsPlaced ?? 0) > 0
      )
    };
  }

  private async resolveStratzPurchaseNames(playersWithTelemetry: StratzMatchTelemetryPlayer[]) {
    const itemIds = playersWithTelemetry.flatMap((player) =>
      player.purchaseLog
        .map((entry) => entry.itemId)
        .filter((itemId): itemId is number => typeof itemId === "number" && Number.isInteger(itemId))
    );

    if (itemIds.length === 0) {
      return new Map<number, string>();
    }

    const rows = await db
      .select({ id: items.id, localizedName: items.localizedName })
      .from(items)
      .where(inArray(items.id, [...new Set(itemIds)]));

    return new Map(rows.map((row) => [row.id, row.localizedName]));
  }

  private async getItemCostMap() {
    const [latestItemsPayload] = await db
      .select({ rawJson: rawApiPayloads.rawJson })
      .from(rawApiPayloads)
      .where(and(eq(rawApiPayloads.provider, "opendota"), eq(rawApiPayloads.entityType, "items")))
      .orderBy(desc(rawApiPayloads.fetchedAt))
      .limit(1);

    const costsById = new Map<number, number>();
    const rawItems = parseJsonValue<Record<string, { id?: number; cost?: number }>>(latestItemsPayload?.rawJson, {});
    for (const item of Object.values(rawItems)) {
      const itemId = item.id;
      if (typeof itemId === "number" && Number.isInteger(itemId) && typeof item.cost === "number" && Number.isFinite(item.cost)) {
        costsById.set(itemId, item.cost);
      }
    }

    return costsById;
  }

  private mergeStratzTelemetryIntoParticipants(
    participants: MatchParticipant[],
    stratzPlayers: StratzMatchTelemetryPlayer[],
    itemNamesById: Map<number, string>
  ): MatchParticipant[] {
    if (stratzPlayers.length === 0) return participants;

    const telemetryByHeroId = new Map<number, StratzMatchTelemetryPlayer>();
    const telemetryByPlayerId = new Map<number, StratzMatchTelemetryPlayer>();

    for (const player of stratzPlayers) {
      if (player.heroId !== null) telemetryByHeroId.set(player.heroId, player);
      if (player.playerId !== null) telemetryByPlayerId.set(player.playerId, player);
    }

    return participants.map((participant) => {
      const telemetry =
        (participant.playerId !== null ? telemetryByPlayerId.get(participant.playerId) : undefined) ??
        (participant.heroId !== null ? telemetryByHeroId.get(participant.heroId) : undefined);

      if (!telemetry) return participant;

      const derivedFirstPurchaseTimes =
        participant.purchaseLog.length === 0 && telemetry.purchaseLog.length > 0
          ? telemetry.purchaseLog.reduce<Record<string, number>>((map, entry) => {
              const itemName =
                entry.key ??
                (typeof entry.itemId === "number" ? itemNamesById.get(entry.itemId) ?? `Item ${entry.itemId}` : null);
              if (!itemName) return map;
              const current = map[itemName];
              if (current === undefined || entry.time < current) {
                map[itemName] = entry.time;
              }
              return map;
            }, {})
          : {};

      return {
        ...participant,
        goldTimeline: participant.goldTimeline.length > 0 ? participant.goldTimeline : telemetry.goldTimeline,
        xpTimeline: participant.xpTimeline.length > 0 ? participant.xpTimeline : telemetry.xpTimeline,
        lastHitsTimeline: participant.lastHitsTimeline.length > 0 ? participant.lastHitsTimeline : telemetry.lastHitsTimeline,
        deniesTimeline: participant.deniesTimeline.length > 0 ? participant.deniesTimeline : telemetry.deniesTimeline,
        heroDamageTimeline:
          participant.heroDamageTimeline.length > 0 ? participant.heroDamageTimeline : telemetry.heroDamageTimeline,
        damageTakenTimeline:
          participant.damageTakenTimeline.length > 0 ? participant.damageTakenTimeline : telemetry.damageTakenTimeline,
        purchaseLog:
          participant.purchaseLog.length > 0
            ? participant.purchaseLog
            : telemetry.purchaseLog
                .map((entry) => ({
                  time: entry.time,
                  key:
                    entry.key ??
                    (typeof entry.itemId === "number"
                      ? itemNamesById.get(entry.itemId) ?? `Item ${entry.itemId}`
                      : "Unknown item"),
                  charges: entry.charges
                })),
        firstPurchaseTimes:
          Object.keys(participant.firstPurchaseTimes).length > 0
            ? participant.firstPurchaseTimes
            : derivedFirstPurchaseTimes,
        observerLog: participant.observerLog.length > 0 ? participant.observerLog : telemetry.observerLog,
        sentryLog: participant.sentryLog.length > 0 ? participant.sentryLog : telemetry.sentryLog,
        observerWardsPlaced:
          participant.observerWardsPlaced !== null ? participant.observerWardsPlaced : telemetry.observerWardsPlaced,
        sentryWardsPlaced:
          participant.sentryWardsPlaced !== null ? participant.sentryWardsPlaced : telemetry.sentryWardsPlaced
      };
    });
  }

  private async tryStratzMatchEnrichment(
    matchId: number,
    participants: MatchParticipant[],
    options?: { forceRefresh?: boolean }
  ): Promise<{ participants: MatchParticipant[]; status: TelemetryProviderStatus }> {
    const settings = await this.settingsService.getSettings();
    if (!settings.stratzApiKey) {
      return {
        participants,
        status: {
          configured: false,
          attempted: false,
          timelines: false,
          itemTimings: false,
          vision: false,
          message: "STRATZ API key is not configured."
        }
      };
    }

    const baselineFlags = this.getTelemetryFlags(participants);
    const shouldAttempt = !baselineFlags.timelines || !baselineFlags.itemTimings || !baselineFlags.vision;

    if (!shouldAttempt) {
      return {
        participants,
        status: {
          configured: true,
          attempted: false,
          timelines: false,
          itemTimings: false,
          vision: false,
          message: "OpenDota already covered the available telemetry for this match."
        }
      };
    }

    const cachedTelemetry = options?.forceRefresh ? null : await this.getCachedStratzMatchTelemetry(matchId);
    if (cachedTelemetry?.players?.length) {
      const itemNamesById = await this.resolveStratzPurchaseNames(cachedTelemetry.players);
      const mergedParticipants = this.mergeStratzTelemetryIntoParticipants(
        participants,
        cachedTelemetry.players,
        itemNamesById
      );
      const mergedFlags = this.getTelemetryFlags(mergedParticipants);

      return {
        participants: mergedParticipants,
        status: {
          configured: true,
          attempted: false,
          timelines: mergedFlags.timelines && !baselineFlags.timelines,
          itemTimings: mergedFlags.itemTimings && !baselineFlags.itemTimings,
          vision: mergedFlags.vision && !baselineFlags.vision,
          message: mergedFlags.timelines || mergedFlags.itemTimings || mergedFlags.vision ? "Cached STRATZ telemetry applied." : "Cached STRATZ telemetry did not include extra timeline or item telemetry."
        }
      };
    }

    try {
      const adapter = await this.createStratzAdapter();
      const result = await adapter.getMatchTelemetry(matchId);

      await this.rawPayloads.store({
        provider: "stratz",
        entityType: "match_telemetry",
        entityId: String(matchId),
        fetchedAt: result.fetchedAt,
        rawJson: result.payload,
        parseVersion: "stratz-telemetry-v1"
      });

      const itemNamesById = await this.resolveStratzPurchaseNames(result.payload.players);
      const mergedParticipants = this.mergeStratzTelemetryIntoParticipants(
        participants,
        result.payload.players,
        itemNamesById
      );
      const mergedFlags = this.getTelemetryFlags(mergedParticipants);

      return {
        participants: mergedParticipants,
        status: {
          configured: true,
          attempted: true,
          timelines: mergedFlags.timelines && !baselineFlags.timelines,
          itemTimings: mergedFlags.itemTimings && !baselineFlags.itemTimings,
          vision: mergedFlags.vision && !baselineFlags.vision,
          message:
            result.payload.players.length > 0
              ? mergedFlags.timelines || mergedFlags.itemTimings || mergedFlags.vision
                ? `STRATZ supplied additional telemetry for ${result.payload.players.length} players.`
                : "STRATZ responded for this match, but did not include extra timeline or item telemetry."
              : "STRATZ telemetry query ran, but no usable player telemetry was returned."
        }
      };
    } catch (error) {
      return {
        participants,
        status: {
          configured: true,
          attempted: true,
          timelines: false,
          itemTimings: false,
          vision: false,
          message: error instanceof Error ? error.message : "STRATZ enrichment failed."
        }
      };
    }
  }

  async ensureReferenceData() {
    const adapter = await this.createOpenDotaAdapter();
    await new ReferenceDataService(adapter, this.rawPayloads).syncIfStale();
  }

  private async getLatestRawPayloadFetchedAt(entityType: string, entityId: string) {
    const [row] = await db
      .select({ fetchedAt: rawApiPayloads.fetchedAt })
      .from(rawApiPayloads)
      .where(and(eq(rawApiPayloads.entityType, entityType), eq(rawApiPayloads.entityId, entityId)))
      .orderBy(desc(rawApiPayloads.fetchedAt))
      .limit(1);

    if (!row?.fetchedAt) return null;
    return row.fetchedAt instanceof Date ? row.fetchedAt.getTime() : Number(row.fetchedAt);
  }

  private labelParsedData(flags: Omit<MatchParsedData, "label">): string {
    return flags.timelines && flags.itemTimings && flags.vision ? "Full" : "Basic";
  }

  private async getMatchParsedDataMap(matchIds: number[]) {
    const uniqueMatchIds = [...new Set(matchIds.filter((matchId) => Number.isInteger(matchId) && matchId > 0))];
    const fallback = new Map<number, MatchParsedData>();
    if (uniqueMatchIds.length === 0) return fallback;

    const rows = await db
      .select({
        matchId: matchPlayers.matchId,
        timelines: sql<number>`
          sum(
            case
              when (
                ${matchPlayers.goldTJson} is not null
                and json_valid(${matchPlayers.goldTJson})
                and json_array_length(${matchPlayers.goldTJson}) > 0
              )
                or (
                  ${matchPlayers.xpTJson} is not null
                  and json_valid(${matchPlayers.xpTJson})
                  and json_array_length(${matchPlayers.xpTJson}) > 0
                )
                or (
                  ${matchPlayers.lhTJson} is not null
                  and json_valid(${matchPlayers.lhTJson})
                  and json_array_length(${matchPlayers.lhTJson}) > 0
                )
              then 1
              else 0
            end
          )
        `,
        itemTimings: sql<number>`
          sum(
            case
              when (
                ${matchPlayers.firstPurchaseTimeJson} is not null
                and json_valid(${matchPlayers.firstPurchaseTimeJson})
                and json_array_length(${matchPlayers.firstPurchaseTimeJson}) > 0
              )
                or (
                  ${matchPlayers.purchaseLogJson} is not null
                  and json_valid(${matchPlayers.purchaseLogJson})
                  and json_array_length(${matchPlayers.purchaseLogJson}) > 0
                )
              then 1
              else 0
            end
          )
        `,
        vision: sql<number>`
          sum(
            case
              when (
                ${matchPlayers.obsLogJson} is not null
                and json_valid(${matchPlayers.obsLogJson})
                and json_array_length(${matchPlayers.obsLogJson}) > 0
              )
                or (
                  ${matchPlayers.senLogJson} is not null
                  and json_valid(${matchPlayers.senLogJson})
                  and json_array_length(${matchPlayers.senLogJson}) > 0
                )
                or ${matchPlayers.obsPlaced} is not null
                or ${matchPlayers.senPlaced} is not null
              then 1
              else 0
            end
          )
        `
      })
      .from(matchPlayers)
      .where(inArray(matchPlayers.matchId, uniqueMatchIds))
      .groupBy(matchPlayers.matchId);

    const rawPayloadRows = await db
      .select({ entityId: rawApiPayloads.entityId })
      .from(rawApiPayloads)
      .where(and(eq(rawApiPayloads.entityType, "match"), inArray(rawApiPayloads.entityId, uniqueMatchIds.map(String))));
    const matchIdsWithRawPayload = new Set(rawPayloadRows.map((row) => Number(row.entityId)));

    const stratzTelemetryRows = await db
      .select({ entityId: rawApiPayloads.entityId, rawJson: rawApiPayloads.rawJson })
      .from(rawApiPayloads)
      .where(
        and(
          eq(rawApiPayloads.provider, "stratz"),
          eq(rawApiPayloads.entityType, "match_telemetry"),
          inArray(rawApiPayloads.entityId, uniqueMatchIds.map(String))
        )
      )
      .orderBy(desc(rawApiPayloads.fetchedAt));
    const stratzFlagsByMatchId = new Map<
      number,
      { timelines: boolean; itemTimings: boolean; vision: boolean }
    >();

    for (const row of stratzTelemetryRows) {
      const matchId = Number(row.entityId);
      if (stratzFlagsByMatchId.has(matchId)) continue;

      try {
        const payload = JSON.parse(row.rawJson) as StratzMatchTelemetry;
        const playersWithTelemetry = payload.players ?? [];
        stratzFlagsByMatchId.set(matchId, {
          timelines: playersWithTelemetry.some(
            (player) =>
              player.goldTimeline.length > 0 ||
              player.xpTimeline.length > 0 ||
              player.lastHitsTimeline.length > 0 ||
              player.deniesTimeline.length > 0 ||
              player.heroDamageTimeline.length > 0 ||
              player.damageTakenTimeline.length > 0
          ),
          itemTimings: playersWithTelemetry.some((player) => player.purchaseLog.length > 0),
          vision: playersWithTelemetry.some(
            (player) =>
              player.observerLog.length > 0 ||
              player.sentryLog.length > 0
          )
        });
      } catch {
        stratzFlagsByMatchId.set(matchId, { timelines: false, itemTimings: false, vision: false });
      }
    }

    for (const row of rows) {
      if (row.matchId === null) continue;
      const stratzFlags = stratzFlagsByMatchId.get(row.matchId);
      const flags = {
        hasFullMatchPayload: matchIdsWithRawPayload.has(row.matchId),
        timelines: Number(row.timelines ?? 0) > 0 || Boolean(stratzFlags?.timelines),
        itemTimings: Number(row.itemTimings ?? 0) > 0 || Boolean(stratzFlags?.itemTimings),
        vision: Number(row.vision ?? 0) > 0 || Boolean(stratzFlags?.vision)
      };
      fallback.set(row.matchId, {
        ...flags,
        label: this.labelParsedData(flags)
      });
    }

    for (const matchId of uniqueMatchIds) {
      if (fallback.has(matchId)) continue;
      const stratzFlags = stratzFlagsByMatchId.get(matchId);
      const flags = {
        hasFullMatchPayload: matchIdsWithRawPayload.has(matchId),
        timelines: Boolean(stratzFlags?.timelines),
        itemTimings: Boolean(stratzFlags?.itemTimings),
        vision: Boolean(stratzFlags?.vision)
      };
      fallback.set(matchId, {
        ...flags,
        label: this.labelParsedData(flags)
      });
    }

    return fallback;
  }

  private async isPriorityPlayer(playerId: number) {
    const settings = await this.settingsService.getSettings();
    return settings.primaryPlayerId === playerId || settings.favoritePlayerIds.includes(playerId);
  }

  private async shouldAutoRefreshPlayer(playerId: number) {
    const settings = await this.settingsService.getSettings();
    return settings.autoRefreshPlayerIds.includes(playerId);
  }

  private async getRecentPatchMatchScope() {
    const settings = await this.settingsService.getSettings();
    if (!settings.limitToRecentPatches) {
      return null;
    }

    const patchWindowSize = Math.max(1, settings.recentPatchCount + 1);

    const latestPatchRows = await db
      .select({ patchId: matches.patchId })
      .from(matches)
      .where(sql`${matches.patchId} is not null`)
      .groupBy(matches.patchId)
      .orderBy(desc(matches.patchId))
      .limit(patchWindowSize);

    const patchIds = latestPatchRows
      .map((row) => row.patchId)
      .filter((value): value is number => Number.isInteger(value));

    if (patchIds.length === 0) {
      return null;
    }

    const [cutoffRow] = await db
      .select({ earliestStartTime: sql<Date | null>`min(${matches.startTime})` })
      .from(matches)
      .where(and(inArray(matches.patchId, patchIds), sql`${matches.startTime} is not null`));

    const cutoffStartTimeMs =
      cutoffRow?.earliestStartTime instanceof Date
        ? cutoffRow.earliestStartTime.getTime()
        : typeof cutoffRow?.earliestStartTime === "number"
          ? cutoffRow.earliestStartTime
          : typeof cutoffRow?.earliestStartTime === "string"
            ? Number(cutoffRow.earliestStartTime)
            : null;

    return { patchIds, cutoffStartTimeMs };
  }

  private async getMatchScopeLabel(matchScope: { patchIds: number[]; cutoffStartTimeMs: number | null } | null) {
    const settings = await this.settingsService.getSettings();
    if (!settings.limitToRecentPatches || !matchScope) {
      return "All locally stored matches";
    }

    if (settings.recentPatchCount === 0) {
      return "Current patch only";
    }

    return `Current + previous ${settings.recentPatchCount} patch${settings.recentPatchCount === 1 ? "" : "es"}`;
  }

  private buildMatchScopeCondition(
    matchTable: { patchId: typeof matches.patchId; startTime: typeof matches.startTime },
    matchScope: { patchIds: number[]; cutoffStartTimeMs: number | null } | null
  ) {
    if (!matchScope || (matchScope.patchIds.length === 0 && !matchScope.cutoffStartTimeMs)) {
      return sql`1 = 1`;
    }

    const clauses = [];
    if (matchScope.patchIds.length > 0) {
      clauses.push(inArray(matchTable.patchId, matchScope.patchIds));
    }
    if (matchScope.cutoffStartTimeMs) {
      clauses.push(sql`${matchTable.startTime} >= ${matchScope.cutoffStartTimeMs}`);
    }

    return sql`(${sql.join(clauses, sql` or `)})`;
  }

  async getPlayerOverview(playerId: number): Promise<PlayerOverview> {
    await this.ensureReferenceData();
    const adapter = await this.createOpenDotaAdapter();
    const matchScope = await this.getRecentPatchMatchScope();
    const matchScopeLabel = await this.getMatchScopeLabel(matchScope);
    const matchScopeCondition = this.buildMatchScopeCondition(matches, matchScope);
    const priorityPlayer = await this.isPriorityPlayer(playerId);
    const autoRefreshOnOpen = await this.shouldAutoRefreshPlayer(playerId);
    const [playerRow] = await db.select().from(players).where(eq(players.id, playerId)).limit(1);
    const missingRankInfo = playerRow ? playerRow.rankTier === null && playerRow.leaderboardRank === null : false;
    const [recentMatchesMeta] = await db
      .select({ latestMatch: sql<Date | null>`max(${matches.updatedAt})` })
      .from(matchPlayers)
      .leftJoin(matches, eq(matches.id, matchPlayers.matchId))
      .where(eq(matchPlayers.playerId, playerId));

    const recentLastUpdated =
      recentMatchesMeta?.latestMatch instanceof Date
        ? recentMatchesMeta.latestMatch.getTime()
        : typeof recentMatchesMeta?.latestMatch === "number"
          ? recentMatchesMeta.latestMatch
          : typeof recentMatchesMeta?.latestMatch === "string"
            ? Number(recentMatchesMeta.latestMatch)
            : null;
    const shouldRefresh =
      autoRefreshOnOpen ||
      missingRankInfo ||
      !playerRow?.lastProfileFetchedAt ||
      !recentLastUpdated ||
      Date.now() - playerRow.lastProfileFetchedAt.getTime() > config.staleWindows.playerRecentMatchesMs ||
      Date.now() - recentLastUpdated > config.staleWindows.playerRecentMatchesMs;
    const latestHistorySyncAt = await this.getLatestRawPayloadFetchedAt("player_match_history", String(playerId));
    const shouldRefreshHistory =
      priorityPlayer && (!latestHistorySyncAt || Date.now() - latestHistorySyncAt > 24 * 60 * 60 * 1000);

    let source: "cache" | "fresh" = "cache";

    if (shouldRefresh || shouldRefreshHistory) {
      logger.info("Refreshing player data", { playerId });
      const requests = [
        adapter.getPlayerProfile(playerId),
        adapter.getPlayerRecentMatches(playerId),
        adapter.getPlayerWinLoss(playerId)
      ] as const;
      const [profile, recentMatches, winLoss] = await Promise.all(requests);

      const historyMatches = shouldRefreshHistory
        ? await adapter.getPlayerMatches(playerId, { days: 3650 })
        : null;

      source = "fresh";

      await this.rawPayloads.store({
        provider: "opendota",
        entityType: "player_profile",
        entityId: String(playerId),
        fetchedAt: profile.fetchedAt,
        rawJson: profile.payload
      });

      await this.rawPayloads.store({
        provider: "opendota",
        entityType: "player_recent_matches",
        entityId: String(playerId),
        fetchedAt: recentMatches.fetchedAt,
        rawJson: recentMatches.payload
      });

      await this.rawPayloads.store({
        provider: "opendota",
        entityType: "player_wl",
        entityId: String(playerId),
        fetchedAt: winLoss.fetchedAt,
        rawJson: winLoss.payload
      });

      if (historyMatches) {
        await this.rawPayloads.store({
          provider: "opendota",
          entityType: "player_match_history",
          entityId: String(playerId),
          fetchedAt: historyMatches.fetchedAt,
          rawJson: historyMatches.payload,
          requestContext: { days: 3650 }
        });
      }

      await db
        .insert(players)
        .values({
          id: playerId,
          personaname: profile.payload.profile?.personaname ?? null,
          avatar: profile.payload.profile?.avatarmedium ?? null,
          profileUrl: profile.payload.profile?.profileurl ?? null,
          countryCode: profile.payload.profile?.loccountrycode ?? null,
          rankTier: profile.payload.rank_tier ?? null,
          leaderboardRank: profile.payload.leaderboard_rank ?? null,
          lastProfileFetchedAt: new Date(profile.fetchedAt),
          updatedAt: new Date()
        })
        .onConflictDoUpdate({
          target: players.id,
          set: {
            personaname: profile.payload.profile?.personaname ?? null,
            avatar: profile.payload.profile?.avatarmedium ?? null,
            profileUrl: profile.payload.profile?.profileurl ?? null,
            countryCode: profile.payload.profile?.loccountrycode ?? null,
            rankTier: profile.payload.rank_tier ?? null,
            leaderboardRank: profile.payload.leaderboard_rank ?? null,
            lastProfileFetchedAt: new Date(profile.fetchedAt),
            updatedAt: new Date()
          }
        });

      const combinedMatches = [...recentMatches.payload, ...(historyMatches?.payload ?? [])];
      const dedupedMatches = new Map<number, OpenDotaRecentMatch>();
      for (const match of combinedMatches) {
        dedupedMatches.set(match.match_id, match);
      }

      for (const match of dedupedMatches.values()) {
        await this.upsertRecentMatch(db, playerId, match, historyMatches?.fetchedAt ?? recentMatches.fetchedAt);
      }
    }

    const [freshPlayer] = await db.select().from(players).where(eq(players.id, playerId)).limit(1);
    if (!freshPlayer) {
      throw new Error("Player not found.");
    }

    const [{ totalStoredMatches }] = await db
      .select({ totalStoredMatches: count(matchPlayers.id) })
      .from(matchPlayers)
      .leftJoin(matches, eq(matches.id, matchPlayers.matchId))
      .where(and(eq(matchPlayers.playerId, playerId), matchScopeCondition));

    const [{ totalLocalMatches }] = await db
      .select({ totalLocalMatches: count(matchPlayers.id) })
      .from(matchPlayers)
      .where(eq(matchPlayers.playerId, playerId));

    const playerMatches = await db
      .select({
        matchId: matches.id,
        startTime: matches.startTime,
        durationSeconds: matches.durationSeconds,
        heroId: matchPlayers.heroId,
        heroInternalName: heroes.name,
        heroName: heroes.localizedName,
        heroIconPath: heroes.iconPath,
        kills: matchPlayers.kills,
        deaths: matchPlayers.deaths,
        assists: matchPlayers.assists,
        win: matchPlayers.win,
        laneRole: matchPlayers.laneRole,
        gameMode: matchPlayers.gameMode
      })
      .from(matchPlayers)
      .leftJoin(matches, eq(matches.id, matchPlayers.matchId))
      .leftJoin(heroes, eq(heroes.id, matchPlayers.heroId))
      .where(and(eq(matchPlayers.playerId, playerId), matchScopeCondition))
      .orderBy(desc(matches.startTime))
      .limit(priorityPlayer ? 100 : 20);
    const playerMatchParsedData = await this.getMatchParsedDataMap(
      playerMatches.map((match) => match.matchId).filter((matchId): matchId is number => matchId !== null)
    );

    const heroUsageRows = await db
      .select({
        heroId: matchPlayers.heroId,
        heroInternalName: heroes.name,
        heroName: heroes.localizedName,
        heroIconPath: heroes.iconPath,
        games: sql<number>`count(${matchPlayers.id})`,
        wins: sql<number>`sum(case when ${matchPlayers.win} = 1 then 1 else 0 end)`
      })
      .from(matchPlayers)
      .leftJoin(matches, eq(matches.id, matchPlayers.matchId))
      .leftJoin(heroes, eq(heroes.id, matchPlayers.heroId))
      .where(and(eq(matchPlayers.playerId, playerId), matchScopeCondition))
      .groupBy(matchPlayers.heroId, heroes.localizedName)
      .orderBy(desc(sql`count(${matchPlayers.id})`));

    const playerMatchBase = alias(matchPlayers, "player_match_base");
    const peerMatch = alias(matchPlayers, "peer_match");
    const peerPlayer = alias(players, "peer_player");

    const peerRows = await db
      .select({
        playerId: peerMatch.playerId,
        personaname: peerPlayer.personaname,
        avatar: peerPlayer.avatar,
        games: count(peerMatch.id),
        wins: sql<number>`sum(case when ${playerMatchBase.win} = 1 then 1 else 0 end)`
      })
      .from(playerMatchBase)
      .innerJoin(
        peerMatch,
        and(
          eq(peerMatch.matchId, playerMatchBase.matchId),
          eq(peerMatch.isRadiant, playerMatchBase.isRadiant),
          sql`${peerMatch.playerId} is not null`,
          sql`${peerMatch.playerId} != ${playerId}`
        )
      )
      .leftJoin(matches, eq(matches.id, playerMatchBase.matchId))
      .leftJoin(peerPlayer, eq(peerPlayer.id, peerMatch.playerId))
      .where(and(eq(playerMatchBase.playerId, playerId), matchScopeCondition))
      .groupBy(peerMatch.playerId, peerPlayer.personaname, peerPlayer.avatar)
      .orderBy(desc(count(peerMatch.id)))
      .limit(12);

    const [winLossRow] = await db
      .select({
        wins: sql<number>`sum(case when ${matchPlayers.win} = 1 then 1 else 0 end)`,
        losses: sql<number>`sum(case when ${matchPlayers.win} = 0 then 1 else 0 end)`
      })
      .from(matchPlayers)
      .leftJoin(matches, eq(matches.id, matchPlayers.matchId))
      .where(and(eq(matchPlayers.playerId, playerId), matchScopeCondition));

    const historySyncedAt = await this.getLatestRawPayloadFetchedAt("player_match_history", String(playerId));

    return {
      playerId: freshPlayer.id,
      personaname: freshPlayer.personaname,
      avatar: freshPlayer.avatar,
      profileUrl: freshPlayer.profileUrl,
      countryCode: freshPlayer.countryCode,
      rankTier: freshPlayer.rankTier,
      leaderboardRank: freshPlayer.leaderboardRank,
      isPriorityPlayer: priorityPlayer,
      autoRefreshOnOpen,
      historySyncedAt,
      source,
      lastSyncedAt: freshPlayer.lastProfileFetchedAt?.getTime() ?? null,
      totalStoredMatches: totalStoredMatches ?? 0,
      totalLocalMatches: totalLocalMatches ?? 0,
      matchScopeLabel,
      wins: winLossRow?.wins ?? 0,
      losses: winLossRow?.losses ?? 0,
      heroUsage: heroUsageRows.map((row) => ({
        heroId: row.heroId ?? 0,
        heroName: row.heroName ?? `Hero ${row.heroId}`,
        heroIconUrl: buildAssetProxyUrl(row.heroIconPath ?? defaultHeroIconPath(row.heroInternalName)),
        games: row.games,
        wins: row.wins ?? 0,
        winrate: row.games ? Number((((row.wins ?? 0) / row.games) * 100).toFixed(1)) : 0
      })),
      peers: peerRows
        .filter((row) => row.playerId !== null)
        .map((row) => ({
          playerId: row.playerId ?? 0,
          personaname: row.personaname,
          avatar: row.avatar,
          games: row.games,
          wins: row.wins ?? 0,
          winrate: row.games ? Number((((row.wins ?? 0) / row.games) * 100).toFixed(1)) : 0
        })),
      matches: playerMatches.map((match) => ({
        matchId: match.matchId ?? 0,
        startTime: match.startTime?.getTime() ?? null,
        durationSeconds: match.durationSeconds,
        heroId: match.heroId,
        heroName: match.heroName,
        heroIconUrl: buildAssetProxyUrl(match.heroIconPath ?? defaultHeroIconPath(match.heroInternalName)),
        kills: match.kills,
        deaths: match.deaths,
        assists: match.assists,
        win: match.win,
        laneRole: match.laneRole,
        gameMode: match.gameMode,
        parsedData: playerMatchParsedData.get(match.matchId ?? 0) ?? {
          label: "Basic",
          hasFullMatchPayload: false,
          timelines: false,
          itemTimings: false,
          vision: false
        }
      }))
    };
  }

  async syncPlayerHistory(playerId: number) {
    await this.ensureReferenceData();
    const adapter = await this.createOpenDotaAdapter();
    const historyMatches = await adapter.getPlayerMatches(playerId, { days: 3650 });

    await this.rawPayloads.store({
      provider: "opendota",
      entityType: "player_match_history",
      entityId: String(playerId),
      fetchedAt: historyMatches.fetchedAt,
      rawJson: historyMatches.payload,
      requestContext: { days: 3650, mode: "manual" }
    });

    for (const match of historyMatches.payload) {
      await this.upsertRecentMatch(db, playerId, match, historyMatches.fetchedAt);
    }

    return this.getPlayerOverview(playerId);
  }

  async comparePlayers(playerIds: number[]): Promise<PlayerCompareResponse> {
    await this.ensureReferenceData();
    const matchScope = await this.getRecentPatchMatchScope();
    const matchScopeCondition = this.buildMatchScopeCondition(matches, matchScope);
    const uniquePlayerIds = [...new Set(playerIds.filter((id) => Number.isInteger(id) && id > 0))];

    if (uniquePlayerIds.length < 2) {
      throw new Error("Choose at least two players to compare.");
    }

    const playersData = await Promise.all(uniquePlayerIds.map((playerId) => this.getPlayerOverview(playerId)));

    const selectedMatchBase = alias(matchPlayers, "selected_match_base");
    const selectedMatchPeer = alias(matchPlayers, "selected_match_peer");

    const sharedCandidateRows = await db
      .select({
        matchId: selectedMatchBase.matchId,
        win: selectedMatchBase.win,
        leftPlayerId: selectedMatchBase.playerId,
        rightPlayerId: selectedMatchPeer.playerId
      })
      .from(selectedMatchBase)
      .innerJoin(
        selectedMatchPeer,
        and(
          eq(selectedMatchPeer.matchId, selectedMatchBase.matchId),
          eq(selectedMatchPeer.isRadiant, selectedMatchBase.isRadiant)
        )
      )
      .leftJoin(matches, eq(matches.id, selectedMatchBase.matchId))
      .where(
        and(
          inArray(selectedMatchBase.playerId, uniquePlayerIds),
          inArray(selectedMatchPeer.playerId, uniquePlayerIds),
          sql`${selectedMatchBase.playerId} < ${selectedMatchPeer.playerId}`,
          matchScopeCondition
        )
      );

    const matchToPlayers = new Map<number, Set<number>>();
    const pairMap = new Map<string, { leftPlayerId: number; rightPlayerId: number; games: number; wins: number; losses: number }>();

    for (const row of sharedCandidateRows) {
      if (row.leftPlayerId == null || row.rightPlayerId == null || row.matchId == null) continue;

      const set = matchToPlayers.get(row.matchId) ?? new Set<number>();
      set.add(row.leftPlayerId);
      set.add(row.rightPlayerId);
      matchToPlayers.set(row.matchId, set);

      const left = Math.min(row.leftPlayerId, row.rightPlayerId);
      const right = Math.max(row.leftPlayerId, row.rightPlayerId);
      const key = `${left}:${right}`;
      const current = pairMap.get(key) ?? { leftPlayerId: left, rightPlayerId: right, games: 0, wins: 0, losses: 0 };
      current.games += 1;
      if (row.win === null) {
        // ignore unknown
      } else if (row.win === true || row.win === false) {
        if (row.win) current.wins += 1;
        else current.losses += 1;
      }
      pairMap.set(key, current);
    }

    const sharedMatchIds = [...matchToPlayers.entries()]
      .filter(([, presentPlayers]) => uniquePlayerIds.every((playerId) => presentPlayers.has(playerId)))
      .map(([matchId]) => matchId);

    let sharedStats = {
      games: 0,
      wins: 0,
      losses: 0,
      winrate: 0,
      recentMatchIds: [] as number[]
    };
    let sharedMatchDetails: Array<{
      matchId: number;
      startTime: number | null;
      durationSeconds: number | null;
      win: boolean | null;
    }> = [];
    let heroCombinations: Array<{
      comboKey: string;
      games: number;
      wins: number;
      losses: number;
      winrate: number;
      matchIds: number[];
      heroes: Array<{
        playerId: number;
        personaname: string | null;
        heroId: number;
        heroName: string;
        heroIconUrl: string | null;
      }>;
    }> = [];

    if (sharedMatchIds.length > 0) {
      const sharedRows = await db
        .select({
          matchId: matchPlayers.matchId,
          playerId: matchPlayers.playerId,
          heroId: matchPlayers.heroId,
          heroInternalName: heroes.name,
          heroName: heroes.localizedName,
          heroIconPath: heroes.iconPath,
          win: matchPlayers.win,
          startTime: matches.startTime,
          durationSeconds: matches.durationSeconds
        })
        .from(matchPlayers)
        .leftJoin(matches, eq(matches.id, matchPlayers.matchId))
        .leftJoin(heroes, eq(heroes.id, matchPlayers.heroId))
        .where(and(inArray(matchPlayers.matchId, sharedMatchIds), inArray(matchPlayers.playerId, uniquePlayerIds), matchScopeCondition))
        .orderBy(desc(matches.startTime));

      const seenSharedMatches = new Set<number>();
      const matchSummaryMap = new Map<
        number,
        { matchId: number; startTime: number | null; durationSeconds: number | null; win: boolean | null }
      >();
      const matchHeroMap = new Map<
        number,
        Array<{
          playerId: number;
          heroId: number;
          heroName: string;
          heroIconUrl: string | null;
          win: boolean | null;
        }>
      >();
      let sharedWins = 0;
      let sharedLosses = 0;

      for (const row of sharedRows) {
        if (row.matchId == null) continue;
        if (!seenSharedMatches.has(row.matchId)) {
          seenSharedMatches.add(row.matchId);
          if (row.win === true) sharedWins += 1;
          if (row.win === false) sharedLosses += 1;
        }

        if (!matchSummaryMap.has(row.matchId)) {
          matchSummaryMap.set(row.matchId, {
            matchId: row.matchId,
            startTime: row.startTime?.getTime() ?? null,
            durationSeconds: row.durationSeconds ?? null,
            win: row.win
          });
        }

        if (row.playerId != null && row.heroId != null && row.heroName) {
          const currentMatchHeroes = matchHeroMap.get(row.matchId) ?? [];
          currentMatchHeroes.push({
            playerId: row.playerId,
            heroId: row.heroId,
            heroName: row.heroName,
            heroIconUrl: buildAssetProxyUrl(row.heroIconPath ?? defaultHeroIconPath(row.heroInternalName)),
            win: row.win
          });
          matchHeroMap.set(row.matchId, currentMatchHeroes);
        }
      }

      const comboMap = new Map<
        string,
        {
          comboKey: string;
          games: number;
          wins: number;
          losses: number;
          matchIds: number[];
          heroes: Array<{
            playerId: number;
            personaname: string | null;
            heroId: number;
            heroName: string;
            heroIconUrl: string | null;
          }>;
        }
      >();

      for (const [matchId, matchHeroes] of matchHeroMap) {
        const orderedHeroes = uniquePlayerIds
          .map((playerId) => {
            const matchHero = matchHeroes.find((entry) => entry.playerId === playerId);
            const playerOverview = playersData.find((entry) => entry.playerId === playerId);
            if (!matchHero) return null;

            return {
              playerId,
              personaname: playerOverview?.personaname ?? null,
              heroId: matchHero.heroId,
              heroName: matchHero.heroName,
              heroIconUrl: matchHero.heroIconUrl
            };
          })
          .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

        if (orderedHeroes.length !== uniquePlayerIds.length) {
          continue;
        }

        const comboKey = orderedHeroes.map((entry) => `${entry.personaname ?? entry.playerId}: ${entry.heroName}`).join(" + ");
        const matchWin = matchHeroes[0]?.win ?? null;
        const currentCombo = comboMap.get(comboKey) ?? {
          comboKey,
          games: 0,
          wins: 0,
          losses: 0,
          matchIds: [],
          heroes: orderedHeroes
        };

        currentCombo.games += 1;
        if (matchWin === true) currentCombo.wins += 1;
        if (matchWin === false) currentCombo.losses += 1;
        if (!currentCombo.matchIds.includes(matchId)) {
          currentCombo.matchIds.push(matchId);
        }
        comboMap.set(comboKey, currentCombo);
      }

      sharedMatchDetails = [...matchSummaryMap.values()].sort((left, right) => (right.startTime ?? 0) - (left.startTime ?? 0));
      heroCombinations = [...comboMap.values()]
        .map((entry) => ({
          ...entry,
          winrate: entry.games ? Number(((entry.wins / entry.games) * 100).toFixed(1)) : 0
        }))
        .sort((left, right) => {
          if (right.games !== left.games) return right.games - left.games;
          return right.winrate - left.winrate;
        });

      sharedStats = {
        games: seenSharedMatches.size,
        wins: sharedWins,
        losses: sharedLosses,
        winrate: seenSharedMatches.size ? Number(((sharedWins / seenSharedMatches.size) * 100).toFixed(1)) : 0,
        recentMatchIds: [...seenSharedMatches].slice(0, 10)
      };
    }

    return {
      playerIds: uniquePlayerIds,
      players: playersData.map((player) => ({
        playerId: player.playerId,
        personaname: player.personaname,
        avatar: player.avatar,
        rankTier: player.rankTier,
        leaderboardRank: player.leaderboardRank,
        totalStoredMatches: player.totalStoredMatches,
        wins: player.wins,
        losses: player.losses,
        topHeroes: player.heroUsage.slice(0, 5)
      })),
      sharedMatches: sharedStats,
      sharedMatchDetails,
      pairStats: [...pairMap.values()].map((row) => ({
        ...row,
        winrate: row.games ? Number(((row.wins / row.games) * 100).toFixed(1)) : 0
      })),
      heroCombinations
    };
  }

  async getMatchOverview(matchId: number, options?: { forceRefresh?: boolean }): Promise<MatchOverview> {
    await this.ensureReferenceData();
    const adapter = await this.createOpenDotaAdapter();
    const [matchRow] = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
    const [matchCompleteness] = await db
      .select({
        participantCount: sql<number>`count(${matchPlayers.id})`,
        detailedParticipantCount: sql<number>`
          sum(
            case
              when ${matchPlayers.netWorth} is not null
                or ${matchPlayers.gpm} is not null
                or ${matchPlayers.xpm} is not null
                or ${matchPlayers.heroDamage} is not null
                or ${matchPlayers.lastHits} is not null
              then 1
              else 0
            end
          )
        `,
        timelineParticipantCount: sql<number>`
          sum(
            case
              when (
                ${matchPlayers.goldTJson} is not null
                and json_valid(${matchPlayers.goldTJson})
                and json_array_length(${matchPlayers.goldTJson}) > 0
              )
                or (
                  ${matchPlayers.xpTJson} is not null
                  and json_valid(${matchPlayers.xpTJson})
                  and json_array_length(${matchPlayers.xpTJson}) > 0
                )
                or (
                  ${matchPlayers.lhTJson} is not null
                  and json_valid(${matchPlayers.lhTJson})
                  and json_array_length(${matchPlayers.lhTJson}) > 0
                )
                or (
                  ${matchPlayers.purchaseLogJson} is not null
                  and json_valid(${matchPlayers.purchaseLogJson})
                  and json_array_length(${matchPlayers.purchaseLogJson}) > 0
                )
                or (
                  ${matchPlayers.obsLogJson} is not null
                  and json_valid(${matchPlayers.obsLogJson})
                  and json_array_length(${matchPlayers.obsLogJson}) > 0
                )
                or (
                  ${matchPlayers.senLogJson} is not null
                  and json_valid(${matchPlayers.senLogJson})
                  and json_array_length(${matchPlayers.senLogJson}) > 0
                )
                or ${matchPlayers.obsPlaced} is not null
                or ${matchPlayers.senPlaced} is not null
              then 1
              else 0
            end
          )
        `
      })
      .from(matchPlayers)
      .where(eq(matchPlayers.matchId, matchId));
    const [rawMatchPayload] = await db
      .select({ id: rawApiPayloads.id })
      .from(rawApiPayloads)
      .where(and(eq(rawApiPayloads.entityType, "match"), eq(rawApiPayloads.entityId, String(matchId))))
      .orderBy(desc(rawApiPayloads.fetchedAt))
      .limit(1);

    const participantCount = Number(matchCompleteness?.participantCount ?? 0);
    const detailedParticipantCount = Number(matchCompleteness?.detailedParticipantCount ?? 0);
    const timelineParticipantCount = Number(matchCompleteness?.timelineParticipantCount ?? 0);
    const hasFullRoster = participantCount >= 10;
    const hasDetailedStats = detailedParticipantCount >= 10;
    const hasRawMatchPayload = Boolean(rawMatchPayload);
    const needsFullFetch = options?.forceRefresh || !matchRow || !hasFullRoster || !hasDetailedStats || !hasRawMatchPayload;

    let source: "cache" | "fresh" = "cache";

    if (needsFullFetch) {
      logger.info("Refreshing match data", {
        matchId,
        participantCount,
        detailedParticipantCount,
        hasRawMatchPayload
      });
      const result = await adapter.getMatch(matchId);
      source = "fresh";
      await this.rawPayloads.store({
        provider: "opendota",
        entityType: "match",
        entityId: String(matchId),
        fetchedAt: result.fetchedAt,
        rawJson: result.payload
      });

      await this.upsertDetailedMatch(db, result.payload, result.fetchedAt);
    }

    const [freshMatch] = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
    if (!freshMatch) {
      throw new Error("Match not found.");
    }

    const participants = await db
      .select({
        playerId: matchPlayers.playerId,
        personaname: players.personaname,
        heroId: matchPlayers.heroId,
        heroInternalName: heroes.name,
        heroName: heroes.localizedName,
        heroIconPath: heroes.iconPath,
        isRadiant: matchPlayers.isRadiant,
        playerSlot: matchPlayers.playerSlot,
        kills: matchPlayers.kills,
        deaths: matchPlayers.deaths,
        assists: matchPlayers.assists,
        netWorth: matchPlayers.netWorth,
        gpm: matchPlayers.gpm,
        xpm: matchPlayers.xpm,
        heroDamage: matchPlayers.heroDamage,
        towerDamage: matchPlayers.towerDamage,
        lastHits: matchPlayers.lastHits,
        denies: matchPlayers.denies,
        level: matchPlayers.level,
        goldTJson: matchPlayers.goldTJson,
        xpTJson: matchPlayers.xpTJson,
        lhTJson: matchPlayers.lhTJson,
        dnTJson: matchPlayers.dnTJson,
        firstPurchaseTimeJson: matchPlayers.firstPurchaseTimeJson,
        itemUsesJson: matchPlayers.itemUsesJson,
        purchaseLogJson: matchPlayers.purchaseLogJson,
        obsLogJson: matchPlayers.obsLogJson,
        senLogJson: matchPlayers.senLogJson,
        obsPlaced: matchPlayers.obsPlaced,
        senPlaced: matchPlayers.senPlaced,
        item0: items.localizedName,
        item0Image: items.imagePath,
        item1: sql<string | null>`(select localized_name from items where id = ${matchPlayers.item1})`,
        item1Image: sql<string | null>`(select image_path from items where id = ${matchPlayers.item1})`,
        item2: sql<string | null>`(select localized_name from items where id = ${matchPlayers.item2})`,
        item2Image: sql<string | null>`(select image_path from items where id = ${matchPlayers.item2})`,
        item3: sql<string | null>`(select localized_name from items where id = ${matchPlayers.item3})`,
        item3Image: sql<string | null>`(select image_path from items where id = ${matchPlayers.item3})`,
        item4: sql<string | null>`(select localized_name from items where id = ${matchPlayers.item4})`,
        item4Image: sql<string | null>`(select image_path from items where id = ${matchPlayers.item4})`,
        item5: sql<string | null>`(select localized_name from items where id = ${matchPlayers.item5})`,
        item5Image: sql<string | null>`(select image_path from items where id = ${matchPlayers.item5})`
      })
      .from(matchPlayers)
      .leftJoin(players, eq(players.id, matchPlayers.playerId))
      .leftJoin(heroes, eq(heroes.id, matchPlayers.heroId))
      .leftJoin(items, eq(items.id, matchPlayers.item0))
      .where(eq(matchPlayers.matchId, matchId))
      .orderBy(matchPlayers.playerSlot);

    const patchRow = freshMatch.patchId ? await db.select().from(patches).where(eq(patches.id, freshMatch.patchId)).limit(1) : [];
    const leagueRow = freshMatch.leagueId ? await db.select().from(leagues).where(eq(leagues.id, freshMatch.leagueId)).limit(1) : [];
    const draft = await this.analyticsService.getDraftOverview(matchId);
    const normalizedParticipants = participants.map((row) => ({
      playerId: row.playerId,
      personaname: row.personaname,
      heroId: row.heroId,
      heroName: row.heroName,
      heroIconUrl: buildAssetProxyUrl(row.heroIconPath ?? defaultHeroIconPath(row.heroInternalName)),
      isRadiant: row.isRadiant,
      playerSlot: row.playerSlot,
      kills: row.kills,
      deaths: row.deaths,
      assists: row.assists,
      netWorth: row.netWorth,
      gpm: row.gpm,
      xpm: row.xpm,
      heroDamage: row.heroDamage,
      towerDamage: row.towerDamage,
      lastHits: row.lastHits,
      denies: row.denies,
      level: row.level,
      goldTimeline: parseJsonValue<number[]>(row.goldTJson, []),
      xpTimeline: parseJsonValue<number[]>(row.xpTJson, []),
      lastHitsTimeline: parseJsonValue<number[]>(row.lhTJson, []),
      deniesTimeline: parseJsonValue<number[]>(row.dnTJson, []),
      heroDamageTimeline: [],
      damageTakenTimeline: [],
      firstPurchaseTimes: parseJsonValue<Record<string, number>>(row.firstPurchaseTimeJson, {}),
      itemUses: parseJsonValue<Record<string, number>>(row.itemUsesJson, {}),
      purchaseLog: parseJsonValue<Array<{ time?: number; key?: string; charges?: number }>>(row.purchaseLogJson, [])
        .filter((entry) => typeof entry.time === "number" && typeof entry.key === "string")
        .map((entry) => ({ time: entry.time as number, key: entry.key as string, charges: entry.charges ?? null })),
      observerLog: parseJsonValue<Array<{ time?: number; x?: number; y?: number; z?: number }>>(row.obsLogJson, [])
        .filter((entry) => typeof entry.time === "number")
        .map((entry) => ({ time: entry.time as number, x: entry.x ?? null, y: entry.y ?? null, z: entry.z ?? null })),
      sentryLog: parseJsonValue<Array<{ time?: number; x?: number; y?: number; z?: number }>>(row.senLogJson, [])
        .filter((entry) => typeof entry.time === "number")
        .map((entry) => ({ time: entry.time as number, x: entry.x ?? null, y: entry.y ?? null, z: entry.z ?? null })),
      observerWardsPlaced: row.obsPlaced,
      sentryWardsPlaced: row.senPlaced,
      items: [
        { name: row.item0, imagePath: row.item0Image },
        { name: row.item1, imagePath: row.item1Image },
        { name: row.item2, imagePath: row.item2Image },
        { name: row.item3, imagePath: row.item3Image },
        { name: row.item4, imagePath: row.item4Image },
        { name: row.item5, imagePath: row.item5Image }
      ]
        .filter((item) => Boolean(item.name))
        .map((item) => ({
          name: item.name as string,
          imageUrl: buildAssetProxyUrl(item.imagePath ?? defaultItemImagePath(item.name))
        }))
    }));
    const openDotaFlags = this.getTelemetryFlags(normalizedParticipants);
    const stratzEnrichment = await this.tryStratzMatchEnrichment(matchId, normalizedParticipants, {
      forceRefresh: options?.forceRefresh
    });
    const enrichedParticipants = stratzEnrichment.participants;
    const effectiveFlags = this.getTelemetryFlags(enrichedParticipants);
    const timelineLength = enrichedParticipants.reduce(
      (max, row) =>
        Math.max(
          max,
          row.goldTimeline.length,
          row.xpTimeline.length,
          row.lastHitsTimeline.length,
          row.heroDamageTimeline.length,
          row.damageTakenTimeline.length
        ),
      0
    );
    const radiantPlayers = enrichedParticipants.filter((player) => player.isRadiant);
    const direPlayers = enrichedParticipants.filter((player) => !player.isRadiant);

    const sumBy = (rows: typeof enrichedParticipants, accessor: (row: (typeof enrichedParticipants)[number]) => number | null) =>
      rows.reduce((sum, row) => sum + (accessor(row) ?? 0), 0);
    const averageBy = (
      rows: typeof enrichedParticipants,
      accessor: (row: (typeof enrichedParticipants)[number]) => number | null
    ) => {
      if (rows.length === 0) return 0;
      return Math.round(sumBy(rows, accessor) / rows.length);
    };
    const buildLeader = (
      label: string,
      accessor: (row: (typeof enrichedParticipants)[number]) => number | null
    ) => {
      const sorted = enrichedParticipants
        .map((row) => ({ row, value: accessor(row) ?? 0 }))
        .sort((left, right) => right.value - left.value);
      const best = sorted[0];
      if (!best || best.value <= 0) return null;
      return {
        label,
        playerId: best.row.playerId,
        personaname: best.row.personaname,
        heroName: best.row.heroName,
        team: best.row.isRadiant ? "radiant" : "dire",
        value: best.value
      } as const;
    };

    return {
      matchId: freshMatch.id,
      source,
      lastSyncedAt: freshMatch.lastFetchedAt?.getTime() ?? null,
      durationSeconds: freshMatch.durationSeconds,
      startTime: freshMatch.startTime?.getTime() ?? null,
      radiantWin: freshMatch.radiantWin,
      radiantScore: freshMatch.radiantScore,
      direScore: freshMatch.direScore,
      patch: patchRow[0]?.name ?? null,
      league: leagueRow[0]?.name ?? null,
      telemetryStatus: {
        openDota: {
          configured: true,
          attempted: true,
          timelines: openDotaFlags.timelines,
          itemTimings: openDotaFlags.itemTimings,
          vision: openDotaFlags.vision,
          message: openDotaFlags.timelines || openDotaFlags.itemTimings || openDotaFlags.vision ? "OpenDota supplied part of the match telemetry." : "OpenDota did not include detailed telemetry for this match."
        },
        stratz: stratzEnrichment.status,
        effective: effectiveFlags
      },
      timelineMinutes: Array.from({ length: timelineLength }, (_, index) => index),
      participants: enrichedParticipants,
      draft,
      summary: {
        totalKills: sumBy(enrichedParticipants, (player) => player.kills),
        radiantPlayers: radiantPlayers.length,
        direPlayers: direPlayers.length,
        radiantNetWorth: sumBy(radiantPlayers, (player) => player.netWorth),
        direNetWorth: sumBy(direPlayers, (player) => player.netWorth),
        radiantHeroDamage: sumBy(radiantPlayers, (player) => player.heroDamage),
        direHeroDamage: sumBy(direPlayers, (player) => player.heroDamage),
        radiantTowerDamage: sumBy(radiantPlayers, (player) => player.towerDamage),
        direTowerDamage: sumBy(direPlayers, (player) => player.towerDamage),
        radiantLastHits: sumBy(radiantPlayers, (player) => player.lastHits),
        direLastHits: sumBy(direPlayers, (player) => player.lastHits),
        averageGpm: {
          radiant: averageBy(radiantPlayers, (player) => player.gpm),
          dire: averageBy(direPlayers, (player) => player.gpm)
        },
        averageXpm: {
          radiant: averageBy(radiantPlayers, (player) => player.xpm),
          dire: averageBy(direPlayers, (player) => player.xpm)
        },
        leaders: {
          kills: buildLeader("Kills", (player) => player.kills),
          netWorth: buildLeader("Net worth", (player) => player.netWorth),
          heroDamage: buildLeader("Hero damage", (player) => player.heroDamage),
          lastHits: buildLeader("Last hits", (player) => player.lastHits),
          assists: buildLeader("Assists", (player) => player.assists)
        }
      }
    };
  }

  async getHeroStats() {
    await this.ensureReferenceData();
    const matchScope = await this.getRecentPatchMatchScope();
    return this.analyticsService.getHeroStats(matchScope ?? undefined);
  }

  async getHeroOverview(heroId: number): Promise<HeroOverview> {
    await this.ensureReferenceData();
    const matchScope = await this.getRecentPatchMatchScope();
    const matchScopeCondition = this.buildMatchScopeCondition(matches, matchScope);
    const heroStats = await this.analyticsService.getHeroStats(matchScope ?? undefined);
    const heroStat = heroStats.find((entry) => entry.heroId === heroId);
    const [heroRow] = await db.select().from(heroes).where(eq(heroes.id, heroId)).limit(1);

    if (!heroRow || !heroStat) {
      throw new Error("Hero not found in the local dataset.");
    }

    const recentMatches = await db
      .select({
        matchId: matches.id,
        startTime: matches.startTime,
        durationSeconds: matches.durationSeconds,
        radiantWin: matches.radiantWin,
        radiantScore: matches.radiantScore,
        direScore: matches.direScore,
        patch: patches.name,
        league: leagues.name,
        playerCount: sql<number>`count(distinct ${matchPlayers.playerSlot})`,
        totalKills: sql<number>`sum(coalesce(${matchPlayers.kills}, 0))`
      })
      .from(matchPlayers)
      .leftJoin(matches, eq(matches.id, matchPlayers.matchId))
      .leftJoin(patches, eq(patches.id, matches.patchId))
      .leftJoin(leagues, eq(leagues.id, matches.leagueId))
      .where(and(eq(matchPlayers.heroId, heroId), matchScopeCondition))
      .groupBy(
        matches.id,
        matches.startTime,
        matches.durationSeconds,
        matches.radiantWin,
        matches.radiantScore,
        matches.direScore,
        patches.name,
        leagues.name
      )
      .orderBy(desc(matches.startTime))
      .limit(20);
    const recentMatchParsedData = await this.getMatchParsedDataMap(
      recentMatches.map((match) => match.matchId).filter((matchId): matchId is number => matchId !== null)
    );

    const playerUsage = await db
      .select({
        playerId: matchPlayers.playerId,
        personaname: players.personaname,
        games: sql<number>`count(${matchPlayers.id})`,
        wins: sql<number>`sum(case when ${matchPlayers.win} = 1 then 1 else 0 end)`
      })
      .from(matchPlayers)
      .leftJoin(matches, eq(matches.id, matchPlayers.matchId))
      .leftJoin(players, eq(players.id, matchPlayers.playerId))
      .where(and(eq(matchPlayers.heroId, heroId), matchScopeCondition))
      .groupBy(matchPlayers.playerId, players.personaname)
      .orderBy(desc(sql`count(${matchPlayers.id})`))
      .limit(12);

    return {
      heroId,
      heroName: heroRow.localizedName,
      heroIconUrl: buildAssetProxyUrl(heroRow.iconPath ?? defaultHeroIconPath(heroRow.name)),
      heroPortraitUrl: buildAssetProxyUrl(heroRow.portraitPath ?? defaultHeroPortraitPath(heroRow.name)),
      source: "cache",
      games: heroStat.games,
      wins: heroStat.wins,
      winrate: heroStat.winrate,
      uniquePlayers: heroStat.uniquePlayers,
      averageFirstCoreItemTimingSeconds: heroStat.averageFirstCoreItemTimingSeconds,
      commonItems: heroStat.commonItems,
      recentMatches: recentMatches.map((match) => ({
        matchId: match.matchId ?? 0,
        startTime: match.startTime?.getTime() ?? null,
        durationSeconds: match.durationSeconds,
        radiantWin: match.radiantWin,
        playerCount: match.playerCount,
        totalKills: match.totalKills ?? 0,
        radiantScore: match.radiantScore,
        direScore: match.direScore,
        patch: match.patch ?? null,
        league: match.league ?? null,
        parsedData: recentMatchParsedData.get(match.matchId ?? 0) ?? {
          label: "Basic",
          hasFullMatchPayload: false,
          timelines: false,
          itemTimings: false,
          vision: false
        }
      })),
      playerUsage: playerUsage.map((player) => ({
        playerId: player.playerId,
        personaname: player.personaname,
        games: player.games,
        wins: player.wins ?? 0,
        winrate: player.games ? Number((((player.wins ?? 0) / player.games) * 100).toFixed(1)) : 0
      }))
    };
  }

  async getLeagues(): Promise<LeagueSummary[]> {
    const settings = await this.settingsService.getSettings();
    const rows = await db
      .select({
        leagueId: leagues.id,
        name: leagues.name,
        matchCount: sql<number>`count(distinct ${matches.id})`,
        firstMatchTime: sql<Date | null>`min(${matches.startTime})`,
        lastMatchTime: sql<Date | null>`max(${matches.startTime})`,
        uniquePlayers: sql<number>`count(distinct ${matchPlayers.playerId})`,
        uniqueHeroes: sql<number>`count(distinct ${matchPlayers.heroId})`
      })
      .from(leagues)
      .leftJoin(matches, eq(matches.leagueId, leagues.id))
      .leftJoin(matchPlayers, eq(matchPlayers.matchId, matches.id))
      .groupBy(leagues.id, leagues.name)
      .orderBy(desc(sql`count(${matches.id})`));

    const parsedData = await this.getMatchParsedDataMap(
      (
        await db
          .select({ matchId: matches.id })
          .from(matches)
          .where(sql`${matches.leagueId} is not null`)
      ).map((row) => row.matchId)
    );

    const fullMatchesByLeague = new Map<number, number>();
    const matchLeagueRows = await db
      .select({ matchId: matches.id, leagueId: matches.leagueId })
      .from(matches)
      .where(sql`${matches.leagueId} is not null`);
    for (const row of matchLeagueRows) {
      if (row.leagueId === null) continue;
      if (parsedData.get(row.matchId)?.label !== "Full") continue;
      fullMatchesByLeague.set(row.leagueId, (fullMatchesByLeague.get(row.leagueId) ?? 0) + 1);
    }

    const storedLeagues = rows
      .filter((row) => row.leagueId !== null && row.matchCount > 0)
      .map((row) => {
        const savedLeague = settings.savedLeagues.find((league) => league.leagueId === row.leagueId);
        return {
          leagueId: row.leagueId,
          name: savedLeague?.name ?? row.name,
          matchCount: row.matchCount,
          parsedFullMatches: fullMatchesByLeague.get(row.leagueId) ?? 0,
          firstMatchTime: row.firstMatchTime instanceof Date ? row.firstMatchTime.getTime() : row.firstMatchTime ? Number(row.firstMatchTime) : null,
          lastMatchTime: row.lastMatchTime instanceof Date ? row.lastMatchTime.getTime() : row.lastMatchTime ? Number(row.lastMatchTime) : null,
          uniquePlayers: row.uniquePlayers ?? 0,
          uniqueHeroes: row.uniqueHeroes ?? 0
        };
      });

    const leaguesById = new Map(storedLeagues.map((league) => [league.leagueId, league]));
    for (const league of settings.savedLeagues) {
      if (leaguesById.has(league.leagueId)) continue;
      leaguesById.set(league.leagueId, {
        leagueId: league.leagueId,
        name: league.name,
        matchCount: 0,
        parsedFullMatches: 0,
        firstMatchTime: null,
        lastMatchTime: null,
        uniquePlayers: 0,
        uniqueHeroes: 0
      });
    }

    return [...leaguesById.values()].sort((left, right) => {
      if (right.matchCount !== left.matchCount) return right.matchCount - left.matchCount;
      return left.name.localeCompare(right.name);
    });
  }

  async getLeagueOverview(leagueId: number): Promise<LeagueOverview> {
    await this.ensureReferenceData();
    const settings = await this.settingsService.getSettings();
    const [leagueRow] = await db.select().from(leagues).where(eq(leagues.id, leagueId)).limit(1);
    const savedLeague = settings.savedLeagues.find((league) => league.leagueId === leagueId);
    if (!leagueRow && !savedLeague) {
      throw new Error("League not found in the local dataset.");
    }
    const leagueName = savedLeague?.name ?? leagueRow?.name ?? `League ${leagueId}`;

    const [summary] = await db
      .select({
        matchCount: count(matches.id),
        firstMatchTime: sql<Date | null>`min(${matches.startTime})`,
        lastMatchTime: sql<Date | null>`max(${matches.startTime})`,
        uniquePlayers: sql<number>`count(distinct ${matchPlayers.playerId})`,
        uniqueHeroes: sql<number>`count(distinct ${matchPlayers.heroId})`
      })
      .from(matches)
      .leftJoin(matchPlayers, eq(matchPlayers.matchId, matches.id))
      .where(eq(matches.leagueId, leagueId));

    const matchRows = await db
      .select({
        matchId: matches.id,
        startTime: matches.startTime,
        durationSeconds: matches.durationSeconds,
        radiantWin: matches.radiantWin,
        radiantScore: matches.radiantScore,
        direScore: matches.direScore,
        patch: patches.name,
        playerCount: sql<number>`count(distinct ${matchPlayers.playerSlot})`,
        totalKills: sql<number>`sum(coalesce(${matchPlayers.kills}, 0))`
      })
      .from(matches)
      .leftJoin(matchPlayers, eq(matchPlayers.matchId, matches.id))
      .leftJoin(patches, eq(patches.id, matches.patchId))
      .where(eq(matches.leagueId, leagueId))
      .groupBy(
        matches.id,
        matches.startTime,
        matches.durationSeconds,
        matches.radiantWin,
        matches.radiantScore,
        matches.direScore,
        patches.name
      )
      .orderBy(desc(matches.startTime));

    const parsedData = await this.getMatchParsedDataMap(matchRows.map((row) => row.matchId));
    const parsedFullMatches = matchRows.filter((row) => parsedData.get(row.matchId)?.label === "Full").length;

    const leagueHeroes = await db
      .select({
        heroId: matchPlayers.heroId,
        heroInternalName: heroes.name,
        heroName: heroes.localizedName,
        heroIconPath: heroes.iconPath,
        games: count(matchPlayers.id),
        wins: sql<number>`sum(case when ${matchPlayers.win} = 1 then 1 else 0 end)`,
        uniquePlayers: sql<number>`count(distinct ${matchPlayers.playerId})`
      })
      .from(matchPlayers)
      .leftJoin(matches, eq(matches.id, matchPlayers.matchId))
      .leftJoin(heroes, eq(heroes.id, matchPlayers.heroId))
      .where(and(eq(matches.leagueId, leagueId), sql`${matchPlayers.heroId} is not null`))
      .groupBy(matchPlayers.heroId, heroes.name, heroes.localizedName, heroes.iconPath)
      .orderBy(desc(count(matchPlayers.id)));

    const leaguePlayers = await db
      .select({
        playerId: matchPlayers.playerId,
        personaname: players.personaname,
        games: count(matchPlayers.id),
        wins: sql<number>`sum(case when ${matchPlayers.win} = 1 then 1 else 0 end)`,
        uniqueHeroes: sql<number>`count(distinct ${matchPlayers.heroId})`
      })
      .from(matchPlayers)
      .leftJoin(matches, eq(matches.id, matchPlayers.matchId))
      .leftJoin(players, eq(players.id, matchPlayers.playerId))
      .where(eq(matches.leagueId, leagueId))
      .groupBy(matchPlayers.playerId, players.personaname)
      .orderBy(desc(count(matchPlayers.id)));

    const leagueHeroPlayers = await db
      .select({
        heroId: matchPlayers.heroId,
        playerId: matchPlayers.playerId,
        personaname: players.personaname,
        games: count(matchPlayers.id),
        wins: sql<number>`sum(case when ${matchPlayers.win} = 1 then 1 else 0 end)`
      })
      .from(matchPlayers)
      .leftJoin(matches, eq(matches.id, matchPlayers.matchId))
      .leftJoin(players, eq(players.id, matchPlayers.playerId))
      .where(and(eq(matches.leagueId, leagueId), sql`${matchPlayers.heroId} is not null`))
      .groupBy(matchPlayers.heroId, matchPlayers.playerId, players.personaname)
      .orderBy(desc(count(matchPlayers.id)));

    const leagueMatchPlayers = await db
      .select({
        matchId: matchPlayers.matchId,
        playerId: matchPlayers.playerId,
        personaname: players.personaname,
        heroId: matchPlayers.heroId,
        heroInternalName: heroes.name,
        heroName: heroes.localizedName,
        heroIconPath: heroes.iconPath,
        win: matchPlayers.win
      })
      .from(matchPlayers)
      .leftJoin(matches, eq(matches.id, matchPlayers.matchId))
      .leftJoin(players, eq(players.id, matchPlayers.playerId))
      .leftJoin(heroes, eq(heroes.id, matchPlayers.heroId))
      .where(and(eq(matches.leagueId, leagueId), sql`${matchPlayers.heroId} is not null`));

    const itemCosts = await this.getItemCostMap();
    const leagueItemRows = sqliteDb
      .prepare(
        `
          with item_rows as (
            select mp.id as row_id, mp.win as win, mp.item_0 as item_id from match_players mp join matches m on m.id = mp.match_id where m.league_id = ?
            union all select mp.id, mp.win, mp.item_1 from match_players mp join matches m on m.id = mp.match_id where m.league_id = ?
            union all select mp.id, mp.win, mp.item_2 from match_players mp join matches m on m.id = mp.match_id where m.league_id = ?
            union all select mp.id, mp.win, mp.item_3 from match_players mp join matches m on m.id = mp.match_id where m.league_id = ?
            union all select mp.id, mp.win, mp.item_4 from match_players mp join matches m on m.id = mp.match_id where m.league_id = ?
            union all select mp.id, mp.win, mp.item_5 from match_players mp join matches m on m.id = mp.match_id where m.league_id = ?
            union all select mp.id, mp.win, mp.backpack_0 from match_players mp join matches m on m.id = mp.match_id where m.league_id = ?
            union all select mp.id, mp.win, mp.backpack_1 from match_players mp join matches m on m.id = mp.match_id where m.league_id = ?
            union all select mp.id, mp.win, mp.backpack_2 from match_players mp join matches m on m.id = mp.match_id where m.league_id = ?
          ),
          player_items as (
            select row_id, item_id, max(case when win = 1 then 1 else 0 end) as won
            from item_rows
            where item_id is not null and item_id > 0
            group by row_id, item_id
          )
          select
            pi.item_id as itemId,
            i.localized_name as itemName,
            i.name as internalName,
            i.image_path as imagePath,
            count(*) as games,
            sum(pi.won) as wins
          from player_items pi
          left join items i on i.id = pi.item_id
          group by pi.item_id, i.localized_name, i.name, i.image_path
          order by games desc
        `
      )
      .all(leagueId, leagueId, leagueId, leagueId, leagueId, leagueId, leagueId, leagueId, leagueId) as Array<{
      itemId: number;
      itemName: string | null;
      internalName: string | null;
      imagePath: string | null;
      games: number;
      wins: number | null;
    }>;

    const leagueItems = leagueItemRows
      .map((item) => ({ ...item, cost: itemCosts.get(item.itemId) ?? null }))
      .filter((item) => (item.cost ?? 0) >= 1500);

    const heroRows = leagueHeroes.map((hero) => {
      const wins = hero.wins ?? 0;
      const losses = Math.max(0, hero.games - wins);
      return {
        heroId: hero.heroId ?? 0,
        heroName: hero.heroName ?? `Hero ${hero.heroId}`,
        heroIconUrl: buildAssetProxyUrl(hero.heroIconPath ?? defaultHeroIconPath(hero.heroInternalName)),
        games: hero.games,
        wins,
        losses,
        winrate: hero.games ? Number(((wins / hero.games) * 100).toFixed(1)) : 0,
        uniquePlayers: hero.uniquePlayers ?? 0
      };
    });

    const playerRows = leaguePlayers.map((player) => {
      const wins = player.wins ?? 0;
      const losses = Math.max(0, player.games - wins);
      return {
        playerId: player.playerId,
        personaname: player.personaname,
        games: player.games,
        wins,
        losses,
        winrate: player.games ? Number(((wins / player.games) * 100).toFixed(1)) : 0,
        uniqueHeroes: player.uniqueHeroes ?? 0
      };
    });

    const heroPlayerRows = leagueHeroPlayers.map((player) => {
      const wins = player.wins ?? 0;
      const losses = Math.max(0, player.games - wins);
      return {
        heroId: player.heroId ?? 0,
        playerId: player.playerId,
        personaname: player.personaname,
        games: player.games,
        wins,
        losses,
        winrate: player.games ? Number(((wins / player.games) * 100).toFixed(1)) : 0
      };
    });

    return {
      leagueId,
      name: leagueName,
      matchCount: summary?.matchCount ?? 0,
      parsedFullMatches,
      firstMatchTime:
        summary?.firstMatchTime instanceof Date
          ? summary.firstMatchTime.getTime()
          : summary?.firstMatchTime
            ? Number(summary.firstMatchTime)
            : null,
      lastMatchTime:
        summary?.lastMatchTime instanceof Date
          ? summary.lastMatchTime.getTime()
          : summary?.lastMatchTime
            ? Number(summary.lastMatchTime)
            : null,
      uniquePlayers: summary?.uniquePlayers ?? 0,
      uniqueHeroes: summary?.uniqueHeroes ?? 0,
      topHeroes: heroRows.slice(0, 12).map((hero) => ({
        heroId: hero.heroId,
        heroName: hero.heroName,
        heroIconUrl: hero.heroIconUrl,
        games: hero.games,
        wins: hero.wins,
        winrate: hero.winrate
      })),
      topPlayers: playerRows.slice(0, 20).map((player) => ({
        playerId: player.playerId,
        personaname: player.personaname,
        games: player.games,
        wins: player.wins,
        winrate: player.winrate
      })),
      heroes: heroRows,
      players: playerRows,
      heroPlayers: heroPlayerRows,
      matchPlayers: leagueMatchPlayers.map((player) => ({
        matchId: player.matchId,
        playerId: player.playerId,
        personaname: player.personaname,
        heroId: player.heroId ?? 0,
        heroName: player.heroName ?? `Hero ${player.heroId}`,
        heroIconUrl: buildAssetProxyUrl(player.heroIconPath ?? defaultHeroIconPath(player.heroInternalName)),
        win: player.win
      })),
      items: leagueItems.map((item) => {
        const wins = item.wins ?? 0;
        const losses = Math.max(0, item.games - wins);
        return {
          itemId: item.itemId,
          itemName: item.itemName ?? `Item ${item.itemId}`,
          imageUrl: buildAssetProxyUrl(item.imagePath ?? defaultItemImagePath(item.internalName ?? `item_${item.itemId}`)),
          cost: item.cost,
          games: item.games,
          wins,
          losses,
          winrate: item.games ? Number(((wins / item.games) * 100).toFixed(1)) : 0
        };
      }),
      matches: matchRows.map((match) => ({
        matchId: match.matchId,
        startTime: match.startTime?.getTime() ?? null,
        durationSeconds: match.durationSeconds,
        radiantWin: match.radiantWin,
        playerCount: match.playerCount,
        totalKills: match.totalKills ?? 0,
        radiantScore: match.radiantScore,
        direScore: match.direScore,
        patch: match.patch ?? null,
        league: leagueName,
        parsedData: parsedData.get(match.matchId) ?? {
          label: "Basic",
          hasFullMatchPayload: false,
          timelines: false,
          itemTimings: false,
          vision: false
        }
      }))
    };
  }

  async syncLeagueMatches(leagueId: number, options?: { limit?: number }): Promise<LeagueSyncResponse> {
    await this.ensureReferenceData();
    const adapter = await this.createOpenDotaAdapter();
    const limit = Math.min(100, Math.max(1, options?.limit ?? 25));
    const settings = await this.settingsService.getSettings();
    const savedLeague = settings.savedLeagues.find((league) => league.leagueId === leagueId);
    const providerMessages: string[] = [];

    const leagueMatches = await adapter.getLeagueMatches(leagueId);

    await this.rawPayloads.store({
      provider: "opendota",
      entityType: "league_matches",
      entityId: String(leagueId),
      fetchedAt: leagueMatches.fetchedAt,
      rawJson: leagueMatches.payload,
      requestContext: { limit }
    });

    let candidates: OpenDotaLeagueMatch[] = leagueMatches.payload;
    if (candidates.length === 0) {
      providerMessages.push("OpenDota /leagues endpoint returned no matches for this league.");
      try {
        const explorerMatches = await adapter.getLeagueMatchesFromExplorer(leagueId);
        await this.rawPayloads.store({
          provider: "opendota",
          entityType: "league_matches_explorer",
          entityId: String(leagueId),
          fetchedAt: explorerMatches.fetchedAt,
          rawJson: explorerMatches.payload,
          requestContext: { limit }
        });
        candidates = explorerMatches.payload;
        if (candidates.length === 0) {
          providerMessages.push("OpenDota explorer also returned no matches for this league id.");
        }
      } catch (error) {
        providerMessages.push(
          `OpenDota explorer lookup failed: ${error instanceof Error ? error.message : "unknown error"}.`
        );
      }
    }

    if (candidates.length === 0) {
      if (settings.steamApiKey) {
        try {
          const valveAdapter = await this.createValveAdapter();
          const valveMatches = await valveAdapter.getLeagueMatches(leagueId, limit);
          await this.rawPayloads.store({
            provider: "valve",
            entityType: "league_matches",
            entityId: String(leagueId),
            fetchedAt: valveMatches.fetchedAt,
            rawJson: valveMatches.payload,
            requestContext: { limit }
          });
          candidates = this.mapValveLeagueMatches(valveMatches.payload, leagueId, savedLeague?.name ?? null);
          if (candidates.length === 0) {
            providerMessages.push("Valve Steam Web API returned no matches for this league id.");
          } else {
            providerMessages.push(`Valve Steam Web API returned ${candidates.length} league matches.`);
          }
        } catch (error) {
          providerMessages.push(`Valve Steam Web API league lookup failed: ${error instanceof Error ? error.message : "unknown error"}.`);
        }
      } else {
        providerMessages.push("Valve Steam Web API lookup skipped because no Steam API key is configured.");
      }
    }

    if (candidates.length === 0) {
      if (settings.stratzApiKey) {
        try {
          const stratzAdapter = await this.createStratzAdapter();
          const stratzMatches = await stratzAdapter.getLeagueMatches(leagueId, limit);
          await this.rawPayloads.store({
            provider: "stratz",
            entityType: "league_matches",
            entityId: String(leagueId),
            fetchedAt: stratzMatches.fetchedAt,
            rawJson: stratzMatches.payload,
            requestContext: { limit }
          });
          candidates = this.mapStratzLeagueMatches(stratzMatches.payload);
          if (candidates.length === 0) {
            providerMessages.push("STRATZ did not return this league or returned no matches for it.");
          }
        } catch (error) {
          providerMessages.push(`STRATZ league lookup failed: ${error instanceof Error ? error.message : "unknown error"}.`);
        }
      } else {
        providerMessages.push("STRATZ league lookup skipped because no STRATZ API key is configured.");
      }
    }

    const leagueName =
      candidates.find((match) => match.league_name)?.league_name ??
      savedLeague?.name ??
      `League ${leagueId}`;
    await db
      .insert(leagues)
      .values({ id: leagueId, name: leagueName })
      .onConflictDoUpdate({
        target: leagues.id,
        set: { name: leagueName }
      });

    const existingMatches = new Set(
      (
        await db
          .select({ id: matches.id })
          .from(matches)
          .where(inArray(matches.id, candidates.map((match) => match.match_id).filter(Number.isInteger)))
      ).map((row) => row.id)
    );

    const sortedCandidates = candidates
      .filter((match) => Number.isInteger(match.match_id))
      .sort((left, right) => (right.start_time ?? 0) - (left.start_time ?? 0));
    const candidateIds = sortedCandidates.map((match) => match.match_id);
    if (candidateIds.length > 0) {
      await db.update(matches).set({ leagueId, updatedAt: new Date() }).where(inArray(matches.id, candidateIds));
    }

    const toFetch = sortedCandidates.filter((match) => !existingMatches.has(match.match_id)).slice(0, limit);
    let fetchedMatches = 0;
    const failedMatches: Array<{ matchId: number; message: string }> = [];

    for (const match of toFetch) {
      try {
        const result = await this.fetchLeagueMatchDetails(match.match_id, leagueId, leagueName);
        await this.upsertDetailedMatch(db, result.payload, result.fetchedAt);
        await db.update(matches).set({ leagueId, updatedAt: new Date() }).where(eq(matches.id, match.match_id));
        fetchedMatches += 1;
      } catch (error) {
        failedMatches.push({
          matchId: match.match_id,
          message: error instanceof Error ? error.message : "Failed to fetch match."
        });
      }
    }

    return {
      leagueId,
      requestedMatches: toFetch.length,
      fetchedMatches,
      skippedMatches: sortedCandidates.length - toFetch.length,
      failedMatches,
      providerMessages,
      overview: await this.getLeagueOverview(leagueId)
    };
  }

  private mapStratzLeagueMatches(matches: StratzLeagueMatch[]): OpenDotaLeagueMatch[] {
    return matches.map((match) => ({
      match_id: match.matchId,
      start_time: match.startTime,
      duration: match.durationSeconds,
      radiant_win: match.radiantWin,
      leagueid: match.leagueId,
      league_name: match.leagueName
    }));
  }

  private mapValveLeagueMatches(matches: ValveLeagueMatch[], leagueId: number, leagueName: string | null): OpenDotaLeagueMatch[] {
    return matches.map((match) => ({
      match_id: match.match_id,
      start_time: match.start_time,
      leagueid: leagueId,
      league_name: leagueName
    }));
  }

  private mapValveMatchDetails(match: ValveMatchDetails, leagueId: number, leagueName: string) {
    return {
      match_id: match.match_id,
      duration: match.duration,
      start_time: match.start_time,
      radiant_win: match.radiant_win,
      radiant_score: match.radiant_score,
      dire_score: match.dire_score,
      leagueid: match.leagueid ?? leagueId,
      league_name: leagueName,
      players: match.players ?? [],
      picks_bans: match.picks_bans ?? []
    };
  }

  private async fetchLeagueMatchDetails(matchId: number, leagueId: number, leagueName: string) {
    const openDota = await this.createOpenDotaAdapter();
    try {
      const result = await openDota.getMatch(matchId);
      await this.rawPayloads.store({
        provider: "opendota",
        entityType: "match",
        entityId: String(matchId),
        fetchedAt: result.fetchedAt,
        rawJson: result.payload
      });
      return result;
    } catch (openDotaError) {
      const settings = await this.settingsService.getSettings();
      if (!settings.steamApiKey) {
        throw openDotaError;
      }

      const valve = await this.createValveAdapter();
      const valveResult = await valve.getMatch(matchId);
      await this.rawPayloads.store({
        provider: "valve",
        entityType: "match",
        entityId: String(matchId),
        fetchedAt: valveResult.fetchedAt,
        rawJson: valveResult.payload
      });
      return {
        fetchedAt: valveResult.fetchedAt,
        payload: this.mapValveMatchDetails(valveResult.payload, leagueId, leagueName)
      };
    }
  }

  async getDashboard() {
    await this.ensureReferenceData();
    const settings = await this.settingsService.getSettings();
    const matchScope = await this.getRecentPatchMatchScope();
    const baseDashboard = await this.analyticsService.getDashboard(matchScope ?? undefined);

    const focusedPlayerIds = [
      ...(settings.primaryPlayerId ? [settings.primaryPlayerId] : []),
      ...settings.favoritePlayerIds
    ].filter((value, index, list) => list.indexOf(value) === index);

    const focusedPlayers = [];
    for (const playerId of focusedPlayerIds) {
      const overview = await this.getPlayerOverview(playerId);
      focusedPlayers.push({
        playerId: overview.playerId,
        personaname: overview.personaname,
        avatar: overview.avatar,
        rankTier: overview.rankTier,
        leaderboardRank: overview.leaderboardRank,
        source: overview.source,
        lastSyncedAt: overview.lastSyncedAt,
        totalStoredMatches: overview.totalStoredMatches,
        wins: overview.wins,
        losses: overview.losses,
        topHeroes: overview.heroUsage.slice(0, 3),
        recentMatches: overview.matches.slice(0, 5)
      });
    }

    return {
      ...baseDashboard,
      primaryPlayerId: settings.primaryPlayerId,
      favoritePlayerIds: settings.favoritePlayerIds,
      focusedPlayers
    };
  }

  async getSettings() {
    return this.settingsService.getSettings();
  }

  async updateSettings(input: {
    openDotaApiKey: string | null;
    stratzApiKey: string | null;
    steamApiKey: string | null;
    primaryPlayerId: number | null;
    favoritePlayerIds: number[];
    savedLeagues: Array<{ leagueId: number; slug: string; name: string }>;
    limitToRecentPatches: boolean;
    recentPatchCount: number;
    autoRefreshPlayerIds: number[];
    colorblindMode: boolean;
    stratzDailyRequestCap: number;
  }) {
    return this.settingsService.updateSettings(input);
  }

  async testStratz(playerId: number) {
    const adapter = await this.createStratzAdapter();
    return adapter.getPlayerBasic(playerId);
  }

  async testSteamLeague(leagueId: number) {
    const adapter = await this.createValveAdapter();
    return adapter.getLeagueMatches(leagueId, 5);
  }

  private async upsertRecentMatch(database: typeof db, playerId: number, match: OpenDotaRecentMatch, fetchedAt: number) {
    const isRadiant = match.player_slot < 128;
    const win = match.radiant_win === isRadiant;
    const startTimeMs = match.start_time ? match.start_time * 1000 : null;

    await database
      .insert(matches)
      .values({
        id: match.match_id,
        startTime: startTimeMs ? new Date(startTimeMs) : null,
        durationSeconds: match.duration,
        radiantWin: match.radiant_win,
        providerSource: "opendota",
        lastFetchedAt: new Date(fetchedAt),
        updatedAt: new Date()
      })
      .onConflictDoUpdate({
        target: matches.id,
        set: {
          startTime: startTimeMs ? new Date(startTimeMs) : null,
          durationSeconds: match.duration,
          radiantWin: match.radiant_win,
          lastFetchedAt: new Date(fetchedAt),
          updatedAt: new Date()
        }
      });

    await database
      .insert(matchPlayers)
      .values({
        matchId: match.match_id,
        playerId,
        heroId: match.hero_id,
        playerSlot: match.player_slot,
        isRadiant,
        win,
        kills: match.kills,
        deaths: match.deaths,
        assists: match.assists,
        laneRole: match.lane_role,
        gameMode: match.game_mode,
        updatedAt: new Date()
      })
      .onConflictDoUpdate({
        target: [matchPlayers.matchId, matchPlayers.playerSlot],
        set: {
          playerId,
          heroId: match.hero_id,
          isRadiant,
          win,
          kills: match.kills,
          deaths: match.deaths,
          assists: match.assists,
          laneRole: match.lane_role,
          gameMode: match.game_mode,
          updatedAt: new Date()
        }
      });
  }

  private async upsertDetailedMatch(
    database: typeof db,
    payload: Awaited<ReturnType<OpenDotaAdapter["getMatch"]>>["payload"],
    fetchedAt: number
  ) {
    await database
      .insert(matches)
      .values({
        id: payload.match_id,
        startTime: payload.start_time ? new Date(payload.start_time * 1000) : null,
        durationSeconds: payload.duration ?? null,
        radiantWin: payload.radiant_win ?? null,
        radiantScore: payload.radiant_score ?? null,
        direScore: payload.dire_score ?? null,
        patchId: payload.patch ?? null,
        leagueId: payload.leagueid ?? null,
        lastFetchedAt: new Date(fetchedAt),
        updatedAt: new Date()
      })
      .onConflictDoUpdate({
        target: matches.id,
        set: {
          startTime: payload.start_time ? new Date(payload.start_time * 1000) : null,
          durationSeconds: payload.duration ?? null,
          radiantWin: payload.radiant_win ?? null,
          radiantScore: payload.radiant_score ?? null,
          direScore: payload.dire_score ?? null,
          patchId: payload.patch ?? null,
          leagueId: payload.leagueid ?? null,
          lastFetchedAt: new Date(fetchedAt),
          updatedAt: new Date()
        }
      });

    if (payload.patch) {
      await database.insert(patches).values({ id: payload.patch, name: `Patch ${payload.patch}` }).onConflictDoNothing();
    }

    if (payload.leagueid) {
      await database
        .insert(leagues)
        .values({ id: payload.leagueid, name: payload.league_name ?? `League ${payload.leagueid}` })
        .onConflictDoUpdate({
          target: leagues.id,
          set: { name: payload.league_name ?? `League ${payload.leagueid}` }
        });
    }

    await database.delete(drafts).where(eq(drafts.matchId, payload.match_id));

    for (const draftEvent of payload.picks_bans ?? []) {
      await database.insert(drafts).values({
        matchId: payload.match_id,
        heroId: draftEvent.hero_id,
        team: draftEvent.team === 0 ? "radiant" : "dire",
        isPick: draftEvent.is_pick,
        orderIndex: draftEvent.order
      });
    }

    for (const player of payload.players ?? []) {
      if (player.account_id) {
        await database
          .insert(players)
          .values({
            id: player.account_id,
            personaname: player.personaname ?? null,
            updatedAt: new Date()
          })
          .onConflictDoUpdate({
            target: players.id,
            set: { personaname: player.personaname ?? null, updatedAt: new Date() }
          });
      }

      const playerSlot = player.player_slot ?? 0;
      const isRadiant = playerSlot < 128;
      const win = payload.radiant_win === undefined ? null : payload.radiant_win === isRadiant;

      await database
        .insert(matchPlayers)
        .values({
          matchId: payload.match_id,
          playerId: player.account_id ?? null,
          heroId: player.hero_id ?? null,
          playerSlot,
          isRadiant,
          win,
          kills: player.kills ?? null,
          deaths: player.deaths ?? null,
          assists: player.assists ?? null,
          netWorth: player.net_worth ?? null,
          gpm: player.gold_per_min ?? null,
          xpm: player.xp_per_min ?? null,
          heroDamage: player.hero_damage ?? null,
          towerDamage: player.tower_damage ?? null,
          lastHits: player.last_hits ?? null,
          denies: player.denies ?? null,
          level: player.level ?? null,
          item0: player.item_0 ?? null,
          item1: player.item_1 ?? null,
          item2: player.item_2 ?? null,
          item3: player.item_3 ?? null,
          item4: player.item_4 ?? null,
          item5: player.item_5 ?? null,
          backpack0: player.backpack_0 ?? null,
          backpack1: player.backpack_1 ?? null,
          backpack2: player.backpack_2 ?? null,
          goldTJson: JSON.stringify(player.gold_t ?? []),
          xpTJson: JSON.stringify(player.xp_t ?? []),
          lhTJson: JSON.stringify(player.lh_t ?? []),
          dnTJson: JSON.stringify(player.dn_t ?? []),
          firstPurchaseTimeJson: JSON.stringify(player.first_purchase_time ?? {}),
          itemUsesJson: JSON.stringify(player.item_uses ?? {}),
          purchaseLogJson: JSON.stringify(player.purchase_log ?? []),
          obsLogJson: JSON.stringify(player.obs_log ?? []),
          senLogJson: JSON.stringify(player.sen_log ?? []),
          obsPlaced: player.obs_placed ?? null,
          senPlaced: player.sen_placed ?? null,
          updatedAt: new Date()
        })
        .onConflictDoUpdate({
          target: [matchPlayers.matchId, matchPlayers.playerSlot],
          set: {
            playerId: player.account_id ?? null,
            heroId: player.hero_id ?? null,
            isRadiant,
            win,
            kills: player.kills ?? null,
            deaths: player.deaths ?? null,
            assists: player.assists ?? null,
            netWorth: player.net_worth ?? null,
            gpm: player.gold_per_min ?? null,
            xpm: player.xp_per_min ?? null,
            heroDamage: player.hero_damage ?? null,
            towerDamage: player.tower_damage ?? null,
            lastHits: player.last_hits ?? null,
            denies: player.denies ?? null,
            level: player.level ?? null,
            item0: player.item_0 ?? null,
            item1: player.item_1 ?? null,
            item2: player.item_2 ?? null,
            item3: player.item_3 ?? null,
            item4: player.item_4 ?? null,
            item5: player.item_5 ?? null,
            backpack0: player.backpack_0 ?? null,
            backpack1: player.backpack_1 ?? null,
            backpack2: player.backpack_2 ?? null,
            goldTJson: JSON.stringify(player.gold_t ?? []),
            xpTJson: JSON.stringify(player.xp_t ?? []),
            lhTJson: JSON.stringify(player.lh_t ?? []),
            dnTJson: JSON.stringify(player.dn_t ?? []),
            firstPurchaseTimeJson: JSON.stringify(player.first_purchase_time ?? {}),
            itemUsesJson: JSON.stringify(player.item_uses ?? {}),
            purchaseLogJson: JSON.stringify(player.purchase_log ?? []),
            obsLogJson: JSON.stringify(player.obs_log ?? []),
            senLogJson: JSON.stringify(player.sen_log ?? []),
            obsPlaced: player.obs_placed ?? null,
            senPlaced: player.sen_placed ?? null,
            updatedAt: new Date()
          }
        });
    }
  }
}
