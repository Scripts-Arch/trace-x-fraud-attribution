import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { CHAIN_COLORS, TYPOLOGY_LABELS } from "../lib/format";
import { useAuth } from "../context/AuthContext";

function detectChain(addr: string): string {
  const a = addr.trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(a)) return "ETH";
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a)) return "TRON";
  if (/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(a)) return "BTC";
  return "";
}

/** Split pasted text into candidate tokens on any separator (comma, newline, space, semicolon…). */
function tokenize(text: string): string[] {
  return Array.from(new Set(
    text.split(/[\s,;]+/)
      .map((t) => t.trim().replace(/[<>"'()\[\]{}]/g, ""))
      .filter((t) => t.length >= 20 && t.length <= 100),
  ));
}

const TYPOLOGIES = Object.keys(TYPOLOGY_LABELS).filter((t) => t !== "UNKNOWN");
type Mode = "single" | "batch" | "extract";

export default function NewTrace() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const [mode, setMode] = useState<Mode>("single");

  // single
  const [address, setAddress] = useState("");
  const [chain, setChain] = useState("");
  // batch / extract
  const [bulk, setBulk] = useState("");
  const [typologyHint, setTypologyHint] = useState("");
  const [caseId, setCaseId] = useState("");
  const [cases, setCases] = useState<any[]>([]);
  const [samples, setSamples] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // validation preview (batch + extract)
  const [preview, setPreview] = useState<{ address: string; valid: boolean; chain: string; reason: string }[] | null>(null);
  // extraction
  const [extracted, setExtracted] = useState<{ address: string; valid: boolean; chain: string }[] | null>(null);

  const detected = useMemo(() => detectChain(address), [address]);

  useEffect(() => {
    api.get("/cases").then((r) => setCases(r.cases || [])).catch(() => {});
    api.get("/samples").then((r) => setSamples(r.samples || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (detected) setChain(detected);
  }, [detected]);

  const candidates = useMemo(() => tokenize(bulk), [bulk]);

  const validatePreview = async () => {
    setErr("");
    const list = mode === "extract" && extracted ? extracted.map((e) => e.address) : candidates;
    if (!list.length) { setErr("Nothing to validate yet."); return; }
    setBusy(true);
    try {
      const results = await Promise.all(
        list.slice(0, 25).map(async (address) => {
          try {
            const v = await api.post("/validate", { address });
            return { address, valid: !!v.valid, chain: v.chain || detectChain(address), reason: v.reason || "" };
          } catch {
            return { address, valid: false, chain: detectChain(address), reason: "validator unreachable" };
          }
        }),
      );
      setPreview(results);
    } finally {
      setBusy(false);
    }
  };

  const extractFromText = async () => {
    setErr("");
    if (!bulk.trim()) { setErr("Paste the complaint text first."); return; }
    setBusy(true);
    try {
      const r = await api.post("/extract", { text: bulk });
      setExtracted((r.addresses || []).map((a: any) => ({ address: a.address, valid: !!a.valid, chain: a.chain || "" })));
      setPreview(null);
      if (!r.count) setErr("No wallet addresses found in the pasted text.");
    } catch (ex: any) {
      setErr(ex?.message || "Extraction failed");
    } finally {
      setBusy(false);
    }
  };

  const submitSingle = async () => {
    setErr("");
    if (!address.trim() || !chain) {
      setErr("Enter a suspect wallet address (BTC / ETH / TRON supported).");
      return;
    }
    setBusy(true);
    try {
      const r = await api.post("/traces", {
        address: address.trim(),
        chain,
        typologyHint: typologyHint || undefined,
        caseId: caseId || undefined,
      });
      navigate(`/investigation/${r.trace.id}`);
    } catch (ex: any) {
      setErr(ex?.message || "Failed to start trace");
      setBusy(false);
    }
  };

  const submitBatch = async () => {
    setErr("");
    const list = mode === "extract" && extracted ? extracted.filter((e) => e.valid).map((e) => e.address) : candidates;
    if (!list.length) { setErr("No addresses to trace."); return; }
    if (list.length > 25) { setErr(`Too many addresses (${list.length}); max 25 per batch.`); return; }
    setBusy(true);
    try {
      const r = await api.post("/batches", {
        addresses: list,
        typologyHint: typologyHint || undefined,
        caseId: caseId || undefined,
      });
      navigate(`/batch/${r.batch.id}`);
    } catch (ex: any) {
      setErr(ex?.message || "Failed to start batch");
      setBusy(false);
    }
  };

  const traceSample = async (s: any) => {
    setAddress(s.address);
    setChain(s.chain);
    setTypologyHint(s.typology || "");
    setBusy(true);
    try {
      const r = await api.post("/traces", {
        address: s.address, chain: s.chain, typologyHint: s.typology || undefined,
      });
      navigate(`/investigation/${r.trace.id}`);
    } catch (ex: any) {
      setErr(ex?.message || "Failed to start trace");
      setBusy(false);
    }
  };

  const validCount = preview?.filter((p) => p.valid).length ?? 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header>
        <h1 className="text-xl font-bold text-white">New Trace</h1>
        <p className="text-xs text-slate-500">
          Paste a suspect wallet, a list of wallets, or an entire complaint text — Trace-X validates, expands the
          transaction graph, detects laundering patterns and attributes the nearest exchange / VASP.
        </p>
      </header>

      {/* Mode tabs */}
      <div className="flex gap-1 rounded-lg border border-ink-800 bg-ink-900 p-1 text-xs">
        {([["single", "◈ Single wallet"], ["batch", "▤ Batch list"], ["extract", "✎ From complaint text"]] as [Mode, string][]).map(([m, label]) => (
          <button key={m} onClick={() => { setMode(m); setPreview(null); setExtracted(null); setErr(""); }}
            className={`flex-1 rounded-md px-3 py-1.5 font-semibold transition-colors ${
              mode === m ? "bg-accent/20 text-accent" : "text-slate-500 hover:text-slate-300"}`}>
            {label}
          </button>
        ))}
      </div>

      <section className="panel space-y-4 p-5">
        {mode === "single" ? (
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-400">Suspect wallet address</label>
            <input
              className="input font-mono"
              placeholder="bc1q… / 0x… / T…"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
            <div className="mt-1.5 flex items-center gap-2 text-[11px]">
              {detected ? (
                <span className="rounded border px-1.5 py-0.5 font-semibold"
                  style={{ color: CHAIN_COLORS[detected], borderColor: `${CHAIN_COLORS[detected]}55`,
                           background: `${CHAIN_COLORS[detected]}15` }}>
                  {detected} detected
                </span>
              ) : (
                <span className="text-slate-500">Chain auto-detected from address format</span>
              )}
            </div>
          </div>
        ) : mode === "batch" ? (
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-400">
              Wallet addresses — one per line or comma-separated (max 25)
            </label>
            <textarea
              className="input min-h-32 font-mono text-xs"
              placeholder={"bc1q…\n0x…\nT…"}
              value={bulk}
              onChange={(e) => { setBulk(e.target.value); setPreview(null); }}
            />
            <div className="mt-1.5 text-[11px] text-slate-500">
              {candidates.length} candidate{candidates.length === 1 ? "" : "s"} detected
              {candidates.length > 25 && <span className="text-amber-400"> — over the 25 limit, submit the first 25</span>}
            </div>
          </div>
        ) : (
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-400">
              Complaint text — paste the full NCRP/fir narrative; wallets are extracted automatically
            </label>
            <textarea
              className="input min-h-32 text-xs"
              placeholder={"Victim transferred 0.4 BTC to bc1q… then 12,000 USDT on TRON to T… after being shown fake profits on 0x…"}
              value={bulk}
              onChange={(e) => { setBulk(e.target.value); setExtracted(null); setPreview(null); }}
            />
            {extracted && (
              <div className="mt-2 space-y-1">
                <div className="text-[11px] text-slate-400">
                  {extracted.length} address{extracted.length === 1 ? "" : "es"} found ·{" "}
                  {extracted.filter((e) => e.valid).length} checksum-valid
                </div>
                {extracted.map((e) => (
                  <div key={e.address} className="flex items-center gap-2 font-mono text-[10px]">
                    <span className={e.valid ? "text-emerald-400" : "text-red-400"}>{e.valid ? "✓" : "✗"}</span>
                    <span className="text-slate-300">{e.address}</span>
                    {e.chain && <span className="text-slate-600">{e.chain}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {(mode !== "single" || true) && (
          <div className="grid gap-4 sm:grid-cols-3">
            {mode === "single" && (
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-400">Chain</label>
                <select className="input" value={chain} onChange={(e) => setChain(e.target.value)}>
                  <option value="">— auto —</option>
                  <option value="BTC">Bitcoin</option>
                  <option value="ETH">Ethereum</option>
                  <option value="TRON">Tron (USDT)</option>
                </select>
              </div>
            )}
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-400">Fraud typology (hint)</label>
              <select className="input" value={typologyHint} onChange={(e) => setTypologyHint(e.target.value)}>
                <option value="">— unspecified —</option>
                {TYPOLOGIES.map((t) => (
                  <option key={t} value={t}>{TYPOLOGY_LABELS[t]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-400">Link to case</label>
              <select className="input" value={caseId} onChange={(e) => setCaseId(e.target.value)}>
                <option value="">— standalone trace —</option>
                {cases.slice(0, 20).map((c) => (
                  <option key={c.id} value={c.id}>{c.reference} — {c.title.slice(0, 40)}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Validation preview */}
        {preview && (
          <div className="space-y-1 rounded-lg border border-ink-700 bg-ink-850 p-3">
            <div className="mb-1 text-[11px] font-semibold text-slate-300">
              Validation preview — {validCount}/{preview.length} valid
            </div>
            {preview.map((p) => (
              <div key={p.address} className="flex items-center gap-2 font-mono text-[10px]">
                <span className={p.valid ? "text-emerald-400" : "text-red-400"}>{p.valid ? "✓" : "✗"}</span>
                <span className="text-slate-300">{p.address}</span>
                {p.chain && <span className="text-slate-600">{p.chain}</span>}
                {!p.valid && p.reason && <span className="text-red-400/70">{p.reason}</span>}
              </div>
            ))}
          </div>
        )}

        {err && <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-400">{err}</div>}

        {mode === "single" ? (
          <button className="btn-primary" onClick={submitSingle} disabled={busy}>
            {busy ? "Starting…" : "▶ Run real-time trace"}
          </button>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button className="btn-ghost" onClick={mode === "extract" ? extractFromText : validatePreview} disabled={busy || !bulk.trim()}>
              {mode === "extract" ? "⌕ Extract addresses" : "✓ Validate list"}
            </button>
            {(mode === "batch" || (mode === "extract" && extracted?.some((e) => e.valid))) && (
              <button className="btn-primary" onClick={submitBatch} disabled={busy}>
                {busy ? "Starting…" : `▶ Trace ${mode === "extract" ? extracted!.filter((e) => e.valid).length : Math.min(candidates.length, 25)} wallets as batch`}
              </button>
            )}
          </div>
        )}
        {session?.user.role === "INVESTIGATOR" && (
          <p className="text-[11px] text-slate-600">
            Running as Investigator — traces are recorded in the case audit trail.
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
          One-click demo scenarios
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {samples.map((s) => (
            <button
              key={s.key}
              onClick={() => traceSample(s)}
              disabled={busy}
              className="panel group p-4 text-left transition-colors hover:border-accent/60 disabled:opacity-50"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-200 group-hover:text-accent">{s.title}</span>
                <span className="rounded border px-1.5 py-0.5 text-[10px] font-bold"
                  style={{ color: CHAIN_COLORS[s.chain], borderColor: `${CHAIN_COLORS[s.chain]}55`,
                           background: `${CHAIN_COLORS[s.chain]}15` }}>
                  {s.chain}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-slate-500">{s.narrative}</p>
              <div className="mt-2 font-mono text-[10px] text-slate-600">{s.address}</div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
