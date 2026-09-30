import { useEffect, useState } from "react";
import { api } from "../lib/api";

const TYPE_META: Record<string, { label: string; cls: string }> = {
  CEX: { label: "Exchange (CEX)", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" },
  INSTANT_SWAP: { label: "Instant swap", cls: "border-sky-500/40 bg-sky-500/10 text-sky-400" },
  MIXER: { label: "Mixer", cls: "border-purple-500/40 bg-purple-500/10 text-purple-400" },
  BRIDGE: { label: "Bridge", cls: "border-orange-500/40 bg-orange-500/10 text-orange-400" },
  DARKNET: { label: "Darknet service", cls: "border-red-500/40 bg-red-500/10 text-red-400" },
  DEX: { label: "DEX", cls: "border-slate-500/40 bg-slate-500/10 text-slate-400" },
};

export default function VaspRegistry() {
  const [vasps, setVasps] = useState<any[]>([]);
  const [type, setType] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    api.get("/vasps").then((r) => setVasps(r.vasps || [])).catch(() => {});
  }, []);

  const filtered = vasps.filter((v) =>
    (!type || v.type === type) &&
    (!q || v.name?.toLowerCase().includes(q.toLowerCase()) ||
      v.aliases?.join(" ").toLowerCase().includes(q.toLowerCase())));

  return (
    <div className="space-y-4 p-6">
      <header>
        <h1 className="text-xl font-bold text-white">VASP Registry</h1>
        <p className="text-xs text-slate-500">
          Labelled clusters of exchange hot/cold wallets, mixers, bridges and instant swaps
          powering attribution · {vasps.length} entities
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <input className="input max-w-xs" placeholder="Search VASP / alias…"
          value={q} onChange={(e) => setQ(e.target.value)} />
        <button
          className={`rounded-lg border px-3 py-1.5 text-xs ${type === "" ? "border-accent bg-accent/10 text-accent" : "border-ink-700 text-slate-400 hover:text-slate-200"}`}
          onClick={() => setType("")}>All</button>
        {Object.entries(TYPE_META).map(([t, meta]) => (
          <button key={t}
            className={`rounded-lg border px-3 py-1.5 text-xs ${type === t ? "border-accent bg-accent/10 text-accent" : "border-ink-700 text-slate-400 hover:text-slate-200"}`}
            onClick={() => setType(t)}>{meta.label}</button>
        ))}
      </div>

      <section className="panel overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-ink-800">
              <th className="th">VASP</th><th className="th">Type</th><th className="th">Jurisdiction</th>
              <th className="th">KYT risk</th><th className="th">LEA liaison</th><th className="th">Freeze channel</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((v) => (
              <tr key={v.id} className="hover:bg-ink-800/40">
                <td className="td">
                  <div className="text-xs font-semibold text-slate-200">{v.name}</div>
                  <div className="text-[10px] text-slate-600">{(v.aliases || []).join(" · ")}</div>
                </td>
                <td className="td">
                  <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${TYPE_META[v.type]?.cls || ""}`}>
                    {TYPE_META[v.type]?.label || v.type}
                  </span>
                </td>
                <td className="td text-[11px] text-slate-400">{v.jurisdiction}</td>
                <td className="td">
                  <div className="flex items-center gap-1.5">
                    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-ink-800">
                      <div className="h-full rounded-full"
                        style={{
                          width: `${(v.kytScore ?? 0) * 100}%`,
                          background: (v.kytScore ?? 0) > 0.8 ? "#ef4444" : (v.kytScore ?? 0) > 0.6 ? "#f59e0b" : "#22c55e",
                        }} />
                    </div>
                    <span className="text-[10px] text-slate-500">{Math.round((v.kytScore ?? 0) * 100)}</span>
                  </div>
                </td>
                <td className="td font-mono text-[10px] text-slate-400">{v.lealLiaison || v.leaLiaison || "—"}</td>
                <td className="td text-[10px] text-slate-500">{v.freezeContact}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
