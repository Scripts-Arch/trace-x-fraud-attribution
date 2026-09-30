/** Formatting + domain colour helpers shared across views. */

export const RISK_COLORS: Record<string, string> = {
  CRITICAL: "#ef4444",
  HIGH: "#f59e0b",
  MEDIUM: "#eab308",
  LOW: "#22c55e",
};

export const CHAIN_COLORS: Record<string, string> = {
  BTC: "#f7931a",
  ETH: "#627eea",
  TRON: "#eb0029",
};

export const NODE_COLORS: Record<string, string> = {
  wallet: "#38bdf8",
  exchange: "#22c55e",
  mixer: "#a855f7",
  bridge: "#f97316",
  contract: "#64748b",
};

export const TYPOLOGY_LABELS: Record<string, string> = {
  INVESTMENT_SCAM: "Investment scam",
  TASK_FRAUD: "Task-based fraud",
  SEXTORTION: "Sextortion",
  RANSOMWARE: "Ransomware",
  PHISHING: "Phishing",
  DARKNET: "Darknet",
  UNKNOWN: "Unclassified",
};

export function usd(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export function short(addr: string | null | undefined, head = 8, tail = 6): string {
  if (!addr) return "—";
  return addr.length <= head + tail + 1 ? addr : `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

export function ago(ts: number | null | undefined): string {
  if (!ts) return "—";
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function riskBadgeClass(level: string | null | undefined): string {
  switch (level) {
    case "CRITICAL": return "bg-red-500/15 text-red-400 border-red-500/40";
    case "HIGH": return "bg-amber-500/15 text-amber-400 border-amber-500/40";
    case "MEDIUM": return "bg-yellow-500/15 text-yellow-300 border-yellow-500/40";
    case "LOW": return "bg-emerald-500/15 text-emerald-400 border-emerald-500/40";
    default: return "bg-slate-500/15 text-slate-400 border-slate-500/40";
  }
}

export function severityBadgeClass(sev: string): string {
  switch (sev) {
    case "P1": return "bg-red-500/15 text-red-400 border-red-500/40";
    case "P2": return "bg-amber-500/15 text-amber-400 border-amber-500/40";
    default: return "bg-sky-500/15 text-sky-400 border-sky-500/40";
  }
}
