/**
 * 状态页
 *
 * 把 /api/status 与 /ready 的检查结果摊开:向量库、嵌入、LLM、索引清单。
 * 未就绪时给出可执行的下一步(npm run ingest),而不是只显示红点。
 */

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { formatCount } from "../components/format.js";
import { RefreshIcon } from "../components/Icons.js";
import { useChatStore } from "../stores/chat.js";

export function StatusView() {
  const status = useChatStore((state) => state.status);
  const ready = useChatStore((state) => state.ready);
  const refreshHealth = useChatStore((state) => state.refreshHealth);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    void refreshHealth().finally(() => {
      if (!cancelled) setBusy(false);
    });
    return () => {
      cancelled = true;
    };
  }, [refreshHealth]);

  const runRefresh = () => {
    setBusy(true);
    void refreshHealth().finally(() => setBusy(false));
  };

  const chroma = status?.health?.chroma;
  const embedding = status?.health?.embedding;
  const llmHealth = status?.health?.llm;
  const manifest = status?.health?.manifest;
  const roles = ready?.checks.llm.roles ?? status?.llm ?? [];
  const readyChroma = ready?.checks.chroma;
  const collections = readyChroma?.collections ?? status?.collections ?? [];
  const index = status?.index;

  const isReady = ready?.ready ?? false;

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[900px] px-5 pb-16 pt-8 sm:px-8 sm:pt-10">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] tracking-[0.3em] text-cinnabar">SYSTEM</p>
            <h1 className="mt-2.5 font-serif text-[24px] leading-snug tracking-[0.03em] text-ink sm:text-[27px]">
              状态
            </h1>
            <p className="mt-2 text-[12.5px] leading-7 text-muted">
              向量库、嵌入模型、大模型与索引清单的实时检查结果。
            </p>
          </div>
          <button
            type="button"
            onClick={runRefresh}
            disabled={busy}
            className="inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-line px-3 text-[12px] text-ink-soft transition-colors hover:border-line-strong hover:bg-paper-deep/40 disabled:opacity-60"
          >
            <RefreshIcon width={13} height={13} className={busy ? "animate-spin" : undefined} />
            {busy ? "检查中…" : "重新检查"}
          </button>
        </header>

        {busy && !status && !ready ? (
          <StatusSkeleton />
        ) : !status && !ready ? (
          <div className="paper-card mt-8 p-6">
            <h2 className="font-serif text-[16px] text-ink">无法连接后端服务</h2>
            <p className="mt-2 text-[12.5px] leading-7 text-muted">
              请先在项目根目录启动 API 服务，再点击右上角重新检查。
            </p>
            <code className="mt-3 inline-block rounded-[4px] border border-line bg-paper px-2 py-1 text-[11.5px] text-ink-soft">
              npm run server
            </code>
          </div>
        ) : (
          <>
            <div className="mt-7 grid grid-cols-2 gap-x-6 gap-y-4 border-y border-line py-4 sm:flex sm:flex-wrap sm:items-center sm:gap-x-8 sm:gap-y-3">
              <div>
                <span className="label-caps block">整体状态</span>
                <span className="mt-1 flex items-center gap-1.5 text-[13px] text-ink-soft">
                  <span
                    aria-hidden="true"
                    className={`h-1.5 w-1.5 rounded-full ${isReady ? "bg-dai" : "bg-cinnabar"}`}
                  />
                  {isReady ? "已就绪" : "未就绪"}
                </span>
              </div>
              <div>
                <span className="label-caps block">索引文档</span>
                <span className="mt-1 block font-serif text-[18px] tabular-nums leading-none text-ink">
                  {formatCount(status?.docCount ?? readyChroma?.docCount ?? 0)}
                </span>
              </div>
              <div>
                <span className="label-caps block">集合</span>
                <span className="mt-1 block text-[13px] tabular-nums text-ink-soft">{collections.length}</span>
              </div>
              <div>
                <span className="label-caps block">版本</span>
                <span className="mt-1 block text-[13px] tabular-nums text-ink-soft">{status?.version ?? "—"}</span>
              </div>
              <div className="sm:ml-auto">
                <span className="label-caps block">查询改写</span>
                <span className="mt-1 block text-[13px] text-ink-soft">{status?.queryRewrite ? "已启用" : "关闭"}</span>
              </div>
            </div>

            {ready && !ready.ready && (
              <div className="mt-5 rounded-[4px] border border-cinnabar/30 bg-cinnabar/[0.04] px-4 py-3">
                <p className="text-[12px] text-cinnabar">知识库尚未就绪，问答无法返回可验证的引用。</p>
                <p className="mt-1 text-[11.5px] leading-6 text-muted">
                  在项目根目录运行{" "}
                  <code className="rounded-[4px] border border-line bg-paper px-1.5 py-0.5 text-[11px] text-ink-soft">
                    npm run ingest
                  </code>{" "}
                  重建索引，完成后点击「重新检查」。
                </p>
              </div>
            )}

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <HealthCard
                title="向量库 Chroma"
                caption="VECTOR STORE"
                ok={chroma?.ok ?? readyChroma?.chroma}
                error={chroma?.error ?? readyChroma?.error}
              >
                <Row label="地址" value={status?.chromaDbUrl ?? "—"} />
                <Row label="集合数" value={`${collections.length} 个`} />
                <Row label="清单校验" value={manifest?.ok === undefined ? "未知" : manifest.ok ? "通过" : "未通过"} />
              </HealthCard>

              <HealthCard title="嵌入模型" caption="EMBEDDING" ok={embedding?.ok}>
                <Row label="提供方" value={embedding?.provider ?? "—"} />
                <Row label="模型" value={embedding?.model ?? status?.embeddingModel ?? "—"} />
              </HealthCard>

              <HealthCard title="大模型" caption="LLM" ok={llmHealth?.ok ?? ready?.checks.llm.ok}>
                {roles.length > 0 ? (
                  <div className="space-y-2">
                    {roles.map((role) => (
                      <div
                        key={`${role.role}-${role.provider}-${role.model}`}
                        className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-line/60 pb-1.5 last:border-b-0 last:pb-0"
                      >
                        <span className="text-[11px] text-muted">{role.role}</span>
                        <span className="text-right text-[11.5px] leading-5 text-ink-soft">
                          {role.provider} / {role.model}
                          {role.jsonMode && <span className="ml-1.5 text-[10px] text-dai">JSON</span>}
                        </span>
                      </div>
                    ))}
                    {roles
                      .filter((role) => role.error)
                      .map((role) => (
                        <p key={`${role.role}-error`} className="break-words text-[10.5px] leading-5 text-cinnabar">
                          {role.role}:{role.error}
                        </p>
                      ))}
                  </div>
                ) : (
                  <p className="text-[11.5px] text-muted">未上报模型信息</p>
                )}
              </HealthCard>

              <HealthCard
                title="索引清单"
                caption="MANIFEST"
                ok={manifest?.ok ?? readyChroma?.manifest.ok}
                error={manifest?.error ?? readyChroma?.manifest.error}
              >
                <Row label="集合" value={index?.collection ?? collections[0] ?? "—"} />
                <Row label="存在" value={index === undefined ? "—" : index.exists ? "是" : "否"} />
                <Row label="文档数" value={formatCount(index?.docCount ?? status?.docCount ?? 0)} />
              </HealthCard>
            </div>

            {status && (
              <section className="mt-9">
                <h2 className="flex items-center gap-2 font-serif text-[15px] tracking-[0.08em] text-ink">
                  <span aria-hidden="true" className="h-1 w-1 rounded-full bg-cinnabar" />
                  索引概况
                </h2>
                <div className="mt-3 grid gap-x-10 sm:grid-cols-2">
                  <MetaRow label="集合名" value={collections.length > 0 ? collections.join(" / ") : "—"} />
                  <MetaRow label="文档数" value={formatCount(status.docCount)} />
                  <MetaRow label="生成模型" value={status.model} />
                  <MetaRow label="嵌入模型" value={status.embeddingModel} />
                  <MetaRow label="版本" value={status.version} />
                  <MetaRow label="分块" value={`${status.chunkSize} 字 / 重叠 ${status.chunkOverlap}`} />
                  <MetaRow label="上下文上限" value={`${formatCount(status.maxContextTokens)} tokens`} />
                  <MetaRow label="查询改写" value={status.queryRewrite ? "已启用" : "关闭"} />
                  <MetaRow label="服务地址" value={status.chromaDbUrl} />
                </div>
              </section>
            )}

            <p className="mt-8 border-t border-line pt-4 text-[10.5px] leading-6 text-muted">
              状态数据来自后端实时探测；若刚执行过 ingest，请稍等片刻再刷新。
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function HealthCard({
  title,
  caption,
  ok,
  error,
  children,
}: {
  title: string;
  caption: string;
  ok?: boolean;
  error?: string;
  children: ReactNode;
}) {
  const label = ok === undefined ? "未知" : ok ? "正常" : "异常";
  const tone =
    ok === undefined
      ? "border-line-strong text-muted"
      : ok
        ? "border-dai/40 bg-dai/[0.06] text-dai"
        : "border-cinnabar/40 bg-cinnabar/[0.06] text-cinnabar";

  return (
    <div className="paper-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-[14px] tracking-[0.04em] text-ink">{title}</h2>
          <p className="mt-0.5 text-[9.5px] tracking-[0.2em] text-muted">{caption}</p>
        </div>
        <span className={`shrink-0 rounded-[4px] border px-1.5 py-0.5 text-[10px] leading-none ${tone}`}>{label}</span>
      </div>
      <div className="mt-3 space-y-1.5 text-[12px]">{children}</div>
      {error && <p className="mt-2.5 break-words text-[10.5px] leading-5 text-cinnabar">{error}</p>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="shrink-0 text-[11px] text-muted">{label}</span>
      <span className="min-w-0 break-all text-right text-[11.5px] leading-5 text-ink-soft">{value}</span>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line/70 py-2">
      <dt className="shrink-0 text-[11.5px] text-muted">{label}</dt>
      <dd className="min-w-0 break-all text-right text-[12px] text-ink-soft">{value}</dd>
    </div>
  );
}

function StatusSkeleton() {
  return (
    <div className="mt-8 space-y-3" aria-busy="true">
      <p className="sr-only">正在检查服务状态…</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="paper-card p-4">
            <div className="h-3 w-24 animate-pulse rounded-[4px] bg-paper-deep" />
            <div className="mt-3 h-2.5 w-full animate-pulse rounded-[4px] bg-paper-deep" />
            <div className="mt-2 h-2.5 w-2/3 animate-pulse rounded-[4px] bg-paper-deep" />
          </div>
        ))}
      </div>
    </div>
  );
}
