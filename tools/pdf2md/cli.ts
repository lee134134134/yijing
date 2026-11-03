/**
 * PDF → Markdown 命令行
 *
 * 用法:
 *   npm run pdf:inventory                 # 扫描 pdf/ 生成 corpus/manifest.yaml
 *   npm run pdf:build                     # 处理台账中所有非 exclude 书目
 *   npm run pdf:build -- --book <id>      # 只处理一本
 *   npm run pdf:build -- --limit 3        # 只处理前 3 本(试跑)
 *
 * 输出:
 *   corpus/<bookId>/*.md        章节 Markdown(front-matter 含页码)
 *   corpus/qa/<bookId>.md       逐本 QA 报告
 *   corpus/ocr-needed/<bookId>.txt  需 OCR 的页码
 *
 * 说明:没有文字层的扫描件不会伪造内容,只会进入 OCR 待办。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { emitBook } from "./emit.js";
import { extractPdf } from "./extract.js";
import { readInventory, scanPdfInventory, writeInventory } from "./inventory.js";
import { normalizeText, stripRunningHeaders } from "./normalize.js";
import { runOcr } from "./ocr.js";
import { writeQaReport } from "./qa.js";
import { DEFAULT_HEADING_PATTERN, splitSections } from "./structure.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CORPUS_DIR = path.join(ROOT, "corpus");
const MANIFEST = path.join(CORPUS_DIR, "manifest.yaml");

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function loadHeadingPattern(bookId: string): RegExp {
  const configPath = path.join(CORPUS_DIR, "config", `${bookId}.yaml`);
  if (!fs.existsSync(configPath)) return DEFAULT_HEADING_PATTERN;

  try {
    const parsed = YAML.parse(fs.readFileSync(configPath, "utf-8")) as { headingPattern?: string } | null;
    if (parsed?.headingPattern) return new RegExp(parsed.headingPattern);
  } catch (err) {
    console.warn(`[warn] 读取 ${configPath} 失败,使用默认切分规则:`, err);
  }
  return DEFAULT_HEADING_PATTERN;
}

function runInventory(): void {
  const scanned = scanPdfInventory(ROOT);
  if (fs.existsSync(MANIFEST)) {
    const existing = readInventory(MANIFEST);
    const byPdf = new Map(existing.books.map((book) => [book.pdf, book]));
    scanned.books = scanned.books.map((book) => {
      const old = byPdf.get(book.pdf);
      return old
        ? {
            ...book,
            scope: old.scope,
            textLayer: old.textLayer,
            pages: old.pages,
            duplicateOf: old.duplicateOf,
            id: old.id,
          }
        : book;
    });
  }
  writeInventory(MANIFEST, scanned);
  console.log(`台账已写入 ${MANIFEST},共 ${scanned.books.length} 本。`);
}

async function processBook(bookId: string): Promise<boolean> {
  const inventory = readInventory(MANIFEST);
  const book = inventory.books.find((entry) => entry.id === bookId);
  if (!book) throw new Error(`台账中找不到 ${bookId}`);
  if (book.scope === "exclude") {
    console.log(`跳过 ${bookId}(scope=exclude)`);
    return true;
  }

  const pdfPath = path.join(ROOT, book.pdf);
  if (!fs.existsSync(pdfPath)) throw new Error(`PDF 不存在: ${pdfPath}`);

  console.log(`\n[${bookId}] 提取 ${book.pdf}`);
  const extraction = await extractPdf(pdfPath);

  book.pages = extraction.numPages;
  book.textLayer = extraction.needsOcrPages.length / Math.max(1, extraction.numPages) > 0.02 ? "no" : "yes";

  if (extraction.needsOcrPages.length > 0) {
    const ocrDir = path.join(CORPUS_DIR, "ocr-needed");
    fs.mkdirSync(ocrDir, { recursive: true });
    fs.writeFileSync(
      path.join(ocrDir, `${bookId}.txt`),
      `# 需 OCR 页(共 ${extraction.needsOcrPages.length} 页)\n${extraction.needsOcrPages.join(", ")}\n`,
      "utf-8",
    );
  }

  const cleanedPages = stripRunningHeaders(extraction.pages);
  const sections = splitSections(cleanedPages, loadHeadingPattern(bookId)).map((section) => ({
    ...section,
    text: normalizeText(section.text),
  }));

  const emitted = emitBook(sections, {
    bookId,
    book: book.title,
    sourcePdf: book.pdf,
    outDir: CORPUS_DIR,
  });

  const qa = writeQaReport(bookId, book.title, extraction, sections, emitted, CORPUS_DIR);
  writeInventory(MANIFEST, inventory);

  console.log(
    `[${bookId}] 页 ${extraction.numPages} / 章节 ${sections.length} / 文件 ${emitted.files.length} / ` +
      `文字层 ${(qa.coverage * 100).toFixed(1)}% / QA ${qa.ok ? "通过" : "未通过"}`,
  );
  return qa.ok;
}

async function main(): Promise<void> {
  if (hasFlag("--inventory")) {
    runInventory();
    return;
  }

  if (!fs.existsSync(MANIFEST)) {
    throw new Error(`缺少 ${MANIFEST};请先运行 npm run pdf:inventory`);
  }

  const bookId = argValue("--book");
  if (bookId) {
    const ok = await processBook(bookId);
    if (!ok) process.exitCode = 1;
    return;
  }

  const ocrBookId = argValue("--ocr");
  if (ocrBookId) {
    const result = await runOcr(ocrBookId);
    console.log(
      `[${ocrBookId}] OCR 页 ${result.pages} / 章节 ${result.sections} / 字符 ${result.chars} / ` +
        `文字层 ${(result.coverage * 100).toFixed(1)}% / QA ${result.ok ? "通过" : "未通过"}`,
    );
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (hasFlag("--ocr-all")) {
    const inventory = readInventory(MANIFEST);
    const scope = argValue("--scope");
    const limit = Number.parseInt(argValue("--limit") ?? "", 10);
    const targets = inventory.books
      .filter((book) => book.scope !== "exclude" && book.textLayer !== "yes")
      .filter((book) => !scope || book.scope === scope)
      .slice(0, Number.isFinite(limit) ? limit : undefined);

    console.log(`OCR 目标: ${targets.length} 本`);
    let failed = 0;
    for (const book of targets) {
      try {
        const result = await runOcr(book.id);
        console.log(
          `[${book.id}] OCR 页 ${result.pages} / 章节 ${result.sections} / ` +
            `文字层 ${(result.coverage * 100).toFixed(1)}% / QA ${result.ok ? "通过" : "未通过"}`,
        );
        if (!result.ok) failed += 1;
      } catch (err) {
        failed += 1;
        console.error(`[${book.id}] OCR 失败:`, err instanceof Error ? err.message : err);
      }
    }
    console.log(`\nOCR 完成 ${targets.length - failed}/${targets.length};失败 ${failed}。`);
    if (failed > 0) process.exitCode = 1;
    return;
  }

  if (hasFlag("--all")) {
    const inventory = readInventory(MANIFEST);
    const limit = Number.parseInt(argValue("--limit") ?? "", 10);
    const scope = argValue("--scope");
    const targets = inventory.books
      .filter((book) => book.scope !== "exclude")
      .filter((book) => !scope || book.scope === scope)
      .slice(0, Number.isFinite(limit) ? limit : undefined);

    let failed = 0;
    for (const book of targets) {
      try {
        const ok = await processBook(book.id);
        if (!ok) failed += 1;
      } catch (err) {
        failed += 1;
        console.error(`[${book.id}] 处理失败:`, err instanceof Error ? err.message : err);
      }
    }
    console.log(`\n完成 ${targets.length - failed}/${targets.length};失败 ${failed}。`);
    if (failed > 0) process.exitCode = 1;
    return;
  }

  console.log(`用法:
  tsx tools/pdf2md/cli.ts --inventory
  tsx tools/pdf2md/cli.ts --book <id>
  tsx tools/pdf2md/cli.ts --all [--limit N]`);
}

main().catch((err) => {
  console.error("pdf2md 失败:", err instanceof Error ? err.message : err);
  process.exit(1);
});
