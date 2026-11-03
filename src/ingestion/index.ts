import { config } from "../config.js";
import { createLogger } from "../logger.js";
import { addDocumentsBatched, deleteCollectionByName, getDocumentCount } from "../vectorstore/chroma.js";
import { rebuildFts } from "../vectorstore/fts.js";
import { computeCorpusHash, readManifest, writeManifest } from "../vectorstore/manifest.js";
import { loadCorpusFiles } from "./corpus-loader.js";
import { chunkDocuments, loadAllMarkdownFiles, printKnowledgeStats } from "./loader.js";

const log = createLogger("ingestion:main");

async function main() {
  log.info("=".repeat(50));
  log.info("  倪海厦知识库 - 索引构建");
  log.info("=".repeat(50));
  log.info(`分块大小: ${config.chunkSize} 字符`);
  log.info(`分块重叠: ${config.chunkOverlap} 字符`);
  log.info(`向量存储: ChromaDB (${config.chromaDbUrl})`);
  log.info(`Embedding: ${config.embeddingModel}`);
  log.info("");

  log.info("📖 第1步：加载 Markdown 文件...");
  const rawDocs = loadAllMarkdownFiles();
  for (const doc of rawDocs) doc.metadata.layer = "curated";
  const corpusDocs = loadCorpusFiles(config.corpusDir);
  const rawAll = [...rawDocs, ...corpusDocs];
  const totalSize = rawAll.reduce((sum, d) => sum + d.pageContent.length, 0);
  log.info(
    `  已加载 ${rawDocs.length} 个摘要文件 + ${corpusDocs.length} 个全文文件，共 ${(totalSize / 1024).toFixed(1)} KB`,
  );

  log.info("\n✂️  第2步：文本分块...");
  const chunks = await chunkDocuments(rawAll);
  printKnowledgeStats(chunks);

  log.info("\n💾 第3步：写入向量存储(新集合)...");
  // 非破坏性:先写新版本集合,校验通过后再切换 manifest;失败时旧索引仍可用
  const previousCollection = readManifest()?.collection ?? null;
  const targetCollection = `${config.chromaCollectionName}_v${Date.now()}`;
  log.info(`  目标集合: ${targetCollection}`);

  log.info("  正在生成 Embedding 并写入...");
  const startTime = Date.now();
  const added = await addDocumentsBatched(chunks, 50, targetCollection);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  const count = await getDocumentCount(targetCollection);
  if (count !== chunks.length) {
    throw new Error(`索引写入不完整: ${count}/${chunks.length},已保留旧索引`);
  }

  log.info("\n🔎 第4步：构建全文索引(FTS5)...");
  const ftsCount = await rebuildFts(chunks);

  // 最后切换清单:只有向量 + 全文都成功,新索引才生效
  writeManifest({
    collection: targetCollection,
    baseCollection: config.chromaCollectionName,
    embeddingProvider: config.embeddingProvider,
    embeddingModel: config.embeddingModel,
    embeddingDimension: config.embeddingDimension,
    chunkSize: config.chunkSize,
    chunkOverlap: config.chunkOverlap,
    corpusHash: computeCorpusHash(chunks),
    chunkCount: chunks.length,
  });

  // 切换成功后清理上一版本(失败不影响新索引)
  if (previousCollection && previousCollection !== targetCollection) {
    try {
      await deleteCollectionByName(previousCollection);
      log.info(`  已清理旧集合: ${previousCollection}`);
    } catch (err) {
      log.warn({ err, collection: previousCollection }, "清理旧集合失败(可手动删除)");
    }
  }

  log.info(`\n✅ 索引构建完成!`);
  log.info(`  写入知识块: ${added}`);
  log.info(`  全文索引块: ${ftsCount}`);
  log.info(`  总文档数: ${count}`);
  log.info(`  耗时: ${elapsed} 秒`);
  log.info(`  平均速度: ${(added / parseFloat(elapsed)).toFixed(1)} 块/秒`);
  log.info(`  向量存储: ChromaDB (${config.chromaDbUrl})`);
  log.info(`  Embedding: ${config.embeddingModel}`);
}

main().catch((err) => {
  log.error("\n❌ 索引构建失败:", err);
  process.exit(1);
});
