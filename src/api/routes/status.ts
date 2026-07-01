/**
 * GET /api/status — 知识库状态
 */

import type { FastifyInstance } from "fastify";
import { config } from "../../config.js";
import { createLogger, createRequestContext, logRequestComplete } from "../../logger.js";
import { getDocumentCount, listCollections } from "../../vectorstore/chroma.js";
import type { StatusResponse } from "../../types.js";

const log = createLogger("api:routes:status");

export async function statusRoutes(server: FastifyInstance) {
  server.get("/status", async (_req, reply) => {
    const rc = createRequestContext("GET", "/api/status");

    try {
      const collections = await listCollections();
      const docCount = await getDocumentCount();

      const response: StatusResponse = {
        docCount,
        model: config.llmModel,
        collections,
        version: "2.0.0",
      };

      logRequestComplete(rc, 200, { docCount, collections: collections.length });
      return reply.send(response);
    } catch (err) {
      log.error({ err, requestId: rc.requestId }, "Failed to get status");
      return reply.status(500).send({ error: { code: "INTERNAL_ERROR", message: "Failed to get status" } });
    }
  });
}
