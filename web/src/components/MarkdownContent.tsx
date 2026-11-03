/**
 * 正文 Markdown 渲染
 *
 * 回答里带 `[ref:<refId>]` 引用标记:
 * 1. 渲染前替换成 `[序号](#ref-<refId>)`,按 citations 顺序编号
 * 2. 自定义 a 渲染器把 `#ref-` 链接变成可点击上标,通知引用栏高亮
 * 3. 未知 refId 直接剔除,绝不把原始标记暴露给读者
 */

import type { ReactNode } from "react";
import { useLayoutEffect, useMemo, useRef } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import type { Citation } from "../api/types.js";

const EMPTY_CITATIONS: Citation[] = [];

interface MarkdownContentProps {
  content: string;
  citations?: Citation[];
  streaming?: boolean;
  activeRefId?: string | null;
  onCitationClick?: (refId: string) => void;
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isSeparatorRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("|") || !trimmed.includes("-")) return false;
  return /^[|\s:-]+$/.test(trimmed);
}

/**
 * react-markdown 默认只支持 CommonMark,没有 GFM 表格。
 * 这里把管道表格降级成「表头 + 条目」,避免原始 | 与 --- 直接暴露给读者。
 * 代码围栏内的内容原样保留。
 */
function normalizeTables(markdown: string): string {
  const lines = markdown.split("\n");
  const output: string[] = [];
  let inFence = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim().startsWith("```")) {
      inFence = !inFence;
      output.push(line);
      continue;
    }
    if (inFence) {
      output.push(line);
      continue;
    }

    const next = lines[index + 1] ?? "";
    if (line.includes("|") && isSeparatorRow(next) && splitRow(line).length === splitRow(next).length) {
      const header = splitRow(line);
      output.push(`**${header.map((cell) => cell || "—").join(" ｜ ")}**`);
      index += 1;

      let rows = 0;
      while (index + 1 < lines.length) {
        const candidate = lines[index + 1] ?? "";
        if (!candidate.includes("|") || candidate.trim() === "" || isSeparatorRow(candidate)) break;
        const cells = splitRow(candidate);
        output.push(
          `- ${cells
            .map((cell, cellIndex) => {
              const value = cell || "—";
              return cellIndex === 0 ? `**${value}**` : value;
            })
            .join(" ｜ ")}`,
        );
        index += 1;
        rows += 1;
      }

      if (rows > 0) output.push("");
      continue;
    }

    output.push(line);
  }

  return output.join("\n");
}

function linkCitations(content: string, citations: Citation[], streaming: boolean): string {
  const withTables = normalizeTables(content);
  // 流式输出时末尾可能只有半截 [ref / [ref:abc,先隐藏,避免闪烁出原始标记
  const text = streaming ? withTables.replace(/\[ref:[^\]\s]*$/, "").replace(/\[(?:re|ref)?$/, "") : withTables;

  return text.replace(/\[ref:([^\]\s]+)\]/g, (_match, refId: string) => {
    const index = citations.findIndex((citation) => citation.refId === refId);
    if (index < 0) return "";
    return `[${index + 1}](#ref-${encodeURIComponent(refId)})`;
  });
}

function decodeRef(href: string): string {
  const raw = href.slice("#ref-".length);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function labelOf(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") return String(children);
  return "";
}

export function MarkdownContent({
  content,
  citations,
  streaming = false,
  activeRefId,
  onCitationClick,
}: MarkdownContentProps) {
  const list = citations ?? EMPTY_CITATIONS;
  const prepared = useMemo(() => linkCitations(content, list, streaming), [content, list, streaming]);
  const containerRef = useRef<HTMLDivElement>(null);

  // 光标必须贴着最后一个字,不能落在块级元素之后,因此直接插到末段文本节点后
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    for (const node of container.querySelectorAll(".stream-caret")) node.remove();
    if (!streaming || prepared.length === 0) return;

    const caret = document.createElement("span");
    caret.className = "stream-caret";
    caret.setAttribute("aria-hidden", "true");

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let last: Text | null = null;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node as Text;
        if (text.data.trim().length > 0) last = text;
      }
    }

    if (last?.parentNode) last.parentNode.insertBefore(caret, last.nextSibling);
    else container.appendChild(caret);
  }, [prepared, streaming]);

  const components: Components = {
    a({ href, children, ...rest }) {
      if (href?.startsWith("#ref-")) {
        const refId = decodeRef(href);
        const label = labelOf(children);
        return (
          <sup className="cite-ref">
            <button
              type="button"
              aria-label={label ? `查看第 ${label} 条引用` : "查看引用"}
              aria-current={activeRefId === refId ? "true" : undefined}
              title={label ? `引用 ${label}` : "引用"}
              onClick={() => onCitationClick?.(refId)}
            >
              {children}
            </button>
          </sup>
        );
      }

      return (
        <a href={href} target="_blank" rel="noreferrer noopener" {...rest}>
          {children}
        </a>
      );
    },
    table({ children }) {
      return (
        <div className="overflow-x-auto">
          <table>{children}</table>
        </div>
      );
    },
  };

  return (
    <div ref={containerRef} className={streaming ? "doc-md doc-md--streaming" : "doc-md"}>
      <ReactMarkdown components={components} skipHtml>
        {prepared}
      </ReactMarkdown>
    </div>
  );
}
