/**
 * Embedding 单元测试(embeddings.ts)
 *
 * mock @huggingface/transformers 的 pipeline 边界与 @langchain/openai,验证:
 * - 本地提供方:批量推理(数组输入)按 dim 切分、query 缓存、异常结构回退逐条
 * - API 提供方:OpenAIEmbeddings 包装、baseURL/apiKey/model 接线
 * - 本地环境:cacheDir/镜像源从 config 注入
 * 测试不下载模型、不触网。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  model: vi.fn(),
  capturedOpenAI: [] as Array<Record<string, unknown>>,
}));

vi.mock("../config.js", () => ({
  config: {
    embeddingProvider: "local",
    embeddingModel: "Xenova/all-MiniLM-L6-v2",
    embeddingDimension: 384,
    embeddingCacheDir: "/tmp/models-cache",
    hfMirror: "https://hf-mirror.com/",
    embeddingApiKey: "embed-key",
    embeddingBaseUrl: "http://embed.local/v1",
  },
}));

vi.mock("../logger.js", () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

// pipeline() 只负责返回模型函数;真正被断言的是模型推理调用 h.model
vi.mock("@huggingface/transformers", () => ({
  pipeline: async () => h.model,
  env: {},
}));

vi.mock("@langchain/openai", () => ({
  OpenAIEmbeddings: vi.fn(function (this: unknown, params: Record<string, unknown>) {
    h.capturedOpenAI.push(params);
    Object.assign(this as object, {
      embedDocuments: vi.fn(async (texts: string[]) => texts.map(() => [1, 2, 3])),
      embedQuery: vi.fn(async () => [1, 2, 3]),
    });
  }),
}));

import { ApiEmbeddings, getEmbeddings, LocalEmbeddings, resetEmbeddings } from "../vectorstore/embeddings.js";

const DIM = 4;

/** 构造 [batch, DIM] 展平的确定性输出:第 i 个文本 → [i*DIM, i*DIM+1, ...] */
function fakeBatchOutput(batch: string[]): { data: Float32Array } {
  const data = new Float32Array(batch.length * DIM);
  batch.forEach((_, i) => {
    for (let d = 0; d < DIM; d++) {
      data[i * DIM + d] = i * DIM + d;
    }
  });
  return { data };
}

describe("vectorstore/embeddings(本地提供方)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.capturedOpenAI.length = 0;
    resetEmbeddings();
    h.model.mockImplementation(async (input: string | string[]) => ({
      data: fakeBatchOutput(typeof input === "string" ? [input] : input).data,
    }));
  });

  it("整批一次推理(数组输入)并按 dim 切分还原", async () => {
    const vecs = await getEmbeddings().embedDocuments(["a", "b", "c"]);

    expect(h.model).toHaveBeenCalledTimes(1);
    expect(h.model).toHaveBeenCalledWith(["a", "b", "c"], expect.objectContaining({ pooling: "mean" }));
    expect(vecs).toEqual([
      [0, 1, 2, 3],
      [4, 5, 6, 7],
      [8, 9, 10, 11],
    ]);
  });

  it("超过批大小(16)时按批切分,仍逐批一次推理", async () => {
    const texts = Array.from({ length: 18 }, (_, i) => `t${i}`);
    const vecs = await getEmbeddings().embedDocuments(texts);

    expect(h.model).toHaveBeenCalledTimes(2);
    expect(h.model.mock.calls[0]?.[0]).toHaveLength(16);
    expect(h.model.mock.calls[1]?.[0]).toHaveLength(2);
    expect(vecs).toHaveLength(18);
    // 第二批内的第 2 个文本(batch 内下标 1)→ [4, 5, 6, 7]
    expect(vecs[17]).toEqual([4, 5, 6, 7]);
  });

  it("embedQuery 命中缓存时不重复推理", async () => {
    const first = await getEmbeddings().embedQuery("桂枝汤");
    const second = await getEmbeddings().embedQuery("桂枝汤");

    expect(h.model).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it("不同查询各自推理", async () => {
    await getEmbeddings().embedQuery("桂枝汤");
    await getEmbeddings().embedQuery("麻黄汤");

    expect(h.model).toHaveBeenCalledTimes(2);
  });

  it("空输入不触发推理", async () => {
    expect(await getEmbeddings().embedDocuments([])).toEqual([]);
    expect(h.model).not.toHaveBeenCalled();
  });

  it("批量返回结构异常时回退逐条推理(正确性优先于吞吐)", async () => {
    h.model.mockImplementation(async (input: string | string[]) => {
      const isBatch = Array.isArray(input);
      // 批调用返回不可整除的脏数据 → 触发回退;逐条调用返回正常维度
      return { data: isBatch ? new Float32Array([1, 2, 3, 4, 5]) : new Float32Array([9, 9, 9, 9]) };
    });

    const vecs = await new LocalEmbeddings().embedDocuments(["a", "b"]);

    expect(vecs).toEqual([
      [9, 9, 9, 9],
      [9, 9, 9, 9],
    ]);
    // 1 次批量尝试 + 2 次逐条回退
    expect(h.model).toHaveBeenCalledTimes(3);
  });
});

describe("vectorstore/embeddings(提供方选择与环境注入)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetEmbeddings();
  });

  it("provider=local 时 getEmbeddings 返回本地实现", async () => {
    const { config } = await import("../config.js");
    expect(config.embeddingProvider).toBe("local");
    expect(getEmbeddings()).toBeInstanceOf(LocalEmbeddings);
  });

  it("本地环境从 config 注入 cacheDir 与镜像源", async () => {
    const transformers = await import("@huggingface/transformers");
    const env = transformers.env as { cacheDir?: string; remoteHost?: string; remotePathTemplate?: string };

    // 触发模型加载(惰性,首次推理时才注入 env)
    await new LocalEmbeddings().embedQuery("触发加载");

    expect(env.cacheDir).toBe("/tmp/models-cache");
    expect(env.remoteHost).toBe("https://hf-mirror.com/");
    expect(env.remotePathTemplate).toBe("{model}/resolve/{revision}/");
  });
});

describe("vectorstore/embeddings(API 提供方)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.capturedOpenAI.length = 0;
  });

  it("ApiEmbeddings 以 embedding 配置接线 OpenAIEmbeddings", async () => {
    const embeddings = new ApiEmbeddings();

    // #3 修复核心:embeddingApiKey/BaseUrl/Model 此前是死配置,现在真正接线
    expect(h.capturedOpenAI[0]).toMatchObject({
      model: "Xenova/all-MiniLM-L6-v2",
      apiKey: "embed-key",
      configuration: { baseURL: "http://embed.local/v1" },
    });

    const vecs = await embeddings.embedDocuments(["x"]);
    expect(vecs).toEqual([[1, 2, 3]]);
    expect(await embeddings.embedQuery("y")).toEqual([1, 2, 3]);
  });
});
