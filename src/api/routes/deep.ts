/**
 * POST /api/deep — 深度分析
 */

import type { FastifyInstance } from "fastify";
import { deepAnalysis } from "../../agents/index.js";
import { createLogger, createRequestContext, logRequestComplete } from "../../logger.js";
import type { DeepAnalysisResponse } from "../../types.js";

const log = createLogger("api:routes:deep");

export async function deepRoutes(server: FastifyInstance) {
  server.post<{ Body: { query: string } }>("/deep", async (req, reply) => {
    const rc = createRequestContext("POST", "/api/deep");

    const { query } = req.body || {};

    if (!query || typeof query !== "string" || query.trim().length === 0) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", message: "query is required" } });
    }

    try {
      const startTime = Date.now();
      const result = await deepAnalysis(query.trim());
      const elapsed = (Date.now() - startTime) / 1000;

      const response: DeepAnalysisResponse = {
        conclusion: result.conclusion,
        reasoning: result.reasoning,
        references: result.references,
        confidence: result.confidence,
        suggestions: result.suggestions,
        elapsed,
      };

      logRequestComplete(rc, 200, { confidence: result.confidence, refCount: result.references.length, elapsed });
      return reply.send(response);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Internal error";
      log.error({ err, requestId: rc.requestId }, "Deep analysis failed");
      return reply.status(500).send({ error: { code: "INTERNAL_ERROR", message: errMsg } });
    }
  });
}
