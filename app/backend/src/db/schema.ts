import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const players = sqliteTable("players", {
  id: integer("id").primaryKey(),
  personaname: text("personaname"),
  avatar: text("avatar"),
  profileUrl: text("profile_url"),
  countryCode: text("country_code"),
  rankTier: integer("rank_tier"),
  leaderboardRank: integer("leaderboard_rank"),
  providerSource: text("provider_source").notNull().default("opendota"),
  lastProfileFetchedAt: integer("last_profile_fetched_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`)
});

export const heroes = sqliteTable("heroes", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  localizedName: text("localized_name").notNull(),
  iconPath: text("icon_path"),
  portraitPath: text("portrait_path"),
  primaryAttr: text("primary_attr"),
  attackType: text("attack_type"),
  rolesJson: text("roles_json"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`)
});

export const teams = sqliteTable("teams", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  tag: text("tag"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`)
});

export const matches = sqliteTable("matches", {
  id: integer("id").primaryKey(),
  startTime: integer("start_time", { mode: "timestamp_ms" }),
  durationSeconds: integer("duration_seconds"),
  radiantWin: integer("radiant_win", { mode: "boolean" }),
  radiantScore: integer("radiant_score"),
  direScore: integer("dire_score"),
  patchId: integer("patch_id"),
  leagueId: integer("league_id"),
  radiantTeamId: integer("radiant_team_id").references(() => teams.id, { onDelete: "set null" }),
  direTeamId: integer("dire_team_id").references(() => teams.id, { onDelete: "set null" }),
  providerSource: text("provider_source").notNull().default("opendota"),
  lastFetchedAt: integer("last_fetched_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`)
});

export const matchPlayers = sqliteTable(
  "match_players",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    matchId: integer("match_id").notNull().references(() => matches.id, { onDelete: "cascade" }),
    playerId: integer("player_id").references(() => players.id, { onDelete: "set null" }),
    heroId: integer("hero_id").references(() => heroes.id, { onDelete: "set null" }),
    playerSlot: integer("player_slot"),
    isRadiant: integer("is_radiant", { mode: "boolean" }).notNull(),
    win: integer("win", { mode: "boolean" }),
    kills: integer("kills"),
    deaths: integer("deaths"),
    assists: integer("assists"),
    netWorth: integer("net_worth"),
    gpm: integer("gpm"),
    xpm: integer("xpm"),
    heroDamage: integer("hero_damage"),
    heroHealing: integer("hero_healing"),
    towerDamage: integer("tower_damage"),
    lastHits: integer("last_hits"),
    denies: integer("denies"),
    level: integer("level"),
    laneRole: integer("lane_role"),
    gameMode: integer("game_mode"),
    lobbyType: integer("lobby_type"),
    item0: integer("item_0"),
    item1: integer("item_1"),
    item2: integer("item_2"),
    item3: integer("item_3"),
    item4: integer("item_4"),
    item5: integer("item_5"),
    itemNeutral: integer("item_neutral"),
    backpack0: integer("backpack_0"),
    backpack1: integer("backpack_1"),
    backpack2: integer("backpack_2"),
    goldTJson: text("gold_t_json"),
    xpTJson: text("xp_t_json"),
    lhTJson: text("lh_t_json"),
    dnTJson: text("dn_t_json"),
    firstPurchaseTimeJson: text("first_purchase_time_json"),
    abilityUpgradesJson: text("ability_upgrades_json"),
    itemUsesJson: text("item_uses_json"),
    purchaseLogJson: text("purchase_log_json"),
    obsLogJson: text("obs_log_json"),
    senLogJson: text("sen_log_json"),
    obsPlaced: integer("obs_placed"),
    senPlaced: integer("sen_placed"),
    observerKills: integer("observer_kills"),
    campsStacked: integer("camps_stacked"),
    courierKills: integer("courier_kills"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`)
  },
  (table) => ({
    uniqueByMatchSlot: uniqueIndex("match_players_match_player_unique").on(table.matchId, table.playerSlot)
  })
);

export const items = sqliteTable("items", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  localizedName: text("localized_name").notNull(),
  imagePath: text("image_path"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`)
});

export const patches = sqliteTable("patches", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  releaseDate: integer("release_date", { mode: "timestamp_ms" })
});

export const leagues = sqliteTable("leagues", {
  id: integer("id").primaryKey(),
  name: text("name").notNull()
});

export const drafts = sqliteTable("drafts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  matchId: integer("match_id").notNull().references(() => matches.id, { onDelete: "cascade" }),
  heroId: integer("hero_id").notNull().references(() => heroes.id, { onDelete: "cascade" }),
  team: text("team").notNull(),
  isPick: integer("is_pick", { mode: "boolean" }).notNull(),
  orderIndex: integer("order_index").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`)
});

export const draftPlans = sqliteTable(
  "draft_plans",
  {
    id: text("id").primaryKey(),
    ownerKey: text("owner_key").notNull(),
    leagueId: integer("league_id").notNull(),
    name: text("name").notNull(),
    firstTeamId: integer("first_team_id"),
    secondTeamId: integer("second_team_id"),
    slotsJson: text("slots_json").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`)
  },
  (table) => ({
    ownerLeagueIdx: index("draft_plans_owner_league_idx").on(table.ownerKey, table.leagueId)
  })
);

export const rawApiPayloads = sqliteTable(
  "raw_api_payloads",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    provider: text("provider").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    fetchedAt: integer("fetched_at", { mode: "timestamp_ms" }).notNull(),
    rawJson: text("raw_json").notNull(),
    parseVersion: text("parse_version").notNull().default("v1"),
    requestContext: text("request_context")
  },
  (table) => ({
    lookupIdx: index("raw_api_payloads_lookup_idx").on(table.provider, table.entityType, table.entityId)
  })
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`)
});

export const providerRequestEvents = sqliteTable(
  "provider_request_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    provider: text("provider").notNull(),
    requestedAt: integer("requested_at", { mode: "timestamp_ms" }).notNull()
  },
  (table) => ({
    providerRequestedAtIdx: index("provider_request_events_provider_requested_at_idx").on(
      table.provider,
      table.requestedAt
    )
  })
);

export const providerQuotaSnapshots = sqliteTable("provider_quota_snapshots", {
  provider: text("provider").primaryKey(),
  observedAt: integer("observed_at", { mode: "timestamp_ms" }).notNull(),
  statusCode: integer("status_code"),
  limit: integer("quota_limit"),
  remaining: integer("remaining"),
  resetAt: integer("reset_at", { mode: "timestamp_ms" }),
  retryAfterSeconds: integer("retry_after_seconds"),
  rawHeadersJson: text("raw_headers_json")
});

export const providerEnrichmentQueue = sqliteTable(
  "provider_enrichment_queue",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    matchId: integer("match_id").notNull().references(() => matches.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    status: text("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: integer("next_attempt_at", { mode: "timestamp_ms" }).notNull(),
    lastAttemptAt: integer("last_attempt_at", { mode: "timestamp_ms" }),
    lastError: text("last_error"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`)
  },
  (table) => ({
    matchProviderUnique: uniqueIndex("provider_enrichment_queue_match_provider_unique").on(table.matchId, table.provider),
    statusNextAttemptIdx: index("provider_enrichment_queue_status_next_attempt_idx").on(table.status, table.nextAttemptAt)
  })
);

export const schema = {
  players,
  heroes,
  matches,
  matchPlayers,
  items,
  patches,
  leagues,
  drafts,
  draftPlans,
  rawApiPayloads,
  settings,
  providerRequestEvents,
  providerQuotaSnapshots,
  providerEnrichmentQueue
};
