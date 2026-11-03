/**
 * GET /api/status — 知识库状态
 */

import type { FastifyInstance } from "fastify";
import { config } from "../../config.js";
import { ErrorCode, YijingError } from "../../errors.js";
import { getLlmStatus } from "../../llm/factory.js";
import { createLogger, createRequestContext, logRequestComplete } from "../../logger.js";
import type { StatusResponse } from "../../types.js";
import { getStoreHealth } from "../../vectorstore/chroma.js";
import { registerErrorHandler } from "../error-handler.js";
import { errorResponseSchema, statusResponseSchema } from "../schemas.js";

const log = createLogger("api:routes:status");

export async function statusRoutes(server: FastifyInstance) {
  registerErrorHandler(server);

  server.get(
    "/status",
    {
      schema: {
        tags: ["status"],
        summary: "系统与知识库状态",
        security: [{ apiKey: [] }],
        response: { 200: statusResponseSchema, 500: errorResponseSchema },
      },
    },
    async (_req, reply) => {
      const rc = createRequestContext("GET", "/api/status");

      try {
        const store = await getStoreHealth();
        const llm = getLlmStatus().map(({ role, provider, model, baseUrl, jsonMode, error }) => ({
          role,
          provider,
          model,
          baseUrl,
          jsonMode,
          ...(error ? { error } : {}),
        }));
        const llmOk = llm.every((entry) => !entry.error);
        const embeddingOk = config.embeddingProvider === "local" || Boolean(config.embeddingApiKey);

        const response: StatusResponse = {
          docCount: store.docCount,
          model: config.llmModel,
          collections: store.collections,
          version: "2.1.0",
          embeddingModel: config.embeddingModel,
          chromaDbUrl: config.chromaDbUrl,
          queryRewrite: config.enableQueryRewrite,
          maxContextTokens: config.maxContextTokens,
          chunkSize: config.chunkSize,
          chunkOverlap: config.chunkOverlap,
          llm,
          health: {
            chroma: { ok: store.chroma, ...(store.error ? { error: store.error } : {}) },
            embedding: { ok: embeddingOk, provider: config.embeddingProvider, model: config.embeddingModel },
            llm: { ok: llmOk },
            manifest: store.manifest,
          },
          index: {
            collection: store.collectionName,
            exists: store.collection,
            docCount: store.docCount,
          },
        };

        logRequestComplete(rc, 200, { docCount: store.docCount, chromaOk: store.ok });
        return reply.send(response);
      } catch (err) {
        log.error({ err, requestId: rc.requestId }, "Failed to get status");
        // getStoreHealth 不抛错;这里只兜底未知异常
        return reply.status(500).send(new YijingError(ErrorCode.INTERNAL, "Failed to get status").toJSON());
      }
    },
  );
}
