import { resolve } from "node:path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import open from "open";
import { registerRoutes } from "./api/routes.js";
import { closeDb, runMigrations } from "./db/client.js";
import { config } from "./utils/config.js";
import { logger } from "./utils/logger.js";

const app = Fastify({ logger: false });

await app.register(cors, { origin: true });
await registerRoutes(app);

if (config.nodeEnv === "production") {
  const frontendDist = resolve(process.cwd(), "app/frontend/dist");
  await app.register(fastifyStatic, {
    root: frontendDist,
    prefix: "/"
  });

  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith("/api/")) {
      reply.code(404);
      return { message: "Route not found." };
    }

    return reply.sendFile("index.html");
  });
}

runMigrations();

const address = await app.listen({
  host: "127.0.0.1",
  port: config.backendPort
});

logger.info("Backend listening", { address });

if (config.openBrowser && config.nodeEnv === "production") {
  await open(address);
}

const shutdown = async () => {
  await app.close();
  closeDb();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
