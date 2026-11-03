/**
 * 深度分析页
 *
 * 一次请求完成多轮检索与推演;结果为结论 + 推理 + 建议 + 参考来源 + 置信度。
 */

import type { ReactNode } from "react";
import { useState } from "react";
import { formatDuration } from "../components/format.js";
import { ArrowUpIcon } from "../components/Icons.js";
import { MarkdownContent } from "../components/MarkdownContent.js";
import { useChatStore } from "../stores/chat.js";

const SCENES = [
  "需要综合多个章节才能回答的复杂辨证",
  "八字格局、用神与流年的组合判断",
  "症状、舌脉与情志线索互相矛盾时的取舍",
];

export function DeepView() {
  const deep = useChatStore((state) => state.deep);
  const deepLoading = useChatStore((state) => state.deepLoading);
  const runDeep = useChatStore((state) => state.runDeep);
  const [draft, setDraft] = useState("");

  const submit = () => {
    const query = draft.trim();
    if (!query || deepLoading) return;
    void runDeep(query);
  };

  const confidence = deep ? Math.max(0, Math.min(100, Math.round(deep.confidence * 100))) : 0;

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[820px] px-5 pb-16 pt-8 sm:px-8 sm:pt-10">
        <header>
          <p className="text-[10px] tracking-[0.3em] text-cinnabar">DEEP ANALYSIS</p>
          <h1 className="mt-2.5 font-serif text-[24px] leading-snug tracking-[0.03em] text-ink sm:text-[27px]">
            深度分析
          </h1>
          <p className="mt-2.5 max-w-[600px] text-[12.5px] leading-7 text-muted">
            调用检索与推演代理，围绕一个问题多轮取证、交叉核对后给出结论。适合没有单一标准答案的复杂问题。
          </p>
        </header>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          className="paper-card mt-7 p-4"
        >
          <label htmlFor="deep-query" className="label-caps block">
            分析问题
          </label>
          <textarea
            id="deep-query"
            rows={3}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit();
              }
            }}
            disabled={deepLoading}
            placeholder="描述一个需要综合判断的问题，例如：结合舌脉与情志,分析长期失眠的证型与调治思路。"
            className="mt-2 max-h-[200px] w-full resize-none rounded-[4px] border border-line bg-paper px-3 py-2.5 text-[14px] leading-7 text-ink placeholder:text-muted focus:border-cinnabar disabled:opacity-60"
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[10.5px] text-muted">多轮检索耗时较长 · ⌘ / Ctrl + Enter 提交</p>
            <button
              type="submit"
              disabled={!draft.trim() || deepLoading}
              className="inline-flex h-8 items-center gap-1.5 rounded-[4px] bg-cinnabar px-4 text-[12px] text-paper transition-colors hover:bg-cinnabar/90 disabled:bg-cinnabar/25 disabled:text-paper/70"
            >
              {deepLoading ? "推演中…" : "开始分析"}
              {!deepLoading && <ArrowUpIcon width={13} height={13} />}
            </button>
          </div>
        </form>

        {deepLoading && <DeepLoading />}

        {!deepLoading && deep && (
          <div className="fade-in mt-9 space-y-9">
            <div className="flex items-end justify-between gap-4 border-b border-line pb-3">
              <h2 className="font-serif text-[16px] tracking-[0.08em] text-ink">分析结果</h2>
              <span className="text-[10.5px] tabular-nums text-muted">耗时 {formatDuration(deep.elapsed)}</span>
            </div>

            <section>
              <div className="flex items-baseline justify-between gap-4">
                <span className="label-caps">置信度</span>
                <span className="font-serif text-[18px] tabular-nums text-ink">{confidence}%</span>
              </div>
              <div
                role="progressbar"
                aria-label="置信度"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={confidence}
                className="mt-2 h-[3px] w-full bg-paper-deep"
              >
                <div className="h-full bg-dai transition-[width] duration-200" style={{ width: `${confidence}%` }} />
              </div>

              <div className="mt-4 rounded-[6px] border border-l-[3px] border-line border-l-cinnabar bg-paper-raised p-5">
                <p className="mb-2 text-[10px] tracking-[0.24em] text-cinnabar">结论</p>
                <p className="whitespace-pre-wrap font-serif text-[16.5px] leading-[1.95] text-ink">
                  {deep.conclusion}
                </p>
              </div>
            </section>

            <section>
              <SectionTitle>推理过程</SectionTitle>
              <MarkdownContent content={deep.reasoning} />
            </section>

            {deep.suggestions && deep.suggestions.length > 0 && (
              <section>
                <SectionTitle>调治建议</SectionTitle>
                <ol className="space-y-2.5">
                  {deep.suggestions.map((suggestion, index) => (
                    <li key={suggestion} className="flex gap-3 text-[13.5px] leading-7 text-ink-soft">
                      <span className="mt-[3px] shrink-0 font-serif text-[11px] tabular-nums text-cinnabar">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span>{suggestion}</span>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {deep.references.length > 0 && (
              <section>
                <SectionTitle>参考来源</SectionTitle>
                <ul className="border-y border-line">
                  {deep.references.map((reference, index) => (
                    <li
                      key={`${reference.source}-${reference.content.slice(0, 16)}`}
                      className="border-b border-line px-1 py-3 last:border-b-0"
                    >
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className="font-serif text-[11px] tabular-nums text-cinnabar">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <span className="text-[12.5px] text-ink-soft">{reference.source}</span>
                        <span className="rounded-[4px] bg-dai/10 px-1.5 py-0.5 text-[10px] leading-none text-dai">
                          {reference.domain}
                        </span>
                      </div>
                      <p className="mt-1.5 line-clamp-3 text-[11.5px] leading-6 text-muted">{reference.content}</p>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <p className="border-t border-line pt-4 text-[10.5px] leading-6 text-muted">
              内容仅供学习研究，不能替代面诊/医嘱。置信度反映检索结果的一致程度,不代表临床结论。
            </p>
          </div>
        )}

        {!deepLoading && !deep && (
          <div className="fade-in mt-10 border-t border-line pt-6">
            <p className="label-caps">适合的场景</p>
            <ul className="mt-3 space-y-2.5">
              {SCENES.map((scene, index) => (
                <li key={scene} className="flex gap-3 text-[12.5px] leading-6 text-ink-soft">
                  <span className="font-serif text-[11px] tabular-nums text-cinnabar">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span>{scene}</span>
                </li>
              ))}
            </ul>
            <p className="mt-5 text-[11px] leading-6 text-muted">
              深度分析不会沿用问答会话；每次分析独立成篇，引用会列在结果末尾。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="mb-3 flex items-center gap-2 font-serif text-[15px] tracking-[0.08em] text-ink">
      <span aria-hidden="true" className="h-1 w-1 rounded-full bg-cinnabar" />
      {children}
    </h3>
  );
}

function DeepLoading() {
  return (
    <div className="paper-card mt-9 p-6" aria-busy="true">
      <p className="sr-only">正在检索典籍并推演…</p>
      <div className="flex items-center gap-2 text-[12px] text-muted">
        <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-cinnabar" />
        正在检索典籍并推演，通常需要数十秒…
      </div>
      <div className="mt-5 space-y-2.5">
        <div className="h-3 w-4/5 animate-pulse rounded-[4px] bg-paper-deep" />
        <div className="h-3 w-3/5 animate-pulse rounded-[4px] bg-paper-deep" />
        <div className="h-3 w-2/3 animate-pulse rounded-[4px] bg-paper-deep" />
      </div>
      <div className="mt-6 space-y-2">
        <div className="h-2.5 w-full animate-pulse rounded-[4px] bg-paper-deep" />
        <div className="h-2.5 w-11/12 animate-pulse rounded-[4px] bg-paper-deep" />
      </div>
    </div>
  );
}
