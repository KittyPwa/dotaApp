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
  gameModeLabel: z.string(),
  leagueId: z.number().nullable(),
  leagueName: z.string().nullable(),
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
  availableLeagues: z.array(
    z.object({
      leagueId: z.number(),
      leagueName: z.string()
    })
  ),
  availableHeroes: z.array(playerHeroUsageSchema),
  activeFilters: z.object({
    leagueId: z.number().nullable(),
    queue: z.enum(["all", "ranked", "unranked", "turbo"]),
    heroId: z.number().nullable()
  }),
  wins: z.number(),
  losses: z.number(),
  comparisonStats: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      value: z.number(),
      higherIsBetter: z.boolean()
    })
  ),
  averageObserverWardLifetimePercent: z.number().nullable(),
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
  lobbyType: z.number().nullable().optional(),
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
      z: z.number().nullable(),
      action: z.string().nullable().optional()
    })
  ).default([]),
  sentryLog: z.array(
    z.object({
      time: z.number(),
      x: z.number().nullable(),
      y: z.number().nullable(),
      z: z.number().nullable(),
      action: z.string().nullable().optional()
    })
  ).default([]),
  observerWardsPlaced: z.number().nullable(),
  sentryWardsPlaced: z.number().nullable(),
  finalInventory: z.array(
    z.object({
      name: z.string(),
      imageUrl: z.string().nullable()
    }).nullable()
  ).default([]),
  finalBackpack: z.array(
    z.object({
      name: z.string(),
      imageUrl: z.string().nullable()
    }).nullable()
  ).default([]),
  finalNeutral: z.object({
    name: z.string(),
    imageUrl: z.string().nullable()
  }).nullable().optional(),
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
  primaryAttr: z.string().nullable().optional(),
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
  heroWin: z.boolean().nullable(),
  playerCount: z.number(),
  totalKills: z.number(),
  radiantScore: z.number().nullable(),
  direScore: z.number().nullable(),
  patch: z.string().nullable(),
  leagueId: z.number().nullable(),
  league: z.string().nullable(),
  averageRankTier: z.number().nullable(),
  radiantAverageRankTier: z.number().nullable(),
  direAverageRankTier: z.number().nullable(),
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
  availableLeagues: z.array(
    z.object({
      leagueId: z.number(),
      leagueName: z.string()
    })
  ),
  activeFilters: z.object({
    leagueId: z.number().nullable(),
    minRankTier: z.number().nullable(),
    maxRankTier: z.number().nullable()
  }),
  games: z.number(),
  wins: z.number(),
  winrate: z.number(),
  uniquePlayers: z.number(),
  averageFirstCoreItemTimingSeconds: z.number().nullable(),
  commonItems: heroStatSchema.shape.commonItems,
  commonSkillBuilds: z.array(
    z.object({
      sequence: z.array(
        z.object({
          level: z.number(),
          abilityId: z.number(),
          abilityName: z.string(),
          imageUrl: z.string().nullable()
        })
      ),
      games: z.number(),
      winrate: z.number()
    })
  ),
  commonItemBuilds: z.array(
    z.object({
      sequence: z.array(
        z.object({
          itemName: z.string(),
          imageUrl: z.string().nullable()
        })
      ),
      games: z.number(),
      winrate: z.number()
    })
  ),
  buildSamples: z.object({
    skillMatches: z.number(),
    itemMatches: z.number()
  }),
  mmrBreakdown: z.array(
    z.object({
      label: z.string(),
      minRankTier: z.number().nullable(),
      games: z.number(),
      wins: z.number(),
      winrate: z.number()
    })
  ),
  rankDistribution: z.array(
    z.object({
      rankTier: z.number(),
      label: z.string(),
      games: z.number()
    })
  ),
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
  teams: z.array(
    z.object({
      teamId: z.number(),
      name: z.string(),
      tag: z.string().nullable(),
      games: z.number(),
      wins: z.number(),
      losses: z.number(),
      winrate: z.number()
    })
  ).default([]),
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

