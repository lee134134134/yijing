import { config } from "../config.js";
import { addDocumentsBatched, clearAll, getDocumentCount, listCollections } from "../vectorstore/chroma.js";
import { chunkDocuments, loadAllMarkdownFiles, printKnowledgeStats } from "./loader.js";

async function main() {
  console.log("=".repeat(50));
  console.log("  倪海厦知识库 - 索引构建");
  console.log("=".repeat(50));
  console.log(`分块大小: ${config.chunkSize} 字符`);
  console.log(`分块重叠: ${config.chunkOverlap} 字符`);
  console.log(`向量存储: ChromaDB (${config.chromaDbUrl})`);
  console.log(`Embedding: ${config.embeddingModel}`);
  console.log("");

  console.log("📖 第1步：加载 Markdown 文件...");
  const rawDocs = loadAllMarkdownFiles();
  const totalSize = rawDocs.reduce((sum, d) => sum + d.pageContent.length, 0);
  console.log(`  已加载 ${rawDocs.length} 个文件，共 ${(totalSize / 1024).toFixed(1)} KB`);

  console.log("\n✂️  第2步：文本分块...");
  const chunks = await chunkDocuments(rawDocs);
  printKnowledgeStats(chunks);

  console.log("\n💾 第3步：写入向量存储...");
  const collections = await listCollections();
  if (collections.length > 0) {
    console.log("  检测到已有索引数据，正在清空...");
    await clearAll();
  }

  console.log("  正在生成 Embedding 并写入...");
  const startTime = Date.now();
  const added = await addDocumentsBatched(chunks);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  const count = await getDocumentCount();

  console.log(`\n✅ 索引构建完成!`);
  console.log(`  写入知识块: ${added}`);
  console.log(`  总文档数: ${count}`);
  console.log(`  耗时: ${elapsed} 秒`);
  console.log(`  平均速度: ${(added / parseFloat(elapsed)).toFixed(1)} 块/秒`);
  console.log(`  向量存储: ChromaDB (${config.chromaDbUrl})`);
  console.log(`  Embedding: ${config.embeddingModel}`);
}

main().catch((err) => {
  console.error("\n❌ 索引构建失败:", err);
  process.exit(1);
});
