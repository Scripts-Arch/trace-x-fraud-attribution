/**
 * API smoke tests — boot the server, exercise auth + case + NCRP flows.
 * Trace orchestration is tested only for graceful failure (ML not running).
 */
import * as assert from "assert";
import { describe, it } from "node:test";

process.env.PORT = "4321";
process.env.TRACE_X_DB = "data/test-tracex.db";
process.env.ML_SERVICE_URL = "http://127.0.0.1:59999"; // unreachable on purpose

function req(method: string, url: string, body?: any, token?: string):
  Promise<{ status: number; json: any }> {
  return fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));
}

describe("Trace-X API", () => {
  // server is booted by the test runner wrapper (run-api-tests.mjs)
  const BASE = `http://127.0.0.1:4321/api/v1`;
  let token = "";

  it("rejects unauthenticated access", async () => {
    const r = await req("GET", `${BASE}/cases`);
    assert.strictEqual(r.status, 401);
  });

  it("rejects bad credentials", async () => {
    const r = await req("POST", `${BASE}/auth/login`, { username: "admin", password: "wrong" });
    assert.strictEqual(r.status, 401);
  });

  it("logs in the demo admin", async () => {
    const r = await req("POST", `${BASE}/auth/login`, { username: "admin", password: "admin123" });
    assert.strictEqual(r.status, 200);
    assert.ok(r.json.token);
    assert.strictEqual(r.json.user.role, "ADMIN");
    token = r.json.token;
  });

  it("returns a populated dashboard (seeded)", async () => {
    const r = await req("GET", `${BASE}/dashboard`, undefined, token);
    assert.strictEqual(r.status, 200);
    assert.ok(r.json.kpis.cases > 0, "seeded cases expected");
    assert.ok(r.json.kpis.completedTraces > 0, "seeded completed traces expected");
  });

  it("creates a case and lists it", async () => {
    const created = await req("POST", `${BASE}/cases`, {
      title: "Test case — unit",
      complaint: {
        cen: "CEN-TEST-1", category: "Phishing", amountUsd: 500, state: "Delhi",
        reportedAt: Date.now(), complainantAlias: "tester",
        suspectAddresses: [{ address: "TXk9Q4tGdwJcK8ZLPmA6rFZBxpig9cLZmN", chain: "TRON" }],
      },
    }, token);
    assert.strictEqual(created.status, 201);
    const list = await req("GET", `${BASE}/cases`, undefined, token);
    assert.ok(list.json.cases.some((c: any) => c.reference === "CEN-TEST-1"));
  });

  it("gracefully fails a trace when the ML service is down", async () => {
    const started = await req("POST", `${BASE}/traces`,
      { address: "TXk9Q4tGdwJcK8ZLPmA6rFZBxpig9cLZmN", chain: "TRON" }, token);
    assert.strictEqual(started.status, 201);
    const id = started.json.trace.id;
    await new Promise((res) => setTimeout(res, 700));
    const rec = await req("GET", `${BASE}/traces/${id}`, undefined, token);
    assert.strictEqual(rec.json.trace.status, "FAILED");
    assert.ok(/unreachable/i.test(rec.json.trace.detail));
  });

  it("imports NCRP complaints in sandbox mode", async () => {
    const r = await req("POST", `${BASE}/ncrp/sync`, {}, token);
    assert.strictEqual(r.status, 200);
    assert.ok(r.json.imported >= 3);
  });

  it("enforces role gates on SAHYOG push", async () => {
    const login = await req("POST", `${BASE}/auth/login`, { username: "investigator", password: "io123" });
    const ioToken = login.json.token;
    const r = await req("POST", `${BASE}/sahyog/alerts`, { alertId: "alr-seed-investment" }, ioToken);
    assert.strictEqual(r.status, 403);
  });

  it("serves report HTML for a seeded completed trace", async () => {
    const traces = await req("GET", `${BASE}/traces`, undefined, token);
    const seeded = traces.json.traces.find((t: any) => t.traceId?.startsWith?.("trc-seed-")) ||
      traces.json.traces[0];
    const r = await fetch(`http://127.0.0.1:4321/api/v1/traces/${seeded.traceId || seeded.id}/report.html`,
      { headers: { Authorization: `Bearer ${token}` } });
    assert.strictEqual(r.status, 200);
    const html = await r.text();
    assert.ok(html.includes("TRACE-X"), "report header expected");
  });
});
