/**
 * Report generation — standardised investigation report (JSON + printable
 * HTML for PDF via browser print) and CSV export of the fund-flow table.
 */
import { stringify } from "csv-stringify/sync";
import { state } from "./state";

export function buildReportJson(traceId: string): any {
  const rec = state.store.tables.traces.find((t: any) => t.id === traceId) as any;
  if (!rec || !rec.result) return null;
  const r = rec.result;
  const primary = r.primaryAttribution;
  const risk = r.risk;
  const caseRec: any = rec.caseId
    ? state.store.tables.cases.find((c: any) => c.id === rec.caseId)
    : null;

  return {
    reportId: `RPT-${traceId.toUpperCase()}`,
    generatedAt: new Date().toISOString(),
    generatedBy: "Trace-X v1.0",
    case: caseRec
      ? { reference: caseRec.reference, title: caseRec.title, status: caseRec.status,
          priority: caseRec.priority, cen: caseRec.complaint?.cen ?? null,
          complainantState: caseRec.complaint?.state ?? null }
      : null,
    classification: "RESTRICTED — FOR OFFICIAL USE ONLY",
    trace: {
      traceId: rec.id,
      seedAddress: rec.seedAddress,
      chain: rec.chain,
      dataMode: rec.mode,
      startedAt: new Date(rec.startedAt).toISOString(),
      completedAt: rec.completedAt ? new Date(rec.completedAt).toISOString() : null,
      durationMs: rec.durationMs,
    },
    attribution: primary
      ? { vasp: primary.name, vaspId: primary.vaspId, vaspType: primary.vaspType,
          depositWallet: primary.wallet, chain: r.vaspHits?.find((h: any) => h.vaspId === primary.vaspId)?.chain ?? rec.chain,
          confidence: primary.confidence,
          pathDepth: primary.pathDepth,
          exposureUsd: primary.totalValueUsd,
          explainablePath: r.vaspHits?.find((h: any) => h.vaspId === primary.vaspId)?.path ?? [] }
      : null,
    risk: { score: risk.score, level: risk.level, typology: risk.typology,
            typologyConfidence: risk.typologyConfidence,
            factors: risk.factors, modelVersion: risk.modelVersion },
    patterns: r.patterns,
    crossChain: r.crossChain,
    recommendations: r.recommendations,
    summary: r.summary,
    vaspHits: (r.vaspHits || []).map((h: any) => ({
      name: h.name, chain: h.chain, wallet: h.wallet, pathDepth: h.pathDepth,
      confidence: h.confidence, exposureUsd: h.totalValueUsd })),
    chainOfCustody: caseRec?.audit ?? [],
  };
}

