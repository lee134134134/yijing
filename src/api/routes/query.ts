/**
 * POST /api/query — 普通查询（支持 SSE 流式输出）
 */

import type { FastifyInstance } from "fastify";
import { agenticRag } from "../../agents/index.js";
import { ErrorCode, ValidationError, YijingError } from "../../errors.js";
import { createLogger, createRequestContext, logRequestComplete } from "../../logger.js";
import type { QueryRequest, QueryResponse } from "../../types.js";

const log = createLogger("api:routes:query");

/**
 * SSE 心跳间隔(ms)
 *
 * deep agent 首 token 前有分类+多轮检索思考,长静默会被 nginx/ALB
 * 默认 60s 超时断开;注释帧 `:ping` 对 SSE 客户端透明,仅维持连接活跃。
 */
const SSE_HEARTBEAT_MS = 25_000;

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
      const ve = new ValidationError("query is required");
      return reply.status(ve.statusCode).send(ve.toJSON());
    }

    const trimmed = query.trim();

    // ── 流式模式：SSE（真流式，逐 chunk 推送） ──
    if (stream) {
      // 必须 hijack，否则 Fastify 在 handler return 后可能再次发送响应头
      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      // 客户端断连后停止写入(deepagents 无 AbortSignal 支持,已发出的
      // agent 运行无法中止——已知限制,但至少不向死连接写数据)
      let clientGone = false;
      reply.raw.on("close", () => {
        clientGone = true;
      });

      // SSE 心跳:agent 长思考期间保活,防代理 60s 静默断连
      const heartbeat = setInterval(() => {
        if (!clientGone && !reply.raw.writableEnded && !reply.raw.destroyed) {
          reply.raw.write(":ping\n\n");
        }
      }, SSE_HEARTBEAT_MS);

      try {
        const startTime = Date.now();
        const result = await agenticRag(trimmed, undefined, (chunk) => {
          if (clientGone) return;
          const textData = JSON.stringify({ type: "text", data: chunk });
          reply.raw.write(`event: message\ndata: ${textData}\n\n`);
        });

        const elapsed = (Date.now() - startTime) / 1000;
        const label = QUERY_TYPES_LABEL[result.queryType] || "知识问答";

        if (!clientGone) {
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
        }

        logRequestComplete(rc, 200, { queryType: result.queryType, docCount: result.docCount, elapsed });
      } catch (err) {
        const message = err instanceof YijingError ? err.message : "Streaming query failed";
        const code = err instanceof YijingError ? err.code : ErrorCode.INTERNAL;
        if (!clientGone) {
          const errData = JSON.stringify({ type: "error", data: { error: message, code } });
          reply.raw.write(`event: error\ndata: ${errData}\n\n`);
          reply.raw.end();
        }
        log.error({ err, requestId: rc.requestId }, "Streaming query failed");
      } finally {
        clearInterval(heartbeat);
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
      log.error({ err, requestId: rc.requestId }, "Query failed");
      if (err instanceof YijingError) {
        return reply.status(err.statusCode).send(err.toJSON());
      }
      return reply.status(500).send(new YijingError(ErrorCode.INTERNAL, "Query failed").toJSON());
    }
  });
}
