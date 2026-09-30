import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import FlowGraph from "../components/FlowGraph";
import { api, apiOrigin, connectWs } from "../lib/api";
import { ago, NODE_COLORS, RISK_COLORS, riskBadgeClass, short, TYPOLOGY_LABELS, usd } from "../lib/format";

export default function Investigation() {
  const { traceId } = useParams();
  const [trace, setTrace] = useState<any>(null);
  const [err, setErr] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [showPath, setShowPath] = useState(true);
  const [reportHtml, setReportHtml] = useState<string | null>(null);
  const [prices, setPrices] = useState<any>(null);
  const [watchMsg, setWatchMsg] = useState<string | null>(null);

  useEffect(() => {
    api.get("/prices").then((r) => setPrices(r)).catch(() => {});
  }, []);

  const load = useCallback(() => {
    if (!traceId) return;
    api.get(`/traces/${traceId}`).then((r) => setTrace(r.trace)).catch((e) => setErr(e.message));
  }, [traceId]);

  useEffect(() => { load(); }, [load]);

  // live progress while running
  const fetchedMissing = useRef(false);
  useEffect(() => {
    if (!traceId || (trace && trace.status !== "RUNNING" && trace.status !== "QUEUED")) return;
    const close = connectWs((type, payload) => {
      if (payload?.traceId === traceId) {
        if (type === "trace_progress" && (payload.status === "COMPLETED" || payload.status === "FAILED")) {
          load();
        } else if (type === "trace_progress") {
          setTrace((t: any) => t ? { ...t, status: payload.status, stage: payload.stage,
            detail: payload.detail, progress: payload.progress } : t);
        } else if (type === "trace_completed" || type === "trace_failed") {
          load();
        }
      }
    });
    return close;
  }, [traceId, trace?.status]);

  // safety: terminal status but result not yet in state (e.g. completed
  // between navigation and WS subscription) — fetch it once
  useEffect(() => {
    if (trace && (trace.status === "COMPLETED" || trace.status === "FAILED") && !trace.result
        && !fetchedMissing.current) {
      fetchedMissing.current = true;
      const t = setTimeout(load, 600);
      return () => clearTimeout(t);
    }
  }, [trace?.status, trace?.result, load]);

  const primary = trace?.result?.primaryAttribution;
  const assets = useMemo(
    () => Array.from(new Set<string>((trace?.result?.edges || []).map((e: any) => e.asset).filter(Boolean))).sort(),
    [trace?.result?.edges],
  );
  const [assetFilter, setAssetFilter] = useState<string>("");
  const primaryHit = useMemo(() => {
    if (!primary || !trace?.result) return null;
    return (trace.result.vaspHits || []).find((h: any) => h.vaspId === primary.vaspId) || null;
  }, [trace, primary]);

  if (err) return <div className="p-8 text-sm text-red-400">Failed to load trace: {err}</div>;
  if (!trace) return <div className="p-8 text-sm text-slate-500">Loading trace…</div>;

  const running = trace.status === "RUNNING" || trace.status === "QUEUED";
  const result = trace.result;
  const risk = result?.risk;
  const summary = result?.summary;

  const openReport = async () => {
    const resp = await fetch(`${apiOrigin()}/api/v1/traces/${traceId}/report.html`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("tracex.token")}` },
    });
    const html = await resp.text();
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
  };

  return (
    <div className="space-y-5 p-6">
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold text-white">Investigation — {trace.chain}</h1>
            <span className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${riskBadgeClass(risk?.level)}`}>
              {risk ? `${risk.score}/100 ${risk.level}` : trace.status}
            </span>
            {trace.mode && (
              <span className="rounded border border-ink-700 bg-ink-850 px-2 py-0.5 text-[10px] uppercase text-slate-500">
                {trace.mode === "live" ? "◉ live chain data" : "▣ simulation mode"}
              </span>
            )}
            {prices?.prices && (
              <span className="rounded border border-ink-700 bg-ink-850 px-2 py-0.5 font-mono text-[10px] text-slate-400"
                title={`live ${prices.source} prices${prices.stale ? " (stale)" : ""}`}>
                {Object.entries(prices.prices)
                  .filter(([a]) => a === trace.chain || a === "USDT")
                  .map(([a, px]) => `${a} $${Number(px).toLocaleString(undefined, { maximumFractionDigits: 0 })}`)
                  .join(" · ")}
              </span>
            )}
          </div>
          <div className="mt-1 font-mono text-xs text-slate-400">{trace.seedAddress}</div>
          <div className="text-[11px] text-slate-600">
            trace {trace.id} · started {ago(trace.startedAt)}
            {trace.durationMs ? ` · completed in ${(trace.durationMs / 1000).toFixed(1)}s` : ""}
          </div>
          {watchMsg && <div className="mt-1 text-[11px] text-accent">◈ {watchMsg}</div>}
        </div>
        <div className="flex gap-2">
          {result && (
            <>
              <button className="btn-ghost" onClick={() => setShowPath((v) => !v)}>
                {showPath ? "Show full graph" : "Highlight attribution path"}
              </button>
              <button className="btn-ghost"
                onClick={async () => {
                  try {
                    await api.post("/watchlist", {
                      address: trace.seedAddress, chain: trace.chain,
                      note: `seed of trace ${trace.id}`, caseId: trace.caseId || undefined,
                    });
                    setWatchMsg("seed wallet pinned to watchlist — poller active");
                  } catch (ex: any) {
                    setWatchMsg(ex?.message || "watchlist add failed");
                  }
                }}>
                ◎ Watch seed
              </button>
              <button className="btn-ghost" onClick={openReport}>⬇ Report (PDF)</button>
              <a className="btn-ghost"
                 href={`${apiOrigin()}/api/v1/traces/${traceId}/report.csv`}
                 onClick={async (e) => {
                   e.preventDefault();
                   const resp = await fetch(`${apiOrigin()}/api/v1/traces/${traceId}/report.csv`, {
                     headers: { Authorization: `Bearer ${localStorage.getItem("tracex.token")}` },
                   });
                   const text = await resp.text();
                   const blob = new Blob([text], { type: "text/csv" });
                   const a = document.createElement("a");
                   a.href = URL.createObjectURL(blob);
                   a.download = `tracex-fundflow-${traceId}.csv`;
                   a.click();
                 }}>
                CSV
              </a>
            </>
          )}
        </div>
      </header>

      {/* Live progress */}
      {running && (
        <section className="panel border-accent/40 p-4">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-semibold text-accent">◈ {trace.stage} — {trace.detail}</span>
            <span className="text-slate-500">{trace.progress}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-ink-800">
            <div className="h-full rounded-full bg-accent transition-all duration-500"
              style={{ width: `${trace.progress}%` }} />
          </div>
        </section>
      )}

      {trace.status === "FAILED" && (
        <section className="panel border-red-500/40 p-4 text-sm text-red-400">
          Trace failed: {trace.detail}
        </section>
      )}

      {result && (
        <>
          {/* Attribution + risk row */}
          <div className="grid gap-4 lg:grid-cols-3">
            <section className="panel border-emerald-500/30 p-4 lg:col-span-2">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-emerald-400">
                Nearest exchange / VASP attribution
              </h2>
              {primary ? (
                <div className="flex flex-wrap items-center gap-5">
                  <div>
                    <div className="text-2xl font-black text-white">{primary.name}</div>
                    <div className="text-[11px] text-slate-500">
                      {primary.vaspType} · deposit wallet {short(primary.wallet, 10, 6)}
                    </div>
                  </div>
                  <Stat label="Confidence" value={`${Math.round((primary.confidence ?? 0) * 100)}%`} accent="#22c55e" />
                  <Stat label="Hops from seed" value={primary.pathDepth} />
                  <Stat label="Exposure" value={usd(primary.totalValueUsd)} />
                  <div className="ml-auto max-w-xs rounded-lg border border-ink-700 bg-ink-850 p-2.5">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      Explainable path
                    </div>
                    <div className="mt-1 font-mono text-[10px] leading-relaxed text-accent">
                      {(primaryHit?.path || [trace.seedAddress]).map((p: string, i: number) => (
                        <span key={i}>
                          {i > 0 && <span className="text-slate-600"> → </span>}
                          <button className="hover:text-white" onClick={() => setSelected(p)}>
                            {short(p, 6, 4)}
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-500">
                  No exchange deposit wallet within the current hop budget — see recommendations.
                </p>
              )}
            </section>

            <section className="panel p-4">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                Risk &amp; typology
              </h2>
              <div className="flex items-center gap-4">
                <div className="relative flex h-20 w-20 items-center justify-center">
                  <svg viewBox="0 0 36 36" className="h-20 w-20 -rotate-90">
                    <circle cx="18" cy="18" r="15.5" fill="none" stroke="#1e2a45" strokeWidth="4" />
                    <circle cx="18" cy="18" r="15.5" fill="none"
                      stroke={RISK_COLORS[risk?.level] || "#38bdf8"} strokeWidth="4"
                      strokeDasharray={`${(risk?.score ?? 0) * 0.974} 100`} strokeLinecap="round" />
                  </svg>
                  <div className="absolute text-center">
                    <div className="text-xl font-black text-white">{risk?.score}</div>
                    <div className="text-[9px] uppercase text-slate-500">{risk?.level}</div>
                  </div>
                </div>
                <div className="text-sm">
                  <div className="font-semibold text-slate-200">
                    {TYPOLOGY_LABELS[risk?.typology] || risk?.typology}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    typology confidence {Math.round((risk?.typologyConfidence ?? 0) * 100)}%
                  </div>
                  <div className="mt-1 text-[10px] text-slate-600">model {risk?.modelVersion}</div>
                </div>
              </div>
            </section>
          </div>

          {/* Value timeline */}
          <Timeline edges={result.edges || []} />

          {/* Graph + inspector */}
          <div className="grid gap-4 xl:grid-cols-3">
            <section className="panel p-3 xl:col-span-2">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Fund-flow graph
                </h2>
                <div className="flex items-center gap-2">
                  {(assets.length > 1) && (
                    <select className="input !h-7 !w-auto !py-0 text-[11px]"
                      value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)}>
                      <option value="">All assets ({assets.length})</option>
                      {assets.map((a) => <option key={a} value={a}>{a}</option>)}
                    </select>
                  )}
                  <span className="text-[11px] text-slate-500">
                    {summary?.totalAddresses} wallets · {summary?.totalTransactions} txns · click a node to inspect
                  </span>
                </div>
              </div>
              <FlowGraph
                result={result}
                selectedId={selected}
                onSelect={setSelected}
                path={showPath ? primaryHit?.path ?? null : null}
                assetFilter={assetFilter}
              />
            </section>

            <div className="space-y-4">
              {/* Node inspector */}
              <section className="panel p-4">
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Node inspector
                </h2>
                {selected ? (
                  <NodeInspector result={result} address={selected}
                    onLabel={(msg) => setWatchMsg(msg)} />
                ) : (
                  <p className="text-xs text-slate-500">Click any node in the graph to inspect it.</p>
                )}
              </section>

              {/* Patterns */}
              <section className="panel p-4">
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Detected laundering patterns
                </h2>
                <div className="space-y-2">
                  {(result.patterns || []).map((p: any, i: number) => (
                    <div key={i} className="rounded-lg border border-ink-700 bg-ink-850 p-2.5">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-purple-500/15 px-1.5 py-0.5 text-[10px] font-bold text-purple-400">
                          {p.type.replace(/_/g, " ")}
                        </span>
                      </div>
                      <div className="mt-1 text-[11px] leading-relaxed text-slate-400">{p.detail}</div>
                    </div>
                  ))}
                  {!(result.patterns || []).length && (
                    <p className="text-xs text-slate-500">No laundering patterns flagged.</p>
                  )}
                </div>
              </section>

              {/* Recommendations */}
              <section className="panel p-4">
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Investigative recommendations
                </h2>
                <ol className="list-decimal space-y-1.5 pl-4 text-[11px] leading-relaxed text-slate-400">
                  {(result.recommendations || []).map((r: string, i: number) => (
                    <li key={i}>{r}</li>
                  ))}
                </ol>
              </section>
            </div>
          </div>

          {/* VASP hit table + risk factors */}
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="panel">
              <h2 className="border-b border-ink-800 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                All VASP hits
              </h2>
              <table className="w-full">
                <thead><tr><th className="th">VASP</th><th className="th">Chain</th><th className="th">Hops</th><th className="th">Confidence</th><th className="th">Exposure</th></tr></thead>
                <tbody>
                  {(result.vaspHits || []).map((h: any) => (
                    <tr key={h.vaspId} className="hover:bg-ink-800/40">
                      <td className="td text-xs font-semibold text-slate-200">{h.name}</td>
                      <td className="td text-xs">{h.chain}</td>
                      <td className="td text-xs">{h.pathDepth}</td>
                      <td className="td text-xs text-emerald-400">{Math.round(h.confidence * 100)}%</td>
                      <td className="td text-xs">{usd(h.totalValueUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="panel">
              <h2 className="border-b border-ink-800 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                Risk factors (explainable)
              </h2>
              <table className="w-full">
                <thead><tr><th className="th">Factor</th><th className="th">Impact</th><th className="th">Detail</th></tr></thead>
                <tbody>
                  {(risk?.factors || []).map((f: any, i: number) => (
                    <tr key={i}>
                      <td className="td text-xs font-semibold text-slate-300">{f.factor}</td>
                      <td className="td text-xs font-bold" style={{ color: f.impact >= 0 ? "#f87171" : "#4ade80" }}>
                        +{f.impact}
                      </td>
                      <td className="td text-[11px] text-slate-500">{f.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>

          {reportHtml && <div />}
        </>
      )}
    </div>
  );
}

function Timeline({ edges }: { edges: any[] }) {
  const txns = edges
    .filter((e) => e.timestamp && e.valueUsd > 0)
    .sort((a, b) => a.timestamp - b.timestamp);
  if (txns.length < 2) return null;

  const t0 = txns[0].timestamp;
  const t1 = txns[txns.length - 1].timestamp;
  const span = Math.max(1, t1 - t0);
  const buckets = 28;
  const perBucket = Array.from({ length: buckets }, () => 0);
  let maxBucket = 0;
  for (const e of txns) {
    const b = Math.min(buckets - 1, Math.floor(((e.timestamp - t0) / span) * buckets));
    perBucket[b] += e.valueUsd;
    maxBucket = Math.max(maxBucket, perBucket[b]);
  }
  const spanDays = span / 86_400_000;
  const spanLabel = spanDays >= 1 ? `${spanDays.toFixed(1)} days` : `${Math.round(span / 3600000)} hours`;
  const first = txns[0].timestamp ? new Date(t0).toISOString().slice(0, 10) : "";
  const last = new Date(t1).toISOString().slice(0, 10);

  return (
    <section className="panel p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Value timeline</h2>
        <span className="text-[10px] text-slate-600">
          {txns.length} txns across {spanLabel} · {first} → {last}
        </span>
      </div>
      <div className="flex h-16 items-end gap-0.5">
        {perBucket.map((v, i) => (
          <div key={i} className="group relative flex-1">
            <div className="w-full rounded-sm bg-accent/50 transition-colors group-hover:bg-accent"
              style={{ height: `${Math.max(2, (v / (maxBucket || 1)) * 60)}px` }}
              title={`$${Math.round(v).toLocaleString()}`} />
          </div>
        ))}
      </div>
    </section>
  );
}

function Stat({ label, value, accent }: { label: string; value: any; accent?: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-lg font-bold" style={{ color: accent || "#f1f5f9" }}>{value}</div>
    </div>
  );
}

function NodeInspector({ result, address, onLabel }: { result: any; address: string; onLabel?: (msg: string) => void }) {
  const node = (result.nodes || []).find((n: any) => n.id === address);
  const inEdges = (result.edges || []).filter((e: any) => e.target === address);
  const outEdges = (result.edges || []).filter((e: any) => e.source === address);
  const [showLabel, setShowLabel] = useState(false);
  const [labelName, setLabelName] = useState("");
  const [labelKind, setLabelKind] = useState("exchange");
  const [busy, setBusy] = useState(false);
  if (!node) return <p className="text-xs text-slate-500">{short(address, 12, 8)}</p>;

  const watch = async () => {
    setBusy(true);
    try {
      await api.post("/watchlist", { address, chain: node.chain || "BTC", note: `from trace ${result.seedAddress}` });
      onLabel?.("added to watchlist — poller will monitor for new movements");
    } catch (ex: any) { onLabel?.(ex?.message || "watchlist add failed"); }
    setBusy(false);
  };

  const saveLabel = async () => {
    setBusy(true);
    try {
      await api.post("/labels", { address, name: labelName.trim(), kind: labelKind });
      onLabel?.(`label saved: ${labelName.trim()} (${labelKind})`);
      setShowLabel(false);
      setLabelName("");
    } catch (ex: any) { onLabel?.(ex?.message || "label failed"); }
    setBusy(false);
  };

  return (
    <div className="space-y-2.5 text-xs">
      <div className="flex items-center gap-2">
        <span className="h-3 w-3 rounded-full" style={{ background: NODE_COLORS[node.type] }} />
        <span className="font-mono text-[11px] text-slate-200">{short(node.id, 14, 10)}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Tag>{node.chain}</Tag>
        <Tag>{node.type}</Tag>
        {node.vaspId && <Tag tone="emerald">VASP: {node.vaspId}</Tag>}
        {node.id === result.seedAddress && <Tag tone="red">victim-reported seed</Tag>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <MiniStat label="Inflow" value={usd(node.totalInUsd)} />
        <MiniStat label="Outflow" value={usd(node.totalOutUsd)} />
        <MiniStat label="Txns seen" value={node.txCount} />
        <MiniStat label="Cluster" value={short(node.cluster, 4, 4)} />
      </div>
      <div className="flex gap-1.5">
        <button className="btn-ghost !px-2 !py-1 text-[10px]" onClick={watch} disabled={busy}>◎ Watch</button>
        <button className="btn-ghost !px-2 !py-1 text-[10px]" onClick={() => setShowLabel((v) => !v)}>🏷 Label entity</button>
      </div>
      {showLabel && (
        <div className="space-y-1.5 rounded border border-ink-800 bg-ink-850 p-2">
          <input className="input !h-7 text-[11px]" placeholder="Entity name — e.g. Binance hot wallet 3"
            value={labelName} onChange={(e) => setLabelName(e.target.value)} />
          <select className="input !h-7 text-[11px]" value={labelKind} onChange={(e) => setLabelKind(e.target.value)}>
            {["exchange", "mixer", "bridge", "darknet", "scam", "instswap", "other"].map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
          <button className="btn-primary !h-7 w-full !px-2 text-[10px]" onClick={saveLabel} disabled={busy || !labelName.trim()}>
            {busy ? "Saving…" : "Save to registry"}
          </button>
        </div>
      )}
      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Transactions
        </div>
        <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
          {[...inEdges.map((e: any) => ({ ...e, dir: "in" })),
            ...outEdges.map((e: any) => ({ ...e, dir: "out" }))]
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, 12)
            .map((e: any, i: number) => (
              <div key={i} className="flex items-center justify-between rounded border border-ink-800 bg-ink-850 px-2 py-1 font-mono text-[10px]">
                <span className={e.dir === "in" ? "text-emerald-400" : "text-sky-400"}>
                  {e.dir === "in" ? "←" : "→"} {short(e.dir === "in" ? e.source : e.target, 5, 4)}
                </span>
                <span className="text-slate-400">{e.asset} {usd(e.valueUsd)}</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

function Tag({ children, tone }: { children: React.ReactNode; tone?: string }) {
  const cls = tone === "emerald" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
    : tone === "red" ? "border-red-500/40 bg-red-500/10 text-red-400"
    : "border-ink-700 bg-ink-850 text-slate-400";
  return <span className={`rounded border px-1.5 py-0.5 text-[10px] ${cls}`}>{children}</span>;
}

function MiniStat({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded border border-ink-800 bg-ink-850 p-2">
      <div className="text-[9px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-xs font-semibold text-slate-200">{value}</div>
    </div>
  );
}