export const teamOverviewSchema = z.object({
  leagueId: z.number(),
  leagueName: z.string(),
  teamId: z.number(),
  name: z.string(),
  tag: z.string().nullable(),
  games: z.number(),
  wins: z.number(),
  losses: z.number(),
  winrate: z.number(),
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
      losses: z.number(),
      winrate: z.number()
    })
  ),
  players: z.array(
    z.object({
      playerId: z.number().nullable(),
      personaname: z.string().nullable(),
      avatar: z.string().nullable(),
      games: z.number(),
      wins: z.number(),
      losses: z.number(),
      winrate: z.number(),
      uniqueHeroes: z.number(),
      comparisonStats: z.array(
        z.object({
          key: z.string(),
          label: z.string(),
          value: z.number(),
          higherIsBetter: z.boolean()
        })
      )
    })
  ),
  matches: z.array(
    z.object({
      matchId: z.number(),
      startTime: z.number().nullable(),
      durationSeconds: z.number().nullable(),
      teamWin: z.boolean().nullable(),
      opponentName: z.string().nullable(),
      teamScore: z.number().nullable(),
      opponentScore: z.number().nullable(),
      patch: z.string().nullable(),
      parsedData: matchParsedDataSchema
    })
  )
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

export const communityGraphSchema = z.object({
  nodes: z.array(
    z.object({
      playerId: z.number(),
      personaname: z.string().nullable(),
      avatar: z.string().nullable(),
      favoritesCount: z.number(),
      favoredByCount: z.number(),
      degree: z.number()
    })
  ),
  edges: z.array(
    z.object({
      sourcePlayerId: z.number(),
      targetPlayerId: z.number(),
      bidirectional: z.boolean()
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
      comparisonStats: z.array(
        z.object({
          key: z.string(),
          label: z.string(),
          value: z.number(),
          higherIsBetter: z.boolean()
        })
      ),
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

export const draftSideSchema = z.enum(["first", "second"]);
export const draftSlotKindSchema = z.enum(["ban", "pick"]);

export const draftSlotSchema = z.object({
  id: z.string().min(1),
  side: draftSideSchema,
  kind: draftSlotKindSchema,
  label: z.string().min(1),
  heroIds: z.array(z.number().int().positive())
});

export const draftPlanSchema = z.object({
  id: z.string().min(1),
  leagueId: z.number().int().positive(),
  name: z.string().min(1).max(120),
  firstTeamId: z.number().int().positive().nullable(),
  secondTeamId: z.number().int().positive().nullable(),
  updatedAt: z.number(),
  slots: z.array(draftSlotSchema)
});

export const draftContextHeroSchema = z.object({
  heroId: z.number(),
  heroName: z.string(),
  heroIconUrl: z.string().nullable(),
  games: z.number(),
  wins: z.number(),
  winrate: z.number()
});

export const draftContextPlayerSchema = z.object({
  playerId: z.number(),
  personaname: z.string().nullable(),
  totalGames: z.number(),
  heroes: z.array(draftContextHeroSchema)
});

export const draftContextComboSchema = z.object({
  side: draftSideSchema,
  comboKey: z.string(),
  games: z.number(),
  wins: z.number(),
  winrate: z.number(),
  heroes: z.array(
    z.object({
      heroId: z.number(),
      heroName: z.string(),
      heroIconUrl: z.string().nullable()
    })
  )
});

export const draftContextSchema = z.object({
  players: z.array(draftContextPlayerSchema),
  combos: z.array(draftContextComboSchema)
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
  darkMode: z.boolean().default(false),
  stratzPerSecondCap: z.number().int().min(1).max(1000).default(20),
  stratzPerMinuteCap: z.number().int().min(1).max(10000).default(250),
  stratzPerHourCap: z.number().int().min(1).max(100000).default(2000),
  stratzDailyRequestCap: z.number().int().min(1).max(100000).default(10000),
  appMode: z.enum(["personal", "public"]).default("personal"),
  adminUnlocked: z.boolean().default(false),
  adminPasswordConfigured: z.boolean().default(false)
});

export type PlayerOverview = z.infer<typeof playerOverviewSchema>;
export type MatchOverview = z.infer<typeof matchOverviewSchema>;
export type HeroStat = z.infer<typeof heroStatSchema>;
export type HeroOverview = z.infer<typeof heroOverviewSchema>;
export type LeagueSummary = z.infer<typeof leagueSummarySchema>;
export type LeagueOverview = z.infer<typeof leagueOverviewSchema>;
export type TeamOverview = z.infer<typeof teamOverviewSchema>;
export type LeagueSyncResponse = z.infer<typeof leagueSyncResponseSchema>;
export type DashboardResponse = z.infer<typeof dashboardSchema>;
export type CommunityGraph = z.infer<typeof communityGraphSchema>;
export type SettingsPayload = z.infer<typeof settingsSchema>;
export type PlayerCompareResponse = z.infer<typeof playerCompareSchema>;
export type DraftPlanPayload = z.infer<typeof draftPlanSchema>;
export type DraftContextResponse = z.infer<typeof draftContextSchema>;
