/** 左栏:新建对话、会话列表、服务健康与接口密钥入口 */

import { useChatStore } from "../stores/chat.js";
import { ConversationList } from "./ConversationList.js";
import { ChevronRightIcon, CloseIcon, KeyIcon, PlusIcon } from "./Icons.js";

interface SidebarProps {
  mobileOpen: boolean;
  onClose: () => void;
  onOpenKey: () => void;
}

interface SidebarBodyProps {
  onClose: () => void;
  onOpenKey: () => void;
  showClose: boolean;
}

function SidebarBody({ onClose, onOpenKey, showClose }: SidebarBodyProps) {
  const conversations = useChatStore((state) => state.conversations);
  const activeId = useChatStore((state) => state.activeId);
  const status = useChatStore((state) => state.status);
  const ready = useChatStore((state) => state.ready);
  const apiKey = useChatStore((state) => state.apiKey);
  const setView = useChatStore((state) => state.setView);
  const newConversation = useChatStore((state) => state.newConversation);
  const selectConversation = useChatStore((state) => state.selectConversation);
  const renameConversation = useChatStore((state) => state.renameConversation);
  const removeConversation = useChatStore((state) => state.removeConversation);

  const health = status?.health;
  const healthy = health
    ? health.chroma.ok && health.embedding.ok && health.llm.ok && health.manifest.ok
    : Boolean(ready?.ready);

  let healthLabel = "服务未连接";
  let healthTone = "bg-muted";
  if (status || ready) {
    if (ready && !ready.ready) {
      healthLabel = "索引未就绪";
      healthTone = "bg-cinnabar";
    } else if (!healthy) {
      healthLabel = "服务异常";
      healthTone = "bg-cinnabar";
    } else {
      healthLabel = "知识库就绪";
      healthTone = "bg-dai";
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {showClose && (
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-3 lg:hidden">
          <span className="font-serif text-[14px] tracking-[0.08em]">会话</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭会话列表"
            className="grid h-8 w-8 place-items-center rounded-[4px] text-muted hover:bg-paper-deep hover:text-ink"
          >
            <CloseIcon width={16} height={16} />
          </button>
        </div>
      )}

      <div className="shrink-0 p-3">
        <button
          type="button"
          onClick={() => {
            void newConversation();
            onClose();
          }}
          className="flex w-full items-center gap-2 rounded-[4px] border border-line-strong bg-paper-raised px-3 py-2 text-[13px] text-ink transition-colors hover:border-cinnabar hover:text-cinnabar"
        >
          <PlusIcon width={15} height={15} />
          新建对话
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-baseline justify-between px-4 pb-1.5 pt-2">
          <span className="label-caps">会话</span>
          <span className="text-[10px] tabular-nums text-muted">{conversations.length}</span>
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          <ConversationList
            variant="rail"
            conversations={conversations}
            activeId={activeId}
            onSelect={(id) => {
              void selectConversation(id);
              onClose();
            }}
            onRename={(id, title) => {
              void renameConversation(id, title);
            }}
            onRemove={(id) => {
              void removeConversation(id);
            }}
          />
        </div>
      </div>

      <div className="shrink-0 border-t border-line p-2">
        <button
          type="button"
          onClick={() => {
            setView("status");
            onClose();
          }}
          className="flex w-full items-center gap-2 rounded-[4px] px-2 py-1.5 text-left text-[11.5px] text-ink-soft transition-colors hover:bg-paper-deep/60"
          aria-label={`服务状态：${healthLabel}`}
        >
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${healthTone}`} aria-hidden="true" />
          <span className="flex-1">{healthLabel}</span>
          <ChevronRightIcon width={13} height={13} className="text-muted" />
        </button>
        <button
          type="button"
          onClick={onOpenKey}
          className="flex w-full items-center gap-2 rounded-[4px] px-2 py-1.5 text-left text-[11.5px] text-ink-soft transition-colors hover:bg-paper-deep/60"
        >
          <KeyIcon width={13} height={13} className="text-muted" />
          <span className="flex-1">接口密钥</span>
          <span className={apiKey ? "text-dai" : "text-muted"}>{apiKey ? "已设置" : "未设置"}</span>
        </button>
      </div>
    </div>
  );
}

export function Sidebar({ mobileOpen, onClose, onOpenKey }: SidebarProps) {
  return (
    <>
      <aside className="hidden w-[260px] shrink-0 border-r border-line bg-paper-sunk lg:block">
        <SidebarBody onClose={onClose} onOpenKey={onOpenKey} showClose={false} />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="关闭会话列表"
            onClick={onClose}
            className="fade-in absolute inset-0 h-full w-full bg-ink/30"
          />
          <aside className="drawer-in absolute inset-y-0 left-0 flex w-[280px] max-w-[86vw] flex-col border-r border-line-strong bg-paper-sunk">
            <SidebarBody onClose={onClose} onOpenKey={onOpenKey} showClose />
          </aside>
        </div>
      )}
    </>
  );
}
