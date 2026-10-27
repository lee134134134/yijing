/**
 * JSON → ChromaDB 数据迁移脚本
 *
 * 将旧版 JSON 文件存储中的文档迁移到 ChromaDB。
 * 旧格式: data/documents.json（StoredDocument[]）
 * 新格式: ChromaDB 集合 + Embedding 向量
 *
 * 使用方式: npm run migrate
 */

import fs from "node:fs";
import path from "node:path";
import { Document } from "@langchain/core/documents";
import { createLogger } from "../logger.js";
import type { KnowledgeDocument, KnowledgeMetadata } from "../types.js";
import { addDocumentsBatched, clearAll, getDocumentCount } from "./chroma.js";

const log = createLogger("vectorstore:migration");

const DATA_DIR = path.resolve(process.cwd(), "data");
const DOCUMENTS_FILE = path.join(DATA_DIR, "documents.json");

/** 旧版存储文档格式 */
interface LegacyStoredDocument {
  id: string;
  content: string;
  metadata: KnowledgeMetadata;
}

/**
 * 读取旧版 JSON 文档
 */
function loadLegacyDocuments(): LegacyStoredDocument[] {
  if (!fs.existsSync(DOCUMENTS_FILE)) {
    log.info("No legacy documents found at %s", DOCUMENTS_FILE);
    return [];
  }

  const raw = fs.readFileSync(DOCUMENTS_FILE, "utf-8");
  const docs: LegacyStoredDocument[] = JSON.parse(raw);
  log.info({ count: docs.length }, "Loaded legacy documents");
  return docs;
}

/**
 * 将旧文档转为 KnowledgeDocument 格式
 */
function convertToKnowledgeDocs(legacy: LegacyStoredDocument[]): KnowledgeDocument[] {
  return legacy.map(
    (doc) =>
      new Document<KnowledgeMetadata>({
        pageContent: doc.content,
        metadata: doc.metadata,
      }),
  );
}

/**
 * 主迁移流程
 */
export async function runMigration(): Promise<void> {
  console.log("=".repeat(50));
  console.log("  旧版 JSON → ChromaDB 数据迁移");
  console.log("=".repeat(50));
  console.log("");

  // Step 1: 检查旧版数据
  const legacyDocs = loadLegacyDocuments();
  if (legacyDocs.length === 0) {
    console.log("没有发现旧版 JSON 数据。跳过迁移。");
    console.log("提示: 首次使用请运行 npm run ingest 直接从 Markdown 构建索引。");
    return;
  }
  console.log(`发现 ${legacyDocs.length} 条旧版文档记录。`);

  // Step 2: 清空 ChromaDB 集合（如果已有数据）
  try {
    const existing = await getDocumentCount();
    if (existing > 0) {
      console.log(`ChromaDB 中已有 ${existing} 条数据，正在清空...`);
      await clearAll();
    }
  } catch {
    // ChromaDB 未初始化，正常
    console.log("ChromaDB 集合尚不存在，将创建。");
  }

  // Step 3: 转换格式并写入 ChromaDB
  console.log("正在转换文档格式...");
  const knowledgeDocs = convertToKnowledgeDocs(legacyDocs);
  console.log(`转换完成: ${knowledgeDocs.length} 条。`);

  console.log("\n正在写入 ChromaDB（生成 Embedding 中）...");
  const startTime = Date.now();
  await addDocumentsBatched(knowledgeDocs);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  const finalCount = await getDocumentCount();
  console.log(`\n迁移完成!`);
  console.log(`  ChromaDB 文档数: ${finalCount}`);
  console.log(`  耗时: ${elapsed} 秒`);

  // Step 4: 清理旧数据
  const backupPath = `${DOCUMENTS_FILE}.bak`;
  fs.renameSync(DOCUMENTS_FILE, backupPath);
  console.log(`\n旧 JSON 文件已备份为: ${backupPath}`);
  console.log("  如需回滚，将 ChromaDB 中数据重新导入即可。");
}

// ── 直接执行时 ──
const isMainModule = process.argv[1]?.endsWith("migration.ts") || process.env.npm_lifecycle_event === "migrate";
if (isMainModule) {
  runMigration().catch((err) => {
    console.error("迁移失败:", err);
    process.exit(1);
  });
}
