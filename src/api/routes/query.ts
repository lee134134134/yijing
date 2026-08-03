/**
 * POST /api/query — 普通查询（支持 SSE 流式输出）
 */

import type { FastifyInstance } from "fastify";
import { agenticRag } from "../../agents/index.js";
import { createLogger, createRequestContext, logRequestComplete } from "../../logger.js";
import type { QueryRequest, QueryResponse } from "../../types.js";

const log = createLogger("api:routes:query");

const QUERY_TYPES_LABEL: Record<string, string> = {
  tcm_diagnosis: "中医辨证",
  tcm_prescription: "方剂药物",
  bazi_analysis: "命理八字",
  mianxiang_analysis: "面相分析",
  yijing_divination: "易经占卜",
  health_advice: "养生功法",
  general_knowledge: "知识问答",
  unknown: "未分类",
};

export async function queryRoutes(server: FastifyInstance) {
  /**
   * POST /api/query
   *
   * 非流式：返回 { response, queryType, docCount, elapsed }
   * 流式（stream=true）：SSE 流式返回文本块
   */
  server.post<{ Body: QueryRequest }>("/query", async (req, reply) => {
    const rc = createRequestContext("POST", "/api/query");

    const { query, stream = false } = req.body || {};

    if (!query || typeof query !== "string" || query.trim().length === 0) {
      log.warn({ requestId: rc.requestId }, "Empty query received");
      return reply.status(400).send({ error: { code: "INVALID_INPUT", message: "query is required" } });
    }

    const trimmed = query.trim();

    // ── 流式模式：SSE（真流式，逐 chunk 推送） ──
    if (stream) {
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      try {
        const startTime = Date.now();
        const result = await agenticRag(trimmed, undefined, (chunk) => {
          const textData = JSON.stringify({ type: "text", data: chunk });
          reply.raw.write(`event: message\ndata: ${textData}\n\n`);
        });

        const elapsed = (Date.now() - startTime) / 1000;
        const label = QUERY_TYPES_LABEL[result.queryType] || "知识问答";

        // meta event（流结束后发送，内容已包含脚注）
        const meta = JSON.stringify({ type: "meta", queryType: result.queryType, docCount: result.docCount, label });
        reply.raw.write(`event: meta\ndata: ${meta}\n\n`);

        // done event
        const doneData = JSON.stringify({
          type: "done",
          data: { response: result.response, queryType: result.queryType, docCount: result.docCount, elapsed },
        });
        reply.raw.write(`event: done\ndata: ${doneData}\n\n`);
        reply.raw.end();

        logRequestComplete(rc, 200, { queryType: result.queryType, docCount: result.docCount, elapsed });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Unknown error";
        const errData = JSON.stringify({ type: "error", data: { error: errMsg } });
        reply.raw.write(`event: error\ndata: ${errData}\n\n`);
        reply.raw.end();
        log.error({ err, requestId: rc.requestId }, "Streaming query failed");
      }
      return;
    }

    // ── 非流式模式 ──
    try {
      const startTime = Date.now();
      const result = await agenticRag(trimmed);
      const elapsed = (Date.now() - startTime) / 1000;

      const response: QueryResponse = {
        response: result.response,
        queryType: result.queryType,
        docCount: result.docCount,
        elapsed,
      };

      logRequestComplete(rc, 200, { queryType: result.queryType, docCount: result.docCount, elapsed });
      return reply.send(response);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Internal error";
      log.error({ err, requestId: rc.requestId }, "Query failed");
      return reply.status(500).send({ error: { code: "INTERNAL_ERROR", message: errMsg } });
    }
  });
}
