/**
 * POST /api/deep — 深度分析
 */

import type { FastifyInstance } from "fastify";
import { deepAnalysis } from "../../agents/index.js";
import { ErrorCode, ValidationError, YijingError } from "../../errors.js";
import { createLogger, createRequestContext, logRequestComplete } from "../../logger.js";
import type { DeepAnalysisResponse } from "../../types.js";

const log = createLogger("api:routes:deep");

export async function deepRoutes(server: FastifyInstance) {
  server.post<{ Body: { query: string } }>("/deep", async (req, reply) => {
    const rc = createRequestContext("POST", "/api/deep");

    const { query } = req.body || {};

    if (!query || typeof query !== "string" || query.trim().length === 0) {
      const ve = new ValidationError("query is required");
      return reply.status(ve.statusCode).send(ve.toJSON());
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
      log.error({ err, requestId: rc.requestId }, "Deep analysis failed");
      if (err instanceof YijingError) {
        return reply.status(err.statusCode).send(err.toJSON());
      }
      return reply.status(500).send(new YijingError(ErrorCode.INTERNAL, "Deep analysis failed").toJSON());
    }
  });
}
