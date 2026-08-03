/**
 * GET /api/history — 对话历史
 * DELETE /api/history — 清除历史
 */

import type { FastifyInstance } from "fastify";
import { clearHistory, getRecentHistory } from "../../conversation/index.js";
import { createLogger, createRequestContext, logRequestComplete } from "../../logger.js";

const log = createLogger("api:routes:history");

export async function historyRoutes(server: FastifyInstance) {
  /**
   * GET /api/history?limit=50
   */
  server.get<{ Querystring: { limit?: string } }>("/history", async (req, reply) => {
    const rc = createRequestContext("GET", "/api/history");

    try {
      const limit = parseInt(req.query?.limit || "50", 10);
      const history = getRecentHistory(Math.max(1, Math.min(200, limit)));

      logRequestComplete(rc, 200, { count: history.length });
      return reply.send({ history, total: history.length });
    } catch (err) {
      log.error({ err, requestId: rc.requestId }, "Failed to fetch history");
      return reply.status(500).send({ error: { code: "INTERNAL_ERROR", message: "Failed to fetch history" } });
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
      return reply.status(500).send({ error: { code: "INTERNAL_ERROR", message: "Failed to clear history" } });
    }
  });
}
