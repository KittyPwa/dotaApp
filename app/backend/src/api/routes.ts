import { z } from "zod";
import { settingsSchema } from "@dota/shared";
import type { FastifyInstance } from "fastify";
import { DotaDataService } from "../services/dotaDataService.js";
import { getCachedAssetBuffer, getMimeType } from "../utils/assets.js";

export async function registerRoutes(app: FastifyInstance) {
  const service = new DotaDataService();

  app.get("/api/health", async () => ({ ok: true, timestamp: Date.now() }));
  app.get("/api/dashboard", async () => service.getDashboard());
  app.get("/api/heroes/stats", async () => service.getHeroStats());
  app.get("/api/assets/opendota", async (request, reply) => {
    const query = z.object({ path: z.string().min(1) }).parse(request.query);
    const buffer = await getCachedAssetBuffer(query.path);
    reply.header("Content-Type", getMimeType(query.path));
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
}
