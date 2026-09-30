/**
 * Trace-X API — Express + WebSocket orchestration layer.
 *
 * Sits between the LEA frontend and the Python ML service: auth, case
 * management, trace job orchestration, alerting, NCRP/SAHYOG integrations
 * and standardised report generation.
 */
import * as http from "http";
import * as path from "path";
import cors from "cors";
import express from "express";
import { WebSocketServer } from "ws";

import {
  authenticate, publicUser, requireAuth, requireRole, seedUser, signToken,
  AuthedRequest,
} from "./auth";
import { env } from "./env";
import { Store } from "./db";
import { emit, state } from "./state";
import { batchAggregate, getTrace, startBatch, startTrace, startWatchSync, summarise } from "./orchestration";
import { sandboxComplaints, sahyogPayload } from "./integrations";
import { buildReportJson, fundFlowCsv, reportHtml } from "./reports";
import { seedIfEmpty } from "./seed";

const app = express();
app.use(cors({ origin: env.corsOrigin }));
app.use(express.json({ limit: "10mb" }));

// ------------------------------------------------------------------ boot
const store = new Store(path.resolve(env.dbFile));
state.store = store;
state.mlUrl = env.mlServiceUrl;
seedIfEmpty(store, { force: process.env.TRACE_X_RESEED === "1" });

// Demo LEA accounts (bcrypt-hashed at boot)
seedUser({ id: "u-admin", username: "admin", password: "admin123",
  name: "Joint Commissioner Sharma", role: "ADMIN", agency: "I4C — CIS Division" });
seedUser({ id: "u-io", username: "investigator", password: "io123",
  name: "Inspector A. Mehta", role: "INVESTIGATOR", agency: "Cyber PS, New Delhi" });
seedUser({ id: "u-sup", username: "supervisor", password: "sup123",
  name: "DSP P. Nair", role: "SUPERVISOR", agency: "I4C Western Region" });

const api = express.Router();

// ------------------------------------------------------------------ auth
api.post("/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  const u = authenticate(String(username || ""), String(password || ""));
  if (!u) return res.status(401).json({ error: "Invalid credentials" });
  res.json({ token: signToken(u), user: publicUser(u) });
});

api.get("/auth/me", requireAuth, (req: AuthedRequest, res) => {
  res.json({ user: req.user });
});

// ------------------------------------------------------------------ dashboard
api.get("/dashboard", requireAuth, (req, res) => {
  const t = store.tables;
  const traces = t.traces as any[];
  const cases = t.cases as any[];
  const alerts = t.alerts as any[];
  const completed = traces.filter((x) => x.status === "COMPLETED" && x.result);
  const attributed = completed.filter((x) => x.result?.primaryAttribution);
  const riskDist: Record<string, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
  for (const tr of completed) riskDist[tr.result?.risk?.level ?? "LOW"] = (riskDist[tr.result?.risk?.level ?? "LOW"] || 0) + 1;
  const typo: Record<string, number> = {};
  for (const tr of completed) {
    const k = tr.result?.risk?.typology || "UNKNOWN";
    typo[k] = (typo[k] || 0) + 1;
  }
  const chainCov: Record<string, number> = {};
  for (const tr of traces) chainCov[tr.chain] = (chainCov[tr.chain] || 0) + 1;
  const durations = completed.map((x) => x.durationMs || 0).filter(Boolean);

  res.json({
    kpis: {
      cases: cases.length,
      openCases: cases.filter((c) => c.status !== "CLOSED").length,
      traces: traces.length,
      completedTraces: completed.length,
      attributionRate: completed.length ? attributed.length / completed.length : 0,
      avgTraceMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
      p1Alerts: alerts.filter((a) => a.severity === "P1" && !a.acknowledged).length,
      unackedAlerts: alerts.filter((a) => !a.acknowledged).length,
      totalValueUsd: completed.reduce((s, x) => s + (x.result?.summary?.totalValueUsd ?? 0), 0),
    },
    riskDistribution: riskDist,
    typologyBreakdown: typo,
    chainCoverage: chainCov,
    recentTraces: traces.slice(0, 8).map((x) => summarise(x)),
    recentAlerts: alerts.slice(0, 6),
    integrations: { ncrp: env.ncrpMode, sahyog: env.sahyogMode, ml: state.mlUrl },
  });
});

