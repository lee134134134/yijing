import { Box, Static, Text, useApp } from "ink";
import TextInput from "ink-text-input";
import { type ReactElement, useCallback, useEffect, useState } from "react";
import { agenticRag, deepAnalysis } from "../agents/index.js";
import { config } from "../config.js";
import { addMessage, clearHistory, getHistoryForContext, getRecentHistory } from "../conversation/index.js";
import { getDocumentCount, listCollections } from "../vectorstore/chroma.js";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface TuiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  isError?: boolean;
  meta?: string; // one-line metadata (type / time / doc count)
}

let msgId = 0;
const nextId = () => `m${++msgId}`;

const QUERY_TYPES_LABEL: Record<string, string> = {
  tcm_diagnosis: "中医辨证",
  tcm_prescription: "方剂药物",
  bazi_analysis: "命理八字",
  mianxiang_analysis: "面相分析",
  yijing_divination: "易经占卜",
  health_advice: "养生功法",
  general_knowledge: "知识问答",
  unknown: "未分类",
};

/* ------------------------------------------------------------------ */
/*  Header                                                             */
/* ------------------------------------------------------------------ */

function Header({ docCount, model }: { docCount: number; model: string }): ReactElement {
  return (
    <Box flexDirection="column" paddingX={1} paddingTop={1} marginBottom={1}>
      <Text bold color="cyan">
        倪海厦知识库 - Agentic RAG
      </Text>
      <Text dimColor>易经 | 天纪 | 人纪 | 命理 | 面相</Text>
      <Text color="green">
        知识库: {docCount} 个知识块 · 模型: {model}
      </Text>
    </Box>
  );
}

/* ------------------------------------------------------------------ */
/*  Spinner (loading animation)                                        */
/* ------------------------------------------------------------------ */

const SPINNER_FRAMES = ["◐", "◓", "◑", "◒"];

function Spinner(): ReactElement {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setFrame((f: number) => (f + 1) % SPINNER_FRAMES.length), 100);
    return () => clearInterval(t);
  }, []);

  return (
    <Box paddingX={1} marginBottom={1}>
      <Text color="yellow">{SPINNER_FRAMES[frame]} 分析中...</Text>
    </Box>
  );
}

/* ------------------------------------------------------------------ */
/*  Help text                                                          */
/* ------------------------------------------------------------------ */

const HELP_TEXT = `你可以问:
  失眠多梦、口干舌燥、手心发热，是怎么回事？
  桂枝汤的组成和适应症是什么？
  正官格和七杀格的区别？
  印堂发暗代表什么？
  四季养生的要点？

命令:
  /deep <问题>   深度分析（结构化输出）
  /history       查看对话历史
  /status        知识库状态
  /clear         清除对话历史
  /help          帮助
  /exit          退出`;

/* ------------------------------------------------------------------ */
/*  App                                                                */
/* ------------------------------------------------------------------ */

