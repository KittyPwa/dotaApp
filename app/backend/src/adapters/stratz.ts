import { fetchJsonWithRetry } from "../utils/http.js";
import type { ProviderFetchResult } from "../domain/provider.js";
import { ProviderRateLimitService } from "../services/providerRateLimitService.js";
import { SettingsService } from "../services/settingsService.js";

export interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

export interface StratzPlayerBasicResponse {
  player: { steamAccountId: number | null } | null;
}

interface StratzMatchTelemetryResponse {
  match: {
    players: Array<{
      playerSlot: number | null;
      steamAccountId: number | null;
      heroId: number | null;
      stats: {
        goldPerMinute: number[] | null;
        experiencePerMinute: number[] | null;
        lastHitsPerMinute: number[] | null;
        deniesPerMinute: number[] | null;
        heroDamagePerMinute: number[] | null;
        heroDamageReceivedPerMinute: number[] | null;
        itemPurchases: Array<{ time: number; itemId: number | null }> | null;
      } | null;
    }> | null;
  } | null;
}

interface StratzMatchWardTelemetryResponse {
  match: {
    playbackData: {
      wardEvents: Array<{
        time: number;
        fromPlayer: number | null;
        wardType: "OBSERVER" | "SENTRY" | string | null;
        action: "SPAWN" | "DESPAWN" | string | null;
        positionX: number | null;
        positionY: number | null;
      }> | null;
    } | null;
  } | null;
}

interface StratzLeagueMatchesResponse {
  league: {
    id: number | null;
    name: string | null;
    displayName: string | null;
    matches: StratzLeagueMatchResponseItem[] | null;
  } | null;
}

interface StratzLeagueMatchResponseItem {
  id: number | null;
  startDateTime: number | null;
  durationSeconds: number | null;
  didRadiantWin: boolean | null;
  leagueId: number | null;
}

export interface StratzLeagueMatch {
  matchId: number;
  startTime: number | null;
  durationSeconds: number | null;
  radiantWin: boolean | null;
  leagueId: number | null;
  leagueName: string | null;
}

export interface StratzTelemetryEvent {
  time: number;
  key: string | null;
  itemId: number | null;
  charges: number | null;
  x: number | null;
  y: number | null;
  z: number | null;
  action: string | null;
}

export interface StratzMatchTelemetryPlayer {
  playerSlot: number | null;
  playerId: number | null;
  heroId: number | null;
  goldTimeline: number[];
  xpTimeline: number[];
  lastHitsTimeline: number[];
  deniesTimeline: number[];
  heroDamageTimeline: number[];
  damageTakenTimeline: number[];
  purchaseLog: StratzTelemetryEvent[];
  observerLog: StratzTelemetryEvent[];
  sentryLog: StratzTelemetryEvent[];
  observerWardsPlaced: number | null;
  sentryWardsPlaced: number | null;
}

export interface StratzMatchTelemetry {
  players: StratzMatchTelemetryPlayer[];
  diagnostics: {
    discoveredSelections: string[];
  };
}

function normalizeNumberArray(value: number[] | null | undefined) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "number" && Number.isFinite(entry)) : [];
}

export class StratzAdapter {
  private readonly endpoint = "https://api.stratz.com/graphql";
  private readonly rateLimitService = new ProviderRateLimitService();
  private readonly settingsService = new SettingsService();

  constructor(private readonly apiKey: string | null) {}

  private assertConfigured() {
    if (!this.apiKey) {
      throw new Error("STRATZ API key is not configured.");
    }
  }

