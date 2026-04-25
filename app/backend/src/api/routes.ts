import { z } from "zod";
import { draftPlanSchema, settingsSchema } from "@dota/shared";
import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { DotaDataService } from "../services/dotaDataService.js";
import { checkDbHealth, db } from "../db/client.js";
import { draftPlans } from "../db/schema.js";
import { getCachedAssetBuffer, getCachedCurrentDotaMapBuffer, getMimeType } from "../utils/assets.js";
import { config } from "../utils/config.js";

export async function registerRoutes(app: FastifyInstance) {
  const service = new DotaDataService();
  const expensiveReadRateLimit = { rateLimit: { max: 60, timeWindow: "1 minute" } };
  const expensiveWriteRateLimit = { rateLimit: { max: 6, timeWindow: "10 minutes" } };
  const adminAuthRateLimit = { rateLimit: { max: 5, timeWindow: "15 minutes" } };
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
  const getDraftOwnerKey = (request: { headers: Record<string, unknown> }) => {
    const rawHeader = request.headers["x-draft-owner-key"];
    const value = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{16,128}$/.test(value)) {
      throw new Error("Missing draft owner key.");
    }
    return value;
  };
  const mapDraftPlanRow = (row: typeof draftPlans.$inferSelect) => ({
    id: row.id,
    leagueId: row.leagueId,
    name: row.name,
    firstTeamId: row.firstTeamId,
    secondTeamId: row.secondTeamId,
    updatedAt: row.updatedAt?.getTime?.() ?? Date.now(),
    slots: JSON.parse(row.slotsJson) as unknown
  });

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

  app.get("/api/draft-plans", async (request, reply) => {
    const query = z
      .object({
        leagueId: z.coerce.number().int().positive().optional()
      })
      .parse(request.query);
    try {
      const ownerKey = getDraftOwnerKey(request);
      const rows = await db
        .select()
        .from(draftPlans)
        .where(
          query.leagueId
            ? and(eq(draftPlans.ownerKey, ownerKey), eq(draftPlans.leagueId, query.leagueId))
            : eq(draftPlans.ownerKey, ownerKey)
        );
      return rows
        .map((row) => draftPlanSchema.parse(mapDraftPlanRow(row)))
        .sort((left, right) => right.updatedAt - left.updatedAt);
    } catch (error) {
      reply.code(400);
      return { message: error instanceof Error ? error.message : "Failed to load draft plans." };
    }
  });

  app.get("/api/draft-context", async (request, reply) => {
    const query = z
      .object({
        firstPlayerIds: z.string().optional(),
        secondPlayerIds: z.string().optional()
      })
      .parse(request.query);
    const parseIds = (value: string | undefined) =>
      (value ?? "")
        .split(",")
        .map((entry) => Number(entry.trim()))
        .filter((entry, index, list) => Number.isInteger(entry) && entry > 0 && list.indexOf(entry) === index)
        .slice(0, 5);

    try {
      return await service.getDraftContext({
        firstPlayerIds: parseIds(query.firstPlayerIds),
        secondPlayerIds: parseIds(query.secondPlayerIds)
      });
    } catch (error) {
      reply.code(400);
      return { message: error instanceof Error ? error.message : "Failed to load draft context." };
    }
  });

  app.post("/api/draft-plans", async (request, reply) => {
    try {
      const ownerKey = getDraftOwnerKey(request);
      const body = draftPlanSchema.parse(request.body);
      const now = Date.now();
      await db
        .insert(draftPlans)
        .values({
          id: body.id,
          ownerKey,
          leagueId: body.leagueId,
          name: body.name,
          firstTeamId: body.firstTeamId,
          secondTeamId: body.secondTeamId,
          slotsJson: JSON.stringify(body.slots),
          updatedAt: new Date(now)
        })
        .onConflictDoUpdate({
          target: draftPlans.id,
          set: {
            leagueId: body.leagueId,
            name: body.name,
            firstTeamId: body.firstTeamId,
            secondTeamId: body.secondTeamId,
            slotsJson: JSON.stringify(body.slots),
            updatedAt: new Date(now)
          },
          where: eq(draftPlans.ownerKey, ownerKey)
        });
      return { ...body, updatedAt: now };
    } catch (error) {
      reply.code(400);
      return { message: error instanceof Error ? error.message : "Failed to save draft plan." };
    }
  });

  app.delete("/api/draft-plans/:draftId", async (request, reply) => {
    const params = z.object({ draftId: z.string().min(1) }).parse(request.params);
    try {
      const ownerKey = getDraftOwnerKey(request);
      await db.delete(draftPlans).where(and(eq(draftPlans.id, params.draftId), eq(draftPlans.ownerKey, ownerKey)));
      return { ok: true };
    } catch (error) {
      reply.code(400);
      return { message: error instanceof Error ? error.message : "Failed to delete draft plan." };
    }
  });

  app.post("/api/leagues/:leagueId/sync", { config: expensiveWriteRateLimit }, async (request, reply) => {
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

  app.get("/api/players/:playerId", { config: expensiveReadRateLimit }, async (request, reply) => {
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

  app.get("/api/players/compare", { config: expensiveReadRateLimit }, async (request, reply) => {
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

  app.post("/api/players/:playerId/sync-history", { config: expensiveWriteRateLimit }, async (request, reply) => {
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

  app.get("/api/matches/:matchId", { config: expensiveReadRateLimit }, async (request, reply) => {
    const params = z.object({ matchId: z.coerce.number().int().positive() }).parse(request.params);
    try {
      return await service.getMatchOverview(params.matchId);
    } catch (error) {
      reply.code(400);
      return { message: error instanceof Error ? error.message : "Failed to load match." };
    }
  });

  app.post("/api/matches/:matchId/refresh", { config: expensiveWriteRateLimit }, async (request, reply) => {
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

  app.post("/api/admin/setup", { config: adminAuthRateLimit }, async (request, reply) => {
    if (service.getAppMode() === "public" || config.nodeEnv === "production") {
      reply.code(403);
      return { message: "Admin setup is disabled in public mode." };
    }
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

  app.post("/api/admin/unlock", { config: adminAuthRateLimit }, async (request, reply) => {
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

  app.get("/api/providers/stratz/test/:playerId", { config: expensiveWriteRateLimit }, async (request, reply) => {
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

  app.get("/api/providers/steam/league-test/:leagueId", { config: expensiveWriteRateLimit }, async (request, reply) => {
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
