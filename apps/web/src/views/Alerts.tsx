import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, connectWs } from "../lib/api";
import { ago, severityBadgeClass } from "../lib/format";

export default function Alerts() {
  const [alerts, setAlerts] = useState<any[]>([]);
  const [outbox, setOutbox] = useState<any[]>([]);
  const [sev, setSev] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(() => {
    api.get("/alerts").then((r) => setAlerts(r.alerts || [])).catch(() => {});
    api.get("/sahyog/outbox").then((r) => setOutbox(r.outbox || [])).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    return connectWs((type) => {
      if (type === "alert" || type === "alert_acknowledged") load();
    });
  }, [load]);

  const filtered = alerts.filter((a) => !sev || a.severity === sev);

  const ack = async (id: string) => {
    await api.post(`/alerts/${id}/acknowledge`, {});
    load();
  };

  const pushSahyog = async (id: string) => {
    try {
      await api.post("/sahyog/alerts", { alertId: id });
      setNote("Alert pushed to SAHYOG outbox — visible to connected agencies.");
      load();
    } catch (e: any) {
      setNote(e.message);
    }
  };

  return (
    <div className="space-y-4 p-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Alerts</h1>
          <p className="text-xs text-slate-500">
            Auto-generated intelligence alerts from trace completions
          </p>
        </div>
        <div className="flex gap-1.5">
          {["", "P1", "P2", "P3"].map((s) => (
            <button key={s || "all"}
              className={`rounded-lg border px-3 py-1.5 text-xs ${sev === s ? "border-accent bg-accent/10 text-accent" : "border-ink-700 text-slate-400"}`}
              onClick={() => setSev(s)}>{s || "All"}</button>
          ))}
        </div>
      </header>

      {note && <div className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-xs text-sky-300">{note}</div>}

      <div className="grid gap-4 xl:grid-cols-3">
        <section className="space-y-3 xl:col-span-2">
          {filtered.map((a) => (
            <article key={a.id} className={`panel p-4 ${a.severity === "P1" && !a.acknowledged ? "border-red-500/40" : ""}`}>
              <div className="flex items-center gap-2">
                <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${severityBadgeClass(a.severity)}`}>
                  {a.severity}
                </span>
                <span className="rounded border border-ink-700 px-1.5 py-0.5 text-[10px] text-slate-400">
                  {a.kind.replace(/_/g, " ")}
                </span>
                {a.chain && <span className="text-[10px] text-slate-500">· {a.chain}</span>}
                <span className="ml-auto text-[10px] text-slate-500">{ago(a.at)}</span>
              </div>
              <h2 className="mt-2 text-sm font-semibold text-slate-100">{a.title}</h2>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{a.detail}</p>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px]">
                {a.traceId && (
                  <Link className="text-accent hover:underline" to={`/investigation/${a.traceId}`}>
                    Open investigation →
                  </Link>
                )}
                {a.acknowledged ? (
                  <span className="text-slate-600">✓ acknowledged</span>
                ) : (
                  <button className="btn-ghost !px-2.5 !py-1 !text-[11px]" onClick={() => ack(a.id)}>
                    Acknowledge
                  </button>
                )}
                <button className="btn-ghost !px-2.5 !py-1 !text-[11px]" onClick={() => pushSahyog(a.id)}>
                  Push to SAHYOG
                </button>
              </div>
            </article>
          ))}
          {!filtered.length && (
            <div className="panel p-8 text-center text-xs text-slate-500">
              No alerts{sev ? ` at ${sev}` : ""} — run a trace to generate intelligence.
            </div>
          )}
        </section>

        <section className="panel h-fit">
          <h2 className="border-b border-ink-800 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
            SAHYOG outbox ({outbox.length})
          </h2>
          <div className="max-h-[480px] space-y-2 overflow-y-auto p-3">
            {outbox.map((o) => (
              <div key={o.id} className="rounded-lg border border-ink-700 bg-ink-850 p-2.5 text-[11px]">
                <div className="flex justify-between text-[10px] text-slate-500">
                  <span className="font-semibold text-slate-400">{o.type}</span>
                  <span>{ago(o.at)}</span>
                </div>
                <div className="mt-1 line-clamp-3 text-slate-400">{o.body}</div>
                <div className="mt-1 text-[10px] text-emerald-500">● {o.status}</div>
              </div>
            ))}
            {!outbox.length && (
              <p className="p-4 text-center text-xs text-slate-500">Nothing pushed yet.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