  async execute<T>(
    query: string,
    variables: Record<string, unknown>,
    operation: string
  ): Promise<ProviderFetchResult<GraphQLResponse<T>>> {
    this.assertConfigured();
    const settings = await this.settingsService.getSettings({ includeProtected: true });
    this.rateLimitService.consume("stratz", {
      perSecond: settings.stratzPerSecondCap,
      perMinute: settings.stratzPerMinuteCap,
      perHour: settings.stratzPerHourCap,
      perDay: settings.stratzDailyRequestCap
    });
    const fetchedAt = Date.now();
    const payload = await fetchJsonWithRetry<GraphQLResponse<T>>(
      this.endpoint,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          "User-Agent": "STRATZ_API"
        },
        body: JSON.stringify({ query, variables, operationName: operation })
      },
      { provider: "stratz", operation }
    );
    return { payload, fetchedAt };
  }

  async getPlayerBasic(playerId: number) {
    return this.execute<StratzPlayerBasicResponse>(
      `
        query PlayerBasic($playerId: Long!) {
          player(steamAccountId: $playerId) {
            steamAccountId
          }
        }
      `,
      { playerId },
      "PlayerBasic"
    );
  }

  async getLeagueMatches(leagueId: number, limit: number): Promise<ProviderFetchResult<StratzLeagueMatch[]>> {
    const result = await this.execute<StratzLeagueMatchesResponse>(
      `
        query LeagueMatches($leagueId: Int!, $take: Int!) {
          league(id: $leagueId) {
            id
            name
            displayName
            matches(request: { take: $take, skip: 0 }) {
              id
              startDateTime
              durationSeconds
              didRadiantWin
              leagueId
            }
          }
        }
      `,
      { leagueId, take: Math.min(100, Math.max(1, limit)) },
      "LeagueMatches"
    );

    if (result.payload.errors?.length) {
      throw new Error(result.payload.errors[0]?.message ?? "STRATZ league query failed.");
    }

    const league = result.payload.data?.league;
    const leagueName = league?.displayName ?? league?.name ?? null;
    return {
      fetchedAt: result.fetchedAt,
      payload: (league?.matches ?? [])
        .filter((match): match is StratzLeagueMatchResponseItem & { id: number } => Number.isInteger(match?.id))
        .map((match) => ({
          matchId: match.id,
          startTime: match.startDateTime,
          durationSeconds: match.durationSeconds,
          radiantWin: match.didRadiantWin,
          leagueId: match.leagueId,
          leagueName
        }))
    };
  }

  async getMatchTelemetry(matchId: number): Promise<ProviderFetchResult<StratzMatchTelemetry>> {
    const result = await this.execute<StratzMatchTelemetryResponse>(
      `
        query MatchTelemetry($matchId: Long!) {
          match(id: $matchId) {
            players {
              playerSlot
              steamAccountId
              heroId
              stats {
                goldPerMinute
                experiencePerMinute
                lastHitsPerMinute
                deniesPerMinute
                heroDamagePerMinute
                heroDamageReceivedPerMinute
                itemPurchases {
                  time
                  itemId
                }
              }
            }
          }
        }
      `,
      { matchId },
      "MatchTelemetry"
    );

    if (result.payload.errors?.length) {
      throw new Error(result.payload.errors[0]?.message ?? "STRATZ telemetry query failed.");
    }

    let wardEvents: NonNullable<NonNullable<StratzMatchWardTelemetryResponse["match"]>["playbackData"]>["wardEvents"] = [];
    let wardDiagnostic: string | null = null;
    try {
      const wardResult = await this.execute<StratzMatchWardTelemetryResponse>(
        `
          query MatchWardTelemetry($matchId: Long!) {
            match(id: $matchId) {
              playbackData {
                wardEvents {
                  time
                  fromPlayer
                  wardType
                  action
                  positionX
                  positionY
                }
              }
            }
          }
        `,
        { matchId },
        "MatchWardTelemetry"
      );
      if (wardResult.payload.errors?.length) {
        wardDiagnostic = wardResult.payload.errors[0]?.message ?? "STRATZ ward telemetry query failed.";
      } else {
        wardEvents = wardResult.payload.data?.match?.playbackData?.wardEvents ?? [];
      }
    } catch (error) {
      wardDiagnostic = error instanceof Error ? error.message : "STRATZ ward telemetry query failed.";
    }

    const match = result.payload.data?.match;
    const filteredWardEvents = wardEvents.filter(
      (event) =>
        event &&
        typeof event.time === "number" &&
        (event.action === "SPAWN" || event.action === "DESPAWN") &&
        (event.wardType === "OBSERVER" || event.wardType === "SENTRY")
    );

    const players = (match?.players ?? []).map<StratzMatchTelemetryPlayer>((player) => {
      const playerWardEvents = filteredWardEvents.filter((event) => event.fromPlayer === player.playerSlot);
      const observerLog = playerWardEvents
        .filter((event) => event.wardType === "OBSERVER")
        .map((event) => ({
          time: event.time,
          key: "observer",
          itemId: null,
          charges: null,
          x: event.positionX,
          y: event.positionY,
          z: null,
          action: event.action ?? null
        }));
      const sentryLog = playerWardEvents
        .filter((event) => event.wardType === "SENTRY")
        .map((event) => ({
          time: event.time,
          key: "sentry",
          itemId: null,
          charges: null,
          x: event.positionX,
          y: event.positionY,
          z: null,
          action: event.action ?? null
        }));

      return {
        playerSlot: player.playerSlot,
        playerId: player.steamAccountId,
        heroId: player.heroId,
        goldTimeline: normalizeNumberArray(player.stats?.goldPerMinute),
        xpTimeline: normalizeNumberArray(player.stats?.experiencePerMinute),
        lastHitsTimeline: normalizeNumberArray(player.stats?.lastHitsPerMinute),
        deniesTimeline: normalizeNumberArray(player.stats?.deniesPerMinute),
        heroDamageTimeline: normalizeNumberArray(player.stats?.heroDamagePerMinute),
        damageTakenTimeline: normalizeNumberArray(player.stats?.heroDamageReceivedPerMinute),
        purchaseLog: (player.stats?.itemPurchases ?? [])
          .filter((entry) => typeof entry?.time === "number")
          .map((entry) => ({
            time: entry.time,
            key: null,
            itemId: entry.itemId ?? null,
            charges: null,
            x: null,
            y: null,
            z: null,
            action: null
          })),
        observerLog,
        sentryLog,
        observerWardsPlaced: observerLog.filter((entry) => entry.action !== "DESPAWN").length,
        sentryWardsPlaced: sentryLog.filter((entry) => entry.action !== "DESPAWN").length
      };
    });

    return {
      fetchedAt: result.fetchedAt,
      payload: {
        players,
        diagnostics: {
          discoveredSelections: [
            "players.stats.goldPerMinute",
            "players.stats.experiencePerMinute",
            "players.stats.lastHitsPerMinute",
            "players.stats.deniesPerMinute",
            "players.stats.heroDamagePerMinute",
            "players.stats.heroDamageReceivedPerMinute",
            "players.stats.itemPurchases",
            ...(wardDiagnostic ? [`match.playbackData.wardEvents unavailable: ${wardDiagnostic}`] : ["match.playbackData.wardEvents"])
          ]
        }
      }
    };
  }
}
