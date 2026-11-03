/**
 * API 客户端
 *
 * - 同源请求(开发期由 Vite 代理到 :3001)
 * - 可选 X-API-Key,保存在 localStorage
 * - SSE 用 fetch + ReadableStream 解析(EventSource 不支持 POST/自定义头)
 */

import type {
  ChatMessage,
  Citation,
  Conversation,
  DeepResponse,
  QueryResponse,
  ReadyResponse,
  StatusResponse,
  StreamDone,
  StreamHandlers,
  StreamMeta,
} from "./types.js";

const API_KEY_STORAGE = "yijing:apiKey";

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 0, code = "UNKNOWN") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export function getApiKey(): string {
  try {
    return localStorage.getItem(API_KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

export function setApiKey(key: string): void {
  try {
    if (key.trim()) localStorage.setItem(API_KEY_STORAGE, key.trim());
    else localStorage.removeItem(API_KEY_STORAGE);
  } catch {
    // localStorage 不可用时忽略(隐私模式)
  }
}

function headers(extra?: Record<string, string>): Record<string, string> {
  const key = getApiKey();
  return {
    ...(key ? { "X-API-Key": key } : {}),
    ...extra,
  };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: headers({
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers as Record<string, string> | undefined),
    }),
  });

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    const error = (payload as { error?: { message?: string; code?: string } } | null)?.error;
    throw new ApiError(error?.message ?? `HTTP ${response.status}`, response.status, error?.code ?? "HTTP_ERROR");
  }

  return payload as T;
}

export function getConversations(): Promise<{ conversations: Conversation[]; total: number }> {
  return request("/api/conversations?limit=100");
}

export function createConversation(title?: string): Promise<{ conversation: Conversation }> {
  return request("/api/conversations", {
    method: "POST",
    body: JSON.stringify(title ? { title } : {}),
  });
}

export function renameConversation(id: string, title: string): Promise<{ conversation: Conversation }> {
  return request(`/api/conversations/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
}

export function deleteConversation(id: string): Promise<{ success: boolean }> {
  return request(`/api/conversations/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function getMessages(id: string, limit = 100): Promise<{ messages: ChatMessage[] }> {
  return request(`/api/conversations/${encodeURIComponent(id)}/messages?limit=${limit}`);
}

export function sendQuery(query: string, conversationId?: string): Promise<QueryResponse> {
  return request("/api/query", {
    method: "POST",
    body: JSON.stringify({ query, ...(conversationId ? { conversationId } : {}) }),
  });
}

export function sendDeep(query: string): Promise<DeepResponse> {
  return request("/api/deep", {
    method: "POST",
    body: JSON.stringify({ query }),
  });
}

export function getStatus(): Promise<StatusResponse> {
  return request("/api/status");
}

export async function getReady(): Promise<ReadyResponse> {
  // /ready 在未就绪时返回 503,但响应体仍包含 checks;这里不抛错
  const response = await fetch("/ready", { headers: headers() });
  return (await response.json()) as ReadyResponse;
}

// ========================================
// SSE
// ========================================

function parseFrame(frame: string): { event: string; data: string } | null {
  let event = "message";
  const data: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (data.length === 0) return null;
  return { event, data: data.join("\n") };
}

export async function streamQuery(
  query: string,
  handlers: StreamHandlers,
  options: { conversationId?: string; signal?: AbortSignal } = {},
): Promise<void> {
  const response = await fetch("/api/query", {
    method: "POST",
    headers: headers({ "content-type": "application/json" }),
    body: JSON.stringify({
      query,
      stream: true,
      ...(options.conversationId ? { conversationId: options.conversationId } : {}),
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    const text = await response.text();
    let message = `HTTP ${response.status}`;
    let code = "HTTP_ERROR";
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string; code?: string } };
      message = parsed.error?.message ?? message;
      code = parsed.error?.code ?? code;
    } catch {
      // 非 JSON 错误体
    }
    throw new ApiError(message, response.status, code);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new ApiError("浏览器不支持流式响应", 0, "NO_STREAM");

  const decoder = new TextDecoder();
  let buffer = "";

  const dispatch = (frame: string): void => {
    const parsed = parseFrame(frame);
    if (!parsed) return;

    try {
      switch (parsed.event) {
        case "meta":
          handlers.onMeta?.(JSON.parse(parsed.data) as StreamMeta);
          break;
        case "token": {
          const payload = JSON.parse(parsed.data) as { text?: string };
          if (payload.text) handlers.onToken?.(payload.text);
          break;
        }
        case "citation":
          handlers.onCitation?.(JSON.parse(parsed.data) as Citation);
          break;
        case "done":
          handlers.onDone?.(JSON.parse(parsed.data) as StreamDone);
          break;
        case "error": {
          const payload = JSON.parse(parsed.data) as { message?: string; code?: string };
          handlers.onError?.(new ApiError(payload.message ?? "流式请求失败", 0, payload.code ?? "STREAM_ERROR"));
          break;
        }
        default:
          break;
      }
    } catch {
      // 单帧解析失败不阻断后续帧
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = buffer.replace(/\r\n/g, "\n");

    let index = buffer.indexOf("\n\n");
    while (index >= 0) {
      const frame = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      if (frame.trim() && !frame.startsWith(":")) dispatch(frame);
      index = buffer.indexOf("\n\n");
    }
  }

  if (buffer.trim() && !buffer.startsWith(":")) dispatch(buffer);
}
