import { Box, Static, Text, useApp } from "ink";
import TextInput from "ink-text-input";
import { type ReactElement, useCallback, useEffect, useState } from "react";
import { agenticRag, deepAnalysis } from "../agents/index.js";
import { config } from "../config.js";
import { addMessage, clearHistory, getHistoryForContext, getRecentHistory } from "../conversation/index.js";
import { getDocumentCount, listCollections } from "../vectorstore/chroma.js";

interface TuiMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  isError?: boolean;
  meta?: string;
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

const HELP_TEXT = `你可以问：
  失眠多梦、口干舌燥、手心发热，是怎么回事？
  桂枝汤的组成和适应症是什么？
  正官格和七杀格的区别？
  印堂发暗代表什么？
  四季养生的要点？

命令：
  /deep <问题>   深度分析（结构化输出）
  /history       查看对话历史
  /status        知识库状态
  /clear         清除对话历史
  /help          显示帮助
  /exit          退出`;

export default function App(): ReactElement {
  const { exit } = useApp();
  const [messages, setMessages] = useState<TuiMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const cols = await listCollections();
        if (cols.includes(config.chromaCollectionName)) await getDocumentCount();
      } catch {
        /* not indexed */
      }
      setReady(true);
    })();
  }, []);

  const pushMsg = useCallback(
    (role: TuiMessage["role"], content: string, opts?: { isError?: boolean; meta?: string }) => {
      setMessages((prev) => [...prev, { id: nextId(), role, content, isError: opts?.isError, meta: opts?.meta }]);
    },
    [],
  );

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
        pushMsg("assistant", `错误: ${(err as Error).message}`, { isError: true });
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
        if (result.reasoning) body += `\n\n推理过程:\n${result.reasoning}`;
        if (result.suggestions?.length) {
          body += "\n\n建议:";
          for (const [i, s] of result.suggestions.entries()) body += `\n  ${i + 1}. ${s}`;
        }
        if (result.references.length > 0) {
          body += "\n\n参考来源:";
          for (const r of result.references) body += `\n  ${r.source} [${r.domain}]`;
        }
        pushMsg("assistant", body, { meta });
        addMessage({ role: "assistant", content: result.conclusion, queryType: "deep_analysis" });
      } catch (err) {
        pushMsg("assistant", `错误: ${(err as Error).message}`, { isError: true });
      }

      setLoading(false);
    },
    [pushMsg],
  );

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
            pushMsg("assistant", "知识库未索引，请运行: npm run ingest", { isError: true });
          }
        })();
        return;
      }
      if (cmd === "/clear") {
        clearHistory();
        setMessages([]);
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
          const t = `${ts.getHours().toString().padStart(2, "0")}:${ts.getMinutes().toString().padStart(2, "0")}`;
          const tag = m.queryType ? ` [${m.queryType}]` : "";
          body += `${m.role === "user" ? "问" : "答"} (${t}${tag}): ${m.content.slice(0, 300)}\n`;
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

      pushMsg("assistant", `未知命令: ${cmd}，输入 /help 查看帮助`, { isError: true });
    },
    [loading, processQuery, processDeep, pushMsg, exit],
  );

  return (
    <Box flexDirection="column">
      {!ready && (
        <Box paddingX={1}>
          <Text dimColor>初始化中...</Text>
        </Box>
      )}

      <Box flexDirection="column">
        <Static items={messages}>
          {(msg: TuiMessage) => (
            <Box key={msg.id} flexDirection="column" paddingX={1} marginBottom={1}>
              {msg.role === "user" ? (
                <Text color="cyan">
                  {">"} {msg.content}
                </Text>
              ) : msg.role === "system" ? (
                <Text dimColor>{msg.content}</Text>
              ) : (
                <Box flexDirection="column">
                  {msg.meta && <Text dimColor>{msg.meta}</Text>}
                  {msg.isError ? <Text color="yellow">{msg.content}</Text> : <Text>{msg.content}</Text>}
                </Box>
              )}
            </Box>
          )}
        </Static>
      </Box>

      {loading && (
        <Box paddingX={1}>
          <Text dimColor>分析中...</Text>
        </Box>
      )}

      <Box paddingX={1} marginTop={1}>
        <Text color="cyan">{"> "}</Text>
        <Box flexGrow={1}>
          <TextInput value={input} onChange={setInput} onSubmit={handleSubmit} />
        </Box>
      </Box>
    </Box>
  );
}
