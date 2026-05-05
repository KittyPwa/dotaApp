import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type {
  CommunityGraph,
  DraftContextResponse,
  HeroOverview,
  LeagueOverview,
  LeagueSummary,
  LeagueSyncResponse,
  MatchOverview,
  PlayerCompareResponse,
  PlayerOverview,
  SettingsPayload,
  TeamOverview
} from "@dota/shared";
import { OpenDotaAdapter, type OpenDotaLeagueMatch, type OpenDotaRecentMatch } from "../adapters/openDota.js";
import { StratzAdapter, type StratzLeagueMatch, type StratzMatchTelemetry, type StratzMatchTelemetryPlayer } from "../adapters/stratz.js";
import { ValveDotaAdapter, type ValveLeagueMatch, type ValveMatchDetails } from "../adapters/valveDota.js";
import { AnalyticsService } from "../analytics/analyticsService.js";
import { db, sqliteDb } from "../db/client.js";
import {
  drafts,
  heroes,
  items,
  leagues,
  matchPlayers,
  matches,
  patches,
  players,
  providerEnrichmentQueue,
  rawApiPayloads,
  teams
} from "../db/schema.js";
import { config } from "../utils/config.js";
import { buildAssetProxyUrl, defaultHeroIconPath, defaultHeroPortraitPath, defaultItemImagePath } from "../utils/assets.js";
import { logger } from "../utils/logger.js";
import { RawPayloadService } from "./rawPayloadService.js";
import { ReferenceDataService } from "./referenceDataService.js";
import { SettingsService } from "./settingsService.js";
import { ProviderRateLimitService } from "./providerRateLimitService.js";

function parseJsonValue<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

const itemNameOverrides: Record<string, string> = {
  smoke: "smoke_of_deceit",
  blink_dagger: "blink",
  battle_fury: "bfury",
  aghanims_scepter: "aghanim_scepter",
  aghanims_shard: "aghanim_shard",
  eye_of_skadi: "skadi",
  shadow_blade: "invis_sword"
};

