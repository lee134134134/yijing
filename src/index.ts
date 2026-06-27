#!/usr/bin/env node

import readline from "readline";
import { config } from "./config.js";
import { agenticRag, deepAnalysis } from "./agents/index.js";
import { getDocumentCount, listCollections } from "./vectorstore/chroma.js";

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

function color(text: string, code: number) {
  return `\x1b[${code}m${text}\x1b[0m`;
}
const CYAN = 36, GREEN = 32, YELLOW = 33, GRAY = 90, BOLD = 1;

async function showWelcome() {
  console.log(`
${color(" 倪海厦知识库 - Agentic RAG", CYAN)}
${color(" 易经 | 天纪 | 人纪 | 命理 | 面相", GRAY)}
  `);

  try {
    const collections = await listCollections();
    if (collections.includes(config.chromaCollectionName)) {
      const count = await getDocumentCount();
      console.log(`${color("知识库:", GREEN)} ${count} 个知识块  |  ${color("模型:", GREEN)} ${config.llmModel}`);
    } else {
      console.log(`${color("知识库未索引，请运行: npm run ingest", YELLOW)}`);
    }
  } catch {
    console.log(`${color("知识库未初始化，请运行: npm run ingest", YELLOW)}`);
  }

  console.log("");
  console.log(`${color("输入问题开始咨询，或输入:", GRAY)}`);
  console.log(`  ${color("/help", CYAN)}   ${color("/exit", CYAN)}   ${color("/deep", CYAN)}   ${color("/history", CYAN)}   ${color("/status", CYAN)}   ${color("/clear", CYAN)}`);
  console.log("");
}

function showHelp() {
  console.log(`
${color("你可以问:", BOLD)}
  失眠多梦、口干舌燥、手心发热，是怎么回事？
  桂枝汤的组成和适应症是什么？
  正官格和七杀格的区别？
  印堂发暗代表什么？
  四季养生的要点？
  阴实和阳虚的区别？

${color("命令:", BOLD)}
  ${color("/deep <问题>", CYAN)}   深度分析（结构化 JSON 输出）
  ${color("/history", CYAN)}       查看对话历史
  ${color("/status", CYAN)}        知识库状态
  ${color("/clear", CYAN)}         清除对话历史
  ${color("/help", CYAN)}          帮助
  ${color("/exit", CYAN)}          退出
`);
}

let processing = false;

function safePrompt(rl: readline.Interface) {
  try { rl.prompt(); } catch { /* stdin closed */ }
}

function formatTime(ms: number): string {
  const s = (ms / 1000).toFixed(1);
  return s;
}

async function handleQuery(
  input: string,
  rl: readline.Interface,
  chatHistory: string[],
) {
  if (processing) return;

  if (!input) {
    safePrompt(rl);
    return;
  }

  const trimmed = input.trim();

  // ---- 命令处理 ----
  if (trimmed.startsWith("/")) {
    const parts = trimmed.split(/\s+/);
    const cmd = parts[0].toLowerCase();

    if (cmd === "/exit" || cmd === "/quit") {
      console.log("再见！");
      process.exit(0);
    }

    if (cmd === "/help") { showHelp(); safePrompt(rl); return; }

    if (cmd === "/status") {
      try {
        const c = await listCollections();
        if (c.includes(config.chromaCollectionName)) {
          const count = await getDocumentCount();
          console.log(`知识库: ${count} 个知识块  |  模型: ${config.llmModel}`);
        }
      } catch { console.log("知识库未初始化"); }
      safePrompt(rl);
      return;
    }

    if (cmd === "/clear") {
      chatHistory.length = 0;
      console.log(`${color("✓ 对话历史已清除", GREEN)}`);
      safePrompt(rl);
      return;
    }

    if (cmd === "/history") {
      if (chatHistory.length === 0) {
        console.log("暂无对话历史");
      } else {
        console.log(`${color("--- 对话历史 ---", BOLD)}`);
        for (const entry of chatHistory) {
          console.log(entry);
        }
        console.log(`${color("---", BOLD)}`);
      }
      safePrompt(rl);
      return;
    }

    if (cmd === "/deep") {
      const deepQuery = parts.slice(1).join(" ");
      if (!deepQuery) {
        console.log(`${color("用法: /deep <问题>", YELLOW)}`);
        safePrompt(rl);
        return;
      }

      processing = true;
      console.log(`\n${color("深度分析中...", YELLOW)}`);
      const startTime = Date.now();

      try {
        const result = await deepAnalysis(deepQuery);
        const elapsed = formatTime(Date.now() - startTime);
        console.log(`\n${color(`[深度分析] ${elapsed}s | ${result.references.length} 个参考`, GREEN)}`);
        console.log("-".repeat(50));
        console.log(color("结论:", BOLD));
        console.log(result.conclusion);
        if (result.reasoning) {
          console.log(`\n${color("推理过程:", BOLD)}`);
          console.log(result.reasoning);
        }
        if (result.suggestions && result.suggestions.length > 0) {
          console.log(`\n${color("建议:", BOLD)}`);
          result.suggestions.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
        }
        if (result.references.length > 0) {
          console.log(`\n${color("参考来源:", GRAY)}`);
          result.references.forEach((r) =>
            console.log(`  ${color(r.source, CYAN)} [${r.domain}]`)
          );
        }
        console.log("-".repeat(50));
      } catch (err) {
        console.error(`${color("错误:", YELLOW)}`, (err as Error).message);
      }

      processing = false;
      console.log("");
      safePrompt(rl);
      return;
    }

    console.log(`${color("未知命令，输入 /help 查看帮助", YELLOW)}`);
    safePrompt(rl);
    return;
  }

  // ---- 正常查询 ----
  processing = true;
  console.log(`\n${color("分析中...", GRAY)}`);
  const startTime = Date.now();

  try {
    const chatCtx = chatHistory.length > 0
      ? chatHistory.slice(-6).join("\n")
      : undefined;
    const result = await agenticRag(trimmed, chatCtx);
    const elapsed = formatTime(Date.now() - startTime);
    const label = QUERY_TYPES_LABEL[result.queryType] || "知识问答";
    console.log(`\n${color(`[${label}] ${elapsed}s | ${result.docCount} 个参考`, GREEN)}`);
    console.log("-".repeat(50));
    console.log(result.response);
    console.log("-".repeat(50));

    chatHistory.push(`${color("问:", CYAN)} ${trimmed}`);
    chatHistory.push(`${color("答:", GREEN)} ${result.response.slice(0, 200).replace(/\n/g, " ")}`);
    if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);
  } catch (err) {
    const e = err as Error;
    console.error(`${color("错误:", YELLOW)} ${e.message}`);
  }

  processing = false;
  console.log("");
  safePrompt(rl);
}

async function interactiveLoop() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "> ",
  });

  const chatHistory: string[] = [];
  await showWelcome();
  rl.prompt();

  rl.on("line", (line) => {
    handleQuery(line.trim(), rl, chatHistory);
  });

  return new Promise<void>((resolve) => {
    rl.on("close", () => resolve());
  });
}

async function singleQuery(query: string) {
  try {
    const result = await agenticRag(query);
    const label = QUERY_TYPES_LABEL[result.queryType] || "知识问答";
    console.log(`${color(`[${label}] 参考 ${result.docCount} 篇`, GREEN)}`);
    console.log("-".repeat(50));
    console.log(result.response);
  } catch (err) {
    console.error("错误:", (err as Error).message);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 0) {
    await singleQuery(args.join(" "));
  } else {
    await interactiveLoop();
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
