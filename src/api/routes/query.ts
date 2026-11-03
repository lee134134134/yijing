/**
 * POST /api/query — 会话问答（支持 SSE v2）
 *
 * 流程:
 * 1. 解析/创建会话,读取该会话最近 3 轮历史
 * 2. 落库 user 消息
 * 3. 调 agenticRag(带 AbortSignal / 检索预算)
 * 4. 落库 assistant 消息(含 citations/耗时/降级)
 * 5. 非流式返回 JSON;流式发送 meta → token* → citation* → done
 *
 * SSE v2 事件:
 *   meta      { conversationId }
 *   token     { text }
 *   citation  Citation
 *   done      { response, queryType, docCount, citations, elapsed, conversationId, messageId }
 *   error     { code, message }
 */

import type { FastifyInstance } from "fastify";
import { agenticRag } from "../../agents/index.js";
import { config } from "../../config.js";
import type { Conversation } from "../../conversation/index.js";
import {
  addConversationMessage,
  createConversation,
  getConversation,
  getHistoryForConversation,
} from "../../conversation/index.js";
import { ErrorCode, ValidationError, YijingError } from "../../errors.js";
import { createLogger, createRequestContext, logRequestComplete } from "../../logger.js";
import { queriesTotal, queryDuration, retrievalDocs } from "../../metrics.js";
import type { QueryRequest, QueryResponse } from "../../types.js";
import { assertStoreReady } from "../../vectorstore/chroma.js";
import { registerErrorHandler } from "../error-handler.js";
import { errorResponseSchema, queryBodySchema, queryResponseSchema } from "../schemas.js";

const log = createLogger("api:routes:query");

/** SSE 心跳间隔(ms) */
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

/** 解析会话:给定 id 必须存在;否则按首问创建新会话 */
function resolveConversation(conversationId: string | undefined, query: string): Conversation {
  if (conversationId) {
    const existing = getConversation(conversationId);
    if (!existing) {
      throw new YijingError(ErrorCode.NOT_FOUND, "Conversation not found", { statusCode: 404 });
    }
    return existing;
  }
  return createConversation(query.slice(0, 30));
}

/** 查询指标(降级 = 无可验证引用) */
function recordQueryMetrics(citations: number, elapsed: number): void {
  const degraded = citations === 0;
  const labels = { degraded: String(degraded) };
  queriesTotal.inc(labels);
  queryDuration.observe(labels, elapsed);
  retrievalDocs.observe(citations);
}

