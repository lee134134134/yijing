/**
 * 逐本 QA 门禁
 *
 * 产出 corpus/qa/<bookId>.md:
 * - 页数、文字层覆盖率、空页(需 OCR)列表
 * - 章节数、字符数
 * - 不通过时在命令行给出明确提示
 */

import fs from "node:fs";
import path from "node:path";
import type { ExtractionResult } from "./extract.js";
import type { Section } from "./structure.js";

export interface QaResult {
  ok: boolean;
  coverage: number;
  reportPath: string;
}

export function writeQaReport(
  bookId: string,
  book: string,
  extraction: ExtractionResult,
  sections: Section[],
  emit: { files: string[]; chars: number },
  outDir: string,
): QaResult {
  const coverage =
    extraction.numPages > 0 ? (extraction.numPages - extraction.needsOcrPages.length) / extraction.numPages : 0;
  const ok = coverage >= 0.98 && emit.chars > 0;

  const lines = [
    `# QA: ${book}`,
    "",
    `- bookId: ${bookId}`,
    `- 页数: ${extraction.numPages}`,
    `- 文字层页码覆盖率: ${(coverage * 100).toFixed(1)}%`,
    `- 需 OCR 页数: ${extraction.needsOcrPages.length}`,
    `- 章节数: ${sections.length}`,
    `- 产出文件数: ${emit.files.length}`,
    `- 字符数: ${emit.chars}`,
    `- 结果: ${ok ? "通过" : "未通过（需 OCR / 人工校对）"}`,
    "",
    "## 需 OCR 页",
    "",
    extraction.needsOcrPages.length === 0
      ? "无。"
      : extraction.needsOcrPages.slice(0, 200).join(", ") + (extraction.needsOcrPages.length > 200 ? " ..." : ""),
    "",
  ];

  const qaDir = path.join(outDir, "qa");
  fs.mkdirSync(qaDir, { recursive: true });
  const reportPath = path.join(qaDir, `${bookId}.md`);
  fs.writeFileSync(reportPath, `${lines.join("\n")}\n`, "utf-8");

  return { ok, coverage, reportPath };
}
