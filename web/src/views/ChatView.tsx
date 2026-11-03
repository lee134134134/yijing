/**
 * 问答页
 *
 * - 桌面:正文 + 右侧引用栏(可收起);移动端引用改为底部浮层
 * - 正文 [n] 上标点击后,引用栏高亮对应卡片
 * - 流式生成时禁用输入,提供停止按钮;耗时在客户端补充测量
 */

import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, Citation } from "../api/types.js";
import { CitationPanel } from "../components/CitationPanel.js";
import { formatClock, formatDuration, queryTypeLabel } from "../components/format.js";
import { ArrowUpIcon, ChevronRightIcon, QuoteIcon, StopIcon } from "../components/Icons.js";
import { MarkdownContent } from "../components/MarkdownContent.js";
import { useChatStore } from "../stores/chat.js";

const EMPTY_CITATIONS: Citation[] = [];

const SUGGESTIONS = [
  { question: "桂枝汤的组成", topic: "方剂", numeral: "壹" },
  { question: "失眠的中医辨证", topic: "辨证", numeral: "贰" },
  { question: "正官格和七杀格的区别", topic: "命理", numeral: "叁" },
  { question: "足三里定位", topic: "经络", numeral: "肆" },
];

interface ActiveCitation {
  messageId: string;
  refId: string;
}

