/** 应用壳:顶部导航 + 左会话栏 + 当前页面(问答页内自带右侧引用栏) */

import { useEffect, useState } from "react";
import { ApiKeyDialog } from "./components/ApiKeyDialog.js";
import { ErrorBanner } from "./components/ErrorBanner.js";
import { Header } from "./components/Header.js";
import { Sidebar } from "./components/Sidebar.js";
import { useChatStore } from "./stores/chat.js";
import { ChatView } from "./views/ChatView.js";
import { DeepView } from "./views/DeepView.js";
import { HistoryView } from "./views/HistoryView.js";
import { StatusView } from "./views/StatusView.js";

export function App() {
  const view = useChatStore((state) => state.view);
  const setView = useChatStore((state) => state.setView);
  const error = useChatStore((state) => state.error);
  const clearError = useChatStore((state) => state.clearError);
  const loadConversations = useChatStore((state) => state.loadConversations);
  const refreshHealth = useChatStore((state) => state.refreshHealth);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);

  useEffect(() => {
    void loadConversations();
    void refreshHealth();
  }, [loadConversations, refreshHealth]);

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-paper text-ink">
      <Header
        view={view}
        onNavigate={(next) => {
          setView(next);
          setSidebarOpen(false);
        }}
        onOpenSidebar={() => setSidebarOpen(true)}
      />

      {error && <ErrorBanner message={error} onClose={clearError} />}

      <div className="flex min-h-0 flex-1">
        <Sidebar mobileOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} onOpenKey={() => setKeyOpen(true)} />
        <main className="min-h-0 min-w-0 flex-1">
          {view === "chat" && <ChatView />}
          {view === "deep" && <DeepView />}
          {view === "history" && <HistoryView />}
          {view === "status" && <StatusView />}
        </main>
      </div>

      <ApiKeyDialog open={keyOpen} onClose={() => setKeyOpen(false)} />
    </div>
  );
}
