import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { HeroOverview, MatchOverview, PlayerCompareResponse, PlayerOverview } from "@dota/shared";
import { OpenDotaAdapter, type OpenDotaRecentMatch } from "../adapters/openDota.js";
import { StratzAdapter } from "../adapters/stratz.js";
import { AnalyticsService } from "../analytics/analyticsService.js";
import { db } from "../db/client.js";
import { drafts, heroes, items, leagues, matchPlayers, matches, patches, players, rawApiPayloads } from "../db/schema.js";
import { config } from "../utils/config.js";
import { buildAssetProxyUrl, defaultHeroIconPath, defaultHeroPortraitPath, defaultItemImagePath } from "../utils/assets.js";
import { logger } from "../utils/logger.js";
import { RawPayloadService } from "./rawPayloadService.js";
import { ReferenceDataService } from "./referenceDataService.js";
import { SettingsService } from "./settingsService.js";

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

  private async isPriorityPlayer(playerId: number) {
    const settings = await this.settingsService.getSettings();
    return settings.primaryPlayerId === playerId || settings.favoritePlayerIds.includes(playerId);
  }

  async getPlayerOverview(playerId: number): Promise<PlayerOverview> {
    await this.ensureReferenceData();
    const adapter = await this.createOpenDotaAdapter();
    const priorityPlayer = await this.isPriorityPlayer(playerId);
    const [playerRow] = await db.select().from(players).where(eq(players.id, playerId)).limit(1);
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
      .where(eq(matchPlayers.playerId, playerId))
      .orderBy(desc(matches.startTime))
      .limit(priorityPlayer ? 100 : 20);

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
      .leftJoin(heroes, eq(heroes.id, matchPlayers.heroId))
      .where(eq(matchPlayers.playerId, playerId))
      .groupBy(matchPlayers.heroId, heroes.localizedName)
      .orderBy(desc(sql`count(${matchPlayers.id})`))
      .limit(8);

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
      .leftJoin(peerPlayer, eq(peerPlayer.id, peerMatch.playerId))
      .where(eq(playerMatchBase.playerId, playerId))
      .groupBy(peerMatch.playerId, peerPlayer.personaname, peerPlayer.avatar)
      .orderBy(desc(count(peerMatch.id)))
      .limit(12);

    const [winLossRow] = await db
      .select({
        wins: sql<number>`sum(case when ${matchPlayers.win} = 1 then 1 else 0 end)`,
        losses: sql<number>`sum(case when ${matchPlayers.win} = 0 then 1 else 0 end)`
      })
      .from(matchPlayers)
      .where(eq(matchPlayers.playerId, playerId));

    const historySyncedAt = await this.getLatestRawPayloadFetchedAt("player_match_history", String(playerId));

    return {
      playerId: freshPlayer.id,
      personaname: freshPlayer.personaname,
      avatar: freshPlayer.avatar,
      profileUrl: freshPlayer.profileUrl,
      countryCode: freshPlayer.countryCode,
      isPriorityPlayer: priorityPlayer,
      historySyncedAt,
      source,
      lastSyncedAt: freshPlayer.lastProfileFetchedAt?.getTime() ?? null,
      totalStoredMatches: totalStoredMatches ?? 0,
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
        gameMode: match.gameMode
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
          sql`${selectedMatchBase.playerId} < ${selectedMatchPeer.playerId}`
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
        .where(and(inArray(matchPlayers.matchId, sharedMatchIds), inArray(matchPlayers.playerId, uniquePlayerIds)))
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

  async getMatchOverview(matchId: number): Promise<MatchOverview> {
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
    const hasFullRoster = participantCount >= 10;
    const hasDetailedStats = detailedParticipantCount >= 10;
    const hasRawMatchPayload = Boolean(rawMatchPayload);
    const needsFullFetch = !matchRow || !hasFullRoster || !hasDetailedStats || !hasRawMatchPayload;

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
    const radiantPlayers = normalizedParticipants.filter((player) => player.isRadiant);
    const direPlayers = normalizedParticipants.filter((player) => !player.isRadiant);

    const sumBy = (rows: typeof normalizedParticipants, accessor: (row: (typeof normalizedParticipants)[number]) => number | null) =>
      rows.reduce((sum, row) => sum + (accessor(row) ?? 0), 0);
    const averageBy = (
      rows: typeof normalizedParticipants,
      accessor: (row: (typeof normalizedParticipants)[number]) => number | null
    ) => {
      if (rows.length === 0) return 0;
      return Math.round(sumBy(rows, accessor) / rows.length);
    };
    const buildLeader = (
      label: string,
      accessor: (row: (typeof normalizedParticipants)[number]) => number | null
    ) => {
      const sorted = normalizedParticipants
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
      participants: normalizedParticipants,
      draft,
      summary: {
        totalKills: sumBy(normalizedParticipants, (player) => player.kills),
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
    return this.analyticsService.getHeroStats();
  }

  async getHeroOverview(heroId: number): Promise<HeroOverview> {
    await this.ensureReferenceData();
    const heroStats = await this.analyticsService.getHeroStats();
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
      .where(eq(matchPlayers.heroId, heroId))
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

    const playerUsage = await db
      .select({
        playerId: matchPlayers.playerId,
        personaname: players.personaname,
        games: sql<number>`count(${matchPlayers.id})`,
        wins: sql<number>`sum(case when ${matchPlayers.win} = 1 then 1 else 0 end)`
      })
      .from(matchPlayers)
      .leftJoin(players, eq(players.id, matchPlayers.playerId))
      .where(eq(matchPlayers.heroId, heroId))
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
        league: match.league ?? null
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

  async getDashboard() {
    await this.ensureReferenceData();
    const settings = await this.settingsService.getSettings();
    const baseDashboard = await this.analyticsService.getDashboard();

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
    primaryPlayerId: number | null;
    favoritePlayerIds: number[];
  }) {
    return this.settingsService.updateSettings(input);
  }

  async testStratz(playerId: number) {
    const adapter = await this.createStratzAdapter();
    return adapter.getPlayerBasic(playerId);
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
          firstPurchaseTimeJson: JSON.stringify(player.first_purchase_time ?? {}),
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
            firstPurchaseTimeJson: JSON.stringify(player.first_purchase_time ?? {}),
            updatedAt: new Date()
          }
        });
    }
  }
}
