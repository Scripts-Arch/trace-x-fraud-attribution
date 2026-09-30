import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const DEMO = [
  { label: "Admin — Joint Commissioner", username: "admin", password: "admin123" },
  { label: "Investigator — IO", username: "investigator", password: "io123" },
  { label: "Supervisor — DSP", username: "supervisor", password: "sup123" },
];

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin123");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await login(username, password);
      navigate("/");
    } catch (ex: any) {
      setErr(ex?.message || "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-ink-950 via-ink-900 to-ink-850 p-6">
      <div className="w-full max-w-4xl overflow-hidden rounded-2xl border border-ink-700 bg-ink-900/80 shadow-panel md:grid md:grid-cols-2">
        {/* Branding side */}
        <div className="hidden flex-col justify-between bg-gradient-to-br from-accent-dim/20 to-transparent p-8 md:flex">
          <div>
            <div className="mb-1 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-dim text-xl font-black text-white">X</div>
              <div className="text-lg font-bold tracking-[0.3em] text-white">TRACE-X</div>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-slate-400">
              Real-time identification of fraud-linked cryptocurrency exchanges from
              victim-reported suspect wallet addresses — automated blockchain analytics
              for law enforcement.
            </p>
          </div>
          <ul className="space-y-2 text-xs text-slate-500">
            <li>▸ Multi-chain tracing — BTC · ETH · TRON</li>
            <li>▸ VASP attribution with explainable paths</li>
            <li>▸ ML risk scoring &amp; fraud typology</li>
            <li>▸ NCRP / SAHYOG integration</li>
          </ul>
        </div>

        {/* Form side */}
        <div className="p-8">
          <h1 className="text-xl font-bold text-white">Sign in to the console</h1>
          <p className="mt-1 text-xs text-slate-500">Law-enforcement access only · demo environment</p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-400">Username</label>
              <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-400">Password</label>
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {err && <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-400">{err}</div>}
            <button className="btn-primary w-full justify-center" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <div className="mt-6 border-t border-ink-700 pt-4">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Demo accounts
            </div>
            <div className="space-y-1.5">
              {DEMO.map((d) => (
                <button
                  key={d.username}
                  onClick={() => { setUsername(d.username); setPassword(d.password); }}
                  className="flex w-full items-center justify-between rounded-lg border border-ink-700 bg-ink-850 px-3 py-2 text-xs text-slate-400 hover:border-accent/50 hover:text-slate-200"
                >
                  <span>{d.label}</span>
                  <span className="font-mono text-[10px] text-slate-500">{d.username} / {d.password}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
