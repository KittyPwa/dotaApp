CREATE TABLE IF NOT EXISTS `players` (
  `id` integer PRIMARY KEY NOT NULL,
  `personaname` text,
  `avatar` text,
  `profile_url` text,
  `country_code` text,
  `rank_tier` integer,
  `leaderboard_rank` integer,
  `provider_source` text DEFAULT 'opendota' NOT NULL,
  `last_profile_fetched_at` integer,
  `created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
CREATE TABLE IF NOT EXISTS `heroes` (
  `id` integer PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `localized_name` text NOT NULL,
  `primary_attr` text,
  `attack_type` text,
  `roles_json` text,
  `created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
CREATE TABLE IF NOT EXISTS `matches` (
  `id` integer PRIMARY KEY NOT NULL,
  `start_time` integer,
  `duration_seconds` integer,
  `radiant_win` integer,
  `radiant_score` integer,
  `dire_score` integer,
  `patch_id` integer,
  `league_id` integer,
  `provider_source` text DEFAULT 'opendota' NOT NULL,
  `last_fetched_at` integer,
  `created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
CREATE TABLE IF NOT EXISTS `match_players` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `match_id` integer NOT NULL,
  `player_id` integer,
  `hero_id` integer,
  `player_slot` integer,
  `is_radiant` integer NOT NULL,
  `win` integer,
  `kills` integer,
  `deaths` integer,
  `assists` integer,
  `net_worth` integer,
  `gpm` integer,
  `xpm` integer,
  `hero_damage` integer,
  `tower_damage` integer,
  `last_hits` integer,
  `denies` integer,
  `level` integer,
  `lane_role` integer,
  `game_mode` integer,
  `item_0` integer,
  `item_1` integer,
  `item_2` integer,
  `item_3` integer,
  `item_4` integer,
  `item_5` integer,
  `backpack_0` integer,
  `backpack_1` integer,
  `backpack_2` integer,
  `first_purchase_time_json` text,
  `item_uses_json` text,
  `created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON DELETE cascade,
  FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON DELETE set null,
  FOREIGN KEY (`hero_id`) REFERENCES `heroes`(`id`) ON DELETE set null
);
CREATE UNIQUE INDEX IF NOT EXISTS `match_players_match_player_unique` ON `match_players` (`match_id`,`player_slot`);
CREATE TABLE IF NOT EXISTS `items` (
  `id` integer PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `localized_name` text NOT NULL,
  `created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
CREATE TABLE IF NOT EXISTS `patches` (
  `id` integer PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `release_date` integer
);
CREATE TABLE IF NOT EXISTS `leagues` (
  `id` integer PRIMARY KEY NOT NULL,
  `name` text NOT NULL
);
CREATE TABLE IF NOT EXISTS `drafts` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `match_id` integer NOT NULL,
  `hero_id` integer NOT NULL,
  `team` text NOT NULL,
  `is_pick` integer NOT NULL,
  `order_index` integer NOT NULL,
  `created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON DELETE cascade,
  FOREIGN KEY (`hero_id`) REFERENCES `heroes`(`id`) ON DELETE cascade
);
CREATE TABLE IF NOT EXISTS `raw_api_payloads` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `provider` text NOT NULL,
  `entity_type` text NOT NULL,
  `entity_id` text NOT NULL,
  `fetched_at` integer NOT NULL,
  `raw_json` text NOT NULL,
  `parse_version` text DEFAULT 'v1' NOT NULL,
  `request_context` text
);
CREATE INDEX IF NOT EXISTS `raw_api_payloads_lookup_idx` ON `raw_api_payloads` (`provider`,`entity_type`,`entity_id`);
CREATE TABLE IF NOT EXISTS `settings` (
  `key` text PRIMARY KEY NOT NULL,
  `value` text,
  `updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
