/** 与后端 src/types.ts 对齐的前端类型 */

export type QueryType =
  | "tcm_diagnosis"
  | "tcm_prescription"
  | "bazi_analysis"
  | "mianxiang_analysis"
  | "yijing_divination"
  | "health_advice"
  | "general_knowledge"
  | "deep_analysis"
  | "unknown";

export interface Citation {
  refId: string;
  source: string;
  h1?: string;
  h2?: string;
  h3?: string;
  lineRange?: string;
  domain: string;
  snippet: string;
  score?: number;
  book?: string;
  chapter?: string;
  sectionPath?: string;
  pageStart?: number;
  pageEnd?: number;
  layer?: "curated" | "fulltext";
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export interface ChatMessage {
  id: string;
  timestamp: number;
  role: "user" | "assistant";
  content: string;
  queryType?: string;
  docCount?: number;
  citations?: Citation[];
  degraded?: boolean;
  model?: string;
  latencyMs?: number;
}

export interface QueryResponse {
  response: string;
  queryType: QueryType;
  docCount: number;
  elapsed: number;
  citations: Citation[];
  conversationId: string;
  messageId: string;
}

export interface DeepReference {
  source: string;
  content: string;
  domain: string;
  refId?: string;
}

export interface DeepResponse {
  conclusion: string;
  reasoning: string;
  references: DeepReference[];
  confidence: number;
  suggestions?: string[];
  elapsed: number;
}

export interface LlmStatus {
  role: string;
  provider: string;
  model: string;
  baseUrl: string;
  jsonMode: boolean;
  error?: string;
}

export interface StatusResponse {
  docCount: number;
  model: string;
  collections: string[];
  version: string;
  embeddingModel: string;
  chromaDbUrl: string;
  queryRewrite: boolean;
  maxContextTokens: number;
  chunkSize: number;
  chunkOverlap: number;
  llm?: LlmStatus[];
  health?: {
    chroma: { ok: boolean; error?: string };
    embedding: { ok: boolean; provider: string; model: string };
    llm: { ok: boolean };
    manifest: { ok: boolean; error?: string };
  };
  index?: {
    collection: string;
    exists: boolean;
    docCount: number;
  };
}

export interface ReadyResponse {
  ready: boolean;
  checks: {
    chroma: {
      ok: boolean;
      chroma: boolean;
      collection: boolean;
      docCount: number;
      collections: string[];
      manifest: { ok: boolean; error?: string };
      error?: string;
      detail?: string;
    };
    llm: { ok: boolean; roles: LlmStatus[] };
  };
}

export interface StreamMeta {
  conversationId: string;
}

export interface StreamDone {
  response: string;
  queryType: QueryType;
  docCount: number;
  citations: Citation[];
  elapsed: number;
  conversationId: string;
  messageId: string;
  label?: string;
}

export interface StreamHandlers {
  onMeta?: (meta: StreamMeta) => void;
  onToken?: (text: string) => void;
  onCitation?: (citation: Citation) => void;
  onDone?: (done: StreamDone) => void;
  onError?: (error: Error) => void;
}
