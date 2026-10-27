/**
 * Fastify API Server
 *
 * REST API + SSE 流式输出，供 Web 前端调用。
 * 企业级安全中间件：认证、速率限制、安全头、请求体限制。
 * 响应压缩 + OpenAPI 文档。
 */

import compress from "@fastify/compress";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify from "fastify";
import { config } from "../config.js";
import { assertConfig } from "../config-validation.js";
import { ErrorCode, YijingError } from "../errors.js";
import { createLogger } from "../logger.js";
import {
  authenticate,
  initAuth,
  rateLimitMiddleware,
  registerSecurityMiddleware,
  sanitizeInput,
} from "./middleware/index.js";
import { deepRoutes } from "./routes/deep.js";
import { historyRoutes } from "./routes/history.js";
import { queryRoutes } from "./routes/query.js";
import { statusRoutes } from "./routes/status.js";

const log = createLogger("api:server");

export async function buildServer() {
  assertConfig();
  initAuth();

  const server = Fastify({
    logger: false,
    bodyLimit: config.maxBodySize,
    routerOptions: { maxParamLength: 200 },
  });

  // ── 响应压缩 ──
  await server.register(compress, {
    encodings: ["gzip", "deflate"],
    threshold: 1024,
  });

  // ── OpenAPI 文档 ──
  // ESM 下必须静态 import:dist 产物为 ES module,require() 会抛 ReferenceError(仅 tsx 开发模式因 shim 而不暴露)
  await server.register(swagger, {
    // dynamic 模式(默认):从路由 schema 自动生成 OpenAPI 文档;
    // v9 的 "static" 模式仅用于挂载预生成 spec 文件,无法自动生成
    mode: "dynamic",
    openapi: {
      info: {
        title: "Yijing Agentic RAG API",
        description: "倪海厦中医命理知识库的 Agentic RAG 系统",
        version: "2.1.0",
      },
      servers: [{ url: "http://localhost:3001" }],
      tags: [
        { name: "query", description: "普通查询" },
        { name: "deep", description: "深度分析" },
        { name: "history", description: "对话历史" },
        { name: "status", description: "系统状态" },
      ],
      components: {
        securitySchemes: {
          apiKey: {
            type: "apiKey",
            in: "header",
            name: "X-API-Key",
          },
        },
      },
    },
  });

  await server.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: {
      docExpansion: "list",
      deepLinking: true,
    },
  });

  // ── 安全中间件 ──
  await registerSecurityMiddleware(server);

  // ── CORS ──
  await server.register(cors, {
    origin: config.corsOrigin,
    methods: ["GET", "POST", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization", "X-API-Key"],
  });

  // ── 速率限制 ──
  server.addHook("onRequest", rateLimitMiddleware);

  // ── 认证钩子 ──
  server.addHook("onRequest", (req, reply, done) => {
    if (req.url === "/health") {
      done();
      return;
    }
    if (!authenticate(req, reply)) {
      reply.code(401).send(new YijingError(ErrorCode.INVALID_INPUT, "Invalid or missing API key").toJSON());
      return;
    }
    done();
  });

  // ── 请求体验证钩子：清理输入 ──
  server.addHook("preHandler", (req, _reply, done) => {
    if (req.body && typeof req.body === "object") {
      const body = req.body as Record<string, unknown>;
      if (body.query && typeof body.query === "string") {
        body.query = sanitizeInput(body.query);
      }
    }
    done();
  });

  // ── 健康检查 ──
  server.get("/health", async () => ({
    status: "ok",
    uptime: process.uptime(),
    timestamp: Date.now(),
  }));

  // ── 优雅关闭 ──
  const shutdown = async (signal: string) => {
    log.info({ signal }, "Shutting down...");
    try {
      await server.close();
      log.info("Server closed gracefully");
      process.exit(0);
    } catch (err) {
      log.error({ err }, "Error during shutdown");
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // ── Routes ──
  await server.register(queryRoutes, { prefix: "/api" });
  await server.register(deepRoutes, { prefix: "/api" });
  await server.register(historyRoutes, { prefix: "/api" });
  await server.register(statusRoutes, { prefix: "/api" });

  // ── 全局错误处理 ──
  server.setErrorHandler((err, _req, reply) => {
    if (err instanceof YijingError) {
      log.warn({ err, code: err.code }, "Request error");
      return reply.status(err.statusCode).send(err.toJSON());
    }
    log.error({ err }, "Unexpected error");
    return reply.status(500).send(new YijingError(ErrorCode.INTERNAL, "Internal server error").toJSON());
  });

  return server;
}

export async function startServer() {
  const server = await buildServer();

  try {
    await server.listen({ port: config.apiPort, host: config.apiHost });
    log.info({ port: config.apiPort, host: config.apiHost }, "API server started");
    log.info({ url: `http://${config.apiHost}:${config.apiPort}/docs` }, "Swagger docs available");
  } catch (err) {
    log.error({ err }, "Failed to start API server");
    process.exit(1);
  }

  return server;
}

const invoked = process.argv[1] ?? "";
const isMainModule = /(?:server\.ts|api[/\\]server\.js)$/.test(invoked) || process.env.START_MODE === "server";
if (isMainModule) {
  startServer();
}
