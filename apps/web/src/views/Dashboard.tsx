import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bar, BarChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { api } from "../lib/api";
import { ago, RISK_COLORS, short, TYPOLOGY_LABELS, usd } from "../lib/format";

export default function Dashboard() {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.get("/dashboard").then(setData).catch((e) => setErr(e.message));
  }, []);

  if (err) return <div className="p-8 text-sm text-red-400">Failed to load dashboard: {err}</div>;
  if (!data) return <div className="p-8 text-sm text-slate-500">Loading dashboard…</div>;

  const k = data.kpis;
  const riskData = (Object.entries(data.riskDistribution) as [string, number][]).map(([name, value]) => ({ name, value }));
  const typoData = (Object.entries(data.typologyBreakdown) as [string, number][])
    .map(([name, value]) => ({ name: TYPOLOGY_LABELS[name] || name, value }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value);
  const chainData = (Object.entries(data.chainCoverage) as [string, number][]).map(([name, traces]) => ({ name, traces }));

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Operations Dashboard</h1>
          <p className="text-xs text-slate-500">
            Live view of tracing operations across chains · integrations:{" "}
            {Object.entries(data.integrations)
              .map(([k2, v]) => `${k2.toUpperCase()}:${String(v).replace("http://localhost:8000", "ml")}`)
              .join(" · ")}
          </p>
        </div>
        <Link to="/trace" className="btn-primary">+ New Trace</Link>
      </header>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        <Kpi label="Cases" value={k.cases} sub={`${k.openCases} open`} />
        <Kpi label="Traces run" value={k.traces} sub={`${k.completedTraces} completed`} />
        <Kpi label="Attribution rate" value={`${Math.round((k.attributionRate ?? 0) * 100)}%`} sub="exchange hits" />
        <Kpi label="Avg trace time" value={`${(k.avgTraceMs / 1000).toFixed(1)}s`} sub="seed → intel" />
        <Kpi label="Value analysed" value={usd(k.totalValueUsd)} sub="cumulative flows" />
        <Kpi label="Unacked alerts" value={k.unackedAlerts} sub={`${k.p1Alerts} × P1`} tone={k.p1Alerts > 0 ? "alert" : "normal"} />
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="panel p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Risk distribution</h2>
          <div className="h-52">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={riskData.filter((d) => d.value > 0)} dataKey="value" nameKey="name"
                  innerRadius={45} outerRadius={70} paddingAngle={3} stroke="none">
                  {riskData.filter((d) => d.value > 0).map((d) => (
                    <Cell key={d.name} fill={RISK_COLORS[d.name]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <Legend items={riskData.map((d) => ({ label: d.name, color: RISK_COLORS[d.name], value: d.value }))} />
        </section>

        <section className="panel p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Fraud typologies</h2>
          <div className="h-52">
            <ResponsiveContainer>
              <BarChart data={typoData} layout="vertical" margin={{ left: 30 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={110} tick={{ fill: "#94a3b8", fontSize: 10 }} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                <Bar dataKey="value" fill="#38bdf8" radius={[0, 4, 4, 0]} barSize={12} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="panel p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Chain coverage</h2>
          <div className="h-52">
            <ResponsiveContainer>
              <BarChart data={chainData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2a45" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                <Bar dataKey="traces" fill="#8b5cf6" radius={[4, 4, 0, 0]} barSize={36} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      {/* Recent activity */}
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="panel lg:col-span-2">
          <h2 className="border-b border-ink-800 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Recent traces
          </h2>
          <table className="w-full">
            <thead><tr><th className="th">Seed</th><th className="th">Chain</th><th className="th">Risk</th><th className="th">Attribution</th><th className="th">When</th></tr></thead>
            <tbody>
              {(data.recentTraces || []).map((t: any) => (
                <tr key={t.traceId} className="hover:bg-ink-800/40">
                  <td className="td font-mono text-xs text-slate-300">
                    <Link to={`/investigation/${t.traceId}`} className="hover:text-accent">
                      {short(t.seedAddress)}
                    </Link>
                  </td>
                  <td className="td text-xs">{t.chain}</td>
                  <td className="td text-xs font-semibold">{t.riskScore ?? "—"} {t.riskLevel ? `· ${t.riskLevel}` : ""}</td>
                  <td className="td text-xs text-emerald-400">{t.primaryVasp?.name ?? "—"}</td>
                  <td className="td text-xs text-slate-500">{ago(t.startedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="panel">
          <h2 className="border-b border-ink-800 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Live alerts
          </h2>
          <div className="max-h-72 space-y-2 overflow-y-auto p-3">
            {(data.recentAlerts || []).map((a: any) => (
              <div key={a.id} className="rounded-lg border border-ink-700 bg-ink-850 p-3">
                <div className="flex items-center justify-between">
                  <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${a.severity === "P1" ? "border-red-500/40 bg-red-500/15 text-red-400" : a.severity === "P2" ? "border-amber-500/40 bg-amber-500/15 text-amber-400" : "border-sky-500/40 bg-sky-500/15 text-sky-400"}`}>
                    {a.severity}
                  </span>
                  <span className="text-[10px] text-slate-500">{ago(a.at)}</span>
                </div>
                <div className="mt-1.5 text-xs font-semibold text-slate-200">{a.title}</div>
                <div className="mt-0.5 line-clamp-2 text-[11px] text-slate-500">{a.detail}</div>
              </div>
            ))}
            {!(data.recentAlerts || []).length && (
              <div className="p-4 text-center text-xs text-slate-500">No alerts yet — run a trace.</div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

const tooltipStyle = { background: "#0f172a", border: "1px solid #1e2a45", borderRadius: 8, fontSize: 12 };

function Kpi({ label, value, sub, tone = "normal" }: { label: string; value: any; sub?: string; tone?: string }) {
  return (
    <div className={`panel p-4 ${tone === "alert" ? "border-red-500/40" : ""}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${tone === "alert" ? "text-red-400" : "text-white"}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string; value: number }[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-3">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <span className="h-2 w-2 rounded-full" style={{ background: i.color }} />
          {i.label} ({i.value})
        </span>
      ))}
    </div>
  );
}
