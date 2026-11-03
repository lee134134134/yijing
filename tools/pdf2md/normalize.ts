/**
 * 文本清洗
 *
 * PDF 抽取常见问题:汉字之间被插入空格、独立页码行、过多空行。
 * 只做保守清洗,不合并断行(避免把药方剂量粘错)。
 */

import type { PageText } from "./extract.js";

/**
 * 去除跨页重复的页眉/页脚与固定声明
 *
 * 扫描件/电子书常见:每页重复书名、日期、免责声明。按"出现在 >=30% 页"判定,
 * 再叠加页码/日期/免责声明的正则,避免把正文误删。
 */
export function stripRunningHeaders(pages: PageText[]): PageText[] {
  const counts = new Map<string, number>();
  for (const page of pages) {
    const unique = new Set(
      page.text
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 2 && line.length < 80),
    );
    for (const line of unique) counts.set(line, (counts.get(line) ?? 0) + 1);
  }

  const threshold = Math.max(3, Math.floor(pages.length * 0.3));
  const repeated = new Set(
    [...counts.entries()].filter(([, count]) => count >= threshold).map(([line]) => line),
  );

  return pages.map((page) => ({
    ...page,
    text: page.text
      .split("\n")
      .filter((line) => {
        const trimmed = line.trim();
        if (!trimmed) return true;
        if (repeated.has(trimmed)) return false;
        if (/^第\s*\d+\s*页$/.test(trimmed)) return false;
        if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return false;
        if (/^根据相关法律.*电子版/.test(trimmed)) return false;
        return true;
      })
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  }));
}

/** 正文清洗:压缩空白、去掉汉字间空格、删除页码行 */
export function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/([\u3400-\u4dbf\u4e00-\u9fff])\s+([\u3400-\u4dbf\u4e00-\u9fff])/g, "$1$2")
    .split("\n")
    .filter((line) => !/^\s*\d{1,4}\s*$/.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
