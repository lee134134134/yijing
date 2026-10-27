/**
 * ChromaDB 检索层单元测试(chroma.ts)
 *
 * mock chromadb 客户端与 embedding 边界,验证:
 * - 检索结果按 query+topK 缓存,重复查询不重复请求 ChromaDB
 * - ingest / clearAll 写入后缓存正确失效
 * - ChromaDB 查询结果的解析为 KnowledgeDocument
 * 测试不连接真实 ChromaDB、不加载模型。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  collection: { query: vi.fn(), add: vi.fn(), count: vi.fn() },
  client: { getOrCreateCollection: vi.fn(), deleteCollection: vi.fn(), listCollections: vi.fn() },
}));

vi.mock("../logger.js", () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

vi.mock("../config.js", () => ({
  config: {
    chromaDbUrl: "http://localhost:8000",
    chromaCollectionName: "test_collection",
    retrievalTopK: 5,
  },
}));

vi.mock("../vectorstore/embeddings.js", () => ({
  getEmbeddings: vi.fn(() => ({
    embedQuery: vi.fn(async () => [0.1, 0.2, 0.3]),
    embedDocuments: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  })),
}));

// class 形式保证 new ChromaClient() 可用(vi.fn 箭头实现不能作构造器,biome 也不允许 constructor return)
vi.mock("chromadb", () => ({
  ChromaClient: class {
    constructor() {
      Object.assign(this, h.client);
    }
  },
}));

import type { KnowledgeDocument } from "../types.js";
import { addDocumentsBatched, clearAll, resetStore, searchKnowledge } from "../vectorstore/chroma.js";

function makeDocs(): KnowledgeDocument[] {
  return [{ pageContent: "桂枝汤组成", metadata: { source: "shanghanlun.md", domain: "方剂" } }] as KnowledgeDocument[];
}

function mockChromaResult(): {
  documents: string[][];
  metadatas: Array<Array<Record<string, string>>>;
} {
  return { documents: [["桂枝汤组成"]], metadatas: [[{ source: "shanghanlun.md", domain: "方剂" }]] };
}

describe("vectorstore/chroma 检索缓存", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
    h.client.getOrCreateCollection.mockResolvedValue(h.collection);
    h.client.deleteCollection.mockResolvedValue(undefined);
    h.client.listCollections.mockResolvedValue([]);
    h.collection.query.mockResolvedValue(mockChromaResult());
    h.collection.add.mockResolvedValue(undefined);
    h.collection.count.mockResolvedValue(1);
  });

  it("相同 query+topK 命中缓存,不重复请求 ChromaDB", async () => {
    const first = await searchKnowledge("桂枝汤");
    const second = await searchKnowledge("桂枝汤");

    expect(h.collection.query).toHaveBeenCalledTimes(1);
    expect(second[0]?.pageContent).toBe(first[0]?.pageContent);
  });

  it("不同 topK 产生不同缓存 key", async () => {
    await searchKnowledge("桂枝汤", 5);
    await searchKnowledge("桂枝汤", 10);

    expect(h.collection.query).toHaveBeenCalledTimes(2);
  });

  it("addDocumentsBatched 写入后缓存失效", async () => {
    await searchKnowledge("桂枝汤");
    await addDocumentsBatched(makeDocs(), 10);
    await searchKnowledge("桂枝汤");

    expect(h.collection.query).toHaveBeenCalledTimes(2);
  });

  it("clearAll 后缓存失效", async () => {
    await searchKnowledge("桂枝汤");
    await clearAll();
    await searchKnowledge("桂枝汤");

    expect(h.collection.query).toHaveBeenCalledTimes(2);
  });

  it("ChromaDB 查询结果解析为 KnowledgeDocument", async () => {
    const docs = await searchKnowledge("桂枝汤");

    expect(docs).toHaveLength(1);
    expect(docs[0]?.metadata.source).toBe("shanghanlun.md");
    expect(docs[0]?.metadata.domain).toBe("方剂");
  });

  it("检索失败时降级为空数组且不写入缓存", async () => {
    h.collection.query.mockRejectedValue(new Error("chroma down"));

    const first = await searchKnowledge("桂枝汤");
    expect(first).toEqual([]);

    // 恢复后重新检索应真正命中 ChromaDB(失败结果未被缓存)
    h.collection.query.mockResolvedValue(mockChromaResult());
    const second = await searchKnowledge("桂枝汤");
    expect(second).toHaveLength(1);
    expect(h.collection.query).toHaveBeenCalledTimes(2);
  });
});
