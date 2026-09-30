import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { api, connectWs } from "../lib/api";
import { useAuth } from "../context/AuthContext";

const NAV = [
  { to: "/", label: "Dashboard", icon: "◎" },
  { to: "/trace", label: "New Trace", icon: "⌖" },
  { to: "/cases", label: "Cases", icon: "▤" },
  { to: "/watchlist", label: "Watchlist", icon: "◈" },
  { to: "/registry", label: "VASP Registry", icon: "组织的" },
  { to: "/alerts", label: "Alerts", icon: "◆" },
];

export default function Shell() {
  const { session, logout } = useAuth();
  const navigate = useNavigate();
  const [live, setLive] = useState(false);
  const [unacked, setUnacked] = useState(0);

  useEffect(() => {
    const close = connectWs((type) => {
      if (type === "hello") setLive(true);
      if (type === "alert") setUnacked((n) => n + 1);
    });
    api.get("/alerts").then((r) => {
      setUnacked((r.alerts || []).filter((a: any) => !a.acknowledged).length);
    }).catch(() => {});
    return close;
  }, []);

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-ink-700 bg-ink-900">
        <div className="flex items-center gap-3 border-b border-ink-700 px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-dim text-lg font-black text-white">
            X
          </div>
          <div>
            <div className="text-sm font-bold tracking-widest text-white">TRACE-X</div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500">
              Crypto Fraud Attribution
            </div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? "bg-accent/10 font-semibold text-accent"
                    : "text-slate-400 hover:bg-ink-800 hover:text-slate-200"
                }`
              }
            >
              <span className="w-4 text-center text-xs opacity-70">{n.icon === "组织的" ? "▣" : n.icon}</span>
              {n.label}
              {n.to === "/alerts" && unacked > 0 && (
                <span className="ml-auto rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-bold text-red-400">
                  {unacked}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-ink-700 px-4 py-3">
          <div className="mb-2 flex items-center gap-2 text-[11px]">
            <span className={`h-2 w-2 rounded-full ${live ? "bg-emerald-400" : "bg-slate-600"}`} />
            <span className={live ? "text-emerald-400" : "text-slate-500"}>
              {live ? "Live feed connected" : "Connecting…"}
            </span>
          </div>
          <div className="text-sm font-semibold text-slate-200">{session?.user.name}</div>
          <div className="text-[11px] text-slate-500">
            {session?.user.role} · {session?.user.agency}
          </div>
          <button
            onClick={() => { logout(); navigate("/login"); }}
            className="mt-3 text-xs text-slate-500 hover:text-red-400"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
