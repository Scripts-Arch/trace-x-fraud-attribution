/**
 * NCRP + SAHYOG integration layer (sandbox simulation).
 *
 * NCRP  : national cybercrime reporting portal — complaint ingestion.
 * SAHYOG: inter-agency coordination platform — alert push + acknowledgment.
 */
import * as crypto from "crypto";

function rid(): string {
  return crypto.randomBytes(4).toString("hex");
}

export function sandboxComplaints(): any[] {
  const now = Date.now();
  const year = new Date().getFullYear();
  return [
    {
      id: `ncrp-${rid()}`,
      cen: `CEN-${year}-482110`,
      category: "Investment / trading fraud",
      subCategory: "Crypto trading group",
      amountUsd: 12400,
      state: "Maharashtra",
      district: "Pune",
      reportedAt: now - 36e5 * 20,
      complainantAlias: "Complainant #48211",
      suspectAddresses: [
        { address: "TJLKnZKEWM2VdTqXhUK8LWG1cQ4uHBBurn", chain: "TRON",
          note: "WhatsApp 'mentor' collection wallet" },
      ],
      narrative:
        "Victim lured via WhatsApp trading group; deposits made across 4 transactions " +
        "to the collection wallet before the group went silent.",
    },
    {
      id: `ncrp-${rid()}`,
      cen: `CEN-${year}-519023`,
      category: "Sextortion",
      amountUsd: 2100,
      state: "Uttar Pradesh",
      district: "Lucknow",
      reportedAt: now - 36e5 * 46,
      complainantAlias: "Complainant #51902",
      suspectAddresses: [
        { address: "bc1qe36w2wz9828z567vlw5r4zv0f39p5wetpge6tl", chain: "BTC",
          note: "Blackmail payment address" },
      ],
      narrative:
        "Video-call recording blackmail; BTC payment demanded within 24 hours of the call.",
    },
    {
      id: `ncrp-${rid()}`,
      cen: `CEN-${year}-603471`,
      category: "Task-based fraud",
      amountUsd: 860,
      state: "Karnataka",
      district: "Bengaluru Urban",
      reportedAt: now - 36e5 * 70,
      complainantAlias: "Complainant #60347",
      suspectAddresses: [
        { address: "0x7358e2aB59D4A01EDfE1CC52f410316131669e20", chain: "ETH",
          note: "Unlock-deposit collector" },
      ],
      narrative:
        "Victims paid small task-completion incentives, then asked for refundable " +
        "'unlock deposits' that were never returned.",
    },
  ];
}

export function sahyogPayload(alert: any): any {
  return {
    messageType: "TRACE_X_ALERT",
    alertId: alert.id,
    severity: alert.severity,
    kind: alert.kind,
    chain: alert.chain ?? null,
    vasp: alert.vaspName ?? null,
    caseRef: alert.caseId ?? null,
    body: alert.detail,
    issuedAt: new Date(alert.at).toISOString(),
    issuingAgency: "I4C-CIS (Trace-X)",
  };
}
