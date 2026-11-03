/**
 * PDF 文字层提取
 *
 * 使用 pdfjs-dist 的 Node 兼容构建,逐页提取文本;没有文字层的页标记 needsOcr,
 * 由 QA 报告列出,不会静默产出空章节。
 */

import fs from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export interface PageText {
  page: number;
  text: string;
  chars: number;
  needsOcr: boolean;
}

export interface ExtractionResult {
  pages: PageText[];
  numPages: number;
  needsOcrPages: number[];
  totalChars: number;
}

export async function extractPdf(pdfPath: string): Promise<ExtractionResult> {
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const loadingTask = getDocument({ data, isEvalSupported: false, useSystemFonts: true });
  const doc = await loadingTask.promise;

  const pages: PageText[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const lines: string[] = [];
      let line = "";

      for (const item of content.items) {
        if (!("str" in item)) continue;
        line += item.str;
        if (item.hasEOL) {
          lines.push(line);
          line = "";
        }
      }
      if (line) lines.push(line);

      const text = lines.join("\n").trim();
      pages.push({
        page: pageNumber,
        text,
        chars: text.length,
        needsOcr: text.length < 20,
      });
    }
  } finally {
    await loadingTask.destroy();
  }

  const needsOcrPages = pages.filter((page) => page.needsOcr).map((page) => page.page);
  return {
    pages,
    numPages: pages.length,
    needsOcrPages,
    totalChars: pages.reduce((sum, page) => sum + page.chars, 0),
  };
}