export function reportHtml(rep: any): string {
  const riskColor = rep.risk.level === "CRITICAL" ? "#ef4444"
    : rep.risk.level === "HIGH" ? "#f59e0b" : rep.risk.level === "MEDIUM" ? "#eab308" : "#22c55e";
  const esc = (s: unknown) => String(s ?? "—").replace(/[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

  const rows = (rep.vaspHits || []).map((h: any) => `
    <tr>
      <td>${esc(h.name)}</td><td>${esc(h.chain)}</td>
      <td class="mono">${esc(h.wallet)}</td><td>${esc(h.pathDepth)}</td>
      <td>${Math.round(h.confidence * 100)}%</td><td>$${Number(h.exposureUsd).toLocaleString()}</td>
    </tr>`).join("");

  const patternRows = (rep.patterns || []).map((p: any) => `
    <li><strong>${esc(p.type)}</strong> — ${esc(p.detail)}</li>`).join("") || "<li>None detected</li>";

  const recRows = (rep.recommendations || []).map((r: string) => `<li>${esc(r)}</li>`).join("");
  const factors = (rep.risk.factors || []).map((f: any) => `
    <tr><td>${esc(f.factor)}</td><td>${esc(f.impact)}</td><td>${esc(f.detail)}</td></tr>`).join("");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<title>${esc(rep.reportId)} — Trace-X Investigation Report</title>
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; margin: 0; color: #111827; }
  .head { background: #0f172a; color: #fff; padding: 24px 32px; }
  .head h1 { margin: 0 0 4px; font-size: 20px; letter-spacing: 1px; }
  .head .sub { color: #94a3b8; font-size: 12px; }
  .wrap { padding: 24px 32px; max-width: 900px; }
  h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 1px; color: #334155;
       border-bottom: 2px solid #e2e8f0; padding-bottom: 4px; margin-top: 28px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  td, th { border: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; }
  th { background: #f8fafc; }
  .mono { font-family: Consolas, monospace; font-size: 11px; word-break: break-all; }
  .badge { display: inline-block; padding: 2px 10px; border-radius: 99px; color: #fff;
           font-size: 11px; font-weight: 600; background: ${riskColor}; }
  .note { background: #fef3c7; border: 1px solid #f59e0b; padding: 8px 12px;
          font-size: 11px; border-radius: 4px; }
  .foot { margin-top: 36px; font-size: 10px; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 10px; }
  @media print { .noprint { display: none; } }
</style></head>
<body>
  <div class="head">
    <h1>TRACE-X — CRYPTOCURRENCY FLOW-OF-FUNDS INVESTIGATION REPORT</h1>
    <div class="sub">${esc(rep.reportId)} · Generated ${esc(rep.generatedAt)} · ${esc(rep.classification)}</div>
  </div>
  <div class="wrap">
    <div class="noprint" style="margin-bottom:16px">
      <button onclick="window.print()" style="padding:8px 16px;cursor:pointer">⬇ Download / Print as PDF</button>
    </div>
    <h2>1. Case Reference</h2>
    <table>
      <tr><th>Case</th><td>${esc(rep.case?.reference)} — ${esc(rep.case?.title)}</td></tr>
      <tr><th>NCRP CEN</th><td>${esc(rep.case?.cen)}</td></tr>
      <tr><th>Complainant state</th><td>${esc(rep.case?.complainantState)}</td></tr>
      <tr><th>Status / priority</th><td>${esc(rep.case?.status)} / ${esc(rep.case?.priority)}</td></tr>
    </table>

    <h2>2. Suspect Wallet &amp; Data Source</h2>
    <table>
      <tr><th>Seed address</th><td class="mono">${esc(rep.trace.seedAddress)}</td></tr>
      <tr><th>Chain</th><td>${esc(rep.trace.chain)} · ${esc(rep.trace.dataMode)} data</td>
      <tr><th>Trace window</th><td>${esc(rep.trace.startedAt)} → ${esc(rep.trace.completedAt)} (${esc(rep.trace.durationMs)} ms)</td></tr>
    </table>

    <h2>3. Exchange / VASP Attribution</h2>
    <table>
      <tr><th>Attributed VASP</th><td><strong>${esc(rep.attribution?.vasp)}</strong>
        <span class="badge">${Math.round((rep.attribution?.confidence ?? 0) * 100)}%</span></td></tr>
      <tr><th>Deposit wallet</th><td class="mono">${esc(rep.attribution?.depositWallet)}</td></tr>
      <tr><th>Hops from seed</th><td>${esc(rep.attribution?.pathDepth)}</td></tr>
      <tr><th>Exposure</th><td>$${Number(rep.attribution?.exposureUsd ?? 0).toLocaleString()}</td></tr>
      <tr><th>Explainable path</th><td class="mono">${esc((rep.attribution?.explainablePath || []).join(" → "))}</td></tr>
    </table>

    <h2>4. Risk Assessment</h2>
    <table>
      <tr><th>Risk</th><td><span class="badge">${esc(rep.risk.score)}/100 · ${esc(rep.risk.level)}</span></td></tr>
      <tr><th>Fraud typology</th><td>${esc(rep.risk.typology)} (${Math.round((rep.risk.typologyConfidence ?? 0) * 100)}%)</td></tr>
      <tr><th>Model</th><td>${esc(rep.risk.modelVersion)}</td></tr>
    </table>
    <table><tr><th>Factor</th><th>Impact</th><th>Detail</th></tr>${factors}</table>

    <h2>5. Detected Laundering Patterns</h2>
    <ul>${patternRows}</ul>

    <h2>6. VASP Hits</h2>
    <table><tr><th>VASP</th><th>Chain</th><th>Wallet</th><th>Hops</th><th>Confidence</th><th>Exposure</th></tr>${rows}</table>

    <h2>7. Investigative Recommendations</h2>
    <ol>${recRows}</ol>

    <h2>8. Chain of Custody</h2>
    <table><tr><th>Time (UTC)</th><th>Actor</th><th>Action</th></tr>
      ${(rep.chainOfCustody || []).map((a: any) =>
        `<tr><td>${esc(new Date(a.at).toISOString())}</td><td>${esc(a.actor)}</td><td>${esc(a.detail)}</td></tr>`).join("")}
    </table>

    <div class="foot">
      Generated by Trace-X v1.0 — Real-Time Crypto Fraud Attribution Platform ·
      I4C / CIS Division demo artefact · Report ID ${esc(rep.reportId)}.
      Data mode: ${esc(rep.trace.dataMode)}. This report is generated for investigative
      support and does not constitute evidence by itself.
    </div>
  </div>
</body></html>`;
}

export function fundFlowCsv(traceId: string): string | null {
  const rec = state.store.tables.traces.find((t: any) => t.id === traceId) as any;
  if (!rec || !rec.result) return null;
  const rows = (rec.result.edges || []).map((e: any) => ({
    txHash: e.txHash, timestampIso: new Date(e.timestamp).toISOString(),
    chain: e.chain, asset: e.asset, source: e.source, target: e.target,
    value: e.value, valueUsd: e.valueUsd,
    crossChain: e.isCrossChain ? "yes" : "no",
  }));
  return stringify(rows, { header: true });
}