export default function App(): ReactElement {
  const { exit } = useApp();
  const [messages, setMessages] = useState<TuiMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [docCount, setDocCount] = useState(0);

  // ── init ───────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const cols = await listCollections();
        if (cols.includes(config.chromaCollectionName)) {
          const c = await getDocumentCount();
          setDocCount(c);
        }
      } catch {
        /* not indexed */
      }
      setReady(true);
    })();
  }, []);

  // ── helpers ──────────────────────────────────────────────────────

  const pushMsg = useCallback(
    (role: "user" | "assistant", content: string, opts?: { isError?: boolean; meta?: string }) => {
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role,
          content,
          timestamp: new Date(),
          isError: opts?.isError,
          meta: opts?.meta,
        },
      ]);
    },
    [],
  );

  // ── query processing ────────────────────────────────────────────

  const processQuery = useCallback(
    async (query: string) => {
      pushMsg("user", query);
      setLoading(true);

      try {
        addMessage({ role: "user", content: query });
        const chatCtx = getHistoryForContext(3);
        const t0 = Date.now();
        const result = await agenticRag(query, chatCtx);
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        const label = QUERY_TYPES_LABEL[result.queryType] || "知识问答";
        const meta = `${label}  ${elapsed}s  ${result.docCount} 个参考`;

        pushMsg("assistant", result.response, { meta });
        addMessage({
          role: "assistant",
          content: result.response,
          queryType: result.queryType,
          docCount: result.docCount,
        });
      } catch (err) {
        pushMsg("assistant", `错误: ${(err as Error).message}`, {
          isError: true,
        });
      }

      setLoading(false);
    },
    [pushMsg],
  );

  const processDeep = useCallback(
    async (query: string) => {
      pushMsg("user", `[深度] ${query}`);
      setLoading(true);

      try {
        addMessage({ role: "user", content: `[深度] ${query}` });
        const t0 = Date.now();
        const result = await deepAnalysis(query);
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        const meta = `深度分析  ${elapsed}s  ${result.references.length} 个参考`;

        let body = result.conclusion;
        if (result.reasoning) {
          body += `\n\n推理过程:\n${result.reasoning}`;
        }
        if (result.suggestions && result.suggestions.length > 0) {
          body += "\n\n建议:";
          for (const [i, s] of result.suggestions.entries()) {
            body += `\n  ${i + 1}. ${s}`;
          }
        }
        if (result.references.length > 0) {
          body += "\n\n参考来源:";
          for (const r of result.references) {
            body += `\n  ${r.source} [${r.domain}]`;
          }
        }

        pushMsg("assistant", body, { meta });
        addMessage({
          role: "assistant",
          content: result.conclusion,
          queryType: "deep_analysis",
        });
      } catch (err) {
        pushMsg("assistant", `错误: ${(err as Error).message}`, {
          isError: true,
        });
      }

      setLoading(false);
    },
    [pushMsg],
  );

  // ── command handler ──────────────────────────────────────────────

  const handleSubmit = useCallback(
    (text: string) => {
      if (loading || !text.trim()) return;

      const trimmed = text.trim();
      setInput("");

      if (!trimmed.startsWith("/")) {
        processQuery(trimmed);
        return;
      }

      const parts = trimmed.split(/\s+/);
      const cmd = parts[0].toLowerCase();

      if (cmd === "/exit" || cmd === "/quit") {
        exit();
        return;
      }

      if (cmd === "/help") {
        pushMsg("assistant", HELP_TEXT);
        return;
      }

      if (cmd === "/status") {
        (async () => {
          try {
            const cols = await listCollections();
            const count = cols.includes(config.chromaCollectionName) ? await getDocumentCount() : 0;
            pushMsg("assistant", `知识库: ${count} 个知识块  模型: ${config.llmModel}`);
          } catch {
            pushMsg("assistant", "知识库未初始化。请运行: npm run ingest", {
              isError: true,
            });
          }
        })();
        return;
      }

      if (cmd === "/clear") {
        clearHistory();
        setMessages([]);
        pushMsg("assistant", "对话历史已清除");
        return;
      }

      if (cmd === "/history") {
        const all = getRecentHistory();
        if (all.length === 0) {
          pushMsg("assistant", "暂无对话历史");
          return;
        }
        let body = "";
        for (const m of all) {
          const ts = new Date(m.timestamp);
          const timeStr = `${ts.getHours().toString().padStart(2, "0")}:${ts.getMinutes().toString().padStart(2, "0")}`;
          const tag = m.queryType ? ` [${m.queryType}]` : "";
          body += `${m.role === "user" ? "问" : "答"} (${timeStr}${tag}): ${m.content.slice(0, 300)}\n`;
        }
        pushMsg("assistant", body.trim());
        return;
      }

      if (cmd === "/deep") {
        const q = parts.slice(1).join(" ");
        if (!q) {
          pushMsg("assistant", "用法: /deep <问题>", { isError: true });
          return;
        }
        processDeep(q);
        return;
      }

      pushMsg("assistant", `未知命令: ${cmd}。输入 /help 查看帮助`, {
        isError: true,
      });
    },
    [loading, processQuery, processDeep, pushMsg, exit],
  );

  // ── render ──────────────────────────────────────────────────────

  return (
    <Box flexDirection="column">
      {/* ── welcome / header ── */}
      {ready && docCount > 0 && <Header docCount={docCount} model={config.llmModel} />}
      {!ready && (
        <Box paddingX={1}>
          <Text color="yellow">初始化中...</Text>
        </Box>
      )}

      {/* ── message log (Static — each item renders once) ── */}
      <Static items={messages}>
        {(msg: TuiMessage) => (
          <Box key={msg.id} flexDirection="column" paddingX={1} marginBottom={1}>
            {msg.role === "user" ? (
              <Box flexDirection="column">
                <Text color="cyan" bold>
                  {"> "}
                  {msg.content}
                </Text>
              </Box>
            ) : (
              <Box flexDirection="column">
                {msg.meta && (
                  <Text color="green" bold>
                    {"─ ".repeat(4)} {msg.meta} {" ─".repeat(4)}
                  </Text>
                )}
                <Text color={msg.isError ? "yellow" : undefined}>{msg.content}</Text>
              </Box>
            )}
          </Box>
        )}
      </Static>

      {/* ── loading indicator ── */}
      {loading && <Spinner />}

      {/* ── input area ── */}
      <Box paddingX={1} marginTop={1}>
        <Text color="green" bold>
          {"\u203A "}
        </Text>
        <Box flexGrow={1}>
          <TextInput value={input} onChange={setInput} onSubmit={handleSubmit} placeholder="/help 查看帮助" />
        </Box>
      </Box>

      {/* ── command hints ── */}
      <Box paddingX={1} marginBottom={1}>
        <Text dimColor>/help /exit /deep /history /status /clear</Text>
      </Box>
    </Box>
  );
}
