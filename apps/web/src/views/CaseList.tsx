import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { ago, riskBadgeClass, short, usd } from "../lib/format";

export default function CaseList() {
  const [cases, setCases] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<any | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [note, setNote] = useState("");

  const load = () => api.get("/cases").then((r) => setCases(r.cases || [])).catch(() => {});
  useEffect(() => { load(); }, []);

  const filtered = cases.filter((c) =>
    !q ||
    c.title?.toLowerCase().includes(q.toLowerCase()) ||
    c.reference?.toLowerCase().includes(q.toLowerCase()) ||
    c.complaint?.state?.toLowerCase().includes(q.toLowerCase()));

  const syncNcrp = async () => {
    setSyncing(true);
    try {
      const r = await api.post("/ncrp/sync", {});
      setNote(`Imported ${r.imported} complaint(s) from NCRP sandbox — available in the triage queue.`);
      load();
    } catch (e: any) {
      setNote(e.message);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-4 p-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Cases</h1>
          <p className="text-xs text-slate-500">
            Complaint-linked investigations · {cases.length} total
          </p>
        </div>
        <button className="btn-ghost" onClick={syncNcrp} disabled={syncing}>
          {syncing ? "Syncing…" : "⟳ Sync NCRP complaints"}
        </button>
      </header>

      {note && (
        <div className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-xs text-sky-300">
          {note}
        </div>
      )}

      <input
        className="input max-w-sm"
        placeholder="Search reference, title, state…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      <section className="panel overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-ink-800">
              <th className="th">Reference</th>
              <th className="th">Title</th>
              <th className="th">Status</th>
              <th className="th">Priority</th>
              <th className="th">Risk</th>
              <th className="th">Attributed VASP</th>
              <th className="th">Updated</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 50).map((c) => (
              <tr key={c.id} className="hover:bg-ink-800/40">
                <td className="td font-mono text-xs text-slate-300">{c.reference}</td>
                <td className="td max-w-[280px] truncate text-xs text-slate-200" title={c.title}>
                  {c.title}
                  <div className="text-[10px] text-slate-500">
                    {c.complaint?.category} · {c.complaint?.state} · {usd(c.complaint?.amountUsd)}
                  </div>
                </td>
                <td className="td">
                  <StatusPill status={c.status} />
                </td>
                <td className="td text-xs font-bold text-slate-400">{c.priority}</td>
                <td className="td">
                  <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${riskBadgeClass(c.riskLevel)}`}>
                    {c.riskScore ?? "—"} {c.riskLevel || ""}
                  </span>
                </td>
                <td className="td text-xs text-emerald-400">{c.attributedVasp ?? "—"}</td>
                <td className="td text-[11px] text-slate-500">{ago(c.updatedAt)}</td>
                <td className="td">
                  {c.latestTraceId ? (
                    <Link className="text-xs text-accent hover:underline"
                      to={`/investigation/${c.latestTraceId}`}>Open trace →</Link>
                  ) : (
                    <button className="text-xs text-slate-500 hover:text-accent"
                      onClick={() => setOpen(c)}>Details</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Audit drawer */}
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={() => setOpen(null)}>
          <div className="h-full w-[440px] overflow-y-auto border-l border-ink-700 bg-ink-900 p-5"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <h2 className="text-sm font-bold text-white">{open.reference}</h2>
              <button className="text-xs text-slate-500 hover:text-white" onClick={() => setOpen(null)}>✕</button>
            </div>
            <p className="mt-1 text-xs text-slate-400">{open.title}</p>
            <div className="mt-4 space-y-2 text-xs">
              <Row label="Category" value={open.complaint?.category} />
              <Row label="NCRP CEN" value={open.complaint?.cen} />
              <Row label="Amount" value={usd(open.complaint?.amountUsd)} />
              <Row label="State" value={open.complaint?.state} />
              <Row label="Complainant" value={open.complaint?.complainantAlias} />
              {open.complaint?.narrative && (
                <div className="rounded-lg border border-ink-700 bg-ink-850 p-3 text-[11px] leading-relaxed text-slate-400">
                  “{open.complaint.narrative}”
                </div>
              )}
              <div>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Suspect addresses
                </div>
                {(open.complaint?.suspectAddresses || []).map((s: any, i: number) => (
                  <div key={i} className="font-mono text-[11px] text-accent">
                    [{s.chain}] {short(s.address, 16, 10)}
                  </div>
                ))}
              </div>
              <div>
                <div className="mb-1 mt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Audit trail (chain of custody)
                </div>
                <div className="space-y-1.5">
                  {(open.audit || []).slice(0, 12).map((a: any) => (
                    <div key={a.id} className="rounded border border-ink-800 bg-ink-850 p-2 text-[10px]">
                      <span className="text-slate-500">{new Date(a.at).toLocaleString()}</span>
                      <span className="ml-2 font-semibold text-slate-300">{a.actor}</span>
                      <div className="text-slate-500">{a.detail}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    OPEN: "border-sky-500/40 bg-sky-500/10 text-sky-400",
    TRACING: "border-amber-500/40 bg-amber-500/10 text-amber-400",
    ATTRIBUTED: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
    REPORTED: "border-violet-500/40 bg-violet-500/10 text-violet-400",
    CLOSED: "border-slate-600 bg-slate-600/10 text-slate-400",
  };
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${map[status] || map.OPEN}`}>
      {status}
    </span>
  );
}

function Row({ label, value }: { label: string; value: any }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      <span className="text-right text-slate-300">{value ?? "—"}</span>
    </div>
  );
}
