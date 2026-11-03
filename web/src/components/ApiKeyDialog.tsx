/** 接口密钥设置:仅保存在本机 localStorage */

import { useEffect, useRef, useState } from "react";
import { useChatStore } from "../stores/chat.js";
import { CloseIcon, KeyIcon } from "./Icons.js";

interface ApiKeyDialogProps {
  open: boolean;
  onClose: () => void;
}

export function ApiKeyDialog({ open, onClose }: ApiKeyDialogProps) {
  const apiKey = useChatStore((state) => state.apiKey);
  const setApiKey = useChatStore((state) => state.setApiKey);
  const [draft, setDraft] = useState(apiKey);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(apiKey);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, [open, apiKey]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const save = () => {
    setApiKey(draft.trim());
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="关闭密钥设置浮层"
        onClick={onClose}
        className="fade-in absolute inset-0 h-full w-full bg-ink/35"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="api-key-title"
        aria-describedby="api-key-desc"
        className="relative z-10 w-full max-w-[420px] rounded-[8px] border border-line-strong bg-paper-raised p-6 shadow-[0_24px_48px_-32px_rgba(31,27,22,0.55)]"
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[4px] border border-line bg-paper text-ink-soft">
            <KeyIcon width={16} height={16} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="api-key-title" className="font-serif text-[17px] tracking-[0.04em] text-ink">
              接口密钥
            </h2>
            <p id="api-key-desc" className="mt-1.5 text-[12px] leading-6 text-muted">
              服务端开启鉴权时，请求需携带{" "}
              <code className="rounded-[4px] bg-paper-deep px-1 text-[11px]">X-API-Key</code>
              <span>。密钥只保存在本机浏览器，不会上传到别处。</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭密钥设置"
            className="-mr-1 -mt-1 grid h-7 w-7 place-items-center rounded-[4px] text-muted hover:bg-paper-deep hover:text-ink"
          >
            <CloseIcon width={14} height={14} />
          </button>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
          className="mt-5"
        >
          <label htmlFor="api-key-input" className="label-caps block">
            当前密钥
          </label>
          <input
            id="api-key-input"
            ref={inputRef}
            type="password"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={apiKey ? "已设置，输入新值可覆盖" : "未设置"}
            autoComplete="off"
            spellCheck={false}
            className="mt-2 w-full rounded-[4px] border border-line-strong bg-paper px-3 py-2 text-[13px] tracking-[0.08em] focus:border-cinnabar"
          />

          <div className="mt-5 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => {
                setApiKey("");
                onClose();
              }}
              className="text-[12px] text-muted underline-offset-4 transition-colors hover:text-cinnabar hover:underline"
            >
              清除密钥
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-[4px] border border-line-strong px-4 py-1.5 text-[12px] text-ink-soft transition-colors hover:border-muted"
              >
                取消
              </button>
              <button
                type="submit"
                className="rounded-[4px] bg-cinnabar px-4 py-1.5 text-[12px] text-paper transition-colors hover:bg-cinnabar/90"
              >
                保存
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