// ------------------------------------------------------------------ cases
api.get("/cases", requireAuth, (req, res) => {
  const cases = [...(store.tables.cases as any[])].sort((a, b) => b.updatedAt - a.updatedAt);
  res.json({ cases });
});

api.post("/cases", requireAuth, (req: AuthedRequest, res) => {
  const { title, priority, complaint } = req.body || {};
  if (!complaint?.suspectAddresses?.length) {
    return res.status(400).json({ error: "complaint.suspectAddresses required" });
  }
  const now = Date.now();
  const id = `case-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const record = {
    id,
    reference: complaint.cen || `TRX-${new Date().getFullYear()}-${String(store.tables.cases.length + 1).padStart(4, "0")}`,
    title: title || `${complaint.category || "Crypto fraud"} — ${complaint.state || "unknown region"}`,
    status: "OPEN",
    priority: priority || "P2",
    complaint,
    createdBy: req.user?.username || "system",
    createdAt: now,
    updatedAt: now,
    traceIds: [],
    latestTraceId: null,
    riskScore: null,
    riskLevel: null,
    attributedVasp: null,
    audit: [{
      id: `aud-${now.toString(36)}`, at: now, actor: req.user?.username || "system",
      action: "CASE_CREATED", detail: `Case opened from ${complaint.source || "manual entry"}`,
    }],
  };
  (store.tables.cases as any[]).unshift(record);
  store.flush();
  emit("case_created", { caseId: id, reference: record.reference });
  res.status(201).json({ case: record });
});

api.get("/cases/:id", requireAuth, (req, res) => {
  const c = (store.tables.cases as any[]).find((x) => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: "Case not found" });
  res.json({ case: c });
});

// ------------------------------------------------------------------ traces
api.get("/traces", requireAuth, (req, res) => {
  const traces = (store.tables.traces as any[]).slice(0, 60).map((t) => ({
    ...summarise(t), status: t.status, stage: t.stage, detail: t.detail,
    caseId: t.caseId, startedAt: t.startedAt,
  }));
  res.json({ traces });
});

api.post("/traces", requireAuth, async (req: AuthedRequest, res) => {
  const { address, chain, typologyHint, caseId } = req.body || {};
  if (!address || typeof address !== "string" || address.length < 8) {
    return res.status(400).json({ error: "address required" });
  }
  if (caseId) {
    const c = (store.tables.cases as any[]).find((x) => x.id === caseId);
    if (!c) return res.status(404).json({ error: "Case not found" });
    c.status = "TRACING";
    c.updatedAt = Date.now();
    c.audit.unshift({
      id: `aud-${Date.now().toString(36)}`, at: Date.now(),
      actor: req.user?.username || "system", action: "TRACE_STARTED",
      detail: `Trace launched for ${address}`,
    });
    store.flush();
  }
  const rec = await startTrace({ address, chain, typologyHint, caseId: caseId ?? null });
  emit("trace_started", { traceId: rec.id, caseId: rec.caseId, address: rec.seedAddress });
  res.status(201).json({ trace: rec });
});

api.get("/traces/:id", requireAuth, (req, res) => {
  const rec = getTrace(req.params.id);
  if (!rec) return res.status(404).json({ error: "Trace not found" });
  res.json({ trace: rec });
});

// ------------------------------------------------------------------ batch traces
api.post("/batches", requireAuth, async (req: AuthedRequest, res) => {
  const { addresses, typologyHint, caseId } = req.body || {};
  const list = Array.isArray(addresses)
    ? addresses.map((a: any) => (typeof a === "string" ? { address: a } : a)).filter((a: any) => a?.address)
    : [];
  if (!list.length) return res.status(400).json({ error: "addresses[] required (max 25)" });
  if (list.length > 25) return res.status(400).json({ error: `Too many addresses (${list.length}); max 25 per batch` });
  if (caseId) {
    const c = (store.tables.cases as any[]).find((x) => x.id === caseId);
    if (!c) return res.status(404).json({ error: "Case not found" });
  }
  const batch = await startBatch({ addresses: list, typologyHint: typologyHint ?? null, caseId: caseId ?? null });
  res.status(201).json({ batch });
});

api.get("/batches", requireAuth, (req, res) => {
  res.json({ batches: (store.tables.batches as any[]).slice(0, 40) });
});

api.get("/batches/:id", requireAuth, (req, res) => {
  const agg = batchAggregate(req.params.id);
  if (!agg) return res.status(404).json({ error: "Batch not found" });
  res.json(agg);
});

// ------------------------------------------------------------------ ML service passthrough (v2)
// Validation, complaint-text extraction, live prices, registry labelling and
// the wallet watchlist all live in the Python ML service — these routes proxy
// them behind the same auth boundary as the rest of the API.
const ML_PROXIES: { path: string; mlPath: string; methods: string[] }[] = [
  { path: "/validate", mlPath: "/api/v1/validate", methods: ["post"] },
  { path: "/extract", mlPath: "/api/v1/extract", methods: ["post"] },
  { path: "/prices", mlPath: "/api/v1/prices", methods: ["get"] },
  { path: "/labels", mlPath: "/api/v1/labels", methods: ["get", "post"] },
  { path: "/labels/:address", mlPath: "/api/v1/labels/:address", methods: ["delete"] },
  { path: "/watchlist", mlPath: "/api/v1/watchlist", methods: ["get", "post"] },
  { path: "/watchlist/:address", mlPath: "/api/v1/watchlist/:address", methods: ["delete"] },
  { path: "/watchlist/:address/check", mlPath: "/api/v1/watchlist/:address/check", methods: ["post"] },
];

for (const p of ML_PROXIES) {
  for (const method of p.methods) {
    (api as any)[method](p.path, requireAuth, async (req: AuthedRequest, res: express.Response) => {
      try {
        const mlPath = p.mlPath
          .replace(":address", encodeURIComponent(req.params.address ?? ""));
        const r = await fetch(`${state.mlUrl}${mlPath}`, {
          method: method.toUpperCase(),
          headers: { "Content-Type": "application/json" },
          body: ["post", "put", "patch", "delete"].includes(method) && req.body
            ? JSON.stringify(req.body) : undefined,
          signal: AbortSignal.timeout(30_000),
        });
        const text = await r.text();
        res.status(r.status).type("json").send(text || "{}");
      } catch (e: any) {
        res.status(502).json({ error: `ML service unreachable: ${e?.message || e}` });
      }
    });
  }
}

// ------------------------------------------------------------------ reports
api.get("/traces/:id/report", requireAuth, (req, res) => {
  const rep = buildReportJson(req.params.id);
  if (!rep) return res.status(404).json({ error: "No completed trace result for report" });
  res.json({ report: rep });
});

api.get("/traces/:id/report.html", requireAuth, (req, res) => {
  const rep = buildReportJson(req.params.id);
  if (!rep) return res.status(404).json({ error: "No completed trace result for report" });
  res.type("html").send(reportHtml(rep));
});

api.get("/traces/:id/report.csv", requireAuth, (req, res) => {
  const csv = fundFlowCsv(req.params.id);
  if (csv === null) return res.status(404).json({ error: "No completed trace result" });
  res.type("text/csv").attachment(`tracex-fundflow-${req.params.id}.csv`).send(csv);
});

// ------------------------------------------------------------------ VASPs & samples (ML passthrough)
api.get("/vasps", requireAuth, async (req, res) => {
  try {
    const r = await fetch(`${state.mlUrl}/api/v1/vasps`);
    const body = await r.json();
    res.json(body);
  } catch (e: any) {
    res.status(502).json({ error: `ML service unreachable: ${e?.message}` });
  }
});

api.get("/samples", requireAuth, async (req, res) => {
  try {
    const r = await fetch(`${state.mlUrl}/api/v1/samples`);
    const body = await r.json();
    res.json(body);
  } catch (e: any) {
    res.status(502).json({ error: `ML service unreachable: ${e?.message}` });
  }
});

// ------------------------------------------------------------------ NCRP
api.post("/ncrp/sync", requireAuth, (req, res) => {
  const complaints = sandboxComplaints();
  (store.tables.ncrpQueue as any[]).unshift(...complaints);
  store.flush();
  emit("ncrp_synced", { imported: complaints.length });
  res.json({ imported: complaints.length, complaints });
});

api.get("/ncrp/complaints", requireAuth, (req, res) => {
  res.json({ complaints: store.tables.ncrpQueue });
});

// ------------------------------------------------------------------ SAHYOG
api.get("/sahyog/outbox", requireAuth, (req, res) => {
  res.json({ outbox: store.tables.sahyogOutbox });
});

api.post("/sahyog/alerts", requireAuth, requireRole("SUPERVISOR", "ADMIN"), (req, res) => {
  const { alertId } = req.body || {};
  const alert = (store.tables.alerts as any[]).find((a) => a.id === alertId);
  if (!alert) return res.status(404).json({ error: "Alert not found" });
  const entry = {
    id: `syg-${Date.now().toString(36)}`, at: Date.now(), type: "MANUAL_PUSH",
    refId: alert.id, caseId: alert.caseId, chain: alert.chain, status: "SENT",
    body: sahyogPayload(alert).body,
  };
  (store.tables.sahyogOutbox as any[]).unshift(entry);
  store.flush();
  res.json({ pushed: entry });
});

api.get("/alerts", requireAuth, (req, res) => {
  res.json({ alerts: (store.tables.alerts as any[]).slice(0, 80) });
});

api.post("/alerts/:id/acknowledge", requireAuth, (req, res) => {
  const a = (store.tables.alerts as any[]).find((x) => x.id === req.params.id);
  if (!a) return res.status(404).json({ error: "Alert not found" });
  a.acknowledged = true;
  store.flush();
  emit("alert_acknowledged", { alertId: a.id });
  res.json({ alert: a });
});

app.use("/api/v1", api);

// ------------------------------------------------------------------ static web console
// Single-service deployment: set WEB_DIST to the built web bundle
// (apps/web/dist) and the API serves the console on the same origin —
// no separate web hosting, no CORS, no separate WS URL.
if (env.webDist) {
  const dist = path.resolve(env.webDist);
  app.use(express.static(dist));
  // SPA fallback: any non-API route serves index.html (react-router)
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path === "/health" || req.path === "/ws") return next();
    res.sendFile(path.join(dist, "index.html"));
  });
}

app.get("/health", async (req, res) => {
  let ml = "down";
  try {
    const r = await fetch(`${state.mlUrl}/health`, { signal: AbortSignal.timeout(1500) });
    if (r.ok) ml = "up";
  } catch { /* down */ }
  res.json({ status: "ok", service: "trace-x-api", ml, mode: { ncrp: env.ncrpMode, sahyog: env.sahyogMode } });
});

// ------------------------------------------------------------------ WebSocket
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (socket) => {
  socket.send(JSON.stringify({ type: "hello", payload: { service: "trace-x", at: Date.now() }, at: Date.now() }));
});

state.broadcast = (msg) => {
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(data);
  }
};

server.listen(env.port, () => {
  startWatchSync(); // watchlist movement polling → P1 alerts + WS
  console.log("┌──────────────────────────────────────────────────┐");
  console.log("│  Trace-X API v2                                  │");
  console.log(`│  REST   http://localhost:${env.port}/api/v1            │`);
  console.log(`│  WS     ws://localhost:${env.port}/ws                  │`);
  console.log(`│  ML     ${state.mlUrl}                 │`);
  console.log("│  Demo logins: admin/admin123 · investigator/io123│");
  console.log("└──────────────────────────────────────────────────┘");
});
