/**
 * 产出 Markdown 章节
 *
 * 输出:corpus/<bookId>/<序号>-<章节>.md
 * front-matter 供 src/ingestion/corpus-loader.ts 读取。
 */

import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { Section } from "./structure.js";

export interface EmitOptions {
  bookId: string;
  book: string;
  sourcePdf: string;
  outDir: string;
}

function slugify(text: string): string {
  return text
    .replace(/[\s/\\:*?"<>|]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

export function emitBook(sections: Section[], options: EmitOptions): { files: string[]; chars: number } {
  const dir = path.join(options.outDir, options.bookId);
  // 重跑时清空本书旧产物,避免残留章节
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const files: string[] = [];
  let chars = 0;

  sections.forEach((section, index) => {
    const text = section.text.trim();
    if (text.length < 20) return;

    const slug = slugify(section.title) || `section-${index + 1}`;
    const file = path.join(dir, `${String(index + 1).padStart(3, "0")}-${slug}.md`);
    const frontMatter = YAML.stringify({
      book: options.book,
      bookId: options.bookId,
      chapter: section.title,
      pageStart: section.pageStart,
      pageEnd: section.pageEnd,
      sourcePdf: options.sourcePdf,
      layer: "fulltext",
    });

    fs.writeFileSync(file, `---\n${frontMatter}---\n\n# ${section.title}\n\n${text}\n`, "utf-8");
    files.push(file);
    chars += text.length;
  });

  return { files, chars };
}
