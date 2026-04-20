import { z } from "zod";
import { settingsSchema } from "@dota/shared";
import type { FastifyInstance } from "fastify";
import { DotaDataService } from "../services/dotaDataService.js";
import { checkDbHealth } from "../db/client.js";
import { getCachedAssetBuffer, getCachedCurrentDotaMapBuffer, getMimeType } from "../utils/assets.js";

export async function registerRoutes(app: FastifyInstance) {
  const service = new DotaDataService();

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
  app.get("/api/dashboard", async () => service.getDashboard());
  app.get("/api/heroes/stats", async () => service.getHeroStats());
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
    try {
      return await service.getHeroOverview(params.heroId);
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

  app.post("/api/leagues/:leagueId/sync", async (request, reply) => {
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
    try {
      return await service.getPlayerOverview(params.playerId);
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
      return await service.comparePlayers(ids);
    } catch (error) {
      reply.code(400);
      return { message: error instanceof Error ? error.message : "Failed to compare players." };
    }
  });

  app.post("/api/players/:playerId/sync-history", async (request, reply) => {
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
    const params = z.object({ matchId: z.coerce.number().int().positive() }).parse(request.params);
    try {
      return await service.getMatchOverview(params.matchId, { forceRefresh: true });
    } catch (error) {
      reply.code(400);
      return { message: error instanceof Error ? error.message : "Failed to refresh match." };
    }
  });

  app.get("/api/settings", async () => service.getSettings());

  app.post("/api/settings", async (request) => {
    const body = settingsSchema.parse(request.body);
    return service.updateSettings(body);
  });

  app.get("/api/providers/stratz/test/:playerId", async (request, reply) => {
    const params = z.object({ playerId: z.coerce.number().int().positive() }).parse(request.params);
    try {
      return await service.testStratz(params.playerId);
    } catch (error) {
      reply.code(400);
      return { message: error instanceof Error ? error.message : "STRATZ test failed." };
    }
  });

  app.get("/api/providers/steam/league-test/:leagueId", async (request, reply) => {
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
