import { config } from "../config.js";
import { createLogger } from "../logger.js";
import { addDocumentsBatched, clearAll, getDocumentCount, listCollections } from "../vectorstore/chroma.js";
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
  const totalSize = rawDocs.reduce((sum, d) => sum + d.pageContent.length, 0);
  log.info(`  已加载 ${rawDocs.length} 个文件，共 ${(totalSize / 1024).toFixed(1)} KB`);

  log.info("\n✂️  第2步：文本分块...");
  const chunks = await chunkDocuments(rawDocs);
  printKnowledgeStats(chunks);

  log.info("\n💾 第3步：写入向量存储...");
  const collections = await listCollections();
  if (collections.length > 0) {
    log.info("  检测到已有索引数据，正在清空...");
    await clearAll();
  }

  log.info("  正在生成 Embedding 并写入...");
  const startTime = Date.now();
  const added = await addDocumentsBatched(chunks);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  const count = await getDocumentCount();

  log.info(`\n✅ 索引构建完成!`);
  log.info(`  写入知识块: ${added}`);
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
