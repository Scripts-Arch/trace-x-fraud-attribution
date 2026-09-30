/**
 * Trace-X — shared types between web and api.
 * Mirrors the JSON emitted by the Python ML service.
 */

export type Chain = 'BTC' | 'ETH' | 'TRON';

export type RiskLevel = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export type FraudTypology =
  | 'INVESTMENT_SCAM'
  | 'TASK_FRAUD'
  | 'SEXTORTION'
  | 'RANSOMWARE'
  | 'PHISHING'
  | 'DARKNET'
  | 'UNKNOWN';

export type TraceStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export type CaseStatus = 'OPEN' | 'TRACING' | 'ATTRIBUTED' | 'REPORTED' | 'CLOSED';

export type UserRole = 'INVESTIGATOR' | 'SUPERVISOR' | 'ADMIN';

export interface TraceNode {
  id: string;
  chain: Chain;
  label?: string | null;
  type: 'wallet' | 'exchange' | 'mixer' | 'bridge' | 'contract';
  vaspId?: string | null;
  firstIn?: number | null;
  lastOut?: number | null;
}

export interface TraceEdge {
  source: string;
  target: string;
  chain: Chain;
  asset: string;
  value: number;
  valueUsd?: number;
  txHash: string;
  timestamp: number;
  isCrossChain?: boolean;
  bridgeId?: string | null;
}

export interface VaspHit {
  vaspId: string;
  name: string;
  chain: Chain;
  wallet: string;
  path: string[];
  pathDepth: number;
  confidence: number;
  totalValueUsd: number;
  firstSeen: number | null;
}

export interface RiskFactor {
  factor: string;
  impact: number;
  detail: string;
}

export interface TraceResult {
  traceId: string;
  seedAddress: string;
  chain: Chain;
  mode: 'live' | 'simulated';
  startedAt: number;
  completedAt: number;
  durationMs: number;
  nodes: TraceNode[];
  edges: TraceEdge[];
  vaspHits: VaspHit[];
  patterns: { type: string; detail: string; addresses: string[] }[];
  crossChain: { bridgesUsed: string[]; hops: { fromChain: Chain; toChain: Chain; via: string; valueUsd: number }[] };
  risk: {
    score: number;
    level: RiskLevel;
    typology: FraudTypology;
    typologyConfidence: number;
    factors: RiskFactor[];
    modelVersion: string;
  };
  summary: {
    totalAddresses: number;
    totalTransactions: number;
    totalValueUsd: number;
    maxDepth: number;
    vaspCount: number;
    mixerCount: number;
    bridgeCount: number;
  };
}

export interface TraceProgress {
  traceId: string;
  status: TraceStatus;
  stage: string;
  detail: string;
  progress: number;
}

export interface NcrpComplaint {
  id: string;
  cen: string;
  category: string;
  subCategory?: string | null;
  amountUsd: number;
  state: string;
  district?: string | null;
  reportedAt: number;
  complainantAlias: string;
  suspectAddresses: { address: string; chain: Chain; note?: string }[];
  narrative?: string | null;
}

export interface CaseRecord {
  id: string;
  reference: string;
  title: string;
  status: CaseStatus;
  priority: 'P1' | 'P2' | 'P3';
  complaint: NcrpComplaint;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  traceIds: string[];
  latestTraceId?: string | null;
  riskScore?: number | null;
  riskLevel?: RiskLevel | null;
  attributedVasp?: string | null;
  audit: AuditEntry[];
}

export interface AuditEntry {
  id: string;
  at: number;
  actor: string;
  action: string;
  detail: string;
}

export interface Alert {
  id: string;
  at: number;
  severity: 'P1' | 'P2' | 'P3';
  kind: 'VASP_HIT' | 'HIGH_RISK' | 'MIXER' | 'BRIDGE' | 'CASE_CREATED';
  title: string;
  detail: string;
  caseId?: string | null;
  traceId?: string | null;
  chain?: Chain | null;
  vaspName?: string | null;
  acknowledged: boolean;
}

export interface User {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  agency: string;
}
