import { z } from "zod";
import { settingsSchema } from "@dota/shared";
import type { FastifyInstance } from "fastify";
import { DotaDataService } from "../services/dotaDataService.js";
import { checkDbHealth } from "../db/client.js";
import { getCachedAssetBuffer, getCachedCurrentDotaMapBuffer, getMimeType } from "../utils/assets.js";

export async function registerRoutes(app: FastifyInstance) {
  const service = new DotaDataService();
  const isAdminRequest = async (request: { headers: Record<string, unknown> }) => {
    const rawHeader = request.headers["x-admin-password"];
    const password = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    return service.verifyAdminPassword(typeof password === "string" ? password : null);
  };
  const getSessionSettingsOverrides = (request: { headers: Record<string, unknown> }) => {
    const rawLimitPatches = request.headers["x-session-limit-patches"];
    const rawPatchCount = request.headers["x-session-patch-count"];
    const limitPatchesValue = Array.isArray(rawLimitPatches) ? rawLimitPatches[0] : rawLimitPatches;
    const patchCountValue = Array.isArray(rawPatchCount) ? rawPatchCount[0] : rawPatchCount;
    const limitToRecentPatches =
      limitPatchesValue === "true" ? true : limitPatchesValue === "false" ? false : null;
    const parsedPatchCount =
      typeof patchCountValue === "string" && patchCountValue.trim().length > 0 ? Number(patchCountValue) : null;
    return {
      limitToRecentPatches,
      recentPatchCount:
        parsedPatchCount !== null && Number.isFinite(parsedPatchCount) ? Math.max(0, Math.floor(parsedPatchCount)) : null
    };
  };
  const getBrowserPreferences = (request: { headers: Record<string, unknown> }) => {
    const rawPrimaryPlayerId = request.headers["x-user-primary-player-id"];
    const rawFavoritePlayerIds = request.headers["x-user-favorite-player-ids"];
    const rawAutoRefreshPlayerIds = request.headers["x-user-auto-refresh-player-ids"];
    const primaryPlayerValue = Array.isArray(rawPrimaryPlayerId) ? rawPrimaryPlayerId[0] : rawPrimaryPlayerId;
    const favoritePlayersValue = Array.isArray(rawFavoritePlayerIds) ? rawFavoritePlayerIds[0] : rawFavoritePlayerIds;
    const autoRefreshPlayersValue = Array.isArray(rawAutoRefreshPlayerIds) ? rawAutoRefreshPlayerIds[0] : rawAutoRefreshPlayerIds;
    const parsePlayerList = (value: unknown) =>
      typeof value === "string"
        ? value
            .split(",")
            .map((entry) => Number(entry.trim()))
            .filter((entry, index, list) => Number.isInteger(entry) && entry > 0 && list.indexOf(entry) === index)
        : [];
    const parsedPrimaryPlayerId =
      typeof primaryPlayerValue === "string" && primaryPlayerValue.trim().length > 0 ? Number(primaryPlayerValue) : null;
    return {
      primaryPlayerId:
        parsedPrimaryPlayerId !== null && Number.isInteger(parsedPrimaryPlayerId) && parsedPrimaryPlayerId > 0
          ? parsedPrimaryPlayerId
          : undefined,
      favoritePlayerIds: typeof favoritePlayersValue === "string" ? parsePlayerList(favoritePlayersValue) : undefined,
      autoRefreshPlayerIds:
        typeof autoRefreshPlayersValue === "string" ? parsePlayerList(autoRefreshPlayersValue) : undefined
    };
  };

  app.get("/api/health", async () => {
    const databaseOk = checkDbHealth();
    return {
      ok: databaseOk,
      services: {
        backend: true,
        database: databaseOk
      },
      timestamp: Date.now()
    };
  });
  app.get("/api/dashboard", async (request) =>
    service.getDashboard({
      adminUnlocked: await isAdminRequest(request),
      sessionSettings: getSessionSettingsOverrides(request),
      browserPreferences: getBrowserPreferences(request)
    })
  );
  app.get("/api/heroes/stats", async (request) => {
    const query = z
      .object({
        leagueId: z.coerce.number().int().positive().optional()
      })
      .parse(request.query);
    return service.getHeroStats({
      leagueId: query.leagueId ?? null,
      sessionSettings: getSessionSettingsOverrides(request)
    });
  });
  app.get("/api/leagues", async () => service.getLeagues());
  app.get("/api/assets/opendota", async (request, reply) => {
    const query = z.object({ path: z.string().min(1) }).parse(request.query);
    const buffer = await getCachedAssetBuffer(query.path);
    reply.header("Content-Type", getMimeType(query.path));
    reply.header("Cache-Control", "public, max-age=31536000, immutable");
    return reply.send(buffer);
  });
  app.get("/api/assets/dota-map", async (_request, reply) => {
    const buffer = await getCachedCurrentDotaMapBuffer();
    reply.header("Content-Type", "image/png");
    reply.header("Cache-Control", "public, max-age=31536000, immutable");
    return reply.send(buffer);
  });
  app.get("/api/heroes/:heroId", async (request, reply) => {
    const params = z.object({ heroId: z.coerce.number().int().positive() }).parse(request.params);
    const query = z
      .object({
        leagueId: z.coerce.number().int().positive().optional(),
        minRankTier: z.coerce.number().int().min(10).max(80).optional(),
        maxRankTier: z.coerce.number().int().min(10).max(80).optional()
      })
      .parse(request.query);
    try {
      return await service.getHeroOverview(params.heroId, {
        leagueId: query.leagueId ?? null,
        minRankTier: query.minRankTier ?? null,
        maxRankTier: query.maxRankTier ?? null,
        sessionSettings: getSessionSettingsOverrides(request)
      });
    } catch (error) {
      reply.code(400);
      return { message: error instanceof Error ? error.message : "Failed to load hero." };
    }
  });

  app.get("/api/leagues/:leagueId", async (request, reply) => {
    const params = z.object({ leagueId: z.coerce.number().int().positive() }).parse(request.params);
    try {
      return await service.getLeagueOverview(params.leagueId);
    } catch (error) {
      reply.code(400);
      return { message: error instanceof Error ? error.message : "Failed to load league." };
    }
  });

  app.get("/api/leagues/:leagueId/teams/:teamId", async (request, reply) => {
    const params = z
      .object({
        leagueId: z.coerce.number().int().positive(),
        teamId: z.coerce.number().int().positive()
      })
      .parse(request.params);
    try {
      return await service.getLeagueTeamOverview(params.leagueId, params.teamId);
    } catch (error) {
      reply.code(400);
      return { message: error instanceof Error ? error.message : "Failed to load team." };
    }
  });

  app.post("/api/leagues/:leagueId/sync", async (request, reply) => {
    if (!(await isAdminRequest(request))) {
      reply.code(403);
      return { message: "Admin access required." };
    }
    const params = z.object({ leagueId: z.coerce.number().int().positive() }).parse(request.params);
    const body = z.object({ limit: z.number().int().positive().max(100).optional() }).parse(request.body ?? {});
    try {
      return await service.syncLeagueMatches(params.leagueId, { limit: body.limit });
    } catch (error) {
      reply.code(400);
      return { message: error instanceof Error ? error.message : "Failed to sync league." };
    }
  });

  app.get("/api/players/:playerId", async (request, reply) => {
    const params = z.object({ playerId: z.coerce.number().int().positive() }).parse(request.params);
    const query = z
      .object({
        leagueId: z.coerce.number().int().positive().optional(),
        queue: z.enum(["all", "ranked", "unranked", "turbo"]).optional(),
        heroId: z.coerce.number().int().positive().optional()
      })
      .parse(request.query);
    try {
      return await service.getPlayerOverview(params.playerId, {
        leagueId: query.leagueId ?? null,
        queue: query.queue ?? "all",
        heroId: query.heroId ?? null,
        sessionSettings: getSessionSettingsOverrides(request),
        browserPreferences: getBrowserPreferences(request)
      });
    } catch (error) {
      reply.code(400);
      return { message: error instanceof Error ? error.message : "Failed to load player." };
    }
  });

  app.get("/api/players/compare", async (request, reply) => {
    const query = z.object({ ids: z.string().min(3) }).parse(request.query);
    const ids = query.ids
      .split(",")
      .map((entry) => Number(entry.trim()))
      .filter((value, index, list) => Number.isInteger(value) && value > 0 && list.indexOf(value) === index);

    try {
      return await service.comparePlayers(ids, {
        sessionSettings: getSessionSettingsOverrides(request),
        browserPreferences: getBrowserPreferences(request)
      });
    } catch (error) {
      reply.code(400);
      return { message: error instanceof Error ? error.message : "Failed to compare players." };
    }
  });

  app.post("/api/players/:playerId/sync-history", async (request, reply) => {
    if (!(await isAdminRequest(request))) {
      reply.code(403);
      return { message: "Admin access required." };
    }
    const params = z.object({ playerId: z.coerce.number().int().positive() }).parse(request.params);
    try {
      return await service.syncPlayerHistory(params.playerId);
    } catch (error) {
      reply.code(400);
      return { message: error instanceof Error ? error.message : "Failed to sync player history." };
    }
  });

  app.get("/api/matches/:matchId", async (request, reply) => {
    const params = z.object({ matchId: z.coerce.number().int().positive() }).parse(request.params);
    try {
      return await service.getMatchOverview(params.matchId);
    } catch (error) {
      reply.code(400);
      return { message: error instanceof Error ? error.message : "Failed to load match." };
    }
  });

  app.post("/api/matches/:matchId/refresh", async (request, reply) => {
    if (!(await isAdminRequest(request))) {
      reply.code(403);
      return { message: "Admin access required." };
    }
    const params = z.object({ matchId: z.coerce.number().int().positive() }).parse(request.params);
    try {
      return await service.getMatchOverview(params.matchId, { forceRefresh: true });
    } catch (error) {
      reply.code(400);
      return { message: error instanceof Error ? error.message : "Failed to refresh match." };
    }
  });

  app.get("/api/settings", async (request) =>
    service.getSettings({
      adminUnlocked: await isAdminRequest(request),
      browserPreferences: getBrowserPreferences(request)
    })
  );

  app.post("/api/player-preferences/favorites", async (request, reply) => {
    const body = z
      .object({
        ownerPlayerId: z.number().int().positive(),
        favoritePlayerIds: z.array(z.number().int().positive())
      })
      .parse(request.body ?? {});
    try {
      const favoritePlayerIds = await service.setFavoritePlayersForOwner(body.ownerPlayerId, body.favoritePlayerIds);
      return { ownerPlayerId: body.ownerPlayerId, favoritePlayerIds };
    } catch (error) {
      reply.code(400);
      return { message: error instanceof Error ? error.message : "Failed to save favorite players." };
    }
  });

  app.get("/api/community", async (request, reply) => {
    if (!(await isAdminRequest(request))) {
      reply.code(403);
      return { message: "Admin access required." };
    }
    return service.getCommunityGraph();
  });

  app.post("/api/settings", async (request, reply) => {
    if (!(await isAdminRequest(request))) {
      reply.code(403);
      return { message: "Admin access required." };
    }
    const body = settingsSchema.parse(request.body);
    return service.updateSettings(body);
  });

  app.post("/api/admin/setup", async (request, reply) => {
    const body = z
      .object({
        password: z.string().min(10)
      })
      .parse(request.body ?? {});
    try {
      return await service.setAdminPassword(body.password);
    } catch (error) {
      reply.code(400);
      return { message: error instanceof Error ? error.message : "Failed to set admin password." };
    }
  });

  app.post("/api/admin/unlock", async (request, reply) => {
    const body = z.object({ password: z.string().min(1) }).parse(request.body ?? {});
    if (!(await service.verifyAdminPassword(body.password))) {
      reply.code(403);
      return { message: "Invalid admin password." };
    }
    return {
      ok: true,
      appMode: service.getAppMode(),
      adminUnlocked: true
    };
  });

  app.get("/api/providers/stratz/test/:playerId", async (request, reply) => {
    if (!(await isAdminRequest(request))) {
      reply.code(403);
      return { message: "Admin access required." };
    }
    const params = z.object({ playerId: z.coerce.number().int().positive() }).parse(request.params);
    try {
      return await service.testStratz(params.playerId);
    } catch (error) {
      reply.code(400);
      return { message: error instanceof Error ? error.message : "STRATZ test failed." };
    }
  });

  app.get("/api/providers/steam/league-test/:leagueId", async (request, reply) => {
    if (!(await isAdminRequest(request))) {
      reply.code(403);
      return { message: "Admin access required." };
    }
    const params = z.object({ leagueId: z.coerce.number().int().positive() }).parse(request.params);
    try {
      const result = await service.testSteamLeague(params.leagueId);
      return {
        fetchedAt: result.fetchedAt,
        count: result.payload.length,
        matches: result.payload
      };
    } catch (error) {
      reply.code(400);
      return { message: error instanceof Error ? error.message : "Steam Web API test failed." };
    }
  });
}
