import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { DashboardResponse, HeroStat } from "@dota/shared";
import { db } from "../db/client.js";
import { drafts, heroes, items, matchPlayers, matches, players } from "../db/schema.js";
import { buildAssetProxyUrl, defaultHeroIconPath, defaultItemImagePath } from "../utils/assets.js";

export class AnalyticsService {
  async getHeroStats(
    matchScope?: { patchIds: number[]; cutoffStartTimeMs: number | null },
    options?: { leagueId?: number | null }
  ): Promise<HeroStat[]> {
    const scopedWhere = this.buildMatchScopeWhere(matchScope);
    const leagueWhere = options?.leagueId ? eq(matches.leagueId, options.leagueId) : undefined;
    const rows = await db
      .select({
        heroId: matchPlayers.heroId,
        heroInternalName: heroes.name,
        heroName: heroes.localizedName,
        heroIconPath: heroes.iconPath,
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
      .leftJoin(heroes, eq(heroes.id, matchPlayers.heroId))
      .where(and(sql`${matchPlayers.heroId} is not null`, scopedWhere, leagueWhere))
      .groupBy(matchPlayers.heroId, heroes.name, heroes.localizedName, heroes.iconPath)
      .orderBy(desc(count(matchPlayers.id)));

    const itemRows = await db
      .select({
        heroId: matchPlayers.heroId,
        itemInternalName: items.name,
        itemName: items.localizedName,
        itemImagePath: items.imagePath,
        timing: sql<number | null>`avg(json_extract(${matchPlayers.firstPurchaseTimeJson}, '$."item_0"'))`,
        usages: count(matchPlayers.id)
      })
      .from(matchPlayers)
      .leftJoin(matches, eq(matches.id, matchPlayers.matchId))
      .leftJoin(items, eq(items.id, matchPlayers.item0))
      .where(and(sql`${matchPlayers.heroId} is not null and ${matchPlayers.item0} is not null`, scopedWhere, leagueWhere))
      .groupBy(matchPlayers.heroId, items.name, items.localizedName, items.imagePath);

    const itemMap = new Map<
      number,
      Array<{ itemName: string; imageUrl: string | null; averageTimingSeconds: number | null; usages: number }>
    >();

    for (const row of itemRows) {
      if (!row.heroId || !row.itemName) continue;
      const list = itemMap.get(row.heroId) ?? [];
      list.push({
        itemName: row.itemName,
        imageUrl: buildAssetProxyUrl(row.itemImagePath ?? defaultItemImagePath(row.itemInternalName)),
        averageTimingSeconds: row.timing ?? null,
        usages: row.usages
      });
      itemMap.set(row.heroId, list.sort((a, b) => b.usages - a.usages).slice(0, 3));
    }

    return rows.map((row) => ({
      heroId: row.heroId ?? 0,
      heroName: row.heroName ?? `Hero ${row.heroId}`,
      heroIconUrl: buildAssetProxyUrl(row.heroIconPath ?? defaultHeroIconPath(row.heroInternalName)),
      games: row.games,
      wins: row.wins ?? 0,
      winrate: row.games ? Number((((row.wins ?? 0) / row.games) * 100).toFixed(1)) : 0,
      uniquePlayers: row.uniquePlayers ?? 0,
      averageFirstCoreItemTimingSeconds: row.averageFirstCoreItemTimingSeconds ?? null,
      commonItems: itemMap.get(row.heroId ?? 0) ?? []
    }));
  }

  async getDashboard(matchScope?: { patchIds: number[]; cutoffStartTimeMs: number | null }): Promise<DashboardResponse> {
    const scopedWhere = this.buildMatchScopeWhere(matchScope);
    const [{ totalStoredMatches }] = await db
      .select({ totalStoredMatches: count(matches.id) })
      .from(matches)
      .where(scopedWhere);

    const mostPlayedHeroes = await db
      .select({
        heroId: matchPlayers.heroId,
        heroName: heroes.localizedName,
        games: count(matchPlayers.id)
      })
      .from(matchPlayers)
      .leftJoin(matches, eq(matches.id, matchPlayers.matchId))
      .leftJoin(heroes, eq(heroes.id, matchPlayers.heroId))
      .where(and(sql`${matchPlayers.heroId} is not null`, scopedWhere))
      .groupBy(matchPlayers.heroId, heroes.localizedName)
      .orderBy(desc(count(matchPlayers.id)))
      .limit(5);

    const heroWinrateExpr = sql<number>`
      (sum(case when ${matchPlayers.win} = 1 then 1.0 else 0 end) / count(${matchPlayers.id})) * 100
    `;

    const highestWinrateHeroes = await db
      .select({
        heroId: matchPlayers.heroId,
        heroName: heroes.localizedName,
        games: count(matchPlayers.id),
        winrate: heroWinrateExpr
      })
      .from(matchPlayers)
      .leftJoin(matches, eq(matches.id, matchPlayers.matchId))
      .leftJoin(heroes, eq(heroes.id, matchPlayers.heroId))
      .where(and(sql`${matchPlayers.heroId} is not null`, scopedWhere))
      .groupBy(matchPlayers.heroId, heroes.localizedName)
      .having(sql`count(${matchPlayers.id}) >= 3`)
      .orderBy(desc(heroWinrateExpr))
      .limit(5);

    return {
      totalStoredMatches,
      primaryPlayerId: null,
      favoritePlayerIds: [],
      focusedPlayers: [],
      mostPlayedHeroes: mostPlayedHeroes.map((row) => ({
        heroId: row.heroId ?? 0,
        heroName: row.heroName ?? `Hero ${row.heroId}`,
        games: row.games
      })),
      highestWinrateHeroes: highestWinrateHeroes.map((row) => ({
        heroId: row.heroId ?? 0,
        heroName: row.heroName ?? `Hero ${row.heroId}`,
        games: row.games,
        winrate: Number((row.winrate ?? 0).toFixed(1))
      }))
    };
  }

  async getDraftOverview(matchId: number) {
    const rows = await db
      .select({
        heroId: drafts.heroId,
        heroName: heroes.localizedName,
        team: drafts.team,
        isPick: drafts.isPick,
        orderIndex: drafts.orderIndex
      })
      .from(drafts)
      .leftJoin(heroes, eq(heroes.id, drafts.heroId))
      .where(eq(drafts.matchId, matchId))
      .orderBy(drafts.orderIndex);

    return rows.map((row) => ({
      heroId: row.heroId,
      heroName: row.heroName,
      team: row.team as "radiant" | "dire",
      isPick: row.isPick,
      orderIndex: row.orderIndex
    }));
  }

  private buildMatchScopeWhere(matchScope?: { patchIds: number[]; cutoffStartTimeMs: number | null }) {
    if (!matchScope || (matchScope.patchIds.length === 0 && !matchScope.cutoffStartTimeMs)) {
      return sql`1 = 1`;
    }

    const clauses = [];
    if (matchScope.patchIds.length > 0) {
      clauses.push(inArray(matches.patchId, matchScope.patchIds));
    }
    if (matchScope.cutoffStartTimeMs) {
      clauses.push(sql`${matches.startTime} >= ${matchScope.cutoffStartTimeMs}`);
    }

    return sql`(${sql.join(clauses, sql` or `)})`;
  }
}
