import { z } from "zod";

export const cacheSourceSchema = z.enum(["cache", "fresh"]);

export const playerMatchSummarySchema = z.object({
  matchId: z.number(),
  startTime: z.number().nullable(),
  durationSeconds: z.number().nullable(),
  heroId: z.number().nullable(),
  heroName: z.string().nullable(),
  heroIconUrl: z.string().nullable(),
  kills: z.number().nullable(),
  deaths: z.number().nullable(),
  assists: z.number().nullable(),
  win: z.boolean().nullable(),
  laneRole: z.number().nullable(),
  gameMode: z.number().nullable()
});

export const playerHeroUsageSchema = z.object({
  heroId: z.number(),
  heroName: z.string(),
  heroIconUrl: z.string().nullable(),
  games: z.number(),
  wins: z.number(),
  winrate: z.number()
});

export const playerPeerSchema = z.object({
  playerId: z.number(),
  personaname: z.string().nullable(),
  avatar: z.string().nullable(),
  games: z.number(),
  wins: z.number(),
  winrate: z.number()
});

export const playerOverviewSchema = z.object({
  playerId: z.number(),
  personaname: z.string().nullable(),
  avatar: z.string().nullable(),
  profileUrl: z.string().nullable(),
  countryCode: z.string().nullable(),
  isPriorityPlayer: z.boolean(),
  historySyncedAt: z.number().nullable(),
  source: cacheSourceSchema,
  lastSyncedAt: z.number().nullable(),
  totalStoredMatches: z.number(),
  wins: z.number(),
  losses: z.number(),
  heroUsage: z.array(playerHeroUsageSchema),
  peers: z.array(playerPeerSchema),
  matches: z.array(playerMatchSummarySchema)
});

export const matchParticipantSchema = z.object({
  playerId: z.number().nullable(),
  personaname: z.string().nullable(),
  heroId: z.number().nullable(),
  heroName: z.string().nullable(),
  heroIconUrl: z.string().nullable(),
  isRadiant: z.boolean(),
  playerSlot: z.number().nullable(),
  kills: z.number().nullable(),
  deaths: z.number().nullable(),
  assists: z.number().nullable(),
  netWorth: z.number().nullable(),
  gpm: z.number().nullable(),
  xpm: z.number().nullable(),
  heroDamage: z.number().nullable(),
  towerDamage: z.number().nullable(),
  lastHits: z.number().nullable(),
  denies: z.number().nullable(),
  level: z.number().nullable(),
  items: z.array(
    z.object({
      name: z.string(),
      imageUrl: z.string().nullable()
    })
  ).default([])
});

export const matchLeaderSchema = z.object({
  label: z.string(),
  playerId: z.number().nullable(),
  personaname: z.string().nullable(),
  heroName: z.string().nullable(),
  team: z.enum(["radiant", "dire"]),
  value: z.number()
});

export const draftEventSchema = z.object({
  heroId: z.number(),
  heroName: z.string().nullable(),
  team: z.enum(["radiant", "dire"]),
  isPick: z.boolean(),
  orderIndex: z.number()
});

export const matchOverviewSchema = z.object({
  matchId: z.number(),
  source: cacheSourceSchema,
  lastSyncedAt: z.number().nullable(),
  durationSeconds: z.number().nullable(),
  startTime: z.number().nullable(),
  radiantWin: z.boolean().nullable(),
  radiantScore: z.number().nullable(),
  direScore: z.number().nullable(),
  patch: z.string().nullable(),
  league: z.string().nullable(),
  participants: z.array(matchParticipantSchema),
  draft: z.array(draftEventSchema),
  summary: z.object({
    totalKills: z.number(),
    radiantPlayers: z.number(),
    direPlayers: z.number(),
    radiantNetWorth: z.number(),
    direNetWorth: z.number(),
    radiantHeroDamage: z.number(),
    direHeroDamage: z.number(),
    radiantTowerDamage: z.number(),
    direTowerDamage: z.number(),
    radiantLastHits: z.number(),
    direLastHits: z.number(),
    averageGpm: z.object({
      radiant: z.number(),
      dire: z.number()
    }),
    averageXpm: z.object({
      radiant: z.number(),
      dire: z.number()
    }),
    leaders: z.object({
      kills: matchLeaderSchema.nullable(),
      netWorth: matchLeaderSchema.nullable(),
      heroDamage: matchLeaderSchema.nullable(),
      lastHits: matchLeaderSchema.nullable(),
      assists: matchLeaderSchema.nullable()
    })
  })
});

