# ── Build Stage ──
# 基础镜像用 Debian(glibc)而非 Alpine(musl):@huggingface/transformers v4 在
# Node 下强依赖 onnxruntime-node 原生绑定,而 ORT 仅提供 glibc 构建(musl 下
# dlopen 失败)。全量镜像自带构建工具链,原生模块(prebuild 失效时)可兜底编译。
FROM node:26 AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ── 构建期预热本地 Embedding 模型 ──
# 默认 local 提供方;镜像内烘焙模型缓存(dtype 必须与运行时 embeddings.ts
# 的 q8 一致,否则运行时缓存 MISS 会重新联网下载)。
# (切换 EMBEDDING_PROVIDER=api 时此步为多余下载,可删除本段)
RUN mkdir -p /app/model-cache && \
    EMBEDDING_MODEL="${EMBEDDING_MODEL:-Xenova/all-MiniLM-L6-v2}" \
    HF_MIRROR="${HF_MIRROR:-https://hf-mirror.com/}" \
    node -e "import('@huggingface/transformers').then(async ({ pipeline, env }) => { \
      env.cacheDir = '/app/model-cache'; \
      env.remoteHost = process.env.HF_MIRROR; \
      env.remotePathTemplate = '{model}/resolve/{revision}/'; \
      await pipeline('feature-extraction', process.env.EMBEDDING_MODEL, { dtype: 'q8' }); \
      console.log('embedding model cached:', process.env.EMBEDDING_MODEL); \
    })"

# ── Production Stage ──
FROM node:26 AS runner

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends tini ca-certificates && \
    rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/model-cache ./model-cache
COPY memory/ ./memory/

# 运行时指向烘焙的模型缓存(独立于 /app/data,避免被 compose 的 ./data 挂载遮蔽)
ENV EMBEDDING_CACHE_DIR=/app/model-cache
ENV NODE_ENV=production
ENV CHROMA_DB_URL=http://chromadb:8000

EXPOSE 3001

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/api/server.js"]
