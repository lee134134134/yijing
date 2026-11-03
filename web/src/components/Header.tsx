/** 顶部细 header:品牌、导航、移动端入口 */

import type { View } from "../stores/chat.js";
import { MenuIcon } from "./Icons.js";

const NAV: Array<{ id: View; label: string }> = [
  { id: "chat", label: "问答" },
  { id: "deep", label: "深度分析" },
  { id: "history", label: "历史" },
  { id: "status", label: "状态" },
];

interface HeaderProps {
  view: View;
  onNavigate: (view: View) => void;
  onOpenSidebar: () => void;
}

export function Header({ view, onNavigate, onOpenSidebar }: HeaderProps) {
  return (
    <header className="relative z-30 shrink-0 border-b border-line bg-paper">
      <div className="flex h-14 items-center gap-3 px-3 sm:px-5">
        <button
          type="button"
          onClick={onOpenSidebar}
          aria-label="打开会话列表"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-[4px] border border-line text-ink-soft transition-colors hover:border-line-strong hover:bg-paper-sunk lg:hidden"
        >
          <MenuIcon width={17} height={17} />
        </button>

        <div className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden="true"
            className="grid h-8 w-8 shrink-0 -rotate-2 place-items-center rounded-[4px] bg-cinnabar font-serif text-[17px] leading-none text-paper shadow-[inset_0_0_0_1px_rgba(246,241,231,0.35)]"
          >
            倪
          </span>
          <div className="min-w-0">
            <p className="truncate font-serif text-[16px] leading-tight tracking-[0.06em] text-ink">倪海厦知识库</p>
            <p className="mt-0.5 hidden text-[9.5px] uppercase leading-none tracking-[0.3em] text-muted sm:block">
              Agentic RAG
            </p>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-5">
          <span className="hidden text-[10px] tracking-[0.2em] text-muted lg:inline">本地典籍 · 私有检索</span>
          <nav aria-label="主导航" className="hidden items-center md:flex">
            {NAV.map((item) => {
              const active = view === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onNavigate(item.id)}
                  aria-current={active ? "page" : undefined}
                  className={`relative flex h-14 items-center px-3 text-[13px] transition-colors ${
                    active ? "text-ink" : "text-muted hover:text-ink"
                  }`}
                >
                  {item.label}
                  <span
                    aria-hidden="true"
                    className={`absolute inset-x-2 bottom-0 h-[2px] transition-colors ${
                      active ? "bg-cinnabar" : "bg-transparent"
                    }`}
                  />
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      <nav aria-label="主导航" className="flex border-t border-line md:hidden">
        {NAV.map((item) => {
          const active = view === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              aria-current={active ? "page" : undefined}
              className={`flex-1 border-b-2 py-2 text-[12px] transition-colors ${
                active ? "border-cinnabar text-ink" : "border-transparent text-muted"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