export const heroStatSchema = z.object({
  heroId: z.number(),
  heroName: z.string(),
  heroIconUrl: z.string().nullable(),
  games: z.number(),
  wins: z.number(),
  winrate: z.number(),
  uniquePlayers: z.number(),
  averageFirstCoreItemTimingSeconds: z.number().nullable(),
  commonItems: z.array(
    z.object({
      itemName: z.string(),
      imageUrl: z.string().nullable(),
      averageTimingSeconds: z.number().nullable(),
      usages: z.number()
    })
  )
});

export const heroMatchSummarySchema = z.object({
  matchId: z.number(),
  startTime: z.number().nullable(),
  durationSeconds: z.number().nullable(),
  radiantWin: z.boolean().nullable(),
  playerCount: z.number(),
  totalKills: z.number(),
  radiantScore: z.number().nullable(),
  direScore: z.number().nullable(),
  patch: z.string().nullable(),
  league: z.string().nullable()
});

export const heroPlayerUsageSchema = z.object({
  playerId: z.number().nullable(),
  personaname: z.string().nullable(),
  games: z.number(),
  wins: z.number(),
  winrate: z.number()
});

export const heroOverviewSchema = z.object({
  heroId: z.number(),
  heroName: z.string(),
  heroIconUrl: z.string().nullable(),
  heroPortraitUrl: z.string().nullable(),
  source: cacheSourceSchema,
  games: z.number(),
  wins: z.number(),
  winrate: z.number(),
  uniquePlayers: z.number(),
  averageFirstCoreItemTimingSeconds: z.number().nullable(),
  commonItems: heroStatSchema.shape.commonItems,
  recentMatches: z.array(heroMatchSummarySchema),
  playerUsage: z.array(heroPlayerUsageSchema)
});

export const dashboardSchema = z.object({
  totalStoredMatches: z.number(),
  primaryPlayerId: z.number().nullable(),
  favoritePlayerIds: z.array(z.number()),
  focusedPlayers: z.array(
    z.object({
      playerId: z.number(),
      personaname: z.string().nullable(),
      avatar: z.string().nullable(),
      source: cacheSourceSchema,
      lastSyncedAt: z.number().nullable(),
      totalStoredMatches: z.number(),
      wins: z.number(),
      losses: z.number(),
      topHeroes: z.array(playerHeroUsageSchema).max(3),
      recentMatches: z.array(playerMatchSummarySchema).max(5)
    })
  ),
  mostPlayedHeroes: z.array(
    z.object({
      heroId: z.number(),
      heroName: z.string(),
      games: z.number()
    })
  ),
  highestWinrateHeroes: z.array(
    z.object({
      heroId: z.number(),
      heroName: z.string(),
      games: z.number(),
      winrate: z.number()
    })
  )
});

export const playerCompareSchema = z.object({
  playerIds: z.array(z.number()),
  players: z.array(
    z.object({
      playerId: z.number(),
      personaname: z.string().nullable(),
      avatar: z.string().nullable(),
      totalStoredMatches: z.number(),
      wins: z.number(),
      losses: z.number(),
      topHeroes: z.array(playerHeroUsageSchema).max(5)
    })
  ),
  sharedMatches: z.object({
    games: z.number(),
    wins: z.number(),
    losses: z.number(),
    winrate: z.number(),
    recentMatchIds: z.array(z.number()).max(10)
  }),
  pairStats: z.array(
    z.object({
      leftPlayerId: z.number(),
      rightPlayerId: z.number(),
      games: z.number(),
      wins: z.number(),
      losses: z.number(),
      winrate: z.number()
    })
  ),
  sharedMatchDetails: z.array(
    z.object({
      matchId: z.number(),
      startTime: z.number().nullable(),
      durationSeconds: z.number().nullable(),
      win: z.boolean().nullable()
    })
  ),
  heroCombinations: z.array(
    z.object({
      comboKey: z.string(),
      games: z.number(),
      wins: z.number(),
      losses: z.number(),
      winrate: z.number(),
      matchIds: z.array(z.number()),
      heroes: z.array(
        z.object({
          playerId: z.number(),
          personaname: z.string().nullable(),
          heroId: z.number(),
          heroName: z.string(),
          heroIconUrl: z.string().nullable()
        })
      )
    })
  )
});

export const settingsSchema = z.object({
  openDotaApiKey: z.string().nullable(),
  stratzApiKey: z.string().nullable(),
  primaryPlayerId: z.number().int().positive().nullable(),
  favoritePlayerIds: z.array(z.number().int().positive())
});

export type PlayerOverview = z.infer<typeof playerOverviewSchema>;
export type MatchOverview = z.infer<typeof matchOverviewSchema>;
export type HeroStat = z.infer<typeof heroStatSchema>;
export type HeroOverview = z.infer<typeof heroOverviewSchema>;
export type DashboardResponse = z.infer<typeof dashboardSchema>;
export type SettingsPayload = z.infer<typeof settingsSchema>;
export type PlayerCompareResponse = z.infer<typeof playerCompareSchema>;
