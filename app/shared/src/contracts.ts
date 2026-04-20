import { z } from "zod";

export const cacheSourceSchema = z.enum(["cache", "fresh"]);

export const matchParsedDataSchema = z.object({
  label: z.string(),
  hasFullMatchPayload: z.boolean(),
  timelines: z.boolean(),
  itemTimings: z.boolean(),
  vision: z.boolean()
});

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
  gameMode: z.number().nullable(),
  parsedData: matchParsedDataSchema
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
  rankTier: z.number().nullable(),
  leaderboardRank: z.number().nullable(),
  isPriorityPlayer: z.boolean(),
  autoRefreshOnOpen: z.boolean(),
  historySyncedAt: z.number().nullable(),
  source: cacheSourceSchema,
  lastSyncedAt: z.number().nullable(),
  totalStoredMatches: z.number(),
  totalLocalMatches: z.number(),
  matchScopeLabel: z.string(),
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
  goldTimeline: z.array(z.number()).default([]),
  xpTimeline: z.array(z.number()).default([]),
  lastHitsTimeline: z.array(z.number()).default([]),
  deniesTimeline: z.array(z.number()).default([]),
  heroDamageTimeline: z.array(z.number()).default([]),
  damageTakenTimeline: z.array(z.number()).default([]),
  firstPurchaseTimes: z.record(z.string(), z.number()).default({}),
  itemUses: z.record(z.string(), z.number()).default({}),
  purchaseLog: z.array(
    z.object({
      time: z.number(),
      key: z.string(),
      charges: z.number().nullable()
    })
  ).default([]),
  observerLog: z.array(
    z.object({
      time: z.number(),
      x: z.number().nullable(),
      y: z.number().nullable(),
      z: z.number().nullable()
    })
  ).default([]),
  sentryLog: z.array(
    z.object({
      time: z.number(),
      x: z.number().nullable(),
      y: z.number().nullable(),
      z: z.number().nullable()
    })
  ).default([]),
  observerWardsPlaced: z.number().nullable(),
  sentryWardsPlaced: z.number().nullable(),
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

export const providerTelemetryStatusSchema = z.object({
  configured: z.boolean(),
  attempted: z.boolean(),
  timelines: z.boolean(),
  itemTimings: z.boolean(),
  vision: z.boolean(),
  message: z.string().nullable()
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
  telemetryStatus: z.object({
    openDota: providerTelemetryStatusSchema,
    stratz: providerTelemetryStatusSchema,
    effective: z.object({
      timelines: z.boolean(),
      itemTimings: z.boolean(),
      vision: z.boolean()
    })
  }),
  timelineMinutes: z.array(z.number()).default([]),
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
  league: z.string().nullable(),
  parsedData: matchParsedDataSchema
});

export const leagueMatchPlayerSchema = z.object({
  matchId: z.number(),
  playerId: z.number().nullable(),
  personaname: z.string().nullable(),
  heroId: z.number(),
  heroName: z.string(),
  heroIconUrl: z.string().nullable(),
  win: z.boolean().nullable()
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

export const leagueSummarySchema = z.object({
  leagueId: z.number(),
  name: z.string(),
  matchCount: z.number(),
  parsedFullMatches: z.number(),
  firstMatchTime: z.number().nullable(),
  lastMatchTime: z.number().nullable(),
  uniquePlayers: z.number(),
  uniqueHeroes: z.number()
});

export const leagueOverviewSchema = z.object({
  leagueId: z.number(),
  name: z.string(),
  matchCount: z.number(),
  parsedFullMatches: z.number(),
  firstMatchTime: z.number().nullable(),
  lastMatchTime: z.number().nullable(),
  uniquePlayers: z.number(),
  uniqueHeroes: z.number(),
  topHeroes: z.array(
    z.object({
      heroId: z.number(),
      heroName: z.string(),
      heroIconUrl: z.string().nullable(),
      games: z.number(),
      wins: z.number(),
      winrate: z.number()
    })
  ),
    topPlayers: z.array(
      z.object({
        playerId: z.number().nullable(),
        personaname: z.string().nullable(),
        games: z.number(),
        wins: z.number(),
        winrate: z.number()
      })
    ),
    heroes: z.array(
      z.object({
        heroId: z.number(),
        heroName: z.string(),
        heroIconUrl: z.string().nullable(),
        games: z.number(),
        wins: z.number(),
        losses: z.number(),
        winrate: z.number(),
        uniquePlayers: z.number()
      })
    ).default([]),
      players: z.array(
        z.object({
          playerId: z.number().nullable(),
          personaname: z.string().nullable(),
          games: z.number(),
        wins: z.number(),
        losses: z.number(),
        winrate: z.number(),
          uniqueHeroes: z.number()
        })
      ).default([]),
      heroPlayers: z.array(
        z.object({
          heroId: z.number(),
          playerId: z.number().nullable(),
          personaname: z.string().nullable(),
          games: z.number(),
          wins: z.number(),
          losses: z.number(),
          winrate: z.number()
        })
      ).default([]),
      matchPlayers: z.array(leagueMatchPlayerSchema).default([]),
      items: z.array(
      z.object({
        itemId: z.number(),
        itemName: z.string(),
        imageUrl: z.string().nullable(),
        cost: z.number().nullable(),
        games: z.number(),
        wins: z.number(),
        losses: z.number(),
        winrate: z.number()
      })
    ).default([]),
    matches: z.array(heroMatchSummarySchema)
  });

export const leagueSyncResponseSchema = z.object({
  leagueId: z.number(),
  requestedMatches: z.number(),
  fetchedMatches: z.number(),
  skippedMatches: z.number(),
  failedMatches: z.array(z.object({ matchId: z.number(), message: z.string() })),
  providerMessages: z.array(z.string()).default([]),
  overview: leagueOverviewSchema
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
      rankTier: z.number().nullable(),
      leaderboardRank: z.number().nullable(),
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
      rankTier: z.number().nullable(),
      leaderboardRank: z.number().nullable(),
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
  steamApiKey: z.string().nullable(),
  primaryPlayerId: z.number().int().positive().nullable(),
  favoritePlayerIds: z.array(z.number().int().positive()),
  savedLeagues: z.array(
    z.object({
      leagueId: z.number().int().positive(),
      slug: z.string(),
      name: z.string()
    })
  ).default([]),
  limitToRecentPatches: z.boolean().default(true)
    ,
  recentPatchCount: z.number().int().min(0).default(2),
  autoRefreshPlayerIds: z.array(z.number().int().positive()).default([]),
  colorblindMode: z.boolean().default(false),
  stratzDailyRequestCap: z.number().int().min(1).max(100000).default(10000)
});

export type PlayerOverview = z.infer<typeof playerOverviewSchema>;
export type MatchOverview = z.infer<typeof matchOverviewSchema>;
export type HeroStat = z.infer<typeof heroStatSchema>;
export type HeroOverview = z.infer<typeof heroOverviewSchema>;
export type LeagueSummary = z.infer<typeof leagueSummarySchema>;
export type LeagueOverview = z.infer<typeof leagueOverviewSchema>;
export type LeagueSyncResponse = z.infer<typeof leagueSyncResponseSchema>;
export type DashboardResponse = z.infer<typeof dashboardSchema>;
export type SettingsPayload = z.infer<typeof settingsSchema>;
export type PlayerCompareResponse = z.infer<typeof playerCompareSchema>;
