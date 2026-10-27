/**
 * GET /api/history — 对话历史
 * DELETE /api/history — 清除历史
 */

import type { FastifyInstance } from "fastify";
import { clearHistory, getRecentHistory } from "../../conversation/index.js";
import { ErrorCode, YijingError } from "../../errors.js";
import { createLogger, createRequestContext, logRequestComplete } from "../../logger.js";

const log = createLogger("api:routes:history");

export async function historyRoutes(server: FastifyInstance) {
  /**
   * GET /api/history?limit=50
   */
  server.get<{ Querystring: { limit?: string } }>("/history", async (req, reply) => {
    const rc = createRequestContext("GET", "/api/history");

    try {
      const raw = req.query?.limit;
      const n = raw ? Number.parseInt(raw, 10) : 50;
      const limit = Number.isNaN(n) || n < 1 ? 50 : Math.min(200, n);
      const history = getRecentHistory(limit);

      logRequestComplete(rc, 200, { count: history.length });
      return reply.send({ history, total: history.length });
    } catch (err) {
      log.error({ err, requestId: rc.requestId }, "Failed to fetch history");
      if (err instanceof YijingError) {
        return reply.status(err.statusCode).send(err.toJSON());
      }
      return reply.status(500).send(new YijingError(ErrorCode.INTERNAL, "Failed to fetch history").toJSON());
    }
  });

  /**
   * DELETE /api/history
   */
  server.delete("/history", async (_req, reply) => {
    const rc = createRequestContext("DELETE", "/api/history");

    try {
      clearHistory();
      logRequestComplete(rc, 200);
      return reply.send({ success: true });
    } catch (err) {
      log.error({ err, requestId: rc.requestId }, "Failed to clear history");
      if (err instanceof YijingError) {
        return reply.status(err.statusCode).send(err.toJSON());
      }
      return reply.status(500).send(new YijingError(ErrorCode.INTERNAL, "Failed to clear history").toJSON());
    }
  });
}
