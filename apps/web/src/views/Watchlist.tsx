import { useCallback, useEffect, useRef, useState } from "react";
import { api, connectWs } from "../lib/api";
import { ago, CHAIN_COLORS, short, usd } from "../lib/format";

export default function Watchlist() {
  const [watchlist, setWatchlist] = useState<any[]>([]);
  const [status, setStatus] = useState<any>(null);
  const [address, setAddress] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [prices, setPrices] = useState<any>(null);
  const wsRef = useRef<(() => void) | null>(null);

  const load = useCallback(() => {
    api.get("/watchlist").then((r) => {
      setWatchlist(r.watchlist || []);
      setStatus(r.status);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    api.get("/prices").then((r) => setPrices(r)).catch(() => {});
    // live: new movements raise alerts over WS; refresh the table instantly
    wsRef.current = connectWs((type, payload) => {
      if (type === "watch_movement") {
        setMsg({ text: `◈ Live: watched wallet moved — ${payload?.newMovements ?? 1} new txn(s)`, ok: true });
        load();
      }
      if (type === "alert") load();
    });
    return () => wsRef.current?.();
  }, [load]);

  const add = async () => {
    const addr = address.trim();
    if (!addr) { setMsg({ text: "Enter an address to watch.", ok: false }); return; }
    setBusy("add");
    try {
      // validate first for a friendly error + auto chain detection
      const v = await api.post("/validate", { address: addr }).catch(() => null);
      const chain = v?.chain || "BTC";
      if (v && !v.valid) {
        setMsg({ text: `Invalid address: ${v.reason || "checksum failed"}`, ok: false });
        return;
      }
      await api.post("/watchlist", { address: addr, chain, note });
      setAddress(""); setNote("");
      setMsg({ text: "Added to watchlist — poller will check it every cycle.", ok: true });
      load();
    } catch (ex: any) {
      setMsg({ text: ex?.message || "Failed to add", ok: false });
    } finally {
      setBusy(null);
    }
  };

  const checkNow = async (addr: string) => {
    setBusy(addr);
    try {
      const r = await api.post(`/watchlist/${encodeURIComponent(addr)}/check`);
      const w = r.watch;
      setMsg({ text: w?.newMovements
        ? `◈ ${w.newMovements} new movement(s) on ${w.chain} — alert raised`
        : `No new movements — ${w?.currentTxCount ?? 0} txn(s) known, $${Math.round(w?.currentValueUsd ?? 0).toLocaleString()} total`,
        ok: !!w?.newMovements });
      load();
    } catch (ex: any) {
      setMsg({ text: ex?.message || "Check failed", ok: false });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (addr: string) => {
    setBusy(addr);
    try {
      await api.del(`/watchlist/${encodeURIComponent(addr)}`);
      load();
    } catch (ex: any) {
      setMsg({ text: ex?.message || "Remove failed", ok: false });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5 p-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Wallet Watchlist</h1>
          <p className="text-xs text-slate-500">
            Pin suspect wallets — the ML poller re-fetches live chain activity and raises P1 alerts on new movements.
          </p>
        </div>
        {status && (
          <div className="flex gap-4 text-right text-[11px] text-slate-500">
            <div>
              <div className="text-lg font-bold text-slate-200">{status.watching}</div>
              watching
            </div>
            <div>
              <div className={`text-lg font-bold ${status.withNewMovements ? "text-amber-400" : "text-slate-200"}`}>
                {status.withNewMovements}
              </div>
              moved
            </div>
            <div>
              <div className={`text-lg font-bold ${status.active ? "text-emerald-400" : "text-slate-600"}`}
                title={status.active ? "background poller running" : "poller idle (simulated mode)"}>
                ◈
              </div>
              poller
            </div>
          </div>
        )}
      </header>

      {/* prices chip */}
      {prices?.prices && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
          <span className="font-semibold uppercase tracking-wider">Live prices</span>
          {Object.entries(prices.prices).map(([asset, px]) => (
            <span key={asset} className="rounded border border-ink-700 bg-ink-850 px-1.5 py-0.5 font-mono">
              {asset} ${Number(px).toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
          ))}
          <span className="text-slate-600">
            ({prices.source}{prices.stale ? ", stale" : ""}{prices.ageSeconds != null ? `, ${ago(Date.now() - prices.ageSeconds * 1000)}` : ""})
          </span>
      </div>
      )}

      {/* add form */}
      <section className="panel space-y-3 p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <input className="input font-mono text-xs" placeholder="Wallet address (bc1q… / 0x… / T…)"
            value={address} onChange={(e) => setAddress(e.target.value)} />
          <input className="input text-xs" placeholder="Note — e.g. ransomware suspect, case 2026-114"
            value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn-primary" onClick={add} disabled={busy === "add"}>
            {busy === "add" ? "Adding…" : "+ Watch wallet"}
          </button>
        </div>
        {msg && (
          <div className={`rounded-lg border px-3 py-2 text-xs ${
            msg.ok ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                   : "border-red-500/40 bg-red-500/10 text-red-400"}`}>
            {msg.text}
          </div>
        )}
      </section>

      {/* table */}
      <section className="panel overflow-hidden">
        <table className="w-full">
          <thead>
            <tr>
              <th className="th">Address</th>
              <th className="th">Chain</th>
              <th className="th">Note</th>
              <th className="th">Movements</th>
              <th className="th">Value seen</th>
              <th className="th">Last checked</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody>
            {watchlist.map((w) => (
              <tr key={w.address} className="hover:bg-ink-800/40">
                <td className="td font-mono text-xs text-slate-200" title={w.address}>{short(w.address, 12, 8)}</td>
                <td className="td">
                  <span className="rounded border px-1.5 py-0.5 text-[10px] font-bold"
                    style={{ color: CHAIN_COLORS[w.chain], borderColor: `${CHAIN_COLORS[w.chain]}55`,
                             background: `${CHAIN_COLORS[w.chain]}15` }}>
                    {w.chain}
                  </span>
                </td>
                <td className="td max-w-40 truncate text-xs text-slate-400" title={w.note}>{w.note || "—"}</td>
                <td className="td text-xs">
                  {w.movements?.length
                    ? <span className="text-amber-400">◈ {w.movements.length}</span>
                    : <span className="text-slate-600">none</span>}
                </td>
                <td className="td text-xs">{usd(w.currentValueUsd)}</td>
                <td className="td text-[11px] text-slate-500">{ago(w.lastCheckedAt)}</td>
                <td className="td text-right">
                  <button className="btn-ghost mr-1 !px-2 !py-1 text-[10px]" onClick={() => checkNow(w.address)}
                    disabled={busy === w.address}>
                    {busy === w.address ? "…" : "Check now"}
                  </button>
                  <button className="btn-ghost !px-2 !py-1 text-[10px] text-red-400" onClick={() => remove(w.address)}
                    disabled={busy === w.address}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            {!watchlist.length && (
              <tr><td className="td text-center text-xs text-slate-500" colSpan={7}>
                Watchlist empty — add a suspect wallet above.
              </td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
