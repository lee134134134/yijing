/**
 * 章节切分(启发式)
 *
 * 43 本书结构差异很大,这里只做通用切分:
 * - 第X章/节/卷/篇
 * - 卷X
 * - 【标题】
 * - 数字编号(1、/1.）
 * 单本书可用 corpus/config/<book>.yaml 覆盖 headingPattern。
 */

import type { PageText } from "./extract.js";

export interface Section {
  title: string;
  text: string;
  pageStart: number;
  pageEnd: number;
}

export const DEFAULT_HEADING_PATTERN =
  /^(第[一二三四五六七八九十百千0-9]+[章节卷篇].*|卷[一二三四五六七八九十百千]+.*|【.+】|\d{1,3}[、.．]\s*.+)$/;

export function splitSections(pages: PageText[], headingPattern = DEFAULT_HEADING_PATTERN): Section[] {
  const sections: Section[] = [];
  let current: Section | null = null;

  const flush = (): void => {
    if (current && current.text.trim()) sections.push(current);
    current = null;
  };

  for (const page of pages) {
    if (page.needsOcr) continue;

    for (const rawLine of page.text.split("\n")) {
      const line = rawLine.trim();
      if (!line) {
        if (current) current.text += "\n";
        continue;
      }

      if (line.length <= 60 && headingPattern.test(line)) {
        flush();
        // 去掉标题尾部粘连的页码(如 "...并治法上 9")
        const title = line.replace(/[\s.·]*\d{1,4}$/, "").trim() || line;
        current = { title, text: "", pageStart: page.page, pageEnd: page.page };
        continue;
      }

      if (!current) {
        current = { title: "正文", text: "", pageStart: page.page, pageEnd: page.page };
      }
      current.text += `${line}\n`;
      current.pageEnd = page.page;
    }
  }

  flush();
  return sections;
}
