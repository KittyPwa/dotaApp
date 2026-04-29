import { resolve } from "node:path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import open from "open";
import { registerRoutes } from "./api/routes.js";
import { closeDb, runMigrations } from "./db/client.js";
import { config } from "./utils/config.js";
import { logger } from "./utils/logger.js";
import { SettingsService } from "./services/settingsService.js";
import { providerEnrichmentWorker } from "./services/providerEnrichmentWorker.js";

const app = Fastify({
  logger: false,
  trustProxy: config.appMode === "public" || config.nodeEnv === "production"
});

const settingsService = new SettingsService();

const corsOrigin = config.nodeEnv === "production" && config.publicOrigin ? [config.publicOrigin] : true;

await app.register(cors, { origin: corsOrigin });
await app.register(rateLimit, {
  global: true,
  max: 240,
  timeWindow: "1 minute"
});
await registerRoutes(app);

if (config.nodeEnv === "production") {
  const frontendDist = resolve(process.cwd(), "app/frontend/dist");
  await app.register(fastifyStatic, {
    root: frontendDist,
    prefix: "/"
  });

  const serveFrontend = async (_request: unknown, reply: { sendFile: (name: string) => unknown }) => reply.sendFile("index.html");

  await app.get("/home", serveFrontend);
  await app.get("/dashboard", serveFrontend);
  await app.get("/settings", serveFrontend);
  await app.get("/compare", serveFrontend);
  await app.get("/drafts", serveFrontend);
  await app.get("/heroes", serveFrontend);
  await app.get("/heroes/:heroId", serveFrontend);
  await app.get("/leagues", serveFrontend);
  await app.get("/leagues/:leagueId", serveFrontend);
  await app.get("/leagues/:leagueId/teams/:teamId", serveFrontend);
  await app.get("/players/:playerId", serveFrontend);
  await app.get("/matches/:matchId", serveFrontend);

  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith("/api/")) {
      reply.code(404);
      return { message: "Route not found." };
    }

    if (request.url.startsWith("/assets/")) {
      reply.code(404);
      return { message: "Asset not found." };
    }

    return reply.sendFile("index.html");
  });
}

runMigrations();
const seededAdminPassword = await settingsService.seedAdminPasswordFromConfig();
if (seededAdminPassword) {
  logger.info("Seeded admin password hash from environment");
}
if ((config.appMode === "public" || config.nodeEnv === "production") && !(await settingsService.hasAdminPasswordConfigured())) {
  logger.warn("No admin password hash is configured; in-app admin controls will remain unavailable");
}

const address = await app.listen({
  host: config.backendHost,
  port: config.backendPort
});

logger.info("Backend listening", { address });
providerEnrichmentWorker.start();

if (config.openBrowser && config.nodeEnv === "production") {
  try {
    await open(address);
  } catch (error) {
    logger.warn("Backend is running, but opening the browser failed", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

const shutdown = async () => {
  providerEnrichmentWorker.stop();
  await app.close();
  closeDb();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
