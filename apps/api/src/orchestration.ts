/**
 * Trace orchestration — submits trace jobs to the Python ML service, polls
 * progress, persists results, links cases, raises alerts and broadcasts over
 * WebSocket so the frontend shows live progress.
 */
import { emit, state } from "./state";

export interface TraceRecord {
  id: string;
  caseId: string | null;
  batchId?: string | null;
  seedAddress: string;
  chain: string;
  typologyHint?: string | null;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
  stage: string;
  detail: string;
  progress: number;
  mlJobId?: string | null;
  startedAt: number;
  completedAt?: number | null;
  durationMs?: number | null;
  mode?: "live" | "simulated" | null;
  result?: any | null;
}

const active = new Map<string, NodeJS.Timeout>();

function ml(path: string): string {
  return `${state.mlUrl}${path}`;
}

export async function startTrace(
  opts: { address: string; chain?: string; typologyHint?: string | null; caseId?: string | null; batchId?: string | null },
): Promise<TraceRecord> {
  const rec: TraceRecord = {
    id: `trc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    caseId: opts.caseId ?? null,
    batchId: opts.batchId ?? null,
    seedAddress: opts.address,
    chain: opts.chain || "BTC",
    typologyHint: opts.typologyHint ?? null,
    status: "QUEUED",
    stage: "INIT",
    detail: "Queued for analysis",
    progress: 0,
    startedAt: Date.now(),
    result: null,
  };
  state.store.tables.traces.unshift(rec as never);
  state.store.flush();

  try {
    const resp = await fetch(ml("/api/v1/trace"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address: opts.address,
        chain: opts.chain,
        typologyHint: opts.typologyHint ?? undefined,
      }),
    });
    if (!resp.ok) throw new Error(`ML service HTTP ${resp.status}`);
    const body = (await resp.json()) as { jobId: string };
    rec.mlJobId = body.jobId;
    rec.status = "RUNNING";
    poll(rec.id);
  } catch (err: any) {
    rec.status = "FAILED";
    rec.detail = `ML service unreachable: ${err?.message || err}`;
    rec.completedAt = Date.now();
    emit("trace_failed", { traceId: rec.id, detail: rec.detail });
  }
  state.store.flush();
  return rec;
}

function poll(traceId: string): void {
  const timer = setInterval(async () => {
    const rec = state.store.tables.traces.find((t: any) => t.id === traceId) as
      | TraceRecord
      | undefined;
    if (!rec || !rec.mlJobId) {
      clearInterval(timer);
      active.delete(traceId);
      return;
    }
    try {
      const resp = await fetch(ml(`/api/v1/trace/${rec.mlJobId}`));
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const body: any = await resp.json();
      rec.status = body.status;
      rec.stage = body.stage;
      rec.detail = body.detail;
      rec.progress = body.progress ?? rec.progress;

      if (body.status === "COMPLETED" && body.result) {
        clearInterval(timer);
        active.delete(traceId);
        rec.result = body.result;
        rec.mode = body.result.mode;
        rec.durationMs = body.result.durationMs;
        rec.completedAt = Date.now();
        state.store.flush();
        emit("trace_progress", {
          traceId: rec.id, caseId: rec.caseId, status: rec.status,
          stage: rec.stage, detail: rec.detail, progress: rec.progress,
        });
        emit("trace_completed", { traceId: rec.id, caseId: rec.caseId, summary: summarise(rec) });
        if (rec.batchId) emit("batch_progress", { batchId: rec.batchId, traceId: rec.id, status: rec.status });
        if (rec.caseId) linkToCase(rec);
        raiseAlerts(rec);
      } else {
        emit("trace_progress", {
          traceId: rec.id, caseId: rec.caseId, status: rec.status,
          stage: rec.stage, detail: rec.detail, progress: rec.progress,
        });
      }

      if (body.status === "FAILED") {
        clearInterval(timer);
        active.delete(traceId);
        rec.completedAt = Date.now();
        rec.detail = body.detail || "Trace failed";
        state.store.flush();
        emit("trace_failed", { traceId: rec.id, caseId: rec.caseId, detail: rec.detail });
        if (rec.batchId) emit("batch_progress", { batchId: rec.batchId, traceId: rec.id, status: rec.status });
      }
    } catch (err: any) {
      // transient poll errors tolerated; give up after ~90s of silence
      if (Date.now() - rec.startedAt > 120_000) {
        clearInterval(timer);
        active.delete(traceId);
        rec.status = "FAILED";
        rec.detail = `Polling failed: ${err?.message || err}`;
        emit("trace_failed", { traceId: rec.id, caseId: rec.caseId, detail: rec.detail });
      }
    }
  }, 800);
  active.set(traceId, timer);
}

export function summarise(rec: TraceRecord) {
  const r = rec.result || {};
  const risk = r.risk || {};
  const primary = r.primaryAttribution || null;
  return {
    traceId: rec.id,
    chain: rec.chain,
    seedAddress: rec.seedAddress,
    mode: rec.mode,
    riskScore: risk.score ?? null,
    riskLevel: risk.level ?? null,
    typology: risk.typology ?? null,
    primaryVasp: primary ? { id: primary.vaspId, name: primary.name, confidence: primary.confidence } : null,
    totalAddresses: r.summary?.totalAddresses ?? null,
    totalTransactions: r.summary?.totalTransactions ?? null,
    totalValueUsd: r.summary?.totalValueUsd ?? null,
    durationMs: rec.durationMs ?? null,
  };
}

function linkToCase(rec: TraceRecord): void {
  const c = state.store.tables.cases.find((x: any) => x.id === rec.caseId) as any;
  if (!c) return;
  if (!c.traceIds.includes(rec.id)) c.traceIds.unshift(rec.id);
  c.latestTraceId = rec.id;
  c.riskScore = rec.result?.risk?.score ?? c.riskScore ?? null;
  c.riskLevel = rec.result?.risk?.level ?? c.riskLevel ?? null;
  const primary = rec.result?.primaryAttribution;
  if (primary) {
    c.attributedVasp = primary.name;
    c.status = "ATTRIBUTED";
  } else {
    c.status = "TRACING";
  }
  c.updatedAt = Date.now();
  c.audit.unshift({
    id: `aud-${Date.now().toString(36)}`,
    at: Date.now(),
    actor: "SYSTEM",
    action: "TRACE_COMPLETED",
    detail: `Trace ${rec.id} completed — risk ${c.riskScore ?? "n/a"} ` +
            `${primary ? `· attributed to ${primary.name} (${Math.round(primary.confidence * 100)}%)` : ""}`,
  });
  state.store.flush();
}

function raiseAlerts(rec: TraceRecord): void {
  const r = rec.result || {};
  const risk = r.risk || {};
  const primary = r.primaryAttribution;
  const patterns: string[] = (r.patterns || []).map((p: any) => p.type);

  let severity: "P1" | "P2" | "P3" = "P3";
  if (risk.level === "CRITICAL" || (primary && (r.summary?.totalValueUsd ?? 0) > 10000)) severity = "P1";
  else if (risk.level === "HIGH") severity = "P2";

  const alerts: any[] = [];
  if (primary) {
    alerts.push({
      severity, kind: "VASP_HIT",
      title: `${primary.name} attribution — ${Math.round(primary.confidence * 100)}% confidence`,
      detail: `Funds from ${rec.seedAddress} reach ${primary.name} within ${primary.pathDepth} hop(s) ` +
              `($${(primary.totalValueUsd ?? 0).toLocaleString()} exposure). Freeze request recommended.`,
    });
  }
  if (patterns.includes("MIXER_PASS")) {
    alerts.push({
      severity: severity === "P3" ? "P2" : severity, kind: "MIXER",
      title: "Mixer pass detected",
      detail: `Trace ${rec.id} routed funds through a mixing service — expect obfuscation downstream.`,
    });
  }
  if (patterns.includes("CROSS_CHAIN")) {
    alerts.push({
      severity: "P2", kind: "BRIDGE",
      title: "Cross-chain movement detected",
      detail: `Bridges used: ${(r.crossChain?.bridgesUsed || []).join(", ") || "unknown"}.`,
    });
  }
  if (!alerts.length && (risk.level === "HIGH" || risk.level === "CRITICAL")) {
    alerts.push({
      severity, kind: "HIGH_RISK",
      title: `High-risk wallet traced (${risk.score}/100)`,
      detail: `Typology ${risk.typology} — no exchange attribution within hop budget.`,
    });
  }

  for (const a of alerts) {
    const alert = {
      id: `alr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      at: Date.now(),
      severity: a.severity,
      kind: a.kind,
      title: a.title,
      detail: a.detail,
      caseId: rec.caseId,
      traceId: rec.id,
      chain: rec.chain,
      vaspName: primary?.name ?? null,
      acknowledged: false,
    };
    state.store.tables.alerts.unshift(alert);
    emit("alert", alert);
    // SAHYOG outbox: P1 alerts are pushed for inter-agency coordination
    if (a.severity === "P1") {
      state.store.tables.sahyogOutbox.unshift({
        id: `syg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        at: Date.now(), type: "ALERT_PUSH", refId: alert.id,
        caseId: rec.caseId, chain: rec.chain, status: "SENT",
        body: `${alert.title} — ${alert.detail}`,
      });
    }
  }
  state.store.flush();
}

export function getTrace(id: string): TraceRecord | undefined {
  return state.store.tables.traces.find((t: any) => t.id === id) as TraceRecord | undefined;
}

// ---------------------------------------------------------------- batch
export interface BatchRecord {
  id: string;
  caseId: string | null;
  traceIds: string[];
  accepted: number;
  rejected: { address: string; reason: string }[];
  createdAt: number;
  typologyHint?: string | null;
}

export async function startBatch(
  opts: { addresses: { address: string; chain?: string }[]; typologyHint?: string | null; caseId?: string | null },
): Promise<BatchRecord> {
  const batch: BatchRecord = {
    id: `bat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    caseId: opts.caseId ?? null,
    traceIds: [],
    accepted: 0,
    rejected: [],
    createdAt: Date.now(),
    typologyHint: opts.typologyHint ?? null,
  };

  // validate each address against the ML validator; invalid ones are flagged
  const validated: { address: string; chain?: string }[] = [];
  for (const item of opts.addresses.slice(0, 25)) {
    const addr = (item.address || "").trim();
    try {
      const resp = await fetch(`${state.mlUrl}/api/v1/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: addr }),
      });
      const v: any = await resp.json();
      if (v.valid && v.chain) {
        validated.push({ address: addr, chain: item.chain || v.chain });
      } else {
        batch.rejected.push({ address: addr, reason: v.reason || "invalid address" });
      }
    } catch {
      // validator unreachable: fall back to shape-based accept
      if (addr.length >= 20) validated.push({ address: addr, chain: item.chain });
      else batch.rejected.push({ address: addr, reason: "validator unavailable and address too short" });
    }
  }

  for (const item of validated) {
    const rec = await startTrace({
      address: item.address,
      chain: item.chain,
      typologyHint: opts.typologyHint,
      caseId: opts.caseId ?? null,
      batchId: batch.id,
    });
    batch.traceIds.push(rec.id);
    batch.accepted += 1;
  }

  (state.store.tables.batches as any[]).unshift(batch);
  state.store.flush();
  emit("batch_started", { batchId: batch.id, accepted: batch.accepted, rejected: batch.rejected.length });
  return batch;
}

// ------------------------------------------------------- watchlist → alert bridge
// The ML service polls watched wallets on its own schedule. The API re-reads
// the watchlist on a short cycle and turns *new* movements into P1/P2 alerts
// + WebSocket events so the UI and SAHYOG pipeline react in real time.

const lastMovementAt: Record<string, number> = {};
let watchTimer: NodeJS.Timeout | null = null;

export async function watchSync(): Promise<number> {
  let raised = 0;
  try {
    const resp = await fetch(ml("/api/v1/watchlist"), { signal: AbortSignal.timeout(5_000) });
    if (!resp.ok) return 0;
    const body = (await resp.json()) as { watchlist?: any[] };
    for (const w of body.watchlist || []) {
      const movements: any[] = w.movements || [];
      const seenAt = lastMovementAt[w.address] ?? 0;
      const fresh = movements.filter((m) => (m.at ?? 0) > seenAt);
      if (!fresh.length) continue;
      lastMovementAt[w.address] = Math.max(...fresh.map((m) => m.at ?? 0), seenAt);

      const totalUsd = fresh.reduce((s, m) => s + (m.valueUsd ?? 0), 0);
      const latest = fresh[0] || {};
      const alert = {
        id: `alr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        at: Date.now(),
        severity: (totalUsd > 5_000 ? "P1" : "P2") as "P1" | "P2",
        kind: "WATCHLIST_MOVEMENT",
        title: `Watched wallet moved — ${fresh.length} new txn(s) on ${w.chain}`,
        detail: `${w.address} — ${fresh.length} new movement(s) worth ` +
                `$${Math.round(totalUsd).toLocaleString()}. Latest: ${latest.direction ?? "txn"} ` +
                `${latest.value ?? "?"} ${latest.asset ?? ""}` +
                (latest.counterparty ? ` ↔ ${String(latest.counterparty).slice(0, 16)}…` : ""),
        caseId: w.caseId ?? null,
        traceId: null,
        chain: w.chain,
        vaspName: null,
        acknowledged: false,
      };
      (state.store.tables.alerts as any[]).unshift(alert);
      emit("alert", alert);
      emit("watch_movement", { watch: w, newMovements: fresh.length, alertId: alert.id });
      if (alert.severity === "P1") {
        (state.store.tables.sahyogOutbox as any[]).unshift({
          id: `syg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          at: Date.now(), type: "WATCH_MOVEMENT", refId: alert.id,
          caseId: w.caseId ?? null, chain: w.chain, status: "SENT",
          body: `${alert.title} — ${alert.detail}`,
        });
      }
      state.store.flush();
      raised += 1;
    }
  } catch {
    /* ML unreachable or watchlist empty — retry next tick */
  }
  return raised;
}

export function startWatchSync(intervalMs = 45_000): void {
  if (watchTimer) return;
  watchTimer = setInterval(() => { watchSync().catch(() => {}); }, intervalMs);
  watchSync().catch(() => {});
}

export function batchAggregate(batchId: string) {
  const b = (state.store.tables.batches as any[]).find((x) => x.id === batchId);
  if (!b) return null;
  const traces = b.traceIds
    .map((id: string) => getTrace(id))
    .filter(Boolean)
    .map((t: any) => summarise(t));

  // aggregate VASP exposure across the batch
  const vaspExposure: Record<string, { name: string; totalUsd: number; traces: number; maxConfidence: number }> = {};
  let totalUsd = 0;
  const riskDist: Record<string, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
  for (const t of traces) {
    totalUsd += t.totalValueUsd ?? 0;
    if (t.riskLevel) riskDist[t.riskLevel] = (riskDist[t.riskLevel] ?? 0) + 1;
  }
  for (const id of b.traceIds) {
    const rec: any = getTrace(id);
    const primary = rec?.result?.primaryAttribution;
    if (primary) {
      const key = primary.vaspId;
      vaspExposure[key] = vaspExposure[key] || { name: primary.name, totalUsd: 0, traces: 0, maxConfidence: 0 };
      vaspExposure[key].totalUsd += primary.totalValueUsd ?? 0;
      vaspExposure[key].traces += 1;
      vaspExposure[key].maxConfidence = Math.max(vaspExposure[key].maxConfidence, primary.confidence ?? 0);
    }
  }
  const attributed = traces.filter((t: any) => t.primaryVasp).length;
  return {
    batch: b,
    traces,
    aggregate: {
      traces: traces.length,
      completed: traces.filter((t: any) => t.riskScore !== null).length,
      attributed,
      attributionRate: traces.length ? attributed / traces.length : 0,
      totalValueUsd: Math.round(totalUsd),
      riskDist,
      vaspExposure: Object.entries(vaspExposure)
        .map(([vaspId, v]) => ({ vaspId, ...v, totalUsd: Math.round(v.totalUsd) }))
        .sort((a, b) => b.totalUsd - a.totalUsd),
    },
  };
}
