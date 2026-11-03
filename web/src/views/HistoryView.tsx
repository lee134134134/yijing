/** 历史页:全部会话的检视与整理入口 */

import { useEffect } from "react";
import { ConversationList } from "../components/ConversationList.js";
import { PlusIcon, RefreshIcon } from "../components/Icons.js";
import { useChatStore } from "../stores/chat.js";

export function HistoryView() {
  const conversations = useChatStore((state) => state.conversations);
  const activeId = useChatStore((state) => state.activeId);
  const loadConversations = useChatStore((state) => state.loadConversations);
  const selectConversation = useChatStore((state) => state.selectConversation);
  const renameConversation = useChatStore((state) => state.renameConversation);
  const removeConversation = useChatStore((state) => state.removeConversation);
  const newConversation = useChatStore((state) => state.newConversation);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[860px] px-5 pb-16 pt-8 sm:px-8 sm:pt-10">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] tracking-[0.3em] text-cinnabar">ARCHIVE</p>
            <h1 className="mt-2.5 font-serif text-[24px] leading-snug tracking-[0.03em] text-ink sm:text-[27px]">
              历史会话
            </h1>
            <p className="mt-2 text-[12.5px] leading-7 text-muted">
              共 {conversations.length} 个会话。点击任意一条继续追问，或就地重命名、删除。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                void loadConversations();
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-line px-3 text-[12px] text-ink-soft transition-colors hover:border-line-strong hover:bg-paper-deep/40"
            >
              <RefreshIcon width={13} height={13} />
              刷新
            </button>
            <button
              type="button"
              onClick={() => {
                void newConversation();
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-[4px] bg-cinnabar px-3 text-[12px] text-paper transition-colors hover:bg-cinnabar/90"
            >
              <PlusIcon width={13} height={13} />
              新建对话
            </button>
          </div>
        </header>

        {conversations.length === 0 ? (
          <div className="mt-10 border-t border-line pt-12 text-center">
            <span aria-hidden="true" className="font-serif text-[20px] text-line-strong">
              ❖
            </span>
            <h2 className="mt-3 font-serif text-[19px] text-ink">尚无记录</h2>
            <p className="mx-auto mt-2 max-w-[360px] text-[12.5px] leading-7 text-muted">
              提出问题后，会话会自动保存在本地数据库。也可以先新建一个空会话。
            </p>
            <button
              type="button"
              onClick={() => {
                void newConversation();
              }}
              className="mt-6 inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-line-strong px-4 text-[12px] text-ink-soft transition-colors hover:border-cinnabar hover:text-cinnabar"
            >
              <PlusIcon width={13} height={13} />
              新建对话
            </button>
          </div>
        ) : (
          <div className="mt-7 overflow-hidden rounded-[6px] border border-line bg-paper-raised">
            <ConversationList
              variant="page"
              conversations={conversations}
              activeId={activeId}
              onSelect={(id) => {
                void selectConversation(id);
              }}
              onRename={(id, title) => {
                void renameConversation(id, title);
              }}
              onRemove={(id) => {
                void removeConversation(id);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