export function ChatView() {
  const messages = useChatStore((state) => state.messages);
  const streaming = useChatStore((state) => state.streaming);
  const loadingMessages = useChatStore((state) => state.loadingMessages);
  const activeId = useChatStore((state) => state.activeId);
  const conversations = useChatStore((state) => state.conversations);
  const send = useChatStore((state) => state.send);
  const stop = useChatStore((state) => state.stop);

  const [draft, setDraft] = useState("");
  const [activeCitation, setActiveCitation] = useState<ActiveCitation | null>(null);
  const [railOpen, setRailOpen] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [elapsedById, setElapsedById] = useState<Record<string, number>>({});

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const streamStart = useRef<number | null>(null);

  const tail = messages[messages.length - 1];
  const tailContent = tail?.content ?? "";
  const title = conversations.find((conversation) => conversation.id === activeId)?.title ?? "新的问答";

  const lastAssistant = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message?.role === "assistant") return message;
    }
    return null;
  }, [messages]);

  const activeMessage = activeCitation
    ? messages.find((message) => message.id === activeCitation.messageId)
    : undefined;
  // 默认跟随最后一条回答:它没有引用时就是空,不退回去展示上一条的出处
  const panelMessage = activeMessage ?? lastAssistant;
  const panelCitations =
    panelMessage?.citations && panelMessage.citations.length > 0 ? panelMessage.citations : EMPTY_CITATIONS;
  const activeRefId = activeCitation?.refId ?? null;

  // 切会话时清掉上一轮的高亮与浮层
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeId 变化时重置引用高亮
  useEffect(() => {
    setActiveCitation(null);
    setSheetOpen(false);
  }, [activeId]);

  // 输入变化时自适应高度(最大 168px)
  // biome-ignore lint/correctness/useExhaustiveDependencies: draft 变化时重新计算高度
  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 168)}px`;
  }, [draft]);

  // 流式结束后按客户端时间补一条耗时(历史消息自带 latencyMs 时以它为准)
  useEffect(() => {
    if (streaming) {
      if (streamStart.current === null) streamStart.current = Date.now();
      return;
    }
    const started = streamStart.current;
    if (started === null) return;
    streamStart.current = null;

    const last = messages[messages.length - 1];
    if (!last?.content || last.role !== "assistant") return;
    const messageId = last.id;
    const measured = Date.now() - started;
    setElapsedById((previous) =>
      previous[messageId] === undefined ? { ...previous, [messageId]: measured } : previous,
    );
  }, [streaming, messages]);

  // 新消息或流式 token 到达时贴底;空态回到顶部,避免把标题顶出视口
  // biome-ignore lint/correctness/useExhaustiveDependencies: loadingMessages/tailContent 是滚动触发信号
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    if (messages.length === 0) {
      node.scrollTop = 0;
      return;
    }
    node.scrollTop = node.scrollHeight;
  }, [messages.length, tailContent, loadingMessages]);

  useEffect(() => {
    if (!sheetOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSheetOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [sheetOpen]);

  const sendText = (text: string) => {
    const query = text.trim();
    if (!query || streaming) return;
    setDraft("");
    setActiveCitation(null);
    void send(query);
  };

  const focusCitation = (messageId: string, refId: string) => {
    setActiveCitation({ messageId, refId });
    setRailOpen(true);
    // 视觉右栏在 xl 以下不渲染,改开浮层
    if (window.matchMedia("(max-width: 1279px)").matches) setSheetOpen(true);
  };

  const selectCitation = (refId: string) => {
    const messageId = panelMessage?.id;
    if (messageId) setActiveCitation({ messageId, refId });
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      sendText(draft);
    }
  };

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-4 sm:px-6">
          <h1 className="min-w-0 flex-1 truncate font-serif text-[13.5px] tracking-[0.04em] text-ink-soft">{title}</h1>
          <span className="hidden shrink-0 items-center gap-1.5 text-[10.5px] tabular-nums text-muted sm:flex">
            <span aria-hidden="true" className="h-1 w-1 rounded-full bg-line-strong" />
            {messages.length} 条消息
            {panelCitations.length > 0 && <span>· 引用 {panelCitations.length}</span>}
          </span>
          <button
            type="button"
            onClick={() => setRailOpen((open) => !open)}
            aria-label={railOpen ? "收起引用栏" : "展开引用栏"}
            aria-expanded={railOpen}
            className="hidden shrink-0 items-center gap-1 rounded-[4px] px-2 py-1 text-[11px] text-muted transition-colors hover:bg-paper-deep/60 hover:text-ink xl:inline-flex"
          >
            引用栏
            <ChevronRightIcon
              width={12}
              height={12}
              className={railOpen ? "rotate-180 transition-transform" : "transition-transform"}
            />
          </button>
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            aria-label={`查看引用，共 ${panelCitations.length} 条`}
            className="inline-flex shrink-0 items-center gap-1 rounded-[4px] border border-line px-2 py-1 text-[11px] text-ink-soft transition-colors hover:border-line-strong hover:bg-paper-deep/50 xl:hidden"
          >
            <QuoteIcon width={12} height={12} />
            引用
            <span className="tabular-nums text-muted">{panelCitations.length}</span>
          </button>
        </div>

        <div ref={scrollRef} className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          <div
            className={`mx-auto flex min-h-full w-full max-w-[760px] flex-col px-5 pb-10 pt-7 sm:px-8 ${
              messages.length === 0 && !loadingMessages ? "sm:justify-center" : ""
            }`}
          >
            {loadingMessages ? (
              <LoadingState />
            ) : messages.length === 0 ? (
              <EmptyState disabled={streaming} onPick={sendText} />
            ) : (
              <ol>
                {messages.map((message, index) => {
                  const isLast = index === messages.length - 1;
                  const isStreaming = streaming && isLast && message.role === "assistant";
                  const elapsed = message.latencyMs ?? elapsedById[message.id];
                  return (
                    <li key={message.id} className={isLast ? undefined : "mb-7 border-b border-line/60 pb-7"}>
                      <MessageBlock
                        message={message}
                        streaming={isStreaming}
                        elapsedMs={elapsed}
                        activeRefId={activeCitation?.messageId === message.id ? activeRefId : null}
                        onCitationClick={(refId) => focusCitation(message.id, refId)}
                      />
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </div>

        <div className="shrink-0 border-t border-line bg-paper">
          <div className="mx-auto w-full max-w-[760px] px-5 py-3 sm:px-8">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                sendText(draft);
              }}
              className="flex items-end gap-2 rounded-[6px] border border-line-strong bg-paper-raised px-3 py-2 transition-colors focus-within:border-cinnabar/60"
            >
              <textarea
                ref={textareaRef}
                rows={1}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onKeyDown}
                disabled={streaming}
                aria-label="输入问题"
                placeholder={streaming ? "正在生成回答，可点击停止…" : "输入你的问题，例如：失眠该如何辨证？"}
                className="max-h-[168px] min-h-[28px] flex-1 resize-none bg-transparent py-1 text-[15px] leading-7 text-ink placeholder:text-muted disabled:opacity-60"
              />
              {streaming ? (
                <button
                  type="button"
                  onClick={stop}
                  className="mb-0.5 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[4px] border border-cinnabar/60 px-3 text-[12px] text-cinnabar transition-colors hover:bg-cinnabar/5"
                >
                  <StopIcon width={12} height={12} />
                  停止
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!draft.trim()}
                  aria-label="发送问题"
                  className="mb-0.5 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[4px] bg-cinnabar px-3 text-[12px] text-paper transition-colors hover:bg-cinnabar/90 disabled:bg-cinnabar/25 disabled:text-paper/70"
                >
                  提问
                  <ArrowUpIcon width={13} height={13} />
                </button>
              )}
            </form>

            <div className="mt-2 flex items-center justify-between gap-3 text-[10.5px] text-muted">
              <span>Enter 发送 · Shift + Enter 换行</span>
              <span className="hidden sm:inline">引用以 [n] 标注</span>
            </div>
            <p className="mt-1 text-center text-[10.5px] leading-5 text-muted">内容仅供学习研究，不能替代面诊/医嘱</p>
          </div>
        </div>
      </div>

      {railOpen && (
        <aside className="hidden w-[320px] shrink-0 border-l border-line xl:block">
          <CitationPanel
            citations={panelCitations}
            activeRefId={activeRefId}
            onSelect={selectCitation}
            onClose={() => setRailOpen(false)}
          />
        </aside>
      )}

      {sheetOpen && (
        <div className="fixed inset-0 z-40 xl:hidden">
          <button
            type="button"
            aria-label="关闭引用"
            onClick={() => setSheetOpen(false)}
            className="fade-in absolute inset-0 h-full w-full bg-ink/30"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="引用列表"
            className="sheet-in absolute inset-x-0 bottom-0 h-[70dvh] overflow-hidden rounded-t-[8px] border-t border-line-strong shadow-[0_-18px_40px_-30px_rgba(31,27,22,0.6)]"
          >
            <CitationPanel
              citations={panelCitations}
              activeRefId={activeRefId}
              onSelect={selectCitation}
              onClose={() => setSheetOpen(false)}
              closeLabel="关闭引用"
            />
          </div>
        </div>
      )}
    </div>
  );
}

interface MessageBlockProps {
  message: ChatMessage;
  streaming: boolean;
  elapsedMs?: number;
  activeRefId: string | null;
  onCitationClick: (refId: string) => void;
}

function MessageBlock({ message, streaming, elapsedMs, activeRefId, onCitationClick }: MessageBlockProps) {
  const isUser = message.role === "user";
  const timestamp = new Date(message.timestamp).toISOString();

  if (isUser) {
    return (
      <article className="rise">
        <header className="mb-2.5 flex items-center gap-2">
          <span
            aria-hidden="true"
            className="grid h-5 w-5 place-items-center rounded-[4px] border border-cinnabar/50 font-serif text-[11px] leading-none text-cinnabar"
          >
            问
          </span>
          <span className="text-[10px] tracking-[0.22em] text-muted">提问</span>
          <time dateTime={timestamp} className="ml-auto text-[10px] tabular-nums text-muted">
            {formatClock(message.timestamp)}
          </time>
        </header>
        <div className="sm:pl-7">
          <p className="whitespace-pre-wrap border-l-2 border-cinnabar/30 pl-4 text-[15px] leading-[1.9] text-ink-soft">
            {message.content}
          </p>
        </div>
      </article>
    );
  }

  const citations = message.citations ?? [];

  return (
    <article className="rise">
      <header className="mb-2.5 flex items-center gap-2">
        <span
          aria-hidden="true"
          className="grid h-5 w-5 place-items-center rounded-[4px] border border-dai/50 font-serif text-[11px] leading-none text-dai"
        >
          答
        </span>
        <span className="text-[10px] tracking-[0.22em] text-muted">回答</span>
        {streaming && (
          <span className="inline-flex items-center gap-1 text-[10px] text-cinnabar">
            <span aria-hidden="true" className="h-1 w-1 animate-pulse rounded-full bg-cinnabar" />
            生成中
          </span>
        )}
        <time dateTime={timestamp} className="ml-auto text-[10px] tabular-nums text-muted">
          {formatClock(message.timestamp)}
        </time>
      </header>

      <div className="sm:pl-7">
        {message.content ? (
          <MarkdownContent
            content={message.content}
            citations={citations}
            streaming={streaming}
            activeRefId={activeRefId}
            onCitationClick={onCitationClick}
          />
        ) : streaming ? (
          <p className="text-[13px] text-muted">
            正在检索典籍
            <span aria-hidden="true" className="stream-caret ml-1.5" />
          </p>
        ) : (
          <p className="text-[13px] text-muted">(空回答)</p>
        )}

        {(message.queryType ||
          typeof message.docCount === "number" ||
          typeof elapsedMs === "number" ||
          message.degraded) && (
          <footer className="mt-4 flex flex-wrap items-center gap-x-2.5 gap-y-1 border-t border-line/60 pt-2.5 text-[10.5px] text-muted">
            {message.queryType && <span className="text-ink-soft">{queryTypeLabel(message.queryType)}</span>}
            {typeof message.docCount === "number" && (
              <>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">检索 {message.docCount} 段</span>
              </>
            )}
            {typeof elapsedMs === "number" && (
              <>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">耗时 {formatDuration(elapsedMs)}</span>
              </>
            )}
            {message.degraded && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-cinnabar">未检索到可验证来源</span>
              </>
            )}
          </footer>
        )}
      </div>
    </article>
  );
}

function EmptyState({ disabled, onPick }: { disabled: boolean; onPick: (question: string) => void }) {
  return (
    <div className="rise">
      <p className="text-[10px] tracking-[0.32em] text-cinnabar">中医 · 命理 · 辨证</p>
      <h2 className="mt-3 font-serif text-[25px] leading-[1.5] tracking-[0.02em] text-ink sm:text-[30px]">
        以典籍为据，逐条作答
      </h2>
      <p className="mt-3 max-w-[540px] text-[12.5px] leading-7 text-muted">
        <span className="block sm:inline">基于倪海厦讲稿的检索增强问答。回答标注可核对出处。</span>
        <span className="block sm:inline">点击上标即可查看原文。</span>
      </p>

      <div className="mt-8 grid gap-2.5 sm:grid-cols-2">
        {SUGGESTIONS.map((item, index) => (
          <button
            key={item.question}
            type="button"
            onClick={() => onPick(item.question)}
            disabled={disabled}
            className="rise group flex items-center gap-3 rounded-[5px] border border-line bg-paper-raised/70 px-3.5 py-3 text-left transition-colors hover:border-cinnabar/50 hover:bg-paper-raised disabled:opacity-50"
            style={{ animationDelay: `${60 + index * 40}ms` }}
          >
            <span aria-hidden="true" className="font-serif text-[11px] text-cinnabar/80">
              {item.numeral}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] text-ink-soft">{item.question}</span>
              <span className="mt-0.5 block text-[9.5px] tracking-[0.18em] text-muted">{item.topic}</span>
            </span>
            <span
              aria-hidden="true"
              className="text-[13px] text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-cinnabar"
            >
              →
            </span>
          </button>
        ))}
      </div>

      <div className="mt-8 flex items-center gap-3 text-[10px] text-muted">
        <span aria-hidden="true" className="h-px flex-1 bg-line" />
        <span>未收录的问题会明确告知，不编造出处</span>
        <span aria-hidden="true" className="h-px flex-1 bg-line" />
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-8 pt-4" aria-busy="true">
      <p className="sr-only">正在加载会话…</p>
      {[0, 1].map((row) => (
        <div key={row}>
          <div className="h-2.5 w-14 animate-pulse rounded-[4px] bg-paper-deep" />
          <div className="mt-3 h-3 w-4/5 animate-pulse rounded-[4px] bg-paper-deep" />
          <div className="mt-2 h-3 w-3/5 animate-pulse rounded-[4px] bg-paper-deep" />
        </div>
      ))}
    </div>
  );
}
