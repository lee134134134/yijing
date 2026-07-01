/**
 * Fastify API Server
 *
 * REST API + SSE 流式输出，供 Web 前端调用。
 */

import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "../config.js";
import { createLogger } from "../logger.js";
import { queryRoutes } from "./routes/query.js";
import { deepRoutes } from "./routes/deep.js";
import { historyRoutes } from "./routes/history.js";
import { statusRoutes } from "./routes/status.js";

const log = createLogger("api:server");

export async function buildServer() {
  const server = Fastify({
    logger: false, // we use pino directly
  });

  // ── CORS ──
  await server.register(cors, {
    origin: config.corsOrigin,
    methods: ["GET", "POST", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });

  // ── Health check ──
  server.get("/health", async () => ({ status: "ok", uptime: process.uptime() }));

  // ── Routes ──
  await server.register(queryRoutes, { prefix: "/api" });
  await server.register(deepRoutes, { prefix: "/api" });
  await server.register(historyRoutes, { prefix: "/api" });
  await server.register(statusRoutes, { prefix: "/api" });

  return server;
}

export async function startServer() {
  const server = await buildServer();

  try {
    await server.listen({ port: config.apiPort, host: config.apiHost });
    log.info({ port: config.apiPort, host: config.apiHost }, "API server started");
  } catch (err) {
    log.error({ err }, "Failed to start API server");
    process.exit(1);
  }

  return server;
}

// ── 直接执行时启动服务器 ──
const isMainModule = process.argv[1]?.endsWith("server.ts") || process.env.START_MODE === "server";
if (isMainModule) {
  startServer();
}
