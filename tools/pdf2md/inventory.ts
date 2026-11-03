/**
 * PDF 语料台账
 *
 * 扫描 pdf/ 目录生成/更新 corpus/manifest.yaml。
 * id 由文件名 + 路径哈希生成,保证重复书名不冲突;
 * scope 按目录区分:0611 = 倪海厦系列(core),0612 = 传统典籍(reference)。
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

export interface PdfEntry {
  id: string;
  title: string;
  pdf: string;
  scope: "core" | "reference" | "exclude";
  textLayer: "yes" | "no" | "unknown";
  pages: number;
  duplicateOf: string | null;
}

export interface Inventory {
  books: PdfEntry[];
}

function slugify(text: string): string {
  return text
    .replace(/[\s/\\:*?"<>|]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function walkPdfs(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkPdfs(full));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) files.push(full);
  }
  return files;
}

export function scanPdfInventory(root: string): Inventory {
  const pdfRoot = path.join(root, "pdf");
  const files = walkPdfs(pdfRoot);
  const books = files.map((file) => {
    const relative = path.relative(root, file).split(path.sep).join("/");
    const base = path.basename(file, path.extname(file));
    const hash = createHash("sha1").update(relative).digest("hex").slice(0, 6);
    const scope = relative.includes("/0612/") ? "reference" : "core";
    return {
      id: `${slugify(base)}-${hash}`,
      title: base,
      pdf: relative,
      scope,
      textLayer: "unknown",
      pages: 0,
      duplicateOf: null,
    } satisfies PdfEntry;
  });

  books.sort((a, b) => a.pdf.localeCompare(b.pdf, "zh-Hans-CN"));
  return { books };
}

export function writeInventory(file: string, inventory: Inventory): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const header = [
    "# 语料台账",
    "#",
    "# scope: core=倪海厦系列, reference=传统典籍, exclude=不入库",
    "# textLayer/pages 由 tools/pdf2md/cli.ts --inventory 或 --book 更新",
    "# duplicateOf: 同书多版本时填权威版本的 id",
    "",
  ].join("\n");
  fs.writeFileSync(file, `${header}${YAML.stringify(inventory, { lineWidth: 0 })}`, "utf-8");
}

export function readInventory(file: string): Inventory {
  const parsed = YAML.parse(fs.readFileSync(file, "utf-8")) as Inventory | null;
  if (!parsed || !Array.isArray(parsed.books)) {
    throw new Error(`无效的语料台账: ${file}`);
  }
  return parsed;
}

export function updateEntry(file: string, id: string, patch: Partial<PdfEntry>): void {
  const inventory = readInventory(file);
  const index = inventory.books.findIndex((book) => book.id === id);
  if (index < 0) throw new Error(`台账中找不到条目: ${id}`);
  inventory.books[index] = { ...inventory.books[index]!, ...patch };
  writeInventory(file, inventory);
}
