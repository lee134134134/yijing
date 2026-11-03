/**
 * 扫描件 OCR(渲染 + RapidOCR)
 *
 * - 渲染:tools/ocr/ocr.swift(macOS PDFKit;首次运行自动 swiftc 编译)
 * - 识别:tools/ocr/ocr.py(RapidOCR,支持中文竖排)
 * - 输出:corpus/ocr/<bookId>/page-XXXX.txt,断点续跑
 *
 * 依赖:
 *   python3 -m pip install --user -r tools/ocr/requirements.txt
 *   Xcode Command Line Tools(swiftc)
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { emitBook } from "./emit.js";
import type { ExtractionResult, PageText } from "./extract.js";
import { readInventory, writeInventory } from "./inventory.js";
import { normalizeText, stripRunningHeaders } from "./normalize.js";
import { writeQaReport } from "./qa.js";
import { DEFAULT_HEADING_PATTERN, splitSections } from "./structure.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CORPUS_DIR = path.join(ROOT, "corpus");
const MANIFEST = path.join(CORPUS_DIR, "manifest.yaml");
const OCR_BIN = path.join(ROOT, "tools", "ocr", "ocr");
const OCR_SWIFT = path.join(ROOT, "tools", "ocr", "ocr.swift");
const OCR_PY = path.join(ROOT, "tools", "ocr", "ocr.py");

function ensureBinary(): void {
  if (fs.existsSync(OCR_BIN)) return;
  console.log("[ocr] compiling tools/ocr/ocr.swift ...");
  execFileSync(
    "swiftc",
    ["-O", "-o", OCR_BIN, OCR_SWIFT, "-framework", "PDFKit", "-framework", "Vision", "-framework", "AppKit"],
    { stdio: "inherit" },
  );
}

function loadHeadingPattern(bookId: string): RegExp {
  const configPath = path.join(CORPUS_DIR, "config", `${bookId}.yaml`);
  if (!fs.existsSync(configPath)) return DEFAULT_HEADING_PATTERN;
  try {
    const parsed = YAML.parse(fs.readFileSync(configPath, "utf-8")) as { headingPattern?: string } | null;
    if (parsed?.headingPattern) return new RegExp(parsed.headingPattern);
  } catch (err) {
    console.warn(`[ocr] 读取 ${configPath} 失败,使用默认切分规则:`, err);
  }
  return DEFAULT_HEADING_PATTERN;
}

export interface OcrResult {
  ok: boolean;
  coverage: number;
  pages: number;
  sections: number;
  chars: number;
  needsOcr: number;
}

/** 对单本书执行 OCR 并重建章节 */
export async function runOcr(bookId: string): Promise<OcrResult> {
  const inventory = readInventory(MANIFEST);
  const book = inventory.books.find((entry) => entry.id === bookId);
  if (!book) throw new Error(`台账中找不到 ${bookId}`);
  if (book.scope === "exclude") throw new Error(`${bookId} scope=exclude,不应处理`);

  const pdfPath = path.join(ROOT, book.pdf);
  if (!fs.existsSync(pdfPath)) throw new Error(`PDF 不存在: ${pdfPath}`);

  ensureBinary();

  const textDir = path.join(CORPUS_DIR, "ocr", bookId);
  const imageDir = path.join(CORPUS_DIR, "ocr-images", bookId);
  console.log(`[ocr] ${book.title} -> ${textDir}`);
  execFileSync("python3", [OCR_PY, "--pdf", pdfPath, "--out", textDir, "--images", imageDir], {
    stdio: "inherit",
  });

  const files = fs
    .readdirSync(textDir)
    .filter((file) => /^page-\d+\.txt$/.test(file))
    .sort();

  const pages: PageText[] = files.map((file) => {
    const page = Number.parseInt(file.match(/\d+/)?.[0] ?? "0", 10);
    const text = fs.readFileSync(path.join(textDir, file), "utf-8").trim();
    return { page, text, chars: text.length, needsOcr: text.length < 10 };
  });

  const extraction: ExtractionResult = {
    pages,
    numPages: pages.length,
    needsOcrPages: pages.filter((page) => page.needsOcr).map((page) => page.page),
    totalChars: pages.reduce((sum, page) => sum + page.chars, 0),
  };

  const sections = splitSections(stripRunningHeaders(pages), loadHeadingPattern(bookId)).map((section) => ({
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

  // 同步 OCR 待办:仍有空页则写入页码,全部识别则移除旧待办
  const noteDir = path.join(CORPUS_DIR, "ocr-needed");
  const noteFile = path.join(noteDir, `${bookId}.txt`);
  if (extraction.needsOcrPages.length > 0) {
    fs.mkdirSync(noteDir, { recursive: true });
    fs.writeFileSync(
      noteFile,
      `# 需 OCR 页(共 ${extraction.needsOcrPages.length} 页)\n${extraction.needsOcrPages.join(", ")}\n`,
      "utf-8",
    );
  } else if (fs.existsSync(noteFile)) {
    fs.rmSync(noteFile, { force: true });
  }

  book.pages = extraction.numPages;
  book.textLayer = qa.coverage >= 0.98 && emitted.chars > 0 ? "yes" : "no";
  writeInventory(MANIFEST, inventory);

  return {
    ok: qa.ok,
    coverage: qa.coverage,
    pages: extraction.numPages,
    sections: sections.length,
    chars: emitted.chars,
    needsOcr: extraction.needsOcrPages.length,
  };
}
