/**
 * 会话管理 API
 *
 * 单机自用:不做 owner 隔离;会话之间互不影响。
 * 软删除:DELETE 只设置 deleted_at,消息保留。
 */

import type { FastifyInstance } from "fastify";
import {
  createConversation,
  deleteConversation,
  getConversation,
  getMessages,
  listConversations,
  renameConversation,
} from "../../conversation/index.js";
import { ErrorCode, YijingError } from "../../errors.js";
import { createLogger, createRequestContext, logRequestComplete } from "../../logger.js";
import { registerErrorHandler } from "../error-handler.js";
import {
  conversationListQuerySchema,
  conversationListResponseSchema,
  conversationMessagesQuerySchema,
  conversationMessagesResponseSchema,
  conversationResponseSchema,
  createConversationBodySchema,
  errorResponseSchema,
  renameConversationBodySchema,
} from "../schemas.js";

const log = createLogger("api:routes:conversations");

export async function conversationRoutes(server: FastifyInstance) {
  registerErrorHandler(server);

  server.post<{ Body: { title?: string } }>(
    "/conversations",
    {
      schema: {
        tags: ["conversations"],
        summary: "新建会话",
        security: [{ apiKey: [] }],
        body: createConversationBodySchema,
        response: { 201: conversationResponseSchema, 400: errorResponseSchema },
      },
    },
    async (req, reply) => {
      const rc = createRequestContext("POST", "/api/conversations");
      const conversation = createConversation(req.body?.title?.trim() || "新对话");
      logRequestComplete(rc, 201, { conversationId: conversation.id });
      return reply.status(201).send({ conversation });
    },
  );

  server.get<{ Querystring: { limit?: number } }>(
    "/conversations",
    {
      schema: {
        tags: ["conversations"],
        summary: "会话列表",
        security: [{ apiKey: [] }],
        querystring: conversationListQuerySchema,
        response: { 200: conversationListResponseSchema },
      },
    },
    async (req, reply) => {
      const rc = createRequestContext("GET", "/api/conversations");
      const conversations = listConversations(req.query?.limit ?? 50);
      logRequestComplete(rc, 200, { count: conversations.length });
      return reply.send({ conversations, total: conversations.length });
    },
  );

  server.get<{ Params: { id: string } }>(
    "/conversations/:id",
    {
      schema: {
        tags: ["conversations"],
        summary: "会话详情",
        security: [{ apiKey: [] }],
        response: { 200: conversationResponseSchema, 404: errorResponseSchema },
      },
    },
    async (req, reply) => {
      const conversation = getConversation(req.params.id);
      if (!conversation) {
        throw new YijingError(ErrorCode.NOT_FOUND, "Conversation not found", { statusCode: 404 });
      }
      return reply.send({ conversation });
    },
  );

  server.get<{ Params: { id: string }; Querystring: { limit?: number; before?: number } }>(
    "/conversations/:id/messages",
    {
      schema: {
        tags: ["conversations"],
        summary: "会话消息（按时间正序）",
        security: [{ apiKey: [] }],
        querystring: conversationMessagesQuerySchema,
        response: { 200: conversationMessagesResponseSchema, 404: errorResponseSchema },
      },
    },
    async (req, reply) => {
      const conversation = getConversation(req.params.id);
      if (!conversation) {
        throw new YijingError(ErrorCode.NOT_FOUND, "Conversation not found", { statusCode: 404 });
      }
      const messages = getMessages(req.params.id, req.query?.limit ?? 50, req.query?.before);
      return reply.send({ messages });
    },
  );

  server.patch<{ Params: { id: string }; Body: { title: string } }>(
    "/conversations/:id",
    {
      schema: {
        tags: ["conversations"],
        summary: "重命名会话",
        security: [{ apiKey: [] }],
        body: renameConversationBodySchema,
        response: { 200: conversationResponseSchema, 404: errorResponseSchema },
      },
    },
    async (req, reply) => {
      if (!renameConversation(req.params.id, req.body.title)) {
        throw new YijingError(ErrorCode.NOT_FOUND, "Conversation not found", { statusCode: 404 });
      }
      const conversation = getConversation(req.params.id);
      if (!conversation) {
        throw new YijingError(ErrorCode.NOT_FOUND, "Conversation not found", { statusCode: 404 });
      }
      return reply.send({ conversation });
    },
  );

  server.delete<{ Params: { id: string } }>(
    "/conversations/:id",
    {
      schema: {
        tags: ["conversations"],
        summary: "删除会话（软删）",
        security: [{ apiKey: [] }],
        response: {
          200: { type: "object", required: ["success"], properties: { success: { type: "boolean" } } },
          404: errorResponseSchema,
        },
      },
    },
    async (req, reply) => {
      if (!deleteConversation(req.params.id)) {
        throw new YijingError(ErrorCode.NOT_FOUND, "Conversation not found", { statusCode: 404 });
      }
      log.info({ conversationId: req.params.id }, "Conversation soft-deleted");
      return reply.send({ success: true });
    },
  );
}
