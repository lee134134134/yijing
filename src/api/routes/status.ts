/**
 * GET /api/status — 知识库状态
 */

import type { FastifyInstance } from "fastify";
import { config } from "../../config.js";
import { ErrorCode, YijingError } from "../../errors.js";
import { getLlmStatus } from "../../llm/factory.js";
import { createLogger, createRequestContext, logRequestComplete } from "../../logger.js";
import type { StatusResponse } from "../../types.js";
import { getDocumentCount, listCollections } from "../../vectorstore/chroma.js";

const log = createLogger("api:routes:status");

export async function statusRoutes(server: FastifyInstance) {
  server.get("/status", async (_req, reply) => {
    const rc = createRequestContext("GET", "/api/status");

    try {
      const collections = await listCollections();
      // 若集合尚未创建，getDocumentCount 可能抛错，这里优雅降级为 0
      const docCount = collections.includes(config.chromaCollectionName) ? await getDocumentCount() : 0;

      const response: StatusResponse = {
        docCount,
        model: config.llmModel,
        collections,
        version: "2.1.0",
        embeddingModel: config.embeddingModel,
        chromaDbUrl: config.chromaDbUrl,
        queryRewrite: config.enableQueryRewrite,
        maxContextTokens: config.maxContextTokens,
        chunkSize: config.chunkSize,
        chunkOverlap: config.chunkOverlap,
        llm: getLlmStatus().map(({ role, provider, model, baseUrl, jsonMode, error }) => ({
          role,
          provider,
          model,
          baseUrl,
          jsonMode,
          ...(error ? { error } : {}),
        })),
      };

      logRequestComplete(rc, 200, { docCount, collections: collections.length });
      return reply.send(response);
    } catch (err) {
      log.error({ err, requestId: rc.requestId }, "Failed to get status");
      if (err instanceof YijingError) {
        return reply.status(err.statusCode).send(err.toJSON());
      }
      return reply.status(500).send(new YijingError(ErrorCode.INTERNAL, "Failed to get status").toJSON());
    }
  });
}