export async function queryRoutes(server: FastifyInstance) {
  registerErrorHandler(server);

  server.post<{ Body: QueryRequest }>(
    "/query",
    {
      schema: {
        tags: ["query"],
        summary: "知识库问答（支持 SSE 流式）",
        security: [{ apiKey: [] }],
        body: queryBodySchema,
        response: {
          200: queryResponseSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
          502: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (req, reply) => {
      const rc = createRequestContext("POST", "/api/query");
      const { query, stream = false, conversationId: requestedId } = req.body || {};

      if (!query || typeof query !== "string" || query.trim().length === 0) {
        log.warn({ requestId: rc.requestId }, "Empty query received");
        const ve = new ValidationError("query is required");
        return reply.status(ve.statusCode).send(ve.toJSON());
      }

      const trimmed = query.trim();

      // 先确认知识库可用,避免 503 时仍把用户问题写入历史
      try {
        await assertStoreReady();
      } catch (err) {
        if (err instanceof YijingError) {
          return reply.status(err.statusCode).send(err.toJSON());
        }
        throw err;
      }

      let conversation: Conversation;
      try {
        conversation = resolveConversation(requestedId, trimmed);
      } catch (err) {
        if (err instanceof YijingError) {
          return reply.status(err.statusCode).send(err.toJSON());
        }
        throw err;
      }

      const conversationId = conversation.id;
      const history = getHistoryForConversation(conversationId, 3);
      addConversationMessage(conversationId, { role: "user", content: trimmed });

      // 取消 / 超时:客户端断开或超过 REQUEST_TIMEOUT_MS 都 abort agent 运行
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort(new Error("request timeout"));
      }, config.requestTimeoutMs);
      timer.unref();

      // ── 流式模式 ──
      if (stream) {
        reply.hijack();
        reply.raw.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });

        let clientGone = false;
        reply.raw.on("close", () => {
          clientGone = true;
          controller.abort(new Error("client closed"));
        });

        let seq = 0;
        const writeEvent = (event: string, data: unknown): void => {
          if (clientGone || reply.raw.writableEnded || reply.raw.destroyed) return;
          reply.raw.write(`id: ${++seq}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };

        writeEvent("meta", { conversationId });

        const heartbeat = setInterval(() => {
          if (!clientGone && !reply.raw.writableEnded && !reply.raw.destroyed) {
            reply.raw.write(":ping\n\n");
          }
        }, SSE_HEARTBEAT_MS);

        try {
          const startTime = Date.now();
          const result = await agenticRag(trimmed, history, (chunk) => writeEvent("token", { text: chunk }), {
            signal: controller.signal,
            maxToolCalls: config.maxToolCalls,
          });
          const elapsed = (Date.now() - startTime) / 1000;
          recordQueryMetrics(result.citations?.length ?? 0, elapsed);

          const assistant = addConversationMessage(conversationId, {
            role: "assistant",
            content: result.response,
            queryType: result.queryType,
            docCount: result.docCount,
            citations: result.citations,
            degraded: (result.citations?.length ?? 0) === 0,
            model: config.llmModel,
            latencyMs: Math.round(elapsed * 1000),
          });

          for (const citation of result.citations ?? []) {
            writeEvent("citation", citation);
          }

          writeEvent("done", {
            response: result.response,
            queryType: result.queryType,
            docCount: result.docCount,
            citations: result.citations ?? [],
            elapsed,
            conversationId,
            messageId: assistant.id,
            label: QUERY_TYPES_LABEL[result.queryType] ?? "知识问答",
          });

          if (!clientGone) reply.raw.end();
          logRequestComplete(rc, 200, {
            conversationId,
            queryType: result.queryType,
            docCount: result.docCount,
            elapsed,
          });
        } catch (err) {
          const code = timedOut ? ErrorCode.LLM_TIMEOUT : err instanceof YijingError ? err.code : ErrorCode.INTERNAL;
          const message = timedOut
            ? "请求超时，请缩小问题范围或稍后重试"
            : err instanceof YijingError
              ? err.message
              : "Streaming query failed";
          writeEvent("error", { code, message });
          if (!clientGone) reply.raw.end();
          log.error({ err, conversationId, timedOut }, "Streaming query failed");
        } finally {
          clearTimeout(timer);
          clearInterval(heartbeat);
        }
        return;
      }

      // ── 非流式模式 ──
      try {
        const startTime = Date.now();
        const result = await agenticRag(trimmed, history, undefined, {
          signal: controller.signal,
          maxToolCalls: config.maxToolCalls,
        });
        const elapsed = (Date.now() - startTime) / 1000;
        recordQueryMetrics(result.citations?.length ?? 0, elapsed);

        const assistant = addConversationMessage(conversationId, {
          role: "assistant",
          content: result.response,
          queryType: result.queryType,
          docCount: result.docCount,
          citations: result.citations,
          degraded: (result.citations?.length ?? 0) === 0,
          model: config.llmModel,
          latencyMs: Math.round(elapsed * 1000),
        });

        const response: QueryResponse = {
          response: result.response,
          queryType: result.queryType,
          docCount: result.docCount,
          elapsed,
          citations: result.citations ?? [],
          conversationId,
          messageId: assistant.id,
        };

        logRequestComplete(rc, 200, {
          conversationId,
          queryType: result.queryType,
          docCount: result.docCount,
          elapsed,
        });
        return reply.send(response);
      } catch (err) {
        if (timedOut) {
          return reply.status(504).send(
            new YijingError(ErrorCode.LLM_TIMEOUT, "请求超时，请缩小问题范围或稍后重试", {
              statusCode: 504,
            }).toJSON(),
          );
        }
        log.error({ err, conversationId }, "Query failed");
        if (err instanceof YijingError) {
          return reply.status(err.statusCode).send(err.toJSON());
        }
        return reply.status(500).send(new YijingError(ErrorCode.INTERNAL, "Query failed").toJSON());
      } finally {
        clearTimeout(timer);
      }
    },
  );
}