function normalizeDotaItemName(value: string) {
  const normalized = value
    .replace(/^item_/i, "")
    .trim()
    .toLowerCase()
    .replace(/['’]s/g, "s")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return itemNameOverrides[normalized] ?? normalized;
}

function getSmokeUseCountFromItemUses(itemUsesJson: string | null | undefined) {
  const itemUses = parseJsonValue<Record<string, number>>(itemUsesJson, {});
  return Object.entries(itemUses).reduce(
    (sum, [key, value]) => (normalizeDotaItemName(key) === "smoke_of_deceit" ? sum + (Number.isFinite(value) ? value : 0) : sum),
    0
  );
}

function isWardRemovalAction(action?: string | null) {
  const normalized = (action ?? "SPAWN").toUpperCase();
  return normalized === "DESPAWN" || normalized === "DESTROY" || normalized === "DEATH" || normalized === "KILL";
}

type MatchParticipant = MatchOverview["participants"][number];

type TelemetryProviderStatus = MatchOverview["telemetryStatus"]["openDota"];

type MatchParsedData = PlayerOverview["matches"][number]["parsedData"];
type HeroSkillBuildEntry = HeroOverview["commonSkillBuilds"][number];
type SessionSettingsOverrides = {
  limitToRecentPatches?: boolean | null;
  recentPatchCount?: number | null;
};
type BrowserPreferencesOverrides = {
  primaryPlayerId?: number | null;
  favoritePlayerIds?: number[] | null;
  autoRefreshPlayerIds?: number[] | null;
};

type DraftContextSide = "first" | "second";

type EnrichmentProvider = "stratz" | "opendota_parse";
type EnrichmentStatus = "queued" | "waiting" | "full" | "failed" | "expired" | "unavailable";

type AbilityMetadata = {
  abilityName: string;
  imageUrl: string | null;
};

function normalizeAbilityUpgrades(player: {
  ability_upgrades_arr?: number[];
  ability_upgrades?: Array<{ ability?: number; time?: number; level?: number }>;
}) {
  if (Array.isArray(player.ability_upgrades_arr) && player.ability_upgrades_arr.length > 0) {
    return player.ability_upgrades_arr
      .filter((abilityId) => Number.isInteger(abilityId))
      .map((abilityId, index) => ({ level: index + 1, abilityId, time: null as number | null }));
  }

  return (player.ability_upgrades ?? [])
    .filter((entry) => Number.isInteger(entry.ability))
    .map((entry, index) => ({
      level: Number.isInteger(entry.level) ? (entry.level as number) : index + 1,
      abilityId: entry.ability as number,
      time: typeof entry.time === "number" && Number.isFinite(entry.time) ? entry.time : null
  }));
}

function defaultAbilityImagePath(abilityName: string) {
  return `/apps/dota2/images/dota_react/abilities/${abilityName}.png`;
}

export class DotaDataService {
  private readonly rawPayloads = new RawPayloadService();
  private readonly settingsService = new SettingsService();
  private readonly analyticsService = new AnalyticsService();
  private readonly rateLimitService = new ProviderRateLimitService();

  private uniquePositiveIds(ids: number[]) {
    return ids.filter((id, index, list) => Number.isInteger(id) && id > 0 && list.indexOf(id) === index);
  }

  async getDraftContext(input: { firstPlayerIds: number[]; secondPlayerIds: number[] }): Promise<DraftContextResponse> {
    const firstPlayerIds = this.uniquePositiveIds(input.firstPlayerIds).slice(0, 5);
    const secondPlayerIds = this.uniquePositiveIds(input.secondPlayerIds).slice(0, 5);
    const allPlayerIds = this.uniquePositiveIds([...firstPlayerIds, ...secondPlayerIds]);

    if (allPlayerIds.length === 0) {
      return { players: [], combos: [] };
    }

    const rows = await db
      .select({
        matchId: matchPlayers.matchId,
        playerId: matchPlayers.playerId,
        personaname: players.personaname,
        heroId: matchPlayers.heroId,
        heroName: heroes.localizedName,
        heroIconPath: heroes.iconPath,
        win: matchPlayers.win
      })
      .from(matchPlayers)
      .leftJoin(players, eq(players.id, matchPlayers.playerId))
      .leftJoin(heroes, eq(heroes.id, matchPlayers.heroId))
      .where(and(inArray(matchPlayers.playerId, allPlayerIds), sql`${matchPlayers.heroId} is not null`));

    const playerMap = new Map<
      number,
      {
        playerId: number;
        personaname: string | null;
        totalGames: number;
        heroes: Map<number, { heroId: number; heroName: string; heroIconUrl: string | null; games: number; wins: number }>;
      }
    >();

    for (const row of rows) {
      if (!row.playerId || !row.heroId) continue;
      const player =
        playerMap.get(row.playerId) ??
        {
          playerId: row.playerId,
          personaname: row.personaname,
          totalGames: 0,
          heroes: new Map()
        };
      player.totalGames += 1;
      const hero =
        player.heroes.get(row.heroId) ??
        {
          heroId: row.heroId,
          heroName: row.heroName ?? `Hero ${row.heroId}`,
          heroIconUrl: buildAssetProxyUrl(row.heroIconPath ?? defaultHeroIconPath(row.heroName ?? "")),
          games: 0,
          wins: 0
        };
      hero.games += 1;
      if (row.win === true) hero.wins += 1;
      player.heroes.set(row.heroId, hero);
      playerMap.set(row.playerId, player);
    }

    const makeCombos = (sidePlayerIds: number[], side: DraftContextSide) => {
      const scopedPlayerIds = new Set(sidePlayerIds);
      const byMatch = new Map<number, typeof rows>();
      for (const row of rows) {
        if (!row.playerId || !row.heroId || !scopedPlayerIds.has(row.playerId)) continue;
        const matchRows = byMatch.get(row.matchId) ?? [];
        matchRows.push(row);
        byMatch.set(row.matchId, matchRows);
      }

      const comboMap = new Map<
        string,
        {
          side: DraftContextSide;
          comboKey: string;
          games: number;
          wins: number;
          heroes: Array<{ heroId: number; heroName: string; heroIconUrl: string | null }>;
        }
      >();

      for (const matchRows of byMatch.values()) {
        const uniqueHeroes = [...new Map(matchRows.map((row) => [row.heroId, row])).values()].filter(
          (row) => typeof row.heroId === "number"
        );
        for (let i = 0; i < uniqueHeroes.length; i += 1) {
          for (let j = i + 1; j < uniqueHeroes.length; j += 1) {
            const pair = [uniqueHeroes[i], uniqueHeroes[j]].sort((left, right) => (left.heroId ?? 0) - (right.heroId ?? 0));
            const comboKey = pair.map((hero) => hero.heroId).join("-");
            const combo =
              comboMap.get(comboKey) ??
              {
                side,
                comboKey,
                games: 0,
                wins: 0,
                heroes: pair.map((hero) => ({
                  heroId: hero.heroId ?? 0,
                  heroName: hero.heroName ?? `Hero ${hero.heroId}`,
                  heroIconUrl: buildAssetProxyUrl(hero.heroIconPath ?? defaultHeroIconPath(hero.heroName ?? ""))
                }))
              };
            combo.games += 1;
            if (pair.some((hero) => hero.win === true)) combo.wins += 1;
            comboMap.set(comboKey, combo);
          }
        }
      }

      return [...comboMap.values()]
        .map((combo) => ({
          ...combo,
          winrate: combo.games ? Number(((combo.wins / combo.games) * 100).toFixed(1)) : 0
        }))
        .sort((left, right) => right.games - left.games || right.winrate - left.winrate)
        .slice(0, 80);
    };

    return {
      players: allPlayerIds.map((playerId) => {
        const player = playerMap.get(playerId);
        const heroRows = player ? [...player.heroes.values()] : [];
        return {
          playerId,
          personaname: player?.personaname ?? null,
          totalGames: player?.totalGames ?? 0,
          heroes: heroRows
            .map((hero) => ({
              ...hero,
              winrate: hero.games ? Number(((hero.wins / hero.games) * 100).toFixed(1)) : 0
            }))
            .sort((left, right) => right.games - left.games || right.winrate - left.winrate)
            .slice(0, 20)
        };
      }),
      combos: [...makeCombos(firstPlayerIds, "first"), ...makeCombos(secondPlayerIds, "second")]
    };
  }

  private async createOpenDotaAdapter() {
    const settings = await this.settingsService.getSettings({ includeProtected: true });
    return new OpenDotaAdapter(settings.openDotaApiKey);
  }

  private async createStratzAdapter() {
    const settings = await this.settingsService.getSettings({ includeProtected: true });
    return new StratzAdapter(settings.stratzApiKey);
  }

  private async createValveAdapter() {
    const settings = await this.settingsService.getSettings({ includeProtected: true });
    return new ValveDotaAdapter(settings.steamApiKey);
  }

  private impactScoreForRow(row: {
    kills?: number | null;
    assists?: number | null;
    deaths?: number | null;
    gpm?: number | null;
    xpm?: number | null;
    heroDamage?: number | null;
    heroHealing?: number | null;
    towerDamage?: number | null;
    obsPlaced?: number | null;
    senPlaced?: number | null;
    observerKills?: number | null;
    campsStacked?: number | null;
    courierKills?: number | null;
  }) {
    return Number(
      (
        (row.kills ?? 0) * 3 +
        (row.assists ?? 0) * 2 -
        (row.deaths ?? 0) * 1.5 +
        (row.gpm ?? 0) * 0.04 +
        (row.xpm ?? 0) * 0.03 +
        (row.heroDamage ?? 0) * 0.002 +
        (row.heroHealing ?? 0) * 0.002 +
        (row.towerDamage ?? 0) * 0.003 +
        ((row.obsPlaced ?? 0) + (row.senPlaced ?? 0)) * 1.5 +
        (row.observerKills ?? 0) * 2 +
        (row.campsStacked ?? 0) * 1.5 +
        (row.courierKills ?? 0) * 4
      ).toFixed(2)
    );
  }

  private async buildComparisonStatsMap(playerIds: number[], whereCondition: any) {
    const uniquePlayerIds = [...new Set(playerIds.filter((id) => Number.isInteger(id) && id > 0))];
    if (uniquePlayerIds.length === 0) {
      return new Map<number, Array<{ key: string; label: string; value: number; higherIsBetter: boolean }>>();
    }

    type ComparisonStat = { key: string; label: string; value: number; higherIsBetter: boolean };

    const comparisonMetricRows = await db
      .select({
        playerId: matchPlayers.playerId,
        games: count(matchPlayers.id),
        wins: sql<number>`sum(case when ${matchPlayers.win} = 1 then 1 else 0 end)`,
        kills: sql<number>`sum(${matchPlayers.kills})`,
        deaths: sql<number>`sum(${matchPlayers.deaths})`,
        assists: sql<number>`sum(${matchPlayers.assists})`,
        avgGpm: sql<number>`avg(${matchPlayers.gpm})`,
        avgXpm: sql<number>`avg(${matchPlayers.xpm})`,
        avgLastHits: sql<number>`avg(${matchPlayers.lastHits})`,
        avgHeroDamage: sql<number>`avg(${matchPlayers.heroDamage})`,
        avgHeroHealing: sql<number>`avg(${matchPlayers.heroHealing})`,
        avgTowerDamage: sql<number>`avg(${matchPlayers.towerDamage})`,
        avgKills: sql<number>`avg(${matchPlayers.kills})`,
        avgAssists: sql<number>`avg(${matchPlayers.assists})`,
        avgObsPlaced: sql<number>`avg(${matchPlayers.obsPlaced})`,
        avgSenPlaced: sql<number>`avg(${matchPlayers.senPlaced})`,
        avgObserverKills: sql<number>`avg(${matchPlayers.observerKills})`,
        avgCampsStacked: sql<number>`avg(${matchPlayers.campsStacked})`,
        avgCourierKills: sql<number>`avg(${matchPlayers.courierKills})`
      })
      .from(matchPlayers)
      .leftJoin(matches, eq(matches.id, matchPlayers.matchId))
      .where(whereCondition)
      .groupBy(matchPlayers.playerId);

    const selectedPlayerRows = await db
      .select({
        matchId: matchPlayers.matchId,
        playerId: matchPlayers.playerId,
        isRadiant: matchPlayers.isRadiant,
        laneRole: matchPlayers.laneRole,
        win: matchPlayers.win,
        kills: matchPlayers.kills,
        deaths: matchPlayers.deaths,
        assists: matchPlayers.assists,
        gpm: matchPlayers.gpm,
        xpm: matchPlayers.xpm,
        heroDamage: matchPlayers.heroDamage,
        heroHealing: matchPlayers.heroHealing,
        towerDamage: matchPlayers.towerDamage,
        lastHits: matchPlayers.lastHits,
        obsPlaced: matchPlayers.obsPlaced,
        senPlaced: matchPlayers.senPlaced,
        observerKills: matchPlayers.observerKills,
        campsStacked: matchPlayers.campsStacked,
        courierKills: matchPlayers.courierKills,
        obsLogJson: matchPlayers.obsLogJson,
        goldTJson: matchPlayers.goldTJson,
        xpTJson: matchPlayers.xpTJson,
        lhTJson: matchPlayers.lhTJson,
        durationSeconds: matches.durationSeconds
      })
      .from(matchPlayers)
      .leftJoin(matches, eq(matches.id, matchPlayers.matchId))
      .where(whereCondition);

    const relevantMatchIds = [...new Set(selectedPlayerRows.map((row) => row.matchId).filter((id): id is number => id !== null))];
    const matchContextRows = relevantMatchIds.length
      ? await db
          .select({
            matchId: matchPlayers.matchId,
            playerId: matchPlayers.playerId,
            isRadiant: matchPlayers.isRadiant,
            laneRole: matchPlayers.laneRole,
            kills: matchPlayers.kills,
            deaths: matchPlayers.deaths,
            assists: matchPlayers.assists,
            gpm: matchPlayers.gpm,
            xpm: matchPlayers.xpm,
            heroDamage: matchPlayers.heroDamage,
            heroHealing: matchPlayers.heroHealing,
            towerDamage: matchPlayers.towerDamage,
            obsPlaced: matchPlayers.obsPlaced,
            senPlaced: matchPlayers.senPlaced,
            observerKills: matchPlayers.observerKills,
            campsStacked: matchPlayers.campsStacked,
            courierKills: matchPlayers.courierKills,
            goldTJson: matchPlayers.goldTJson,
            xpTJson: matchPlayers.xpTJson,
            lhTJson: matchPlayers.lhTJson
          })
          .from(matchPlayers)
          .where(inArray(matchPlayers.matchId, relevantMatchIds))
      : [];

    const comparisonMetricMap = new Map(comparisonMetricRows.map((row) => [row.playerId, row]));
    const matchParticipantsMap = new Map<number, typeof matchContextRows>();
    for (const row of matchContextRows) {
      if (row.matchId == null) continue;
      const current = matchParticipantsMap.get(row.matchId) ?? [];
      current.push(row);
      matchParticipantsMap.set(row.matchId, current);
    }

    const playerRowsMap = new Map<number, Array<(typeof selectedPlayerRows)[number]>>();
    for (const row of selectedPlayerRows) {
      if (row.playerId == null) continue;
      const current = playerRowsMap.get(row.playerId) ?? [];
      current.push(row);
      playerRowsMap.set(row.playerId, current);
    }

    const stat = (key: string, label: string, value: number): ComparisonStat => ({
      key,
      label,
      value: Number((Number.isFinite(value) ? value : 0).toFixed(2)),
      higherIsBetter: true
    });

    return new Map(
      uniquePlayerIds.map((playerId) => {
        const row = comparisonMetricMap.get(playerId);
        const playerRows = playerRowsMap.get(playerId) ?? [];
        const games = Number(row?.games ?? 0);
        let mvpWins = 0;
        let laneWins = 0;
        let laneSamples = 0;
        let observerActualLifetimeTotal = 0;
        let observerPotentialLifetimeTotal = 0;

        for (const playerRow of playerRows) {
          if (playerRow.matchId == null) continue;
          const participants = matchParticipantsMap.get(playerRow.matchId) ?? [];
          if (participants.length > 0) {
            const bestImpact = Math.max(...participants.map((entry) => this.impactScoreForRow(entry)));
            if (this.impactScoreForRow(playerRow) >= bestImpact - 0.01) {
              mvpWins += 1;
            }
          }

          if (playerRow.laneRole != null && playerRow.isRadiant != null) {
            const goldT = parseJsonValue<number[]>(playerRow.goldTJson, []);
            const xpT = parseJsonValue<number[]>(playerRow.xpTJson, []);
            const lhT = parseJsonValue<number[]>(playerRow.lhTJson, []);
            const playerMinute = Math.min(goldT.length, xpT.length, lhT.length) - 1;
            if (playerMinute >= 8) {
              const playerMinuteIndex = Math.min(9, playerMinute);
              const playerLaneScore =
                (goldT[playerMinuteIndex] ?? 0) + (xpT[playerMinuteIndex] ?? 0) + (lhT[playerMinuteIndex] ?? 0) * 35;
              const opponents = participants.filter(
                (entry) =>
                  entry.isRadiant !== playerRow.isRadiant &&
                  entry.laneRole != null &&
                  entry.laneRole === playerRow.laneRole
              );
              if (opponents.length > 0) {
                const opponentScores = opponents
                  .map((entry) => {
                    const enemyGold = parseJsonValue<number[]>(entry.goldTJson, []);
                    const enemyXp = parseJsonValue<number[]>(entry.xpTJson, []);
                    const enemyLh = parseJsonValue<number[]>(entry.lhTJson, []);
                    const enemyMinute = Math.min(enemyGold.length, enemyXp.length, enemyLh.length) - 1;
                    if (enemyMinute < 8) return null;
                    const enemyMinuteIndex = Math.min(9, enemyMinute);
                    return (enemyGold[enemyMinuteIndex] ?? 0) + (enemyXp[enemyMinuteIndex] ?? 0) + (enemyLh[enemyMinuteIndex] ?? 0) * 35;
                  })
                  .filter((value): value is number => value !== null);
                if (opponentScores.length > 0) {
                  laneSamples += 1;
                  const opponentAverage = opponentScores.reduce((sum, value) => sum + value, 0) / opponentScores.length;
                  if (playerLaneScore > opponentAverage) {
                    laneWins += 1;
                  }
                }
              }
            }
          }

          if (playerRow.durationSeconds && playerRow.durationSeconds > 0) {
            const efficiency = this.calculateObserverWardEfficiency(
              playerRow.obsLogJson,
              playerRow.durationSeconds
            );
            observerActualLifetimeTotal += efficiency.actualLifetimeTotal;
            observerPotentialLifetimeTotal += efficiency.potentialLifetimeTotal;
          }
        }

        const averageObserverLifetime =
          observerPotentialLifetimeTotal > 0
            ? (observerActualLifetimeTotal / observerPotentialLifetimeTotal) * 100
            : 0;

        const stats: ComparisonStat[] = [
          stat("impact", "Impact", playerRows.length ? playerRows.reduce((sum, entry) => sum + this.impactScoreForRow(entry), 0) / playerRows.length : 0),
          stat("mvpRate", "MVP rate %", games ? (mvpWins / games) * 100 : 0),
          stat("laneWinRate", "Lane winrate %", laneSamples ? (laneWins / laneSamples) * 100 : 0),
          stat("kills", "Kills", Number(row?.avgKills ?? 0)),
          stat("assists", "Assists", Number(row?.avgAssists ?? 0)),
          stat("gpm", "GPM", Number(row?.avgGpm ?? 0)),
          stat("xpm", "XPM", Number(row?.avgXpm ?? 0)),
          stat("lastHits", "Last hits", Number(row?.avgLastHits ?? 0)),
          stat("heroDamage", "Hero damage", Number(row?.avgHeroDamage ?? 0)),
          stat("heroHealing", "Hero healing", Number(row?.avgHeroHealing ?? 0)),
          stat("towerDamage", "Tower damage", Number(row?.avgTowerDamage ?? 0)),
          stat("wardsPlaced", "Wards placed", Number(row?.avgObsPlaced ?? 0) + Number(row?.avgSenPlaced ?? 0)),
          stat("wardEfficiency", "Ward efficiency %", averageObserverLifetime),
          stat("observerWardsDestroyed", "Observer wards destroyed", Number(row?.avgObserverKills ?? 0)),
          stat("campStacked", "Camp stacked", Number(row?.avgCampsStacked ?? 0)),
          stat("courierKills", "Courier kills", Number(row?.avgCourierKills ?? 0))
        ];

        return [
          playerId,
          stats
        ] as [number, ComparisonStat[]];
      })
    );
  }

  private calculateObserverWardEfficiency(
    observerLogJson: string | null | undefined,
    durationSeconds: number | null | undefined,
    wardLifetimeSeconds = 360
  ) {
    if (!durationSeconds || durationSeconds <= 0) {
      return { actualLifetimeTotal: 0, potentialLifetimeTotal: 0 };
    }

    const entries = parseJsonValue<
      Array<{ time?: number; x?: number | null; y?: number | null; z?: number | null; action?: string | null }>
    >(observerLogJson, [])
      .filter((entry) => typeof entry.time === "number")
      .sort((left, right) => (left.time ?? 0) - (right.time ?? 0));

    const activeWards = new Map<string, number[]>();
    const activeWardOrder: Array<{ key: string; time: number }> = [];
    let actualLifetimeTotal = 0;
    let potentialLifetimeTotal = 0;

    for (const entry of entries) {
      const time = entry.time ?? 0;
      const key = `${Math.round(entry.x ?? -999)}-${Math.round(entry.y ?? -999)}`;
      const action = (entry.action ?? "SPAWN").toUpperCase();
      if (action === "DESPAWN") {
        const spawnedAtEntries = activeWards.get(key) ?? [];
        let spawnedAt = spawnedAtEntries.shift();
        let matchedKey = key;
        if (typeof spawnedAt === "number") {
          const orderIndex = activeWardOrder.findIndex((entry) => entry.key === key && entry.time === spawnedAt);
          if (orderIndex >= 0) {
            activeWardOrder.splice(orderIndex, 1);
          }
        }
        if (typeof spawnedAt !== "number") {
          const fallback = activeWardOrder.shift();
          if (fallback) {
            matchedKey = fallback.key;
            const fallbackEntries = activeWards.get(fallback.key) ?? [];
            spawnedAt = fallbackEntries.shift();
            if (fallbackEntries.length > 0) {
              activeWards.set(fallback.key, fallbackEntries);
            } else {
              activeWards.delete(fallback.key);
            }
          }
        }
        if (typeof spawnedAt === "number") {
          actualLifetimeTotal += Math.min(Math.max(0, time - spawnedAt), wardLifetimeSeconds);
          potentialLifetimeTotal += Math.min(Math.max(0, durationSeconds - spawnedAt), wardLifetimeSeconds);
        }
        if (spawnedAtEntries.length > 0) {
          activeWards.set(key, spawnedAtEntries);
        } else {
          activeWards.delete(matchedKey);
        }
      } else {
        const current = activeWards.get(key) ?? [];
        current.push(time);
        activeWards.set(key, current);
        activeWardOrder.push({ key, time });
      }
    }

    for (const spawnedAtEntries of activeWards.values()) {
      for (const spawnedAt of spawnedAtEntries) {
        actualLifetimeTotal += Math.min(Math.max(0, durationSeconds - spawnedAt), wardLifetimeSeconds);
        potentialLifetimeTotal += Math.min(Math.max(0, durationSeconds - spawnedAt), wardLifetimeSeconds);
      }
    }

    return { actualLifetimeTotal, potentialLifetimeTotal };
  }

  private getQueueLabel(gameMode: number | null | undefined, lobbyType?: number | null | undefined) {
    if (gameMode === 23) return "Turbo";
    if (lobbyType === 7) return "Ranked";
    return "Unranked";
  }

  private getRankBuckets() {
    return [
      { rankTier: 0, label: "Any" },
      { rankTier: 10, label: "Herald" },
      { rankTier: 20, label: "Guardian" },
      { rankTier: 30, label: "Crusader" },
      { rankTier: 40, label: "Archon" },
      { rankTier: 50, label: "Legend" },
      { rankTier: 60, label: "Ancient" },
      { rankTier: 70, label: "Divine" },
      { rankTier: 80, label: "Immortal" }
    ];
  }

  private buildQueueCondition(
    gameModeColumn: any,
    lobbyTypeColumn: any,
    queue: "all" | "ranked" | "unranked" | "turbo"
  ) {
    if (queue === "ranked") return eq(lobbyTypeColumn, 7);
    if (queue === "turbo") return eq(gameModeColumn, 23);
    if (queue === "unranked") {
      return sql`(${gameModeColumn} is null or ${gameModeColumn} != 23) and (${lobbyTypeColumn} is null or ${lobbyTypeColumn} != 7)`;
    }
    return undefined;
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
    const fullRosterTelemetry = participants.length >= 10;

    return {
      timelines:
        fullRosterTelemetry &&
        participants.every(
          (player) =>
            player.goldTimeline.length > 0 &&
            player.xpTimeline.length > 0 &&
            player.lastHitsTimeline.length > 0 &&
            player.heroDamageTimeline.length > 0 &&
            player.damageTakenTimeline.length > 0
        ),
      itemTimings:
        fullRosterTelemetry &&
        participants.every((player) => Object.keys(player.firstPurchaseTimes).length > 0 || player.purchaseLog.length > 0),
      vision:
        fullRosterTelemetry &&
        participants.some(
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

  private extractRawSmokeUseEvents(rawJson: string | null | undefined) {
    const events = new Map<string, Array<{ time: number; source: string }>>();
    const payload = parseJsonValue<unknown>(rawJson, null);
    const addEvent = (keys: string[], time: number, source: string) => {
      for (const key of keys.filter(Boolean)) {
        const current = events.get(key) ?? [];
        if (!current.some((event) => Math.abs(event.time - time) <= 1 && event.source === source)) {
          current.push({ time, source });
        }
        events.set(key, current);
      }
    };
    const walk = (value: unknown, path: string[]) => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) {
        value.forEach((entry, index) => walk(entry, [...path, String(index)]));
        return;
      }
      const record = value as Record<string, unknown>;
      const flatText = Object.entries(record)
        .filter(([, entry]) => typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean")
        .map(([key, entry]) => `${key}:${entry}`)
        .join("|")
        .toLowerCase();
      const hasSmoke = flatText.includes("smoke");
      const looksUsed = /\b(use|used|uses|cast|consume|consumed)\b/.test(flatText);
      const looksPurchased = /\b(purchase|purchased|buy|bought)\b/.test(flatText);
      const timeValue = typeof record.time === "number" ? record.time : typeof record.gameTime === "number" ? record.gameTime : null;
      if (hasSmoke && looksUsed && !looksPurchased && timeValue !== null && Number.isFinite(timeValue)) {
        addEvent(
          [
            typeof record.player_slot === "number" ? `slot:${record.player_slot}` : "",
            typeof record.playerSlot === "number" ? `slot:${record.playerSlot}` : "",
            typeof record.account_id === "number" ? `player:${record.account_id}` : "",
            typeof record.accountId === "number" ? `player:${record.accountId}` : "",
            typeof record.hero_id === "number" ? `hero:${record.hero_id}` : "",
            typeof record.heroId === "number" ? `hero:${record.heroId}` : ""
          ],
          timeValue,
          `raw:${path.slice(-3).join(".") || "match"}`
        );
      }
      for (const [key, entry] of Object.entries(record)) {
        walk(entry, [...path, key]);
      }
    };
    walk(payload, []);
    return events;
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
        observerLog: telemetry.observerLog.length > 0 ? telemetry.observerLog : participant.observerLog,
        sentryLog: telemetry.sentryLog.length > 0 ? telemetry.sentryLog : participant.sentryLog,
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
    options?: { forceRefresh?: boolean; cacheOnly?: boolean }
  ): Promise<{ participants: MatchParticipant[]; status: TelemetryProviderStatus }> {
    const settings = await this.settingsService.getSettings({ includeProtected: true });
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

    if (options?.cacheOnly) {
      return {
        participants,
        status: {
          configured: true,
          attempted: false,
          timelines: false,
          itemTimings: false,
          vision: false,
          message: "Cached STRATZ telemetry is unavailable."
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

  private isOverviewFullyEnriched(overview: MatchOverview) {
    return (
      overview.telemetryStatus.effective.timelines &&
      overview.telemetryStatus.effective.itemTimings &&
      overview.telemetryStatus.effective.vision
    );
  }

  private upsertEnrichmentQueueEntry(matchId: number, provider: EnrichmentProvider, nextAttemptAt = Date.now()) {
    const now = Date.now();
    sqliteDb
      .prepare(
        `
          insert into provider_enrichment_queue (
            match_id,
            provider,
            status,
            attempts,
            next_attempt_at,
            created_at,
            updated_at
          )
          values (?, ?, 'queued', 0, ?, ?, ?)
          on conflict(match_id, provider) do update set
            status = case
              when provider_enrichment_queue.status in ('full', 'expired', 'unavailable') then provider_enrichment_queue.status
              when provider_enrichment_queue.next_attempt_at > ? then provider_enrichment_queue.status
              else 'queued'
            end,
            next_attempt_at = case
              when provider_enrichment_queue.status in ('full', 'expired', 'unavailable') then provider_enrichment_queue.next_attempt_at
              when provider_enrichment_queue.next_attempt_at > ? then provider_enrichment_queue.next_attempt_at
              else min(provider_enrichment_queue.next_attempt_at, excluded.next_attempt_at)
            end,
            updated_at = excluded.updated_at
        `
      )
      .run(matchId, provider, nextAttemptAt, now, now, now, now);
  }

  async getProviderEnrichmentQueueSummary() {
    const counts = sqliteDb
      .prepare(
        `
          select provider, status, count(*) as count
          from provider_enrichment_queue
          group by provider, status
          order by provider, status
        `
      )
      .all() as Array<{ provider: EnrichmentProvider; status: EnrichmentStatus; count: number }>;
    const [due] = sqliteDb
      .prepare(
        `
          select count(*) as count
          from provider_enrichment_queue
          where status in ('queued', 'failed', 'waiting')
            and next_attempt_at <= ?
        `
      )
      .all(Date.now()) as Array<{ count: number }>;
    const [next] = sqliteDb
      .prepare(
        `
          select min(next_attempt_at) as nextAttemptAt
          from provider_enrichment_queue
          where status in ('queued', 'failed', 'waiting')
        `
      )
      .all() as Array<{ nextAttemptAt: number | null }>;
    const enrichedMatchCandidates = sqliteDb
      .prepare(
        `
          select
            q.match_id as matchId,
            q.provider,
            q.last_attempt_at as enrichedAt,
            m.start_time as startTime
          from provider_enrichment_queue q
          left join matches m on m.id = q.match_id
          where q.status = 'full'
          order by coalesce(q.last_attempt_at, q.updated_at) desc
          limit 100
        `
      )
      .all() as Array<{ matchId: number; provider: EnrichmentProvider; enrichedAt: number | null; startTime: number | null }>;
    const parsedDataByMatchId = await this.getMatchParsedDataMap(enrichedMatchCandidates.map((match) => match.matchId));
    const enrichedMatches = enrichedMatchCandidates
      .filter((match) => parsedDataByMatchId.get(match.matchId)?.label === "Full")
      .slice(0, 20);
    const recentAttemptCandidates = sqliteDb
      .prepare(
        `
          select
            q.match_id as matchId,
            q.provider,
            q.status,
            q.attempts,
            q.last_attempt_at as attemptedAt,
            q.next_attempt_at as nextAttemptAt,
            q.last_error as lastError,
            m.start_time as startTime
          from provider_enrichment_queue q
          left join matches m on m.id = q.match_id
          where q.last_attempt_at is not null
          order by q.last_attempt_at desc
          limit 20
        `
      )
      .all() as Array<{
        matchId: number;
        provider: EnrichmentProvider;
        status: EnrichmentStatus;
        attempts: number;
        attemptedAt: number | null;
        nextAttemptAt: number | null;
        lastError: string | null;
        startTime: number | null;
      }>;
    const recentAttemptParsedData = await this.getMatchParsedDataMap(
      recentAttemptCandidates.map((attempt) => attempt.matchId)
    );
    const recentAttempts = recentAttemptCandidates.map((attempt) => ({
      ...attempt,
      parsedData: recentAttemptParsedData.get(attempt.matchId) ?? {
        label: "Basic",
        hasFullMatchPayload: false,
        timelines: false,
        itemTimings: false,
        vision: false
      }
    }));

    const settings = await this.settingsService.getSettings({ includeProtected: true });
    const providerUsage = [
      {
        provider: "stratz" as const,
        usage: this.rateLimitService.getUsage("stratz"),
        limits: {
          perSecond: settings.stratzPerSecondCap,
          perMinute: settings.stratzPerMinuteCap,
          perHour: settings.stratzPerHourCap,
          perDay: settings.stratzDailyRequestCap
        }
      },
      {
        provider: "opendota" as const,
        usage: this.rateLimitService.getUsage("opendota"),
        limits: {
          perSecond: settings.openDotaPerSecondCap,
          perMinute: settings.openDotaPerMinuteCap,
          perHour: settings.openDotaPerHourCap,
          perDay: settings.openDotaDailyRequestCap
        }
      },
      {
        provider: "steam" as const,
        usage: this.rateLimitService.getUsage("steam"),
        limits: {
          perSecond: settings.steamPerSecondCap,
          perMinute: settings.steamPerMinuteCap,
          perHour: settings.steamPerHourCap,
          perDay: settings.steamDailyRequestCap
        }
      },
      {
        provider: "enrichment" as const,
        usage: this.rateLimitService.getUsage("provider_enrichment"),
        limits: {
          perSecond: 1000,
          perMinute: 10000,
          perHour: 100000,
          perDay: settings.providerEnrichmentDailyRequestCap
        }
      }
    ];

    return {
      counts,
      dueCount: due?.count ?? 0,
      nextAttemptAt: next?.nextAttemptAt ?? null,
      providerUsage,
      enrichedMatches,
      recentAttempts
    };
  }

  private async requeueFalseFullEnrichmentEntries(matchIds: number[], nextAttemptAt: number) {
    const parsedDataByMatchId = await this.getMatchParsedDataMap(matchIds);
    const staleFullMatchIds = matchIds.filter((matchId) => parsedDataByMatchId.get(matchId)?.label !== "Full");
    if (staleFullMatchIds.length === 0) return 0;

    sqliteDb
      .prepare(
        `
          update provider_enrichment_queue
          set
            status = 'waiting',
            next_attempt_at = ?,
            last_error = 'Previously marked full, but required telemetry is still incomplete.',
            updated_at = ?
          where status = 'full'
            and provider = 'stratz'
            and match_id in (${staleFullMatchIds.map(() => "?").join(",")})
        `
      )
      .run(nextAttemptAt, Date.now(), ...staleFullMatchIds);
    return staleFullMatchIds.length;
  }

  async enqueueProviderEnrichmentCandidates(options?: { limit?: number }) {
    const limit = Math.min(Math.max(options?.limit ?? 200, 1), 1000);
    const now = Date.now();
    const openDotaReplayWindowMs = 10 * 24 * 60 * 60 * 1000;
    const rows = sqliteDb
      .prepare(
        `
          select id, start_time as startTime
          from matches
          order by coalesce(start_time, 0) desc
          limit ?
        `
      )
      .all(limit) as Array<{ id: number; startTime: number | null }>;
    await this.requeueFalseFullEnrichmentEntries(
      rows.map((row) => row.id),
      now
    );

    let stratzQueued = 0;
    let openDotaParseQueued = 0;

    for (const row of rows) {
      this.upsertEnrichmentQueueEntry(row.id, "stratz", now);
      stratzQueued += 1;

      if (row.startTime && row.startTime >= now - openDotaReplayWindowMs) {
        this.upsertEnrichmentQueueEntry(row.id, "opendota_parse", now);
        openDotaParseQueued += 1;
      }
    }

    return {
      scannedMatches: rows.length,
      stratzQueued,
      openDotaParseQueued,
      summary: await this.getProviderEnrichmentQueueSummary()
    };
  }

  private markProviderEnrichmentAttempt(
    id: number,
    status: EnrichmentStatus,
    options?: { nextAttemptAt?: number; lastError?: string | null }
  ) {
    sqliteDb
      .prepare(
        `
          update provider_enrichment_queue
          set
            status = ?,
            attempts = attempts + 1,
            last_attempt_at = ?,
            next_attempt_at = ?,
            last_error = ?,
            updated_at = ?
          where id = ?
        `
      )
      .run(status, Date.now(), options?.nextAttemptAt ?? Date.now(), options?.lastError ?? null, Date.now(), id);
  }

  async processProviderEnrichmentQueue(options?: { limit?: number }) {
    const limit = Math.min(Math.max(options?.limit ?? 5, 1), 25);
    const now = Date.now();
    const settings = await this.settingsService.getSettings({ includeProtected: true });
    const rows = sqliteDb
      .prepare(
        `
          select id, match_id as matchId, provider, attempts
          from provider_enrichment_queue
          where status in ('queued', 'failed', 'waiting')
            and next_attempt_at <= ?
          order by
            case provider
              when 'opendota_parse' then 0
              else 1
            end,
            next_attempt_at asc,
            id asc
          limit ?
        `
      )
      .all(now, limit) as Array<{ id: number; matchId: number; provider: EnrichmentProvider; attempts: number }>;

    const processed: Array<{ matchId: number; provider: EnrichmentProvider; status: EnrichmentStatus; message: string | null }> = [];

    for (const row of rows) {
      try {
        this.rateLimitService.consume("provider_enrichment", {
          perSecond: 1000,
          perMinute: 10000,
          perHour: 100000,
          perDay: settings.providerEnrichmentDailyRequestCap
        });

        if (row.provider === "opendota_parse") {
          const adapter = await this.createOpenDotaAdapter();
          const matchResult = await adapter.getMatch(row.matchId);
          await this.rawPayloads.store({
            provider: "opendota",
            entityType: "match",
            entityId: String(row.matchId),
            fetchedAt: matchResult.fetchedAt,
            rawJson: matchResult.payload
          });
          await this.upsertDetailedMatch(db, matchResult.payload, matchResult.fetchedAt);

          const parsedData = (await this.getMatchParsedDataMap([row.matchId])).get(row.matchId);
          if (parsedData?.label === "Full") {
            this.markProviderEnrichmentAttempt(row.id, "full", {
              nextAttemptAt: now,
              lastError: null
            });
            processed.push({
              matchId: row.matchId,
              provider: row.provider,
              status: "full",
              message: "OpenDota match payload is now fully parsed."
            });
            continue;
          }

          const result = await adapter.requestMatchParse(row.matchId);
          await this.rawPayloads.store({
            provider: "opendota",
            entityType: "match_parse_request",
            entityId: String(row.matchId),
            fetchedAt: result.fetchedAt,
            rawJson: result.payload,
            parseVersion: "opendota-parse-request-v1"
          });
          const parseMessage = result.payload.message ?? result.payload.error ?? "OpenDota parse request accepted or queued.";
          const message = `OpenDota match fetched (${parsedData?.label ?? "Basic"}); ${parseMessage}`;
          const nextAttempts = row.attempts + 1;
          const status = result.payload.error
            ? nextAttempts >= settings.providerEnrichmentMaxAttempts
              ? "unavailable"
              : "failed"
            : "waiting";
          this.markProviderEnrichmentAttempt(row.id, status, {
            nextAttemptAt: now + (result.payload.error ? 6 : 1) * 60 * 60 * 1000,
            lastError: result.payload.error ?? null
          });
          processed.push({ matchId: row.matchId, provider: row.provider, status, message });
          continue;
        }

        const overview = await this.getMatchOverview(row.matchId);
        const full = this.isOverviewFullyEnriched(overview);
        const message = overview.telemetryStatus.stratz.message;
        const nextAttempts = row.attempts + 1;
        const status = full ? "full" : nextAttempts >= settings.providerEnrichmentMaxAttempts ? "unavailable" : "waiting";
        this.markProviderEnrichmentAttempt(row.id, status, {
          nextAttemptAt: full || status === "unavailable" ? now : now + 6 * 60 * 60 * 1000,
          lastError: full ? null : message
        });
        processed.push({ matchId: row.matchId, provider: row.provider, status, message });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Provider enrichment failed.";
        const isRateLimit = message.includes("rate limit reached");
        const nextAttempts = row.attempts + (isRateLimit ? 0 : 1);
        const status = !isRateLimit && nextAttempts >= settings.providerEnrichmentMaxAttempts ? "unavailable" : "failed";
        this.markProviderEnrichmentAttempt(row.id, status, {
          nextAttemptAt: isRateLimit ? now + 60 * 60 * 1000 : now + Math.min(24, row.attempts + 1) * 60 * 60 * 1000,
          lastError: message
        });
        processed.push({ matchId: row.matchId, provider: row.provider, status, message });
      }
    }

    return {
      processed,
      summary: await this.getProviderEnrichmentQueueSummary()
    };
  }

  async ensureReferenceData() {
    const adapter = await this.createOpenDotaAdapter();
    await new ReferenceDataService(adapter, this.rawPayloads).syncIfStale();
  }

  private async getAbilityMetadataMap() {
    const [abilityIdsPayload] = await db
      .select({ rawJson: rawApiPayloads.rawJson })
      .from(rawApiPayloads)
      .where(and(eq(rawApiPayloads.provider, "opendota"), eq(rawApiPayloads.entityType, "ability_ids")))
      .orderBy(desc(rawApiPayloads.fetchedAt))
      .limit(1);
    const [abilitiesPayload] = await db
      .select({ rawJson: rawApiPayloads.rawJson })
      .from(rawApiPayloads)
      .where(and(eq(rawApiPayloads.provider, "opendota"), eq(rawApiPayloads.entityType, "abilities")))
      .orderBy(desc(rawApiPayloads.fetchedAt))
      .limit(1);

    const abilityIds = parseJsonValue<Record<string, string>>(abilityIdsPayload?.rawJson, {});
    const abilities = parseJsonValue<Record<string, { dname?: string; img?: string }>>(abilitiesPayload?.rawJson, {});
    const metadata = new Map<number, AbilityMetadata>();

    for (const [abilityIdText, abilityInternalName] of Object.entries(abilityIds)) {
      const abilityId = Number(abilityIdText);
      if (!Number.isInteger(abilityId) || !abilityInternalName) continue;
      const ability = abilities[abilityInternalName];
      metadata.set(abilityId, {
        abilityName: ability?.dname ?? abilityInternalName.replace(/_/g, " "),
        imageUrl: buildAssetProxyUrl(ability?.img ?? defaultAbilityImagePath(abilityInternalName))
      });
    }

    return metadata;
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
        const fullRosterTelemetry = playersWithTelemetry.length >= 10;
        stratzFlagsByMatchId.set(matchId, {
          timelines:
            fullRosterTelemetry &&
            playersWithTelemetry.every(
              (player) =>
                player.goldTimeline.length > 0 &&
                player.xpTimeline.length > 0 &&
                player.lastHitsTimeline.length > 0 &&
                player.heroDamageTimeline.length > 0 &&
                player.damageTakenTimeline.length > 0
            ),
          itemTimings: fullRosterTelemetry && playersWithTelemetry.every((player) => player.purchaseLog.length > 0),
          vision:
            fullRosterTelemetry &&
            playersWithTelemetry.some(
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
      const openDotaFlags = {
        timelines: Number(row.timelines ?? 0) >= 10,
        itemTimings: Number(row.itemTimings ?? 0) >= 10,
        vision: Number(row.vision ?? 0) > 0
      };
      const flags = {
        hasFullMatchPayload: matchIdsWithRawPayload.has(row.matchId),
        timelines: openDotaFlags.timelines || Boolean(stratzFlags?.timelines),
        itemTimings: openDotaFlags.itemTimings || Boolean(stratzFlags?.itemTimings),
        vision: openDotaFlags.vision || Boolean(stratzFlags?.vision)
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

  private async isPriorityPlayer(playerId: number, browserPreferences?: BrowserPreferencesOverrides) {
    const settings = await this.settingsService.getSettings({ browserPreferences });
    return settings.primaryPlayerId === playerId || settings.favoritePlayerIds.includes(playerId);
  }

  private async shouldAutoRefreshPlayer(playerId: number, browserPreferences?: BrowserPreferencesOverrides) {
    const settings = await this.settingsService.getSettings({ browserPreferences });
    return settings.autoRefreshPlayerIds.includes(playerId);
  }

  private async getRecentPatchMatchScope(sessionSettings?: SessionSettingsOverrides) {
    const settings = await this.settingsService.getSettings();
    const limitToRecentPatches = sessionSettings?.limitToRecentPatches ?? settings.limitToRecentPatches;
    const recentPatchCount = sessionSettings?.recentPatchCount ?? settings.recentPatchCount;
    if (!limitToRecentPatches) {
      return null;
    }

    const patchWindowSize = Math.max(1, recentPatchCount + 1);

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

  private async getMatchScopeLabel(
    matchScope: { patchIds: number[]; cutoffStartTimeMs: number | null } | null,
    sessionSettings?: SessionSettingsOverrides
  ) {
    const settings = await this.settingsService.getSettings();
    const limitToRecentPatches = sessionSettings?.limitToRecentPatches ?? settings.limitToRecentPatches;
    const recentPatchCount = sessionSettings?.recentPatchCount ?? settings.recentPatchCount;
    if (!limitToRecentPatches || !matchScope) {
      return "All locally stored matches";
    }

    if (recentPatchCount === 0) {
      return "Current patch only";
    }

    return `Current + previous ${recentPatchCount} patch${recentPatchCount === 1 ? "" : "es"}`;
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

  async getPlayerOverview(
    playerId: number,
    options?: {
      leagueId?: number | null;
      queue?: "all" | "ranked" | "unranked" | "turbo";
      heroId?: number | null;
      sessionSettings?: SessionSettingsOverrides;
      browserPreferences?: BrowserPreferencesOverrides;
      cacheOnly?: boolean;
    }
  ): Promise<PlayerOverview> {
    await this.ensureReferenceData();
    const matchScope = await this.getRecentPatchMatchScope(options?.sessionSettings);
    const matchScopeLabel = await this.getMatchScopeLabel(matchScope, options?.sessionSettings);
    const matchScopeCondition = this.buildMatchScopeCondition(matches, matchScope);
    const queue = options?.queue ?? "all";
    const queueCondition = this.buildQueueCondition(matchPlayers.gameMode, matchPlayers.lobbyType, queue);
    const leagueCondition = options?.leagueId ? eq(matches.leagueId, options.leagueId) : undefined;
    const heroCondition = options?.heroId ? eq(matchPlayers.heroId, options.heroId) : undefined;
    const scopedPlayerCondition = and(eq(matchPlayers.playerId, playerId), matchScopeCondition, queueCondition, leagueCondition, heroCondition);
    const availableLeagueCondition = and(eq(matchPlayers.playerId, playerId), matchScopeCondition, queueCondition);
    const availableHeroCondition = and(eq(matchPlayers.playerId, playerId), matchScopeCondition, queueCondition, leagueCondition);
    const priorityPlayer = await this.isPriorityPlayer(playerId, options?.browserPreferences);
    const autoRefreshOnOpen = await this.shouldAutoRefreshPlayer(playerId, options?.browserPreferences);
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

    if (!options?.cacheOnly && (shouldRefresh || shouldRefreshHistory)) {
      logger.info("Refreshing player data", { playerId });
      const adapter = await this.createOpenDotaAdapter();
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
      .where(scopedPlayerCondition);

      const [{ totalLocalMatches }] = await db
        .select({ totalLocalMatches: count(matchPlayers.id) })
        .from(matchPlayers)
        .where(eq(matchPlayers.playerId, playerId));
      const [playerPerformance] = await db
        .select({
          games: count(matchPlayers.id),
          wins: sql<number>`sum(case when ${matchPlayers.win} = 1 then 1 else 0 end)`,
        avgKills: sql<number>`avg(coalesce(${matchPlayers.kills}, 0))`,
        avgAssists: sql<number>`avg(coalesce(${matchPlayers.assists}, 0))`,
        avgGpm: sql<number>`avg(coalesce(${matchPlayers.gpm}, 0))`,
        avgXpm: sql<number>`avg(coalesce(${matchPlayers.xpm}, 0))`,
        avgLastHits: sql<number>`avg(coalesce(${matchPlayers.lastHits}, 0))`,
        avgHeroDamage: sql<number>`avg(coalesce(${matchPlayers.heroDamage}, 0))`,
        avgHeroHealing: sql<number>`avg(coalesce(${matchPlayers.heroHealing}, 0))`,
        avgTowerDamage: sql<number>`avg(coalesce(${matchPlayers.towerDamage}, 0))`,
        avgWardsPlaced: sql<number>`avg(coalesce(${matchPlayers.obsPlaced}, 0) + coalesce(${matchPlayers.senPlaced}, 0))`
      })
        .from(matchPlayers)
        .leftJoin(matches, eq(matches.id, matchPlayers.matchId))
        .where(scopedPlayerCondition);
      const comparisonStatsMap = await this.buildComparisonStatsMap([playerId], scopedPlayerCondition);

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
        gameMode: matchPlayers.gameMode,
        lobbyType: matchPlayers.lobbyType,
        leagueId: matches.leagueId,
        leagueName: leagues.name
      })
      .from(matchPlayers)
      .leftJoin(matches, eq(matches.id, matchPlayers.matchId))
      .leftJoin(heroes, eq(heroes.id, matchPlayers.heroId))
      .leftJoin(leagues, eq(leagues.id, matches.leagueId))
      .where(scopedPlayerCondition)
      .orderBy(desc(matches.startTime));
    const playerMatchParsedData = await this.getMatchParsedDataMap(
      playerMatches.map((match) => match.matchId).filter((matchId): matchId is number => matchId !== null)
    );
    const availableLeagueRows = await db
      .select({
        leagueId: matches.leagueId,
        leagueName: leagues.name
      })
      .from(matchPlayers)
      .leftJoin(matches, eq(matches.id, matchPlayers.matchId))
      .leftJoin(leagues, eq(leagues.id, matches.leagueId))
      .where(and(availableLeagueCondition, sql`${matches.leagueId} is not null`))
      .groupBy(matches.leagueId, leagues.name)
      .orderBy(leagues.name);

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
      .where(scopedPlayerCondition)
      .groupBy(matchPlayers.heroId, heroes.localizedName)
      .orderBy(desc(sql`count(${matchPlayers.id})`));

    const availableHeroRows = await db
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
      .where(and(availableHeroCondition, sql`${matchPlayers.heroId} is not null`))
      .groupBy(matchPlayers.heroId, heroes.localizedName, heroes.name, heroes.iconPath)
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
      .where(
        and(
          eq(playerMatchBase.playerId, playerId),
          matchScopeCondition,
          leagueCondition,
          this.buildQueueCondition(playerMatchBase.gameMode, playerMatchBase.lobbyType, queue)
        )
      )
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
      .where(scopedPlayerCondition);

    const observerLifetimeRows = await db
      .select({
        observerLogJson: matchPlayers.obsLogJson,
        durationSeconds: matches.durationSeconds
      })
      .from(matchPlayers)
      .leftJoin(matches, eq(matches.id, matchPlayers.matchId))
      .where(scopedPlayerCondition);

    let observerActualLifetimeTotal = 0;
    let observerPotentialLifetimeTotal = 0;
    for (const row of observerLifetimeRows) {
      const efficiency = this.calculateObserverWardEfficiency(row.observerLogJson, row.durationSeconds);
      observerActualLifetimeTotal += efficiency.actualLifetimeTotal;
      observerPotentialLifetimeTotal += efficiency.potentialLifetimeTotal;
    }
    const averageObserverWardLifetimePercent =
      observerPotentialLifetimeTotal > 0
        ? Number(((observerActualLifetimeTotal / observerPotentialLifetimeTotal) * 100).toFixed(1))
        : null;

    const visionHeatmapRows = await db
      .select({
        observerLogJson: matchPlayers.obsLogJson,
        isRadiant: matchPlayers.isRadiant
      })
      .from(matchPlayers)
      .leftJoin(matches, eq(matches.id, matchPlayers.matchId))
      .where(scopedPlayerCondition);
    const visionHeatmapMap = new Map<string, { x: number; y: number; count: number; isRadiant: boolean | null }>();
    for (const row of visionHeatmapRows) {
      const entries = parseJsonValue<
        Array<{ time?: number; x?: number | null; y?: number | null; z?: number | null; action?: string | null }>
      >(row.observerLogJson, []);
      for (const entry of entries) {
        const action = (entry.action ?? "SPAWN").toUpperCase();
        if (action === "DESPAWN" || action === "DESTROY" || action === "DEATH" || action === "KILL") continue;
        if (typeof entry.x !== "number" || typeof entry.y !== "number") continue;
        const x = Math.round(entry.x / 4) * 4;
        const y = Math.round(entry.y / 4) * 4;
        const key = `${x}:${y}:${row.isRadiant === null ? "unknown" : row.isRadiant ? "radiant" : "dire"}`;
        const current = visionHeatmapMap.get(key) ?? { x, y, count: 0, isRadiant: row.isRadiant };
        current.count += 1;
        visionHeatmapMap.set(key, current);
      }
    }
    const visionHeatmap = [...visionHeatmapMap.values()].sort((left, right) => right.count - left.count).slice(0, 450);

    const smokePlayerRows = await db
      .select({
        itemUsesJson: matchPlayers.itemUsesJson
      })
      .from(matchPlayers)
      .leftJoin(matches, eq(matches.id, matchPlayers.matchId))
      .where(scopedPlayerCondition);
    const smokeUses = smokePlayerRows.reduce((sum, row) => sum + getSmokeUseCountFromItemUses(row.itemUsesJson), 0);

    const historySyncedAt = await this.getLatestRawPayloadFetchedAt("player_match_history", String(playerId));
    const filterBits = [matchScopeLabel];
    if (options?.leagueId) {
      const selectedLeague = availableLeagueRows.find((row) => row.leagueId === options.leagueId);
      filterBits.push(selectedLeague?.leagueName ?? `League ${options.leagueId}`);
    }
    if (queue !== "all") {
      filterBits.push(queue === "ranked" ? "Ranked" : queue === "turbo" ? "Turbo" : "Unranked");
    }

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
      matchScopeLabel: filterBits.join(" • "),
      availableLeagues: availableLeagueRows
        .filter((row) => row.leagueId !== null && row.leagueId > 0)
        .map((row) => ({
          leagueId: row.leagueId ?? 0,
          leagueName: row.leagueName ?? `League ${row.leagueId}`
        })),
      availableHeroes: availableHeroRows
        .filter((row) => row.heroId !== null && row.games > 0)
        .map((row) => ({
          heroId: row.heroId ?? 0,
          heroName: row.heroName ?? `Hero ${row.heroId}`,
          heroIconUrl: buildAssetProxyUrl(row.heroIconPath ?? defaultHeroIconPath(row.heroInternalName)),
          games: row.games,
          wins: row.wins ?? 0,
          winrate: row.games ? Number((((row.wins ?? 0) / row.games) * 100).toFixed(1)) : 0
        })),
      activeFilters: {
        leagueId: options?.leagueId ?? null,
        queue,
        heroId: options?.heroId ?? null
      },
      wins: winLossRow?.wins ?? 0,
      losses: winLossRow?.losses ?? 0,
      comparisonStats: comparisonStatsMap.get(playerId) ?? [],
      averageObserverWardLifetimePercent,
      visionHeatmap,
      smokeStats: {
        uses: smokeUses,
        inferredEvents: 0,
        successes: 0,
        failures: 0,
        neutrals: 0,
        efficiencyPercent: null
      },
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
        lobbyType: match.lobbyType,
        gameModeLabel: this.getQueueLabel(match.gameMode, match.lobbyType),
        leagueId: match.leagueId && match.leagueId > 0 ? match.leagueId : null,
        leagueName: match.leagueId && match.leagueId > 0 ? match.leagueName : null,
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

  async comparePlayers(
    playerIds: number[],
    options?: { sessionSettings?: SessionSettingsOverrides; browserPreferences?: BrowserPreferencesOverrides }
  ): Promise<PlayerCompareResponse> {
      await this.ensureReferenceData();
      const matchScope = await this.getRecentPatchMatchScope(options?.sessionSettings);
      const matchScopeCondition = this.buildMatchScopeCondition(matches, matchScope);
      const uniquePlayerIds = [...new Set(playerIds.filter((id) => Number.isInteger(id) && id > 0))];
  
      if (uniquePlayerIds.length < 2) {
        throw new Error("Choose at least two players to compare.");
      }
  
      const playersData = await Promise.all(
        uniquePlayerIds.map((playerId) =>
          this.getPlayerOverview(playerId, {
            sessionSettings: options?.sessionSettings,
            browserPreferences: options?.browserPreferences
          })
        )
      );
      const comparisonStatsMap = await this.buildComparisonStatsMap(
        uniquePlayerIds,
        and(inArray(matchPlayers.playerId, uniquePlayerIds), matchScopeCondition)
      );

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
          comparisonStats: comparisonStatsMap.get(player.playerId) ?? [],
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

  async getMatchOverview(matchId: number, options?: { forceRefresh?: boolean; cacheOnly?: boolean }): Promise<MatchOverview> {
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
      .select({ id: rawApiPayloads.id, rawJson: rawApiPayloads.rawJson })
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
    const needsFullFetch =
      !options?.cacheOnly && (options?.forceRefresh || !matchRow || !hasFullRoster || !hasDetailedStats || !hasRawMatchPayload);

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
        lobbyType: matchPlayers.lobbyType,
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
        item5Image: sql<string | null>`(select image_path from items where id = ${matchPlayers.item5})`,
        backpack0: sql<string | null>`(select localized_name from items where id = ${matchPlayers.backpack0})`,
        backpack0Image: sql<string | null>`(select image_path from items where id = ${matchPlayers.backpack0})`,
        backpack1: sql<string | null>`(select localized_name from items where id = ${matchPlayers.backpack1})`,
        backpack1Image: sql<string | null>`(select image_path from items where id = ${matchPlayers.backpack1})`,
        backpack2: sql<string | null>`(select localized_name from items where id = ${matchPlayers.backpack2})`,
        backpack2Image: sql<string | null>`(select image_path from items where id = ${matchPlayers.backpack2})`,
        itemNeutral: sql<string | null>`(select localized_name from items where id = ${matchPlayers.itemNeutral})`,
        itemNeutralImage: sql<string | null>`(select image_path from items where id = ${matchPlayers.itemNeutral})`
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
    const [latestRawMatchPayload] = await db
      .select({ rawJson: rawApiPayloads.rawJson })
      .from(rawApiPayloads)
      .where(and(eq(rawApiPayloads.entityType, "match"), eq(rawApiPayloads.entityId, String(matchId))))
      .orderBy(desc(rawApiPayloads.fetchedAt))
      .limit(1);
    const rawSmokeEvents = this.extractRawSmokeUseEvents(latestRawMatchPayload?.rawJson ?? rawMatchPayload?.rawJson);
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
      lobbyType: row.lobbyType,
      goldTimeline: parseJsonValue<number[]>(row.goldTJson, []),
      xpTimeline: parseJsonValue<number[]>(row.xpTJson, []),
      lastHitsTimeline: parseJsonValue<number[]>(row.lhTJson, []),
      deniesTimeline: parseJsonValue<number[]>(row.dnTJson, []),
      heroDamageTimeline: [],
      damageTakenTimeline: [],
      firstPurchaseTimes: parseJsonValue<Record<string, number>>(row.firstPurchaseTimeJson, {}),
      itemUses: parseJsonValue<Record<string, number>>(row.itemUsesJson, {}),
      smokeUseEvents: [
        ...(row.playerSlot !== null ? rawSmokeEvents.get(`slot:${row.playerSlot}`) ?? [] : []),
        ...(row.playerId !== null ? rawSmokeEvents.get(`player:${row.playerId}`) ?? [] : []),
        ...(row.heroId !== null ? rawSmokeEvents.get(`hero:${row.heroId}`) ?? [] : [])
      ].sort((left, right) => left.time - right.time),
      purchaseLog: parseJsonValue<Array<{ time?: number; key?: string; charges?: number }>>(row.purchaseLogJson, [])
        .filter((entry) => typeof entry.time === "number" && typeof entry.key === "string")
        .map((entry) => ({ time: entry.time as number, key: entry.key as string, charges: entry.charges ?? null })),
      observerLog: parseJsonValue<Array<{ time?: number; x?: number; y?: number; z?: number; action?: string | null }>>(row.obsLogJson, [])
        .filter((entry) => typeof entry.time === "number")
        .map((entry) => ({ time: entry.time as number, x: entry.x ?? null, y: entry.y ?? null, z: entry.z ?? null, action: entry.action ?? null })),
      sentryLog: parseJsonValue<Array<{ time?: number; x?: number; y?: number; z?: number; action?: string | null }>>(row.senLogJson, [])
        .filter((entry) => typeof entry.time === "number")
        .map((entry) => ({ time: entry.time as number, x: entry.x ?? null, y: entry.y ?? null, z: entry.z ?? null, action: entry.action ?? null })),
      observerWardsPlaced: row.obsPlaced,
      sentryWardsPlaced: row.senPlaced,
      finalInventory: [
        { name: row.item0, imagePath: row.item0Image },
        { name: row.item1, imagePath: row.item1Image },
        { name: row.item2, imagePath: row.item2Image },
        { name: row.item3, imagePath: row.item3Image },
        { name: row.item4, imagePath: row.item4Image },
        { name: row.item5, imagePath: row.item5Image }
      ].map((item) =>
        item.name
          ? {
              name: item.name,
              imageUrl: buildAssetProxyUrl(item.imagePath ?? defaultItemImagePath(item.name))
            }
          : null
      ),
      finalBackpack: [
        { name: row.backpack0, imagePath: row.backpack0Image },
        { name: row.backpack1, imagePath: row.backpack1Image },
        { name: row.backpack2, imagePath: row.backpack2Image }
      ].map((item) =>
        item.name
          ? {
              name: item.name,
              imageUrl: buildAssetProxyUrl(item.imagePath ?? defaultItemImagePath(item.name))
            }
          : null
      ),
      finalNeutral: row.itemNeutral
        ? {
            name: row.itemNeutral,
            imageUrl: buildAssetProxyUrl(row.itemNeutralImage ?? defaultItemImagePath(row.itemNeutral))
          }
        : null,
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
      forceRefresh: options?.forceRefresh,
      cacheOnly: options?.cacheOnly
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

  async getHeroStats(options?: { leagueId?: number | null; sessionSettings?: SessionSettingsOverrides }) {
    await this.ensureReferenceData();
    const matchScope = await this.getRecentPatchMatchScope(options?.sessionSettings);
    return this.analyticsService.getHeroStats(matchScope ?? undefined, options);
  }

  async getHeroOverview(
    heroId: number,
    options?: {
      leagueId?: number | null;
      minRankTier?: number | null;
      maxRankTier?: number | null;
      sessionSettings?: SessionSettingsOverrides;
    }
  ): Promise<HeroOverview> {
    await this.ensureReferenceData();
    const settings = await this.settingsService.getSettings();
    const matchScope = await this.getRecentPatchMatchScope(options?.sessionSettings);
    const matchScopeCondition = this.buildMatchScopeCondition(matches, matchScope);
    const [heroRow] = await db.select().from(heroes).where(eq(heroes.id, heroId)).limit(1);

    if (!heroRow) {
      throw new Error("Hero not found in the local dataset.");
    }

    const activeLeagueId = options?.leagueId ?? null;
    const activeMinRankTier = options?.minRankTier ?? null;
    const activeMaxRankTier = options?.maxRankTier ?? null;

    const leagueCondition = activeLeagueId ? eq(matches.leagueId, activeLeagueId) : undefined;
    const rankFilters: ReturnType<typeof sql>[] = [];
    if (activeMinRankTier !== null) {
      rankFilters.push(sql`${players.rankTier} >= ${activeMinRankTier}`);
    }
    if (activeMaxRankTier !== null) {
      rankFilters.push(sql`${players.rankTier} <= ${activeMaxRankTier}`);
    }
    const rankCondition =
      rankFilters.length > 0
        ? sql`${players.rankTier} is not null and (${sql.join(rankFilters, sql` and `)})`
        : undefined;

    const baseHeroScopeCondition = and(eq(matchPlayers.heroId, heroId), matchScopeCondition);
    const backgroundHeroScopeCondition = and(baseHeroScopeCondition, leagueCondition);
    const activeHeroScopeCondition = and(baseHeroScopeCondition, leagueCondition, rankCondition);

    const availableLeagues = await db
      .select({
        leagueId: leagues.id,
        leagueName: leagues.name
      })
      .from(matchPlayers)
      .leftJoin(matches, eq(matches.id, matchPlayers.matchId))
      .leftJoin(leagues, eq(leagues.id, matches.leagueId))
      .where(and(baseHeroScopeCondition, sql`${matches.leagueId} is not null and ${matches.leagueId} > 0`))
      .groupBy(leagues.id, leagues.name)
      .orderBy(leagues.name);
    const savedLeagueNames = new Map(settings.savedLeagues.map((league) => [league.leagueId, league.name]));

    const [summary] = await db
      .select({
        games: count(matchPlayers.id),
        wins: sql<number>`sum(case when ${matchPlayers.win} = 1 then 1 else 0 end)`,
        uniquePlayers: sql<number>`count(distinct ${matchPlayers.playerId})`,
        averageFirstCoreItemTimingSeconds: sql<number | null>`
          avg(
            case
              when json_extract(${matchPlayers.firstPurchaseTimeJson}, '$."item_0"') is not null
              then json_extract(${matchPlayers.firstPurchaseTimeJson}, '$."item_0"')
              else null
            end
          )
        `
      })
      .from(matchPlayers)
      .leftJoin(matches, eq(matches.id, matchPlayers.matchId))
      .leftJoin(players, eq(players.id, matchPlayers.playerId))
      .where(activeHeroScopeCondition);

    const itemRows = await db
      .select({
        itemInternalName: items.name,
        itemName: items.localizedName,
        itemImagePath: items.imagePath,
        timing: sql<number | null>`avg(json_extract(${matchPlayers.firstPurchaseTimeJson}, '$."item_0"'))`,
        usages: count(matchPlayers.id)
      })
      .from(matchPlayers)
      .leftJoin(matches, eq(matches.id, matchPlayers.matchId))
      .leftJoin(players, eq(players.id, matchPlayers.playerId))
      .leftJoin(items, eq(items.id, matchPlayers.item0))
      .where(and(activeHeroScopeCondition, sql`${matchPlayers.item0} is not null`))
      .groupBy(items.name, items.localizedName, items.imagePath)
      .orderBy(desc(count(matchPlayers.id)));

    const itemCatalogRows = await db
      .select({
        itemId: items.id,
        itemInternalName: items.name,
        itemName: items.localizedName,
        itemImagePath: items.imagePath
      })
      .from(items);
    const itemCatalog = new Map(
      itemCatalogRows.map((item) => [
        item.itemInternalName,
        { itemName: item.itemName, itemInternalName: item.itemInternalName, itemImagePath: item.itemImagePath }
      ])
    );
    const itemCatalogById = new Map(
      itemCatalogRows.map((item) => [
        item.itemId,
        { itemName: item.itemName, itemInternalName: item.itemInternalName, itemImagePath: item.itemImagePath }
      ])
    );
    const recentMatches = await db
      .select({
        matchId: matches.id,
        startTime: matches.startTime,
        durationSeconds: matches.durationSeconds,
        radiantWin: matches.radiantWin,
        heroWin: sql<number | null>`max(case when ${matchPlayers.win} is null then null when ${matchPlayers.win} = 1 then 1 else 0 end)`,
        radiantScore: matches.radiantScore,
        direScore: matches.direScore,
        leagueId: matches.leagueId,
        patch: patches.name,
        league: leagues.name,
        playerCount: sql<number>`count(distinct ${matchPlayers.playerSlot})`,
        totalKills: sql<number>`sum(coalesce(${matchPlayers.kills}, 0))`,
        averageRankTier: sql<number | null>`avg(${players.rankTier})`,
        radiantAverageRankTier: sql<number | null>`avg(case when ${matchPlayers.isRadiant} = 1 then ${players.rankTier} else null end)`,
        direAverageRankTier: sql<number | null>`avg(case when ${matchPlayers.isRadiant} = 0 then ${players.rankTier} else null end)`
      })
      .from(matchPlayers)
      .leftJoin(matches, eq(matches.id, matchPlayers.matchId))
      .leftJoin(players, eq(players.id, matchPlayers.playerId))
      .leftJoin(patches, eq(patches.id, matches.patchId))
      .leftJoin(leagues, eq(leagues.id, matches.leagueId))
      .where(activeHeroScopeCondition)
      .groupBy(
        matches.id,
        matches.startTime,
        matches.durationSeconds,
        matches.radiantWin,
        matches.radiantScore,
        matches.direScore,
        matches.leagueId,
        patches.name,
        leagues.name
      )
      .orderBy(desc(matches.startTime));

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
      .where(activeHeroScopeCondition)
      .groupBy(matchPlayers.playerId, players.personaname)
      .orderBy(desc(sql`count(${matchPlayers.id})`));

    const skillRows = await db
      .select({
        abilityUpgradesJson: matchPlayers.abilityUpgradesJson,
        win: matchPlayers.win
      })
      .from(matchPlayers)
      .leftJoin(matches, eq(matches.id, matchPlayers.matchId))
      .leftJoin(players, eq(players.id, matchPlayers.playerId))
      .where(and(activeHeroScopeCondition, sql`${matchPlayers.abilityUpgradesJson} is not null`));

    const skillBuildMap = new Map<string, { sequence: Array<{ level: number; abilityId: number }>; games: number; wins: number }>();
    for (const row of skillRows) {
      const sequence = parseJsonValue<Array<{ level?: number; abilityId?: number }>>(row.abilityUpgradesJson, [])
        .filter((entry) => Number.isInteger(entry.abilityId))
        .sort((left, right) => (left.level ?? Number.MAX_SAFE_INTEGER) - (right.level ?? Number.MAX_SAFE_INTEGER))
        .slice(0, 18)
        .map((entry, index) => ({
          level: index + 1,
          abilityId: entry.abilityId as number
        }));
      if (sequence.length === 0) continue;
      const key = sequence.map((entry) => `${entry.level}:${entry.abilityId}`).join("-");
      const current = skillBuildMap.get(key) ?? { sequence, games: 0, wins: 0 };
      current.games += 1;
      if (row.win === true) current.wins += 1;
      skillBuildMap.set(key, current);
    }
    const abilityMetadataMap = await this.getAbilityMetadataMap();

    const itemBuildRows = await db
      .select({
        purchaseLogJson: matchPlayers.purchaseLogJson,
        win: matchPlayers.win
      })
      .from(matchPlayers)
      .leftJoin(matches, eq(matches.id, matchPlayers.matchId))
      .leftJoin(players, eq(players.id, matchPlayers.playerId))
      .where(
        and(
          activeHeroScopeCondition,
          sql`${matchPlayers.purchaseLogJson} is not null`,
          sql`json_valid(${matchPlayers.purchaseLogJson})`,
          sql`json_array_length(${matchPlayers.purchaseLogJson}) > 0`
        )
      );

    const itemBuildMap = new Map<
      string,
      { sequence: Array<{ itemName: string; itemInternalName: string | null; itemImagePath: string | null }>; games: number; wins: number }
    >();
    const excludedBuildItems = new Set([
      "tango",
      "enchanted_mango",
      "clarity",
      "faerie_fire",
      "branches",
      "ward_observer",
      "ward_sentry",
      "dust",
      "smoke_of_deceit",
      "ward_dispenser",
      "blood_grenade",
      "tpscroll",
      "circlet",
      "slippers",
      "mantle",
      "gauntlets",
      "band_of_elvenskin",
      "belt_of_strength",
      "robe",
      "crown",
      "gloves",
      "boots",
      "ring_of_protection",
      "ring_of_regen",
      "fluffy_hat",
      "infused_raindrop",
      "wind_lace",
      "magic_stick",
      "magic_wand",
      "bottle",
      "flask",
      "blades_of_attack",
      "broadsword",
      "quarterstaff",
      "mithril_hammer",
      "javelin",
      "ogre_axe",
      "blade_of_alacrity",
      "staff_of_wizardry",
      "point_booster",
      "energy_booster",
      "vitality_booster",
      "void_stone",
      "voodoo_mask",
      "morbid_mask",
      "pers",
      "cornucopia",
      "sobi_mask",
      "robe_of_the_magi",
      "wizard_hat",
      "trusty_shovel",
      "arcane_ring",
      "faded_broach",
      "pupil_gift",
      "specialists_array",
      "whisper_of_the_dread",
      "philosophers_stone",
      "bullwhip",
      "ceremonial_robe",
      "timeless_relic",
      "null_talisman",
      "great_famango",
      "shadow_amulet",
      "cloak"
    ]);
    let itemBuildSampleMatches = 0;
    for (const row of itemBuildRows) {
      const purchaseSequence = parseJsonValue<Array<{ key?: string; time?: number }>>(row.purchaseLogJson, [])
        .filter((entry) => typeof entry.key === "string" && typeof entry.time === "number" && entry.time >= 0)
        .sort((left, right) => (left.time ?? 0) - (right.time ?? 0))
        .map((entry) => (entry.key as string).replace(/^item_/i, ""))
        .filter((itemName) => {
          const normalized = itemName.trim().toLowerCase();
          return !normalized.startsWith("recipe_") && !excludedBuildItems.has(normalized);
        });
      const dedupedSequence = purchaseSequence.filter((itemName, index) => purchaseSequence.indexOf(itemName) === index).slice(0, 8);
      if (dedupedSequence.length === 0) continue;
      itemBuildSampleMatches += 1;

      const decoratedSequence = dedupedSequence.map((itemName) => {
        const normalizedItemName = itemName.replace(/^item_/i, "");
        const itemMetadata = itemCatalog.get(normalizedItemName);
        return {
          itemName: itemMetadata?.itemName ?? normalizedItemName.replace(/_/g, " "),
          itemInternalName: normalizedItemName,
          itemImagePath: itemMetadata?.itemImagePath ?? null
        };
      });

      const key = decoratedSequence.map((item) => item.itemInternalName ?? item.itemName).join(" -> ");
      const current = itemBuildMap.get(key) ?? { sequence: decoratedSequence, games: 0, wins: 0 };
      current.games += 1;
      if (row.win === true) current.wins += 1;
      itemBuildMap.set(key, current);
    }

    const itemCostsById = await this.getItemCostMap();
    const heroCatalogRows = await db
      .select({
        heroId: heroes.id,
        heroInternalName: heroes.name,
        heroName: heroes.localizedName,
        heroIconPath: heroes.iconPath
      })
      .from(heroes);
    const heroCatalogById = new Map(heroCatalogRows.map((hero) => [hero.heroId, hero]));

    const targetHeroRows = await db
      .select({
        matchId: matchPlayers.matchId,
        isRadiant: matchPlayers.isRadiant
      })
      .from(matchPlayers)
      .leftJoin(matches, eq(matches.id, matchPlayers.matchId))
      .leftJoin(players, eq(players.id, matchPlayers.playerId))
      .where(activeHeroScopeCondition);
    const targetSideByMatch = new Map<number, boolean>();
    for (const row of targetHeroRows) {
      if (typeof row.matchId === "number" && row.isRadiant !== null) {
        targetSideByMatch.set(row.matchId, row.isRadiant);
      }
    }

    const targetMatchIds = [...targetSideByMatch.keys()];
    type MatchupParticipant = {
      matchId: number;
      isRadiant: boolean;
      win: boolean | null;
      heroId: number | null;
      itemIds: number[];
    };
    const participantsByMatch = new Map<number, Map<string, MatchupParticipant>>();
    const setParticipant = (key: string, participant: MatchupParticipant) => {
      const matchParticipants = participantsByMatch.get(participant.matchId) ?? new Map<string, MatchupParticipant>();
      matchParticipants.set(key, participant);
      participantsByMatch.set(participant.matchId, matchParticipants);
    };
    const finalInventoryItemIds = (values: Array<number | null | undefined>) =>
      [...new Set(values.filter((itemId): itemId is number => typeof itemId === "number" && itemId > 0))].filter(
        (itemId) => (itemCostsById.get(itemId) ?? 0) >= 1500
      );

    for (let offset = 0; offset < targetMatchIds.length; offset += 400) {
      const matchIdChunk = targetMatchIds.slice(offset, offset + 400);
      if (matchIdChunk.length === 0) continue;
      const rows = await db
        .select({
          matchId: matchPlayers.matchId,
          playerSlot: matchPlayers.playerSlot,
          isRadiant: matchPlayers.isRadiant,
          win: matchPlayers.win,
          heroId: matchPlayers.heroId,
          item0: matchPlayers.item0,
          item1: matchPlayers.item1,
          item2: matchPlayers.item2,
          item3: matchPlayers.item3,
          item4: matchPlayers.item4,
          item5: matchPlayers.item5,
          backpack0: matchPlayers.backpack0,
          backpack1: matchPlayers.backpack1,
          backpack2: matchPlayers.backpack2
        })
        .from(matchPlayers)
        .where(inArray(matchPlayers.matchId, matchIdChunk));

      for (const row of rows) {
        if (row.isRadiant === null) continue;
        setParticipant(row.playerSlot === null ? `row:${row.heroId ?? "unknown"}:${row.isRadiant}` : `slot:${row.playerSlot}`, {
          matchId: row.matchId,
          isRadiant: row.isRadiant,
          win: row.win,
          heroId: row.heroId,
          itemIds: finalInventoryItemIds([
            row.item0,
            row.item1,
            row.item2,
            row.item3,
            row.item4,
            row.item5,
            row.backpack0,
            row.backpack1,
            row.backpack2
          ])
        });
      }

      const rawRows = await db
        .select({
          entityId: rawApiPayloads.entityId,
          rawJson: rawApiPayloads.rawJson
        })
        .from(rawApiPayloads)
        .where(and(eq(rawApiPayloads.entityType, "match"), inArray(rawApiPayloads.entityId, matchIdChunk.map(String))))
        .orderBy(desc(rawApiPayloads.fetchedAt));
      const rawByMatch = new Map<number, string>();
      for (const rawRow of rawRows) {
        const matchId = Number(rawRow.entityId);
        if (Number.isInteger(matchId) && !rawByMatch.has(matchId)) rawByMatch.set(matchId, rawRow.rawJson);
      }
      for (const [matchId, rawJson] of rawByMatch) {
        const payload = parseJsonValue<{
          radiant_win?: boolean;
          players?: Array<{
            player_slot?: number;
            hero_id?: number;
            item_0?: number;
            item_1?: number;
            item_2?: number;
            item_3?: number;
            item_4?: number;
            item_5?: number;
            backpack_0?: number;
            backpack_1?: number;
            backpack_2?: number;
          }>;
        }>(rawJson, {});
        for (const player of payload.players ?? []) {
          if (typeof player.player_slot !== "number") continue;
          const isRadiant = player.player_slot < 128;
          const heroId = typeof player.hero_id === "number" && Number.isInteger(player.hero_id) && player.hero_id > 0 ? player.hero_id : null;
          setParticipant(`slot:${player.player_slot}`, {
            matchId,
            isRadiant,
            win: typeof payload.radiant_win === "boolean" ? payload.radiant_win === isRadiant : null,
            heroId,
            itemIds: finalInventoryItemIds([
              player.item_0,
              player.item_1,
              player.item_2,
              player.item_3,
              player.item_4,
              player.item_5,
              player.backpack_0,
              player.backpack_1,
              player.backpack_2
            ])
          });
        }
      }
    }

    const matchupSampleMatches = new Map<
      number,
      { withHero: boolean; againstHero: boolean; withItem: boolean; againstItem: boolean }
    >();
    for (const matchId of targetMatchIds) {
      const targetSide = targetSideByMatch.get(matchId);
      if (targetSide === undefined) continue;
      const participants = participantsByMatch.get(matchId);
      if (!participants) continue;
      for (const row of participants.values()) {
        const current =
          matchupSampleMatches.get(matchId) ?? {
            withHero: false,
            againstHero: false,
            withItem: false,
            againstItem: false
          };
        const hasOtherHero = row.heroId !== null && row.heroId !== heroId;
        const hasFinalItems = row.itemIds.length > 0;
        if (row.isRadiant === targetSide) {
          if (hasOtherHero) current.withHero = true;
          if (hasFinalItems) current.withItem = true;
        } else {
          if (hasOtherHero) current.againstHero = true;
          if (hasFinalItems) current.againstItem = true;
        }
        matchupSampleMatches.set(matchId, current);
      }
    }
    const heroWithMatchSample = [...matchupSampleMatches.values()].filter((entry) => entry.withHero).length;
    const heroAgainstMatchSample = [...matchupSampleMatches.values()].filter((entry) => entry.againstHero).length;
    const itemWithMatchSample = [...matchupSampleMatches.values()].filter((entry) => entry.withItem).length;
    const itemAgainstMatchSample = [...matchupSampleMatches.values()].filter((entry) => entry.againstItem).length;
    const collectItemMatchups = async (sideMode: "with" | "against") => {
      const itemMap = new Map<string, { itemName: string; imageUrl: string | null; games: number; wins: number; heroGames: number }>();
      for (const matchId of targetMatchIds) {
        const targetSide = targetSideByMatch.get(matchId);
        if (targetSide === undefined) continue;
        const participants = participantsByMatch.get(matchId);
        if (!participants) continue;
        for (const row of participants.values()) {
          if (sideMode === "with" && row.isRadiant !== targetSide) continue;
          if (sideMode === "against" && row.isRadiant === targetSide) continue;
          for (const itemId of row.itemIds) {
            const item = itemCatalogById.get(itemId);
            if (!item) continue;
            const current =
              itemMap.get(item.itemInternalName) ??
              {
                itemName: item.itemName,
                imageUrl: buildAssetProxyUrl(item.itemImagePath ?? defaultItemImagePath(item.itemInternalName)),
                games: 0,
                wins: 0,
                heroGames: 0
              };
            current.games += 1;
            if (row.win === true) current.wins += 1;
            if (row.heroId === heroId) current.heroGames += 1;
            itemMap.set(item.itemInternalName, current);
          }
        }
      }
      return [...itemMap.values()]
        .map((item) => ({
          ...item,
          winrate: item.games ? Number(((item.wins / item.games) * 100).toFixed(1)) : 0,
          isHeroMajority: item.heroGames > item.games / 2
        }));
    };
    const itemAgainstRows = await collectItemMatchups("against");
    const itemWithRows = await collectItemMatchups("with");
    const matchupSort = <T extends { games: number; winrate: number }>(left: T, right: T) =>
      right.games - left.games || right.winrate - left.winrate;
    const lowMatchupSort = <T extends { games: number; winrate: number }>(left: T, right: T) =>
      right.games - left.games || left.winrate - right.winrate;
    const games = summary?.games ?? 0;
    const wins = summary?.wins ?? 0;
    const scopedHeroWinrate = games ? Number(((wins / games) * 100).toFixed(1)) : 50;
    const partitionMatchups = <T extends { games: number; winrate: number }>(rows: T[]) => ({
      highSuccess: rows.filter((row) => row.winrate >= scopedHeroWinrate).sort(matchupSort),
      lowSuccess: rows.filter((row) => row.winrate < scopedHeroWinrate).sort(lowMatchupSort)
    });
    const itemAgainstGroups = partitionMatchups(itemAgainstRows);
    const itemWithGroups = partitionMatchups(itemWithRows);

    const collectHeroMatchups = async (sideMode: "with" | "against") => {
      const heroMap = new Map<number, { heroId: number; heroName: string; heroIconUrl: string | null; games: number; wins: number }>();
      for (const matchId of targetMatchIds) {
        const targetSide = targetSideByMatch.get(matchId);
        if (targetSide === undefined) continue;
        const participants = participantsByMatch.get(matchId);
        if (!participants) continue;
        for (const row of participants.values()) {
          if (row.heroId === null || row.heroId === heroId) continue;
          if (sideMode === "with" && row.isRadiant !== targetSide) continue;
          if (sideMode === "against" && row.isRadiant === targetSide) continue;
          const hero = heroCatalogById.get(row.heroId);
          const current =
            heroMap.get(row.heroId) ??
            {
              heroId: row.heroId,
              heroName: hero?.heroName ?? `Hero ${row.heroId}`,
              heroIconUrl: buildAssetProxyUrl(hero?.heroIconPath ?? defaultHeroIconPath(hero?.heroInternalName ?? null)),
              games: 0,
              wins: 0
            };
          current.games += 1;
          if (row.win === true) current.wins += 1;
          heroMap.set(row.heroId, current);
        }
      }
      return [...heroMap.values()]
        .map((entry) => ({
          ...entry,
          winrate: entry.games ? Number(((entry.wins / entry.games) * 100).toFixed(1)) : 0
        }));
    };
    const heroAgainstRows = await collectHeroMatchups("against");
    const heroWithRows = await collectHeroMatchups("with");
    const heroAgainstGroups = partitionMatchups(heroAgainstRows);
    const heroWithGroups = partitionMatchups(heroWithRows);

    const mmrBuckets = [
      { label: "All ranks", minRankTier: null },
      { label: "Archon+", minRankTier: 40 },
      { label: "Legend+", minRankTier: 50 },
      { label: "Ancient+", minRankTier: 60 },
      { label: "Divine+", minRankTier: 70 },
      { label: "Immortal", minRankTier: 80 }
    ];
    const rankedRows = await db
      .select({
        rankTier: players.rankTier,
        win: matchPlayers.win
      })
      .from(matchPlayers)
      .leftJoin(matches, eq(matches.id, matchPlayers.matchId))
      .leftJoin(players, eq(players.id, matchPlayers.playerId))
      .where(activeHeroScopeCondition);

    const backgroundRankRows = await db
      .select({
        rankTier: players.rankTier
      })
      .from(matchPlayers)
      .leftJoin(matches, eq(matches.id, matchPlayers.matchId))
      .leftJoin(players, eq(players.id, matchPlayers.playerId))
      .where(backgroundHeroScopeCondition);

    const mmrBreakdown = mmrBuckets.map((bucket) => {
      const bucketRows = rankedRows.filter(
        (row) => bucket.minRankTier === null || (row.rankTier !== null && row.rankTier >= bucket.minRankTier)
      );
      const wins = bucketRows.filter((row) => row.win === true).length;
      return {
        label: bucket.label,
        minRankTier: bucket.minRankTier,
        games: bucketRows.length,
        wins,
        winrate: bucketRows.length ? Number(((wins / bucketRows.length) * 100).toFixed(1)) : 0
      };
    });
    const rankDistribution = this.getRankBuckets().map((bucket) => ({
      rankTier: bucket.rankTier,
      label: bucket.label,
      games: backgroundRankRows.filter((row) => row.rankTier !== null && row.rankTier >= bucket.rankTier && row.rankTier < bucket.rankTier + 10).length
    }));

    return {
      heroId,
      heroName: heroRow.localizedName,
      heroIconUrl: buildAssetProxyUrl(heroRow.iconPath ?? defaultHeroIconPath(heroRow.name)),
      heroPortraitUrl: buildAssetProxyUrl(heroRow.portraitPath ?? defaultHeroPortraitPath(heroRow.name)),
      source: "cache",
      availableLeagues: availableLeagues
        .filter((league) => league.leagueId !== null)
        .map((league) => ({
          leagueId: league.leagueId ?? 0,
          leagueName: savedLeagueNames.get(league.leagueId ?? 0) ?? league.leagueName ?? `League ${league.leagueId}`
        })),
      activeFilters: {
        leagueId: activeLeagueId,
        minRankTier: activeMinRankTier,
        maxRankTier: activeMaxRankTier
      },
      games,
      wins,
      winrate: games ? Number(((wins / games) * 100).toFixed(1)) : 0,
      uniquePlayers: summary?.uniquePlayers ?? 0,
      averageFirstCoreItemTimingSeconds: summary?.averageFirstCoreItemTimingSeconds ?? null,
      commonItems: itemRows
        .filter((item) => item.itemName)
        .slice(0, 12)
        .map((item) => ({
          itemName: item.itemName ?? "Unknown item",
          imageUrl: buildAssetProxyUrl(item.itemImagePath ?? defaultItemImagePath(item.itemInternalName)),
          averageTimingSeconds: item.timing ?? null,
          usages: item.usages
        })),
      commonSkillBuilds: [...skillBuildMap.values()]
        .sort((left, right) => right.games - left.games || right.wins / right.games - left.wins / left.games)
        .slice(0, 12)
        .map((build) => ({
          sequence: build.sequence.map((entry) => ({
            level: entry.level,
            abilityId: entry.abilityId,
            abilityName: abilityMetadataMap.get(entry.abilityId)?.abilityName ?? `Ability ${entry.abilityId}`,
            imageUrl: abilityMetadataMap.get(entry.abilityId)?.imageUrl ?? null
          })),
          games: build.games,
          winrate: build.games ? Number(((build.wins / build.games) * 100).toFixed(1)) : 0
        })),
      commonItemBuilds: [...itemBuildMap.values()]
        .sort((left, right) => right.games - left.games || right.wins / right.games - left.wins / left.games)
        .slice(0, 200)
        .map((build) => ({
          sequence: build.sequence.map((item) => ({
            itemName: item.itemName,
            imageUrl: buildAssetProxyUrl(item.itemImagePath ?? defaultItemImagePath(item.itemInternalName ?? item.itemName))
          })),
          games: build.games,
          winrate: build.games ? Number(((build.wins / build.games) * 100).toFixed(1)) : 0
        })),
      itemsAgainst: {
        highSuccess: itemAgainstGroups.highSuccess,
        lowSuccess: itemAgainstGroups.lowSuccess
      },
      itemsWith: {
        highSuccess: itemWithGroups.highSuccess,
        lowSuccess: itemWithGroups.lowSuccess
      },
      heroesAgainst: {
        highSuccess: heroAgainstGroups.highSuccess,
        lowSuccess: heroAgainstGroups.lowSuccess
      },
      heroesWith: {
        highSuccess: heroWithGroups.highSuccess,
        lowSuccess: heroWithGroups.lowSuccess
      },
      matchupSamples: {
        appearances: targetMatchIds.length,
        heroWithMatches: heroWithMatchSample,
        heroAgainstMatches: heroAgainstMatchSample,
        itemWithMatches: itemWithMatchSample,
        itemAgainstMatches: itemAgainstMatchSample
      },
      buildSamples: {
        skillMatches: [...skillBuildMap.values()].reduce((sum, build) => sum + build.games, 0),
        itemMatches: itemBuildSampleMatches
      },
      mmrBreakdown,
      rankDistribution,
      recentMatches: recentMatches.map((match) => ({
        matchId: match.matchId ?? 0,
        startTime: match.startTime?.getTime() ?? null,
        durationSeconds: match.durationSeconds,
        radiantWin: match.radiantWin,
        heroWin: match.heroWin === null ? null : Boolean(match.heroWin),
        playerCount: match.playerCount,
        totalKills: match.totalKills ?? 0,
        radiantScore: match.radiantScore,
        direScore: match.direScore,
        leagueId: match.leagueId,
        patch: match.patch ?? null,
        league: match.leagueId ? savedLeagueNames.get(match.leagueId) ?? match.league ?? `League ${match.leagueId}` : null,
        averageRankTier: match.averageRankTier === null ? null : Number(match.averageRankTier.toFixed(1)),
        radiantAverageRankTier: match.radiantAverageRankTier === null ? null : Number(match.radiantAverageRankTier.toFixed(1)),
        direAverageRankTier: match.direAverageRankTier === null ? null : Number(match.direAverageRankTier.toFixed(1)),
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

    const leagueTeams = sqliteDb
      .prepare(
        `
          with team_rows as (
            select m.radiant_team_id as team_id, case when m.radiant_win = 1 then 1 else 0 end as won
            from matches m
            where m.league_id = ? and m.radiant_team_id is not null and m.radiant_team_id > 0
            union all
            select m.dire_team_id as team_id, case when m.radiant_win = 0 then 1 else 0 end as won
            from matches m
            where m.league_id = ? and m.dire_team_id is not null and m.dire_team_id > 0
          )
          select
            t.id as teamId,
            t.name as teamName,
            t.tag as teamTag,
            count(*) as games,
            sum(case when tr.won = 1 then 1 else 0 end) as wins
          from team_rows tr
          join teams t on t.id = tr.team_id
          group by t.id, t.name, t.tag
          order by games desc, wins desc, t.name asc
        `
      )
      .all(leagueId, leagueId) as Array<{
      teamId: number;
      teamName: string;
      teamTag: string | null;
      games: number;
      wins: number | null;
    }>;

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
      teams: leagueTeams.map((team) => {
        const wins = team.wins ?? 0;
        const losses = Math.max(0, team.games - wins);
        return {
          teamId: team.teamId,
          name: team.teamName,
          tag: team.teamTag,
          games: team.games,
          wins,
          losses,
          winrate: team.games ? Number(((wins / team.games) * 100).toFixed(1)) : 0
        };
      }),
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
        heroWin: null,
        playerCount: match.playerCount,
        totalKills: match.totalKills ?? 0,
        radiantScore: match.radiantScore,
        direScore: match.direScore,
        patch: match.patch ?? null,
        leagueId,
        league: leagueName,
        averageRankTier: null,
        radiantAverageRankTier: null,
        direAverageRankTier: null,
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

  async getLeagueTeamOverview(leagueId: number, teamId: number): Promise<TeamOverview> {
    await this.ensureReferenceData();
    const leagueOverview = await this.getLeagueOverview(leagueId);
    const team = leagueOverview.teams.find((entry) => entry.teamId === teamId);
    if (!team) {
      throw new Error("Team not found in the local dataset for this league.");
    }

    const exactTeamMatches = await db
      .select({
        matchId: matches.id,
        radiantTeamId: matches.radiantTeamId,
        direTeamId: matches.direTeamId
      })
      .from(matches)
      .where(
        and(
          eq(matches.leagueId, leagueId),
          sql`(${matches.radiantTeamId} = ${teamId} or ${matches.direTeamId} = ${teamId})`
        )
      );

    const teamSideByMatchId = new Map<number, boolean>();
    for (const match of exactTeamMatches) {
      if (match.radiantTeamId === teamId) {
        teamSideByMatchId.set(match.matchId, true);
      } else if (match.direTeamId === teamId) {
        teamSideByMatchId.set(match.matchId, false);
      }
    }

    const coreRosterRows =
      exactTeamMatches.length > 0
        ? await db
            .select({
              matchId: matchPlayers.matchId,
              playerId: matchPlayers.playerId,
              isRadiant: matchPlayers.isRadiant
            })
            .from(matchPlayers)
            .where(inArray(matchPlayers.matchId, exactTeamMatches.map((match) => match.matchId)))
        : [];
    const coreRosterPlayerIds = new Set(
      coreRosterRows
        .filter((row) => row.playerId !== null && teamSideByMatchId.get(row.matchId) === row.isRadiant)
        .map((row) => row.playerId as number)
    );

    const possibleTeamlessRows =
      coreRosterPlayerIds.size > 0
        ? await db
            .select({
              matchId: matches.id,
              playerId: matchPlayers.playerId,
              isRadiant: matchPlayers.isRadiant,
              radiantTeamId: matches.radiantTeamId,
              direTeamId: matches.direTeamId
            })
            .from(matchPlayers)
            .leftJoin(matches, eq(matches.id, matchPlayers.matchId))
            .where(eq(matches.leagueId, leagueId))
        : [];

    const teamlessSideMap = new Map<string, { matchId: number; isRadiant: boolean; overlap: number }>();
    for (const row of possibleTeamlessRows) {
      if (row.playerId === null || row.matchId === null) continue;
      const sideIsTeamless =
        row.isRadiant ? row.radiantTeamId === null : row.direTeamId === null;
      if (!sideIsTeamless) continue;
      const key = `${row.matchId}:${row.isRadiant ? "radiant" : "dire"}`;
      const current = teamlessSideMap.get(key) ?? { matchId: row.matchId, isRadiant: row.isRadiant ?? false, overlap: 0 };
      if (coreRosterPlayerIds.has(row.playerId)) {
        current.overlap += 1;
      }
      teamlessSideMap.set(key, current);
    }

    for (const candidate of teamlessSideMap.values()) {
      if (candidate.overlap >= 3 && !teamSideByMatchId.has(candidate.matchId)) {
        teamSideByMatchId.set(candidate.matchId, candidate.isRadiant);
      }
    }

    const scopedMatchIds = [...teamSideByMatchId.keys()];
    if (scopedMatchIds.length === 0) {
      throw new Error("No matches stored for this team yet.");
    }

    const parsedData = await this.getMatchParsedDataMap(scopedMatchIds);

    const scopedPlayerRows = await db
      .select({
        matchId: matchPlayers.matchId,
        playerId: matchPlayers.playerId,
        personaname: players.personaname,
        avatar: players.avatar,
        heroId: matchPlayers.heroId,
        heroInternalName: heroes.name,
        heroName: heroes.localizedName,
        heroIconPath: heroes.iconPath,
        win: matchPlayers.win,
        isRadiant: matchPlayers.isRadiant
      })
      .from(matchPlayers)
      .leftJoin(players, eq(players.id, matchPlayers.playerId))
      .leftJoin(heroes, eq(heroes.id, matchPlayers.heroId))
      .where(inArray(matchPlayers.matchId, scopedMatchIds));

    const teamParticipantRows = scopedPlayerRows.filter(
      (row) => teamSideByMatchId.get(row.matchId) === row.isRadiant
    );

    const matchMetaRows = await db
      .select({
        matchId: matches.id,
        startTime: matches.startTime,
        durationSeconds: matches.durationSeconds,
        radiantWin: matches.radiantWin,
        radiantScore: matches.radiantScore,
        direScore: matches.direScore,
        patch: patches.name,
        radiantTeamId: matches.radiantTeamId,
        direTeamId: matches.direTeamId
      })
      .from(matches)
      .leftJoin(patches, eq(patches.id, matches.patchId))
      .where(inArray(matches.id, scopedMatchIds))
      .orderBy(desc(matches.startTime));

    const allTeamIds = [...new Set(
      matchMetaRows.flatMap((row) => [row.radiantTeamId, row.direTeamId]).filter((value): value is number => value !== null)
    )];
    const teamNameRows =
      allTeamIds.length > 0
        ? await db.select({ id: teams.id, name: teams.name }).from(teams).where(inArray(teams.id, allTeamIds))
        : [];
    const teamNameMap = new Map(teamNameRows.map((row) => [row.id, row.name]));

    const uniquePlayers = new Set(teamParticipantRows.map((row) => row.playerId).filter((value): value is number => value !== null));
    const uniqueHeroes = new Set(teamParticipantRows.map((row) => row.heroId).filter((value): value is number => value !== null));
    const playerMap = new Map<
      number | string,
      {
        playerId: number | null;
        personaname: string | null;
        avatar: string | null;
        games: number;
        wins: number;
        uniqueHeroes: Set<number>;
      }
    >();
    const heroMap = new Map<
      number,
      {
        heroId: number;
        heroName: string;
        heroIconUrl: string | null;
        games: number;
        wins: number;
      }
    >();

    for (const row of teamParticipantRows) {
      const playerKey = row.playerId ?? `anon-${row.personaname ?? "unknown"}`;
      const currentPlayer =
        playerMap.get(playerKey) ??
        {
          playerId: row.playerId,
          personaname: row.personaname,
          avatar: row.avatar,
          games: 0,
          wins: 0,
          uniqueHeroes: new Set<number>()
        };
      currentPlayer.games += 1;
      if (row.win === true) currentPlayer.wins += 1;
      if (row.heroId !== null) currentPlayer.uniqueHeroes.add(row.heroId);
      playerMap.set(playerKey, currentPlayer);

      if (row.heroId !== null) {
        const currentHero =
          heroMap.get(row.heroId) ??
          {
            heroId: row.heroId,
            heroName: row.heroName ?? `Hero ${row.heroId}`,
            heroIconUrl: buildAssetProxyUrl(row.heroIconPath ?? defaultHeroIconPath(row.heroInternalName)),
            games: 0,
            wins: 0
          };
        currentHero.games += 1;
        if (row.win === true) currentHero.wins += 1;
        heroMap.set(row.heroId, currentHero);
      }
    }

    const playerIds = [...uniquePlayers];
    const comparisonStatsMap =
      playerIds.length > 0
        ? await this.buildComparisonStatsMap(
            playerIds,
            and(inArray(matchPlayers.matchId, scopedMatchIds), inArray(matchPlayers.playerId, playerIds))
          )
        : new Map<number, Array<{ key: string; label: string; value: number; higherIsBetter: boolean }>>();

    return {
      leagueId,
      leagueName: leagueOverview.name,
      teamId: team.teamId,
      name: team.name,
      tag: team.tag,
      games: matchMetaRows.length,
      wins: matchMetaRows.filter((match) => {
        const isRadiantTeam = teamSideByMatchId.get(match.matchId);
        return match.radiantWin !== null && isRadiantTeam !== undefined && (isRadiantTeam ? match.radiantWin : !match.radiantWin);
      }).length,
      losses: matchMetaRows.filter((match) => {
        const isRadiantTeam = teamSideByMatchId.get(match.matchId);
        return match.radiantWin !== null && isRadiantTeam !== undefined && (isRadiantTeam ? !match.radiantWin : match.radiantWin);
      }).length,
      winrate:
        matchMetaRows.length > 0
          ? Number(
              (
                (matchMetaRows.filter((match) => {
                  const isRadiantTeam = teamSideByMatchId.get(match.matchId);
                  return match.radiantWin !== null && isRadiantTeam !== undefined && (isRadiantTeam ? match.radiantWin : !match.radiantWin);
                }).length /
                  matchMetaRows.length) *
                100
              ).toFixed(1)
            )
          : 0,
      firstMatchTime: matchMetaRows.at(-1)?.startTime?.getTime() ?? null,
      lastMatchTime: matchMetaRows[0]?.startTime?.getTime() ?? null,
      uniquePlayers: uniquePlayers.size,
      uniqueHeroes: uniqueHeroes.size,
      topHeroes: [...heroMap.values()]
        .sort((left, right) => right.games - left.games || right.wins - left.wins || left.heroName.localeCompare(right.heroName))
        .slice(0, 12)
        .map((hero) => {
        const losses = Math.max(0, hero.games - hero.wins);
        return {
          heroId: hero.heroId,
          heroName: hero.heroName,
          heroIconUrl: hero.heroIconUrl,
          games: hero.games,
          wins: hero.wins,
          losses,
          winrate: hero.games ? Number(((hero.wins / hero.games) * 100).toFixed(1)) : 0
        };
      }),
      players: [...playerMap.values()]
        .sort((left, right) => right.games - left.games || right.wins - left.wins || (left.personaname ?? "").localeCompare(right.personaname ?? ""))
        .map((player) => {
        const losses = Math.max(0, player.games - player.wins);
        return {
          playerId: player.playerId,
          personaname: player.personaname,
          avatar: player.avatar,
          games: player.games,
          wins: player.wins,
          losses,
          winrate: player.games ? Number(((player.wins / player.games) * 100).toFixed(1)) : 0,
          uniqueHeroes: player.uniqueHeroes.size,
          comparisonStats: player.playerId ? comparisonStatsMap.get(player.playerId) ?? [] : []
        };
      }),
      matches: matchMetaRows.map((match) => {
        const isRadiantTeam = teamSideByMatchId.get(match.matchId) ?? false;
        const teamWin =
          match.radiantWin === null ? null : isRadiantTeam ? match.radiantWin : !match.radiantWin;
        const opponentName =
          isRadiantTeam
            ? match.direTeamId ? teamNameMap.get(match.direTeamId) ?? null : null
            : match.radiantTeamId ? teamNameMap.get(match.radiantTeamId) ?? null : null;
        const teamScore = isRadiantTeam ? match.radiantScore : match.direScore;
        const opponentScore = isRadiantTeam ? match.direScore : match.radiantScore;
        return {
          matchId: match.matchId,
          startTime: match.startTime?.getTime() ?? null,
          durationSeconds: match.durationSeconds,
          teamWin,
          opponentName,
          teamScore,
          opponentScore,
          patch: match.patch ?? null,
          parsedData: parsedData.get(match.matchId) ?? {
            label: "Basic",
            hasFullMatchPayload: false,
            timelines: false,
            itemTimings: false,
            vision: false
          }
        };
      })
    };
  }

  async syncLeagueMatches(leagueId: number, options?: { limit?: number }): Promise<LeagueSyncResponse> {
    await this.ensureReferenceData();
    const adapter = await this.createOpenDotaAdapter();
    const limit = Math.min(100, Math.max(1, options?.limit ?? 25));
    const settings = await this.settingsService.getSettings({ includeProtected: true });
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

    const existingMatchRows = await db
      .select({
        id: matches.id,
        radiantTeamId: matches.radiantTeamId,
        direTeamId: matches.direTeamId
      })
      .from(matches)
      .where(inArray(matches.id, candidates.map((match) => match.match_id).filter(Number.isInteger)));
    const existingMatches = new Set(existingMatchRows.map((row) => row.id));
    const teamlessExistingMatches = new Set(
      existingMatchRows
        .filter((row) => row.radiantTeamId === null || row.direTeamId === null)
        .map((row) => row.id)
    );

    const sortedCandidates = candidates
      .filter((match) => Number.isInteger(match.match_id))
      .sort((left, right) => (right.start_time ?? 0) - (left.start_time ?? 0));
    const candidateIds = sortedCandidates.map((match) => match.match_id);
    if (candidateIds.length > 0) {
      await db.update(matches).set({ leagueId, updatedAt: new Date() }).where(inArray(matches.id, candidateIds));
    }

    const toFetch = sortedCandidates
      .filter((match) => !existingMatches.has(match.match_id) || teamlessExistingMatches.has(match.match_id))
      .slice(0, limit);
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
      const settings = await this.settingsService.getSettings({ includeProtected: true });
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

  async getDashboard(options?: {
    adminUnlocked?: boolean;
    sessionSettings?: SessionSettingsOverrides;
    browserPreferences?: BrowserPreferencesOverrides;
  }) {
    await this.ensureReferenceData();
    const settings = await this.settingsService.getSettings({
      adminUnlocked: options?.adminUnlocked,
      browserPreferences: options?.browserPreferences
    });
    const matchScope = await this.getRecentPatchMatchScope(options?.sessionSettings);
    const baseDashboard = await this.analyticsService.getDashboard(matchScope ?? undefined);

    const focusedPlayerIds = [
      ...(settings.primaryPlayerId ? [settings.primaryPlayerId] : []),
      ...settings.favoritePlayerIds
    ].filter((value, index, list) => list.indexOf(value) === index);

    const focusedPlayers = [];
    for (const playerId of focusedPlayerIds) {
      const overview = await this.getPlayerOverview(playerId, {
        sessionSettings: options?.sessionSettings,
        browserPreferences: options?.browserPreferences,
        cacheOnly: true
      });
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

  async setFavoritePlayersForOwner(ownerPlayerId: number, favoritePlayerIds: number[]) {
    const normalizedOwnerPlayerId = Number(ownerPlayerId);
    if (!Number.isInteger(normalizedOwnerPlayerId) || normalizedOwnerPlayerId <= 0) {
      throw new Error("A valid current player is required before saving favorites.");
    }
    return this.settingsService.setFavoritePlayersForOwner(normalizedOwnerPlayerId, favoritePlayerIds);
  }

  async getCommunityGraph(): Promise<CommunityGraph> {
    const linksByOwner = await this.settingsService.getFavoriteLinksByOwner();
    const edges = Object.entries(linksByOwner).flatMap(([ownerId, favorites]) =>
      favorites.map((favoritePlayerId) => ({
        sourcePlayerId: Number(ownerId),
        targetPlayerId: favoritePlayerId
      }))
    );
    const playerIds = [...new Set(edges.flatMap((edge) => [edge.sourcePlayerId, edge.targetPlayerId]))];
    const playerRows =
      playerIds.length > 0
        ? await db
            .select({ id: players.id, personaname: players.personaname, avatar: players.avatar })
            .from(players)
            .where(inArray(players.id, playerIds))
        : [];
    const playersById = new Map(playerRows.map((row) => [row.id, row]));
    const outgoingCounts = new Map<number, number>();
    const incomingCounts = new Map<number, number>();
    for (const edge of edges) {
      outgoingCounts.set(edge.sourcePlayerId, (outgoingCounts.get(edge.sourcePlayerId) ?? 0) + 1);
      incomingCounts.set(edge.targetPlayerId, (incomingCounts.get(edge.targetPlayerId) ?? 0) + 1);
    }

    const bidirectionalPairs = new Set(
      edges
        .filter((edge) =>
          edges.some(
            (candidate) =>
              candidate.sourcePlayerId === edge.targetPlayerId && candidate.targetPlayerId === edge.sourcePlayerId
          )
        )
        .map((edge) => [edge.sourcePlayerId, edge.targetPlayerId].sort((left, right) => left - right).join(":"))
    );

    return {
      nodes: playerIds.map((playerId) => {
        const player = playersById.get(playerId);
        const favoritesCount = outgoingCounts.get(playerId) ?? 0;
        const favoredByCount = incomingCounts.get(playerId) ?? 0;
        return {
          playerId,
          personaname: player?.personaname ?? null,
          avatar: player?.avatar ?? null,
          favoritesCount,
          favoredByCount,
          degree: favoritesCount + favoredByCount
        };
      }),
      edges: edges.map((edge) => ({
        ...edge,
        bidirectional: bidirectionalPairs.has(
          [edge.sourcePlayerId, edge.targetPlayerId].sort((left, right) => left - right).join(":")
        )
      }))
    };
  }

  async getSettings(options?: { adminUnlocked?: boolean; browserPreferences?: BrowserPreferencesOverrides }) {
    return this.settingsService.getSettings(options);
  }

  async setAdminPassword(password: string) {
    return this.settingsService.setAdminPassword(password);
  }

    async updateSettings(input: SettingsPayload) {
      return this.settingsService.updateSettings(input);
    }

  async testStratz(playerId: number) {
    const adapter = await this.createStratzAdapter();
    return adapter.getPlayerBasic(playerId);
  }

  async testStratzMatchTelemetry(matchId: number) {
    const adapter = await this.createStratzAdapter();
    return adapter.getMatchTelemetry(matchId);
  }

  async testSteamLeague(leagueId: number) {
    const adapter = await this.createValveAdapter();
    return adapter.getLeagueMatches(leagueId, 5);
  }

  async verifyAdminPassword(password: string | null | undefined) {
    return this.settingsService.verifyAdminPassword(password);
  }

  getAppMode() {
    return config.appMode;
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
        lobbyType: match.lobby_type ?? null,
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
          lobbyType: match.lobby_type ?? null,
          updatedAt: new Date()
        }
      });
  }

  private async upsertDetailedMatch(
    database: typeof db,
    payload: Awaited<ReturnType<OpenDotaAdapter["getMatch"]>>["payload"],
    fetchedAt: number
  ) {
    const radiantTeamId =
      payload.radiant_team?.team_id ??
      payload.radiant_team_id ??
      null;
    const direTeamId =
      payload.dire_team?.team_id ??
      payload.dire_team_id ??
      null;
    const upsertTeam = async (
      teamId: number | null,
      teamName: string | null | undefined,
      tag: string | null | undefined
    ) => {
      if (!teamId || !Number.isInteger(teamId) || teamId <= 0 || !teamName?.trim()) return;
      await database
        .insert(teams)
        .values({
          id: teamId,
          name: teamName.trim(),
          tag: tag?.trim() || null,
          updatedAt: new Date()
        })
        .onConflictDoUpdate({
          target: teams.id,
          set: {
            name: teamName.trim(),
            tag: tag?.trim() || null,
            updatedAt: new Date()
          }
        });
    };

    await upsertTeam(radiantTeamId, payload.radiant_team?.name ?? payload.radiant_name ?? null, payload.radiant_team?.tag ?? null);
    await upsertTeam(direTeamId, payload.dire_team?.name ?? payload.dire_name ?? null, payload.dire_team?.tag ?? null);

    const referencedHeroIds = [
      ...(payload.picks_bans ?? []).map((draftEvent) => draftEvent.hero_id),
      ...(payload.players ?? []).map((player) => player.hero_id ?? null)
    ].filter((heroId): heroId is number => typeof heroId === "number" && Number.isInteger(heroId) && heroId > 0);
    const validHeroIds =
      referencedHeroIds.length > 0
        ? new Set(
            (
              await database
                .select({ id: heroes.id })
                .from(heroes)
                .where(inArray(heroes.id, [...new Set(referencedHeroIds)]))
            ).map((row) => row.id)
          )
        : new Set<number>();

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
        radiantTeamId,
        direTeamId,
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
          radiantTeamId,
          direTeamId,
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
      if (!validHeroIds.has(draftEvent.hero_id)) {
        continue;
      }
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
      const heroId =
        typeof player.hero_id === "number" && Number.isInteger(player.hero_id) && validHeroIds.has(player.hero_id)
          ? player.hero_id
          : null;

      await database
        .insert(matchPlayers)
        .values({
          matchId: payload.match_id,
          playerId: player.account_id ?? null,
          heroId,
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
          heroHealing: player.hero_healing ?? null,
          towerDamage: player.tower_damage ?? null,
          lastHits: player.last_hits ?? null,
          denies: player.denies ?? null,
          level: player.level ?? null,
          lobbyType: payload.lobby_type ?? null,
          item0: player.item_0 ?? null,
          item1: player.item_1 ?? null,
          item2: player.item_2 ?? null,
          item3: player.item_3 ?? null,
          item4: player.item_4 ?? null,
          item5: player.item_5 ?? null,
          itemNeutral: player.item_neutral ?? null,
          backpack0: player.backpack_0 ?? null,
          backpack1: player.backpack_1 ?? null,
          backpack2: player.backpack_2 ?? null,
          goldTJson: JSON.stringify(player.gold_t ?? []),
          xpTJson: JSON.stringify(player.xp_t ?? []),
          lhTJson: JSON.stringify(player.lh_t ?? []),
          dnTJson: JSON.stringify(player.dn_t ?? []),
          firstPurchaseTimeJson: JSON.stringify(player.first_purchase_time ?? {}),
          abilityUpgradesJson: JSON.stringify(normalizeAbilityUpgrades(player)),
          itemUsesJson: JSON.stringify(player.item_uses ?? {}),
          purchaseLogJson: JSON.stringify(player.purchase_log ?? []),
          obsLogJson: JSON.stringify(player.obs_log ?? []),
          senLogJson: JSON.stringify(player.sen_log ?? []),
          obsPlaced: player.obs_placed ?? null,
          senPlaced: player.sen_placed ?? null,
          observerKills: player.observer_kills ?? null,
          campsStacked: player.camps_stacked ?? null,
          courierKills: player.courier_kills ?? null,
          updatedAt: new Date()
        })
        .onConflictDoUpdate({
          target: [matchPlayers.matchId, matchPlayers.playerSlot],
          set: {
            playerId: player.account_id ?? null,
            heroId,
            isRadiant,
            win,
            kills: player.kills ?? null,
            deaths: player.deaths ?? null,
            assists: player.assists ?? null,
            netWorth: player.net_worth ?? null,
            gpm: player.gold_per_min ?? null,
            xpm: player.xp_per_min ?? null,
            heroDamage: player.hero_damage ?? null,
            heroHealing: player.hero_healing ?? null,
            towerDamage: player.tower_damage ?? null,
            lastHits: player.last_hits ?? null,
            denies: player.denies ?? null,
            level: player.level ?? null,
            lobbyType: payload.lobby_type ?? null,
            item0: player.item_0 ?? null,
            item1: player.item_1 ?? null,
            item2: player.item_2 ?? null,
            item3: player.item_3 ?? null,
            item4: player.item_4 ?? null,
            item5: player.item_5 ?? null,
            itemNeutral: player.item_neutral ?? null,
            backpack0: player.backpack_0 ?? null,
            backpack1: player.backpack_1 ?? null,
            backpack2: player.backpack_2 ?? null,
            goldTJson: JSON.stringify(player.gold_t ?? []),
            xpTJson: JSON.stringify(player.xp_t ?? []),
            lhTJson: JSON.stringify(player.lh_t ?? []),
            dnTJson: JSON.stringify(player.dn_t ?? []),
            firstPurchaseTimeJson: JSON.stringify(player.first_purchase_time ?? {}),
            abilityUpgradesJson: JSON.stringify(normalizeAbilityUpgrades(player)),
            itemUsesJson: JSON.stringify(player.item_uses ?? {}),
            purchaseLogJson: JSON.stringify(player.purchase_log ?? []),
            obsLogJson: JSON.stringify(player.obs_log ?? []),
            senLogJson: JSON.stringify(player.sen_log ?? []),
            obsPlaced: player.obs_placed ?? null,
            senPlaced: player.sen_placed ?? null,
            observerKills: player.observer_kills ?? null,
            campsStacked: player.camps_stacked ?? null,
            courierKills: player.courier_kills ?? null,
            updatedAt: new Date()
          }
        });
    }
  }
}
