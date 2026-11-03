/**
 * 聊天状态(zustand)
 *
 * 只负责数据与请求编排;视觉/布局在 components/views 中实现。
 */

import { create } from "zustand";
import * as api from "../api/client.js";
import type { ChatMessage, Citation, Conversation, DeepResponse, ReadyResponse, StatusResponse } from "../api/types.js";

export type View = "chat" | "deep" | "history" | "status";

interface ChatState {
  view: View;
  conversations: Conversation[];
  activeId: string | null;
  messages: ChatMessage[];
  streaming: boolean;
  loadingMessages: boolean;
  error: string | null;
  status: StatusResponse | null;
  ready: ReadyResponse | null;
  deep: DeepResponse | null;
  deepLoading: boolean;
  apiKey: string;

  setView: (view: View) => void;
  setApiKey: (key: string) => void;
  clearError: () => void;
  loadConversations: () => Promise<void>;
  selectConversation: (id: string) => Promise<void>;
  newConversation: () => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  removeConversation: (id: string) => Promise<void>;
  send: (text: string) => Promise<void>;
  stop: () => void;
  runDeep: (text: string) => Promise<void>;
  refreshHealth: () => Promise<void>;
}

let abortController: AbortController | null = null;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "请求失败";
}

export const useChatStore = create<ChatState>((set, get) => ({
  view: "chat",
  conversations: [],
  activeId: null,
  messages: [],
  streaming: false,
  loadingMessages: false,
  error: null,
  status: null,
  ready: null,
  deep: null,
  deepLoading: false,
  apiKey: api.getApiKey(),

  setView: (view) => {
    set({ view });
    if (view === "status") void get().refreshHealth();
  },

  setApiKey: (key) => {
    api.setApiKey(key);
    set({ apiKey: key });
  },

  clearError: () => set({ error: null }),

  loadConversations: async () => {
    try {
      const { conversations } = await api.getConversations();
      set({ conversations });
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  },

  selectConversation: async (id) => {
    set({ activeId: id, loadingMessages: true, error: null, view: "chat" });
    try {
      const { messages } = await api.getMessages(id);
      set({ messages });
    } catch (error) {
      set({ error: errorMessage(error), messages: [] });
    } finally {
      set({ loadingMessages: false });
    }
  },

  newConversation: async () => {
    try {
      const { conversation } = await api.createConversation();
      set((state) => ({
        conversations: [conversation, ...state.conversations],
        activeId: conversation.id,
        messages: [],
        view: "chat",
        error: null,
      }));
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  },

  renameConversation: async (id, title) => {
    try {
      const { conversation } = await api.renameConversation(id, title);
      set((state) => ({
        conversations: state.conversations.map((item) => (item.id === id ? conversation : item)),
      }));
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  },

  removeConversation: async (id) => {
    try {
      await api.deleteConversation(id);
      set((state) => {
        const conversations = state.conversations.filter((item) => item.id !== id);
        const wasActive = state.activeId === id;
        return {
          conversations,
          ...(wasActive ? { activeId: null, messages: [] } : {}),
        };
      });
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  },

  send: async (text) => {
    const query = text.trim();
    if (!query || get().streaming) return;

    set({ streaming: true, error: null, view: "chat" });

    const streamId = `streaming-${Date.now()}`;
    const userMessage: ChatMessage = {
      id: `local-user-${Date.now()}`,
      timestamp: Date.now(),
      role: "user",
      content: query,
    };
    const streamMessage: ChatMessage = {
      id: streamId,
      timestamp: Date.now(),
      role: "assistant",
      content: "",
    };

    try {
      const conversationId = get().activeId ?? undefined;

      set((state) => ({ messages: [...state.messages, userMessage, streamMessage] }));

      const citations: Citation[] = [];
      const controller = new AbortController();
      abortController = controller;

      await api.streamQuery(
        query,
        {
          onMeta: (meta) => {
            // 服务端会在首帧返回会话 id;新会话在这里补进列表,避免额外的创建请求
            set((state) => {
              const exists = state.conversations.some((conversation) => conversation.id === meta.conversationId);
              return {
                activeId: meta.conversationId,
                conversations: exists
                  ? state.conversations
                  : [
                      {
                        id: meta.conversationId,
                        title: query.slice(0, 30),
                        createdAt: Date.now(),
                        updatedAt: Date.now(),
                        messageCount: 0,
                      },
                      ...state.conversations,
                    ],
              };
            });
          },
          onToken: (token) => {
            set((state) => ({
              messages: state.messages.map((message) =>
                message.id === streamId ? { ...message, content: message.content + token } : message,
              ),
            }));
          },
          onCitation: (citation) => {
            citations.push(citation);
          },
          onDone: (done) => {
            set((state) => ({
              messages: state.messages.map((message) =>
                message.id === streamId
                  ? {
                      id: done.messageId,
                      timestamp: Date.now(),
                      role: "assistant",
                      content: done.response,
                      citations: done.citations,
                      queryType: done.queryType,
                      docCount: done.docCount,
                      degraded: done.citations.length === 0,
                    }
                  : message,
              ),
              conversations: state.conversations.map((conversation) =>
                conversation.id === done.conversationId
                  ? {
                      ...conversation,
                      updatedAt: Date.now(),
                      messageCount: conversation.messageCount + 2,
                    }
                  : conversation,
              ),
            }));
          },
          onError: (error) => {
            set((state) => ({
              error: error.message,
              messages: state.messages.filter((message) => message.id !== streamId || message.content.length > 0),
            }));
          },
        },
        { conversationId, signal: controller.signal },
      );
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        set({ error: errorMessage(error) });
      }
      set((state) => ({
        messages: state.messages.filter((message) => message.id !== streamId || message.content.length > 0),
      }));
    } finally {
      abortController = null;
      set({ streaming: false });
    }
  },

  stop: () => {
    abortController?.abort();
    abortController = null;
    set({ streaming: false });
  },

  runDeep: async (text) => {
    const query = text.trim();
    if (!query || get().deepLoading) return;
    set({ deepLoading: true, error: null, view: "deep" });
    try {
      const deep = await api.sendDeep(query);
      set({ deep });
    } catch (error) {
      set({ error: errorMessage(error) });
    } finally {
      set({ deepLoading: false });
    }
  },

  refreshHealth: async () => {
    const [status, ready] = await Promise.all([api.getStatus().catch(() => null), api.getReady().catch(() => null)]);
    set({ status, ready });
    if (!status || !ready) {
      set({ error: "无法连接后端服务，请确认 `npm run server` 已启动" });
    }
  },
}));
