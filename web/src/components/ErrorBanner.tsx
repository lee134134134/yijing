/** 顶部错误横幅:可关闭,不遮挡主流程 */

import { CloseIcon } from "./Icons.js";

interface ErrorBannerProps {
  message: string;
  onClose: () => void;
}

/** 把浏览器的网络错误翻译成可执行的中文提示 */
function friendlyMessage(message: string): string {
  if (/failed to fetch|load failed|networkerror|fetch failed/i.test(message)) {
    return "无法连接服务，请确认已运行 npm run server。";
  }
  if (/\b401\b|unauthori[sz]ed|缺少 api key/i.test(message)) {
    return "接口鉴权失败，请在左下角「接口密钥」中填写正确的密钥。";
  }
  return message.replace(/`([^`]+)`/g, "「$1」");
}

export function ErrorBanner({ message, onClose }: ErrorBannerProps) {
  return (
    <div
      role="alert"
      className="flex shrink-0 items-start gap-3 border-b border-cinnabar/25 bg-[#f2e2d8] px-4 py-2.5 text-cinnabar sm:px-6"
    >
      <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-cinnabar" />
      <p className="min-w-0 flex-1 break-words text-[12px] leading-6">{friendlyMessage(message)}</p>
      <button
        type="button"
        onClick={onClose}
        aria-label="关闭错误提示"
        className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-[4px] text-cinnabar/80 transition-colors hover:bg-cinnabar/10 hover:text-cinnabar"
      >
        <CloseIcon width={14} height={14} />
      </button>
    </div>
  );
}
