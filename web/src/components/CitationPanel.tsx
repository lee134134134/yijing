/** 引用栏内容(桌面右栏与移动端底部浮层共用) */

import { useEffect, useRef } from "react";
import type { Citation } from "../api/types.js";
import { scorePercent } from "./format.js";
import { CloseIcon, QuoteIcon } from "./Icons.js";

interface CitationPanelProps {
  citations: Citation[];
  activeRefId: string | null;
  onSelect: (refId: string) => void;
  onClose: () => void;
  closeLabel?: string;
}

export function CitationPanel({
  citations,
  activeRefId,
  onSelect,
  onClose,
  closeLabel = "收起引用栏",
}: CitationPanelProps) {
  const itemRefs = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    if (!activeRefId) return;
    const node = itemRefs.current.get(activeRefId);
    node?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeRefId]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper-sunk">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
        <QuoteIcon width={15} height={15} className="text-muted" />
        <h2 className="font-serif text-[13px] tracking-[0.16em] text-ink">引用</h2>
        <span className="text-[10px] tabular-nums text-muted">{citations.length} 条</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={closeLabel}
          className="ml-auto grid h-7 w-7 place-items-center rounded-[4px] text-muted transition-colors hover:bg-paper-deep hover:text-ink"
        >
          <CloseIcon width={14} height={14} />
        </button>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {citations.length === 0 ? (
          <div className="px-2 py-10 text-center">
            <span aria-hidden="true" className="font-serif text-[18px] text-line-strong">
              ❖
            </span>
            <p className="mt-3 text-[12px] leading-6 text-muted">
              暂无可核对的引用。
              <br />
              若回答带有出处，会按上标顺序列在这里。
            </p>
          </div>
        ) : (
          <ol className="space-y-2.5">
            {citations.map((citation, index) => {
              const active = citation.refId === activeRefId;
              const percent = scorePercent(citation.score);
              const heading =
                citation.h2 ?? citation.chapter ?? citation.h1 ?? citation.h3 ?? citation.book ?? "未标注章节";
              const pages =
                citation.pageStart !== undefined
                  ? ` · 第 ${citation.pageStart}${
                      citation.pageEnd !== undefined && citation.pageEnd !== citation.pageStart
                        ? `–${citation.pageEnd}`
                        : ""
                    } 页`
                  : "";

              return (
                <li key={citation.refId}>
                  <article
                    ref={(node) => {
                      if (node) itemRefs.current.set(citation.refId, node);
                      else itemRefs.current.delete(citation.refId);
                    }}
                    className={`rounded-[5px] border transition-colors ${
                      active
                        ? "border-cinnabar/70 bg-paper-raised shadow-[inset_2px_0_0_0_var(--color-cinnabar)]"
                        : "border-line bg-paper-raised/70 hover:border-line-strong"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(citation.refId)}
                      aria-pressed={active}
                      aria-label={`引用 ${index + 1}:${heading}`}
                      className="block w-full rounded-[5px] p-3 text-left"
                    >
                      <div className="flex items-start gap-2.5">
                        <span
                          aria-hidden="true"
                          className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-[4px] border font-serif text-[10px] tabular-nums ${
                            active ? "border-cinnabar bg-cinnabar text-paper" : "border-cinnabar/40 text-cinnabar"
                          }`}
                        >
                          {index + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="rounded-[4px] bg-dai/10 px-1.5 py-0.5 text-[10px] leading-none tracking-[0.08em] text-dai">
                              {citation.domain}
                            </span>
                            {percent !== null && (
                              <span className="inline-flex items-center gap-1.5 text-[10px] text-muted">
                                <span>相关度</span>
                                <span aria-hidden="true" className="h-px w-8 bg-line-strong">
                                  <span className="block h-px bg-dai" style={{ width: `${percent}%` }} />
                                </span>
                                <span className="tabular-nums">{percent}%</span>
                              </span>
                            )}
                          </div>

                          <h3 className="mt-1.5 line-clamp-2 font-serif text-[13px] leading-snug text-ink">
                            {heading}
                          </h3>

                          <p className="mt-1 truncate text-[10.5px] text-muted" title={citation.source}>
                            {citation.source}
                            {citation.lineRange ? ` · ${citation.lineRange}` : ""}
                            {pages}
                          </p>

                          <p className="mt-1.5 line-clamp-3 text-[11.5px] leading-[1.75] text-ink-soft">
                            {citation.snippet}
                          </p>
                        </div>
                      </div>
                    </button>
                  </article>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <div className="shrink-0 border-t border-line px-4 py-2.5">
        <p className="text-[10px] leading-5 text-muted">引用按回答中的上标顺序编号，点击正文 [n] 可定位。</p>
      </div>
    </div>
  );
}
