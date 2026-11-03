/** 展示层格式化工具(纯函数,无副作用) */

const QUERY_TYPE_LABELS: Record<string, string> = {
  tcm_diagnosis: "中医辨证",
  tcm_prescription: "方剂",
  bazi_analysis: "八字命理",
  mianxiang_analysis: "相学",
  yijing_divination: "易占",
  health_advice: "养生建议",
  general_knowledge: "通识",
  deep_analysis: "深度分析",
  unknown: "未分类",
};

export function queryTypeLabel(type: string): string {
  return QUERY_TYPE_LABELS[type] ?? "常规问答";
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

export function formatClock(timestamp: number): string {
  const date = new Date(timestamp);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatFullDate(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

export function formatRelativeTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;

  if (timestamp >= startOfToday) return `今天 ${clock}`;
  if (timestamp >= startOfToday - 86_400_000) return `昨天 ${clock}`;

  const days = Math.floor((startOfToday - timestamp) / 86_400_000);
  if (days < 7) return `${days} 天前`;
  if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

/** 毫秒 → 「0.8 秒」/「420 毫秒」 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)} 毫秒`;
  return `${(ms / 1000).toFixed(1)} 秒`;
}

/** 相关度归一化到 0–100 */
export function scorePercent(score: number | undefined): number | null {
  if (typeof score !== "number" || !Number.isFinite(score)) return null;
  return Math.max(0, Math.min(100, Math.round(score * 100)));
}

export function formatCount(count: number): string {
  return count.toLocaleString("zh-CN");
}
