/**
 * 会话列表(左栏 rail / 历史页 page 两种密度)
 *
 * 重命名与删除都在原地完成,不弹通用确认框:
 * 删除采用两步确认,避免误触丢失会话。
 */

import { useState } from "react";
import type { Conversation } from "../api/types.js";
import { formatFullDate, formatRelativeTime } from "./format.js";
import { EditIcon, TrashIcon } from "./Icons.js";

interface ConversationListProps {
  conversations: Conversation[];
  activeId?: string | null;
  variant: "rail" | "page";
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onRemove: (id: string) => void;
  emptyHint?: string;
}

export function ConversationList({
  conversations,
  activeId,
  variant,
  onSelect,
  onRename,
  onRemove,
  emptyHint = "还没有会话，从一次提问开始。",
}: ConversationListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const startRename = (conversation: Conversation) => {
    setEditingId(conversation.id);
    setDraftTitle(conversation.title);
    setConfirmId(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraftTitle("");
  };

  const commitRename = () => {
    if (!editingId) return;
    const title = draftTitle.trim();
    if (title) onRename(editingId, title);
    cancelEdit();
  };

  const cancelDelete = () => setConfirmId(null);

  const confirmDelete = (id: string) => {
    onRemove(id);
    setConfirmId(null);
  };

  if (conversations.length === 0) {
    return <p className="px-3 py-8 text-center text-[12px] leading-6 text-muted">{emptyHint}</p>;
  }

  if (variant === "page") {
    return (
      <div>
        <div className="hidden grid-cols-[44px_minmax(0,1fr)_150px_88px_76px] items-center gap-3 border-b border-line bg-paper-deep/40 px-4 py-2 text-[9.5px] tracking-[0.18em] text-muted sm:grid">
          <span>序号</span>
          <span>会话</span>
          <span>更新时间</span>
          <span>消息</span>
          <span className="text-right">操作</span>
        </div>
        <ul className="border-b border-line">
          {conversations.map((conversation, index) => {
            const active = conversation.id === activeId;
            const editing = editingId === conversation.id;
            const confirming = confirmId === conversation.id;

            if (editing) {
              return (
                <li key={conversation.id} className="border-b border-line bg-paper-raised px-4 py-3 last:border-b-0">
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      commitRename();
                    }}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <input
                      // 就地编辑时自动聚焦,便于键盘流
                      // biome-ignore lint/a11y/noAutofocus: 就地重命名需要自动聚焦
                      autoFocus
                      value={draftTitle}
                      onChange={(event) => setDraftTitle(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") cancelEdit();
                      }}
                      aria-label="会话标题"
                      className="min-w-0 flex-1 rounded-[4px] border border-line-strong bg-paper px-2.5 py-1.5 text-[13px] focus:border-cinnabar"
                    />
                    <button
                      type="submit"
                      className="rounded-[4px] bg-cinnabar px-3 py-1.5 text-[12px] text-paper hover:bg-cinnabar/90"
                    >
                      保存
                    </button>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      className="rounded-[4px] border border-line-strong px-3 py-1.5 text-[12px] text-ink-soft hover:border-muted"
                    >
                      取消
                    </button>
                  </form>
                </li>
              );
            }

            if (confirming) {
              return (
                <li key={conversation.id} className="border-b border-line bg-paper-deep/60 px-4 py-3 last:border-b-0">
                  {/* biome-ignore lint/a11y/useSemanticElements: 确认操作组 */}
                  <div
                    className="flex flex-wrap items-center gap-3"
                    role="group"
                    aria-label={`确认删除 ${conversation.title}`}
                  >
                    <p className="min-w-0 flex-1 truncate text-[12px] text-ink-soft">
                      删除「{conversation.title}」及其消息？此操作不可撤销。
                    </p>
                    <button
                      type="button"
                      onClick={() => confirmDelete(conversation.id)}
                      className="rounded-[4px] bg-cinnabar px-3 py-1.5 text-[12px] text-paper hover:bg-cinnabar/90"
                    >
                      删除
                    </button>
                    <button
                      type="button"
                      onClick={cancelDelete}
                      className="rounded-[4px] border border-line-strong px-3 py-1.5 text-[12px] text-ink-soft hover:border-muted"
                    >
                      取消
                    </button>
                  </div>
                </li>
              );
            }

            return (
              <li
                key={conversation.id}
                className={`group border-b border-line transition-colors last:border-b-0 ${
                  active ? "bg-paper-deep/50" : "hover:bg-paper-deep/30"
                }`}
              >
                <div className="grid grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 sm:grid-cols-[44px_minmax(0,1fr)_150px_88px_76px]">
                  <span className="font-serif text-[12px] tabular-nums text-muted" aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <button
                    type="button"
                    onClick={() => onSelect(conversation.id)}
                    aria-current={active ? "true" : undefined}
                    className="min-w-0 text-left"
                  >
                    <span className={`block truncate text-[14px] leading-6 ${active ? "text-ink" : "text-ink-soft"}`}>
                      {conversation.title || "未命名对话"}
                    </span>
                    <span className="mt-0.5 flex items-center gap-2 text-[11px] text-muted sm:hidden">
                      <span>{formatRelativeTime(conversation.updatedAt)}</span>
                      <span aria-hidden="true">·</span>
                      <span>{conversation.messageCount} 条</span>
                    </span>
                  </button>
                  <time
                    dateTime={new Date(conversation.updatedAt).toISOString()}
                    title={formatFullDate(conversation.updatedAt)}
                    className="hidden text-[11px] tabular-nums text-muted sm:block"
                  >
                    {formatRelativeTime(conversation.updatedAt)}
                  </time>
                  <span className="hidden text-[11px] tabular-nums text-muted sm:block">
                    {conversation.messageCount} 条
                  </span>
                  <div className="flex justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => startRename(conversation)}
                      aria-label={`重命名 ${conversation.title}`}
                      className="grid h-7 w-7 place-items-center rounded-[4px] text-muted transition-colors hover:bg-paper-deep hover:text-ink"
                    >
                      <EditIcon width={15} height={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmId(conversation.id);
                        setEditingId(null);
                      }}
                      aria-label={`删除 ${conversation.title}`}
                      className="grid h-7 w-7 place-items-center rounded-[4px] text-muted transition-colors hover:bg-cinnabar/10 hover:text-cinnabar"
                    >
                      <TrashIcon width={15} height={15} />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <ul className="space-y-0.5">
      {conversations.map((conversation) => {
        const active = conversation.id === activeId;
        const editing = editingId === conversation.id;
        const confirming = confirmId === conversation.id;

        if (editing) {
          return (
            <li key={conversation.id} className="border-l-2 border-cinnabar bg-paper-deep/60 px-2.5 py-2">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  commitRename();
                }}
              >
                <input
                  // biome-ignore lint/a11y/noAutofocus: 就地重命名需要自动聚焦
                  autoFocus
                  value={draftTitle}
                  onChange={(event) => setDraftTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") cancelEdit();
                  }}
                  aria-label="会话标题"
                  className="w-full rounded-[4px] border border-line-strong bg-paper-raised px-2 py-1 text-[12.5px] focus:border-cinnabar"
                />
                <div className="mt-1.5 flex gap-2 text-[11px]">
                  <button type="submit" className="text-cinnabar hover:underline">
                    保存
                  </button>
                  <button type="button" onClick={cancelEdit} className="text-muted hover:text-ink">
                    取消
                  </button>
                </div>
              </form>
            </li>
          );
        }

        if (confirming) {
          return (
            <li key={conversation.id} className="border-l-2 border-cinnabar bg-paper-deep/60 px-2.5 py-2">
              {/* biome-ignore lint/a11y/useSemanticElements: 确认操作组 */}
              <div role="group" aria-label={`确认删除 ${conversation.title}`}>
                <p className="text-[11.5px] leading-5 text-ink-soft">删除这个会话？消息将一并移除。</p>
                <div className="mt-1.5 flex gap-2 text-[11px]">
                  <button
                    type="button"
                    onClick={() => confirmDelete(conversation.id)}
                    className="text-cinnabar hover:underline"
                  >
                    删除
                  </button>
                  <button type="button" onClick={cancelDelete} className="text-muted hover:text-ink">
                    取消
                  </button>
                </div>
              </div>
            </li>
          );
        }

        return (
          <li
            key={conversation.id}
            className={`group relative border-l-2 transition-colors ${
              active ? "border-cinnabar bg-paper-deep/70" : "border-transparent hover:bg-paper-deep/40"
            }`}
          >
            <button
              type="button"
              onClick={() => onSelect(conversation.id)}
              aria-current={active ? "true" : undefined}
              className="block w-full px-3 py-2.5 pr-14 text-left"
            >
              <span className={`block truncate text-[13px] leading-5 ${active ? "text-ink" : "text-ink-soft"}`}>
                {conversation.title || "未命名对话"}
              </span>
              <span className="mt-1 flex items-center gap-1.5 text-[10.5px] tabular-nums text-muted">
                <time
                  dateTime={new Date(conversation.updatedAt).toISOString()}
                  title={formatFullDate(conversation.updatedAt)}
                >
                  {formatRelativeTime(conversation.updatedAt)}
                </time>
                <span aria-hidden="true">·</span>
                <span>{conversation.messageCount} 条</span>
              </span>
            </button>
            <div className="absolute right-1 top-1.5 flex items-center gap-0.5 opacity-100 transition-opacity lg:opacity-0 lg:group-focus-within:opacity-100 lg:group-hover:opacity-100">
              <button
                type="button"
                onClick={() => startRename(conversation)}
                aria-label={`重命名 ${conversation.title}`}
                className="grid h-6 w-6 place-items-center rounded-[4px] text-muted transition-colors hover:bg-paper hover:text-ink"
              >
                <EditIcon width={13} height={13} />
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmId(conversation.id);
                  setEditingId(null);
                }}
                aria-label={`删除 ${conversation.title}`}
                className="grid h-6 w-6 place-items-center rounded-[4px] text-muted transition-colors hover:bg-paper hover:text-cinnabar"
              >
                <TrashIcon width={13} height={13} />
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
