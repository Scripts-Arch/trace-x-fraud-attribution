import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, connectWs } from "../lib/api";
import { ago, riskBadgeClass, short, usd } from "../lib/format";

export default function BatchView() {
  const { batchId } = useParams();
  const [agg, setAgg] = useState<any>(null);
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    if (!batchId) return;
    api.get(`/batches/${batchId}`).then(setAgg).catch((e) => setErr(e.message));
  }, [batchId]);

  useEffect(() => { load(); }, [load]);

  // live: refresh as each member trace completes / fails
  useEffect(() => {
    if (!batchId) return;
    return connectWs((type, payload) => {
      if (type === "batch_progress" && payload?.batchId === batchId) load();
      if (type === "trace_completed" || type === "trace_failed") load();
    });
  }, [batchId, load]);

  if (err) return <div className="p-8 text-sm text-red-400">Failed to load batch: {err}</div>;
  if (!agg) return <div className="p-8 text-sm text-slate-500">Loading batch…</div>;

  const { batch, traces, aggregate } = agg;
  const done = aggregate.completed;
  const pct = aggregate.traces ? Math.round((done / aggregate.traces) * 100) : 0;

  return (
    <div className="space-y-5 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-white">Batch {batch.id}</h1>
          <div className="text-[11px] text-slate-500">
            created {ago(batch.createdAt)} · {aggregate.traces} trace{aggregate.traces === 1 ? "" : "s"}
            {batch.rejected.length ? ` · ${batch.rejected.length} rejected at intake` : ""}
            {batch.typologyHint ? ` · typology hint ${batch.typologyHint}` : ""}
          </div>
        </div>
        <Link className="btn-ghost" to="/trace">＋ New trace</Link>
      </header>

      {/* intake rejections */}
      {!!batch.rejected.length && (
        <section className="panel border-amber-500/30 p-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-400">
            Rejected at intake — {batch.rejected.length}
          </h2>
          <div className="space-y-1 font-mono text-[10px]">
            {batch.rejected.map((r: any, i: number) => (
              <div key={i} className="text-slate-400">
                <span className="text-red-400">✗</span> {r.address.slice(0, 44)}{r.address.length > 44 ? "…" : ""}
                <span className="text-slate-600"> — {r.reason}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* aggregate KPIs */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Attribution rate" accent="#22c55e"
          value={`${Math.round((aggregate.attributionRate || 0) * 100)}%`}
          sub={`${aggregate.attributed}/${aggregate.traces} attributed`} />
        <Kpi label="Total exposure" accent="#38bdf8"
          value={usd(aggregate.totalValueUsd)}
          sub={`${aggregate.completed}/${aggregate.traces} traces done`} />
        <Kpi label="Highest risk"
          value={(() => {
            const order = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
            const top = order.find((l) => (aggregate.riskDist as any)[l] > 0);
            return top || "—";
          })()}
          sub={Object.entries(aggregate.riskDist).filter(([, n]) => (n as number) > 0)
            .map(([l, n]) => `${l} ${n}`).join(" · ") || "no completed traces"} />
        <Kpi label="Progress" accent="#a855f7" value={`${pct}%`} sub={`${done} of ${aggregate.traces} complete`} />
      </div>

      {pct < 100 && pct > 0 && (
        <div className="h-1.5 overflow-hidden rounded-full bg-ink-800">
          <div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
      )}

      {/* per-VASP exposure */}
      {!!aggregate.vaspExposure.length && (
        <section className="panel">
          <h2 className="border-b border-ink-800 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Consolidated exchange exposure
          </h2>
          <table className="w-full">
            <thead><tr><th className="th">VASP</th><th className="th">Traces hitting</th><th className="th">Total exposure</th><th className="th">Peak confidence</th></tr></thead>
            <tbody>
              {aggregate.vaspExposure.map((v: any) => (
                <tr key={v.vaspId} className="hover:bg-ink-800/40">
                  <td className="td text-xs font-semibold text-slate-200">{v.name}</td>
                  <td className="td text-xs">{v.traces}</td>
                  <td className="td text-xs text-emerald-400">{usd(v.totalUsd)}</td>
                  <td className="td text-xs">{Math.round(v.maxConfidence * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* member traces */}
      <section className="panel overflow-hidden">
        <h2 className="border-b border-ink-800 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Batch members
        </h2>
        <table className="w-full">
          <thead><tr><th className="th">Seed</th><th className="th">Chain</th><th className="th">Status</th><th className="th">Risk</th><th className="th">Attribution</th><th className="th">Value</th><th className="th"></th></tr></thead>
          <tbody>
            {traces.map((t: any) => (
              <tr key={t.traceId} className="hover:bg-ink-800/40">
                <td className="td font-mono text-[11px] text-slate-300" title={t.seedAddress}>{short(t.seedAddress, 10, 6)}</td>
                <td className="td text-xs">{t.chain}</td>
                <td className="td text-[11px] text-slate-400">{t.mode ? (t.riskScore != null ? "COMPLETED" : "RUNNING") : "RUNNING"}</td>
                <td className="td">
                  {t.riskLevel
                    ? <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${riskBadgeClass(t.riskLevel)}`}>{t.riskScore}</span>
                    : <span className="text-slate-600">—</span>}
                </td>
                <td className="td text-xs text-emerald-400">{t.primaryVasp?.name || "—"}</td>
                <td className="td text-xs">{usd(t.totalValueUsd)}</td>
                <td className="td text-right">
                  {t.riskScore != null && (
                    <Link className="btn-ghost !px-2 !py-1 text-[10px]" to={`/investigation/${t.traceId}`}>Open</Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Kpi({ label, value, sub, accent }: { label: string; value: any; sub?: string; accent?: string }) {
  return (
    <div className="panel p-4">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-black" style={{ color: accent || "#f1f5f9" }}>{value}</div>
      {sub && <div className="text-[10px] text-slate-600">{sub}</div>}
    </div>
  );
}
