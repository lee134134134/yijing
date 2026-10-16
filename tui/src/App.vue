<script setup lang="ts">
/**
 * 倪海厦知识库 Agentic RAG —— 终端 TUI
 *
 * vue-termui（OpenTUI 渲染引擎）实现的中文交互式聊天界面：
 * - 顶部状态栏：知识库就绪信息 + 退出提示
 * - 中部消息日志（ScrollBox，自动跟随底部）
 * - 底部输入行：普通提问 / `/deep` 深度分析 / 命令
 *
 * 逻辑从原 React+Ink 的 src/tui/app.tsx 迁移而来，交互与命令集保持不变。
 */
import { nextTick, onMounted, onUnmounted, ref, useTemplateRef } from "vue";
import { Box, Input, ScrollBox, Text, useExit } from "vue-termui";
import { agenticRag, deepAnalysis } from "@app/agents/index.js";
import { config } from "@app/config.js";
import {
  addMessage,
  clearHistory,
  getHistoryForContext,
  getRecentHistory,
} from "@app/conversation/index.js";
import { getDocumentCount, listCollections } from "@app/vectorstore/chroma.js";

interface TuiMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  isError?: boolean;
  meta?: string;
}

let msgId = 0;
const nextId = (): string => `m${++msgId}`;

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

const exit = useExit();
const messages = ref<TuiMessage[]>([]);
const inputValue = ref("");
const inputKey = ref(0); // 提交后 remount 输入框以清空内部缓冲
const loading = ref(false);
const ready = ref(false);

const scroller = useTemplateRef<InstanceType<typeof ScrollBox>>("scroller");

/** 分析中的点动画（库的 Spinner 未在运行时导出，这里自绘）。 */
const loadingDots = ref("");
let dotsTimer: ReturnType<typeof setInterval> | undefined;

function startLoading(): void {
  loading.value = true;
  dotsTimer = setInterval(() => {
    loadingDots.value = loadingDots.value.length >= 3 ? "" : loadingDots.value + ".";
  }, 250);
}

function stopLoading(): void {
  loading.value = false;
  loadingDots.value = "";
  if (dotsTimer) {
    clearInterval(dotsTimer);
    dotsTimer = undefined;
  }
}

onUnmounted(() => {
  if (dotsTimer) clearInterval(dotsTimer);
});

/** 新消息加入后，让日志自动滚动到底部。stickyScroll 默认已跟随底部，这里做兜底。 */
function scrollToBottom(): void {
  void nextTick(() => {
    const el = scroller.value?.$el;
    if (!el || typeof (el as { scrollTo?: unknown }).scrollTo !== "function") return;
    try {
      // 类型来自 OpenTUI ScrollBoxRenderable；scrollTo 接受像素/目标位置。
      (el as unknown as { scrollTo: (target: number) => void }).scrollTo(Number.MAX_SAFE_INTEGER);
    } catch {
      /* stickyScroll 会自动跟随底部 */
    }
  });
}

function pushMsg(role: TuiMessage["role"], content: string, opts?: { isError?: boolean; meta?: string }): void {
  messages.value.push({ id: nextId(), role, content, isError: opts?.isError, meta: opts?.meta });
  scrollToBottom();
}

onMounted(async () => {
  try {
    const cols = await listCollections();
    if (cols.includes(config.chromaCollectionName)) await getDocumentCount();
  } catch {
    /* knowledge base not indexed */
  }
  ready.value = true;
});

async function processQuery(query: string): Promise<void> {
  pushMsg("user", query);
  startLoading();
  try {
    addMessage({ role: "user", content: query });
    const chatCtx = getHistoryForContext(3);
    const t0 = Date.now();
    const result = await agenticRag(query, chatCtx);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const label = QUERY_TYPES_LABEL[result.queryType] || "知识问答";
    pushMsg("assistant", result.response, {
      meta: `${label}  ${elapsed}s  ${result.docCount} 个参考`,
    });
    addMessage({
      role: "assistant",
      content: result.response,
      queryType: result.queryType,
      docCount: result.docCount,
    });
  } catch (err) {
    pushMsg("assistant", `错误: ${(err as Error).message}`, { isError: true });
  }
  stopLoading();
}

async function processDeep(query: string): Promise<void> {
  pushMsg("user", `[深度] ${query}`);
  startLoading();
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
  stopLoading();
}

function submit(rawValue: string | number | undefined): void {
  if (loading.value) return;
  const text = String(rawValue ?? inputValue.value).trim();
  if (!text) return;
  inputValue.value = "";
  inputKey.value += 1; // 强制 remount 输入框，清空 OpenTUI 内部缓冲

  if (!text.startsWith("/")) {
    void processQuery(text);
    return;
  }

  const parts = text.split(/\s+/);
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
    void (async () => {
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
    messages.value = [];
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
    void processDeep(q);
    return;
  }

  pushMsg("assistant", `未知命令: ${cmd}，输入 /help 查看帮助`, { isError: true });
}
</script>

<template>
  <Box flexDirection="column" :height="'100%'" :paddingX="1">
    <Box :marginBottom="1">
      <Text fg="cyan"> 倪海厦知识库 - Agentic RAG</Text>
      <Text dim>
        {{ config.llmModel }} |{{ ready ? " 就绪" : " 初始化中..." }}| 输入问题或
        /help，Ctrl+C 退出
      </Text>
    </Box>

    <ScrollBox ref="scroller" :flex-grow="1" scroll-y sticky-scroll sticky-start="bottom">
      <Box flexDirection="column" :gap="1">
        <Box v-for="msg in messages" :key="msg.id" flexDirection="column">
          <Text v-if="msg.role === 'user'" fg="cyan">{{ "> " + msg.content }}</Text>
          <Text v-else-if="msg.role === 'system'" dim>{{ msg.content }}</Text>
          <Box v-else flexDirection="column">
            <Text v-if="msg.meta" dim>{{ msg.meta }}</Text>
            <Text :dim="!msg.isError" :fg="msg.isError ? 'yellow' : undefined">{{ msg.content }}</Text>
          </Box>
        </Box>
      </Box>
    </ScrollBox>

    <Box :marginTop="1">
      <Text v-if="loading" dim fg="gray">分析中{{ loadingDots }}</Text>
    </Box>

    <Box :key="inputKey">
      <Text fg="cyan">&gt; </Text>
      <Input
        v-model="inputValue"
        placeholder="输入问题，回车提问；/help 查看全部命令"
        autofocus
        :flexGrow="1"
        @enter="submit"
      />
    </Box>
  </Box>
</template>