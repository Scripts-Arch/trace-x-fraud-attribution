# Trace-X — Technical Deep-Dive (for judge Q&A)

Companion to [HOW_IT_WORKS.md](HOW_IT_WORKS.md) (plain-language guide) and [README.md](README.md).
Everything below is verified against the actual source — file references included so you can
pull any of it up live if a judge wants to see code.

---

## 1. Architecture

```
 Browser (React SPA, Vercel CDN)
   │  HTTPS REST + WSS
   ▼
 apps/api — Node/Express + ws          apps/ml — Python/FastAPI
   auth (JWT/bcrypt/roles)              chain adapters + failover
   case store (JSON-file DB)            BFS tracer + union-find clustering
   trace orchestration + polling  ───▶  VASP attribution + patterns
   WebSocket broadcast                  GradientBoosting risk model
   NCRP/SAHYOG sandbox, reports         price oracle, watchlist poller
   (Render)                             (Render)
```

- **apps/web** — React 18 + Vite + TypeScript + Tailwind; Cytoscape.js for the fund-flow graph.
  Deployed: `https://trace-x-fraud-attribution.vercel.app` (SPA rewrite config in
  [apps/web/vercel.json](apps/web/vercel.json)).
- **apps/api** — Express 4 orchestration layer; owns auth, persistence, WS fan-out, reports,
  integrations; proxies ML routes behind the same auth boundary. Deployed:
  `https://trace-x-api-w8ct.onrender.com` ([render.yaml](render.yaml) blueprint).
- **apps/ml** — FastAPI engine; all blockchain I/O, graph analysis and ML. Also Render.
- **packages/shared** — TypeScript types consumed by api + web (`npm workspaces`).

**Why three services:** independent scaling and failure domains (ML is the heavy/CPU part),
different runtimes where each belongs, and it mirrors real product topology (UI tier / service
tier / compute tier).

---

## 2. Stack + versions

| Layer | Tech | Why |
|---|---|---|
| Web | React 18, Vite 5, TS 5, Tailwind, Cytoscape.js, recharts | Fast build, typed contracts, graph viz in canvas (handles hundreds of nodes) |
| API | Node 18+, Express 4, `ws`, `jsonwebtoken`, `bcryptjs`, `csv-stringify` | Small, zero-native-deps, deployable anywhere |
| ML | Python 3.11, FastAPI 0.111, pydantic 2.7, scikit-learn 1.5 (GradientBoostingRegressor), requests, networkx | Standard, defensible data-science stack; Uvicorn/ASGI for concurrent jobs |
| Persistence | JSON-file store (api), JSON cache dirs (ml) | Zero setup, replayable, swap-point for Postgres (§9) |
| Infra | Vercel (web), Render blueprint `render.yaml` (api+ml), GitHub | IaC blueprint → reproducible deploys; Node build from repo root for npm workspaces |

---

## 3. Request lifecycle: one trace

1. **POST `/api/v1/traces`** `{address, chain?, typologyHint?, caseId?}` (Bearer JWT).
   API validates shape, links the case (audit entry `TRACE_STARTED`), creates a trace record
   `PENDING`, emits WS `trace_started`, returns **201 immediately** (async job).
2. **API → ML POST `/api/v1/trace`** — ML validates the address cryptographically, then runs
   the pipeline in a background job (in-memory `JOBS` dict): each stage reports
   `INIT → FETCH → PATTERN → CLUSTER → ATTRIBUTION → RISK → DONE` with % progress
   ([engine.py](apps/ml/app/engine.py)).
3. **API polls** the ML job every ~1.5 s ([orchestration.ts](apps/api/src/orchestration.ts)),
   mirrors stage/progress/percent into the record and broadcasts **`trace_progress`** over
   WebSocket — the Investigation screen updates without polling from the browser.
4. On `COMPLETED`: result (nodes, edges, vaspHits, patterns, risk, summary, recommendations)
   is stored, `mode` + `durationMs` recorded, case linked, `raiseAlerts()` evaluates P1/P2/P3,
   WS `trace_completed` fires. On error: `trace_failed` with detail — UI shows failure, never hangs.
5. **Budgets:** ML hard time-budget 55 s per trace, HTTP timeout 12 s per upstream call,
   ≤6 hops, ≤220 addresses, ≤40 txs per address ([config.py](apps/ml/app/config.py)).
   Deployed end-to-end we measured **~16.6 s** (sample, simulated mode); dashboard
   `avgTraceMs` tracks the real average.

**Batch:** POST `/batches` (≤25) → each address validated first (rejections carry reasons),
valid ones traced in parallel, WS `batch_progress` per trace, aggregate view computed on read.

---

## 4. ML engine internals

### 4.1 Chain adapters ([adapters.py](apps/ml/app/adapters.py))
- Multi-source with **priority failover**: BTC `blockchain.info → blockstream.info`;
  ETH `Etherscan v2 → Blockscout`; TRON `Tronscan` native TRX + **TRC-20 token transfers**
  (USDT/USDC — where fraud volume actually lives).
- Every response normalised into `AddressInfo` / `TxEdge`; USD via the **price oracle**.
- **Disk cache** keyed `md5(chain:address)`, TTL 6 h → traces are replayable offline and the
  demo survives venue WiFi. `requests.Session`, 12 s timeouts.
- `live_check.py` (scripts) spot-checks freshness by discovering addresses from the latest
  blocks (BTC mempool.space→blockstream; ETH Blockscout v2; TRON Tronscan) — 8/8 locally.

### 4.2 Tracer ([tracer.py](apps/ml/app/tracer.py))
- **BFS expansion** from the seed: frontier fetched level-by-level through a
  `ThreadPoolExecutor(max_workers=6)`; each worker writes into an **isolated sub-graph**
  merged serially (thread-safe, deduped by `txHash+src+dst+asset`).
- Guards: depth ≤ `MAX_HOPS(6)`, graph ≤ `MAX_ADDRESSES(220)`, ≤ `MAX_TX(40)` counterparties
  per address, wall-clock budget 55 s. Registry labels attached to nodes as discovered.
- **Hybrid policy:** if the adapter errors **or returns zero edges** → deterministic
  simulator takes over, and `graph.mode` records `live` vs `simulated` (shown in UI).

### 4.3 Attribution ([attribution.py](apps/ml/app/attribution.py))
1. **Union-find co-spend clustering** — addresses appearing in the same tx share common
   control (path-compressed union-find over tx participants; cross-chain edges excluded).
2. **Value-weighted BFS** from seed to every registry-labelled wallet; paths may traverse
   other labelled nodes (bridge → exchange) and still count.
3. **Exposure** = min edge value along the path (**bottleneck semantics** — the max that can
   actually have travelled that route).
4. **Confidence** = `0.97 − depth_penalty(0…0.42) − exposure_factor − 0.12·KYT`, clamped
   [0.35, 0.98]. Higher KYT (know-your-transaction) score of the VASP → slightly lower
   confidence we can freeze.
5. **Ranking is policy-aware:** freezable CEX first (`weight CEX 1.0, INSTANT_SWAP 0.94,
   DARKNET 0.62, MIXER 0.58, BRIDGE 0.45`), ties by USD exposure, top 8 hits; best hit per
   VASP by `value/depth`. Every hit carries the **explicit wallet path** — explainability
   is structural, not cosmetic.

### 4.4 Pattern detectors ([tracer.py §patterns](apps/ml/app/tracer.py))
`DUSTING` (≥3 sub-$1 inbounds) · `FAN_IN` (≥3 deposits into seed) · `PEEL_CHAIN` (wallets
with ≥3 time-ordered outputs containing decreasing-value runs) · `MIXER_PASS` (mixer-type
node in graph) · `CROSS_CHAIN` (bridge edges) · `RAPID_MOVEMENT` (burst of ≥3 outbound
transfers in a short window) · plus round-trip detection. Each pattern lists the addresses
involved — evidence, not just a flag.

### 4.5 Risk model ([risk.py](apps/ml/app/risk.py) + [train_model.py](apps/ml/train_model.py))
- **12 graph features:** `fan_in, fan_out, tx_velocity, avg_usd, max_usd, mixer_proximity,
  bridge_usage, counterparty_risk, vasp_distance, graph_size_norm, fan_in_out_ratio, usd_log`.
- **Model:** sklearn `GradientBoostingRegressor(n_estimators=240, learning_rate=0.07,
  max_depth=3, subsample=0.9)` — small, fast (<10 ms inference), robust on tabular features.
- **Training data:** 600 synthetic traces (200 per chain, all 6 typologies, 2–5 hops)
  generated by the simulator; teacher signal = the transparent heuristic score + Gaussian
  noise σ=3.5 (forces generalisation over memorisation); in-sample MAE reported at train
  time. Artifact committed: `models/risk_model.pkl` (+ meta JSON probe).
- **Final score** = `clamp(model/heuristic + 2.5·patterns_found (max +10), 0, 99)`; level
  bands LOW<35≤MEDIUM<60≤HIGH<80≤CRITICAL.
- **Graceful degradation:** if the artifact is missing → heuristic-v1 (rule scores with
  explainable factors); every response records `modelVersion`.
- **Typology:** hint-weighted evidence classifier — hint +0.45, graph evidence adds to
  INVESTMENT_SCAM / TASK_FRAUD / SEXTORTION / RANSOMWARE / PHISHING / DARKNET; UNKNOWN if
  top score <0.4; full score vector returned.

### 4.6 Validation & extraction ([validation.py](apps/ml/app/validation.py))
- **bech32 (BIP-173)** polymod checksum for BTC SegWit (`bc1…`), mixed-case rejected.
- **base58check** double-SHA256 checksum, prefix-checked (BTC P2PKH/P2SH; TRON `0x41`).
- **EIP-55** keccak-256 checksum for ETH (all-lower/all-upper accepted as unchecksummed).
- Tested against **official BIP-173 vectors** and **every single-character corruption** of
  sample addresses (39 pytest suite incl. chaos tests). `extract_addresses()` regex-pulls
  BTC/ETH/TRON candidates from raw complaint text, case-deduped, then validated.

### 4.7 Price oracle ([prices.py](apps/ml/app/prices.py))
CoinGecko `simple/price`, in-memory 10-min cache + disk snapshot; fallback chain:
fresh → in-memory stale → disk last-known-good → hardcoded table. Valuations never break.

### 4.8 Watchlist ([watchlist.py](apps/ml/app/watchlist.py))
Persisted watches (`cache/watchlist.json`); poller thread re-fetches via the same adapters
(~45 s cadence, driven by API `watchSync`), diffs `knownTxHashes`, appends movements, marks
P1-worthy → API raises alerts and broadcasts `watch_movement`. Manual **check-now** endpoint.

### 4.9 Simulator
Deterministic (seeded) fraud-graph generator per typology — realistic peel chains, mixer
passes, fan-ins — same output schema as live graphs, so downstream code is identical.

---

## 5. API service internals

- **Endpoints:** `auth/login`, `auth/me` · `dashboard` · `cases` CRUD (+audit) · `traces`
  (list/create/get) · `batches` (create/list/get-aggregate) · ML proxies `validate, extract,
  prices, labels, watchlist(+/:addr/check)` · `reports/:traceId.(html|json|csv)` ·
  `integrations/ncrp (import)` · `sahyog push (SUPERVISOR-gated)` · WebSocket `/ws`.
- **Auth** ([auth.ts](apps/api/src/auth.ts)): bcrypt(cost 8) hashes; JWT HS256, **12 h expiry**,
  role claim; `requireAuth` + `requireRole` middleware. Roles: `INVESTIGATOR, SUPERVISOR,
  ADMIN` — e.g. SAHYOG push requires supervisor.
- **Store** ([db.ts](apps/api/src/db.ts)): in-memory tables (`users, cases, traces, alerts,
  ncrpQueue, sahyogOutbox, batches`) flushed to a JSON file on every mutation. Chosen for
  zero-native-dep deployability; the Store interface is the swap point for Postgres (§9).
- **WebSocket** ([state.ts](apps/api/src/state.ts) + ws): event catalogue
  `trace_started, trace_progress, trace_completed, trace_failed, batch_progress,
  case_created, watch_movement`.
- **Reports** ([reports.ts](apps/api/src/reports.ts)): standardised HTML (classification
  banner, case reference + CEN, attribution with path, risk factors, **chain-of-custody**
  from the case audit log) print-to-PDF; JSON build; CSV fund-flow export.
- **NCRP/SAHYOG** ([integrations.ts](apps/api/src/integrations.ts)): sandbox simulation of
  complaint ingestion (CEN records) and inter-agency alert push with acknowledgment outbox —
  interface-complete for production credentials.
- **CORS:** allowlist from `CORS_ORIGIN` (csv, exact origin match). JSON body limit 10 MB.

---

## 6. Web app internals

- React Router 6 (auth-guarded `RequireAuth`), pages: Dashboard, NewTrace (3 modes),
  Investigation, BatchView, Watchlist, CaseList, VaspRegistry, Alerts ([App.tsx](apps/web/src/App.tsx)).
- [api.ts](apps/web/src/lib/api.ts): single fetch wrapper injecting the JWT; `VITE_API_URL` /
  `VITE_WS_URL` baked at build time (present in the deployed bundle — verified).
- FlowGraph: Cytoscape.js canvas — nodes coloured per chain, VASP nodes highlighted, click →
  node inspector (label form), asset/chain filter, timeline view.
- Live updates via the `/ws` WebSocket; investigation screen shows staged progress
  (FETCH → PATTERN → CLUSTER → ATTRIBUTION → RISK).
- Vercel: `buildCommand npx vite build`, `dist` output, SPA rewrites
  ([apps/web/vercel.json](apps/web/vercel.json)).

---

## 7. Failure modes & graceful degradation (judge favourite)

| Dependency fails | Behaviour | User sees |
|---|---|---|
| blockchain.info down | blockstream failover (same for Etherscan→Blockscout) | nothing (transparent) |
| all chain APIs down / 0 edges | deterministic simulator | `simulated` mode badge |
| CoinGecko down | stale → disk → static table | prices slightly old, chip shows cache age |
| ML service down | API trace fails gracefully; validation endpoints report unreachable | clear error, batch falls back to shape-check |
| WS drops | REST still fully functional; UI shows connecting state | degraded liveness only |
| Model file missing | heuristic-v1 scoring | `model: heuristic-v1` in factors |

---

## 8. Security posture

JWT (12 h) + bcrypt password hashes + role gates; all ML access proxied through the API's
auth boundary (no direct ML exposure to the browser); CORS exact-origin allowlist; pydantic
input bounds + Express body limit; no secrets in the repo (`.env` gitignored, Render
`generateValue` for JWT_SECRET); immutable audit entries on cases (chain of custody);
addresses checksummed before any processing.

**Honest limits (say them before judges ask):** demo credentials are seeded; no rate
limiting yet; JSON-file DB is single-node; sandbox integrations are simulated. Production
hardening list: Postgres + object storage, Redis job queue + rate limiter, mTLS between
tiers, secret rotation, audit log to append-only storage, real NCRP/SAHYOG credentials.

---

## 9. Scalability path (the "what next" answer)

1. **Persistence:** `Store` → Postgres (interface already isolated); audit trail →
   append-only table.
2. **Jobs:** in-memory `JOBS`/polling → Redis/BullMQ queue + worker pool; ML scales
   horizontally behind an internal LB (it's stateless apart from caches).
3. **Chain data:** adapters → paid indexers (Etherscan Pro, Bitquery, TronGrid Pro) with the
   same normalisation layer; add S3-style cache for raw receipts.
4. **ML:** model registry + retraining pipeline (train_model.py is already parameterised);
   add per-typology classifiers and graph-embedding models later.
5. **Realtime:** single `ws` node → Redis pub/sub fan-out for multi-instance API.
6. **Coverage:** more chains (Solana, Polygon) = one adapter class each + registry entries.

---

## 10. Technical Q&A crib sheet

1. **"Why GradientBoosting and not a neural net?"** — 12 tabular features, 600 samples:
   GBDT is the right bias/variance point, trains in seconds, inference <10 ms, and feature
   importances are explainable. A GNN is the natural v3 (needs far more labelled graphs).
2. **"Where does training data come from if fraud graphs aren't public?"** — The simulator
   generates labelled synthetic graphs from typology templates; the heuristic (written from
   public laundering literature) is the teacher with added noise. Production path: FCAT/FIR
   data + LEA feedback loop relabels.
3. **"How do you know the attribution is right?"** — We never assert; we rank with an
   explainable path (wallet-by-wallet txhashes) + confidence formula (§4.3). The path is
   independently verifiable on a block explorer.
4. **"Union-find on what relation?"** — Same-transaction co-spending ⇒ common control
   (standard heuristic; exchange sweep wallets cluster correctly). Cross-chain edges excluded.
5. **"Why bottleneck (min-edge) exposure?"** — Value through a multi-hop route is limited by
   its smallest edge; max-edge would overstate laundering capacity.
6. **"Is tracing real-time?"** — Graph fetch budget 55 s live (we measured ~16 s simulated
   end-to-end deployed); watchlist movements alert within ~45 s. Both shown live via WS.
7. **"Why a JSON file DB — isn't that a toy?"** — Deliberate: zero native deps = deploy
   anywhere (Render / offline venue), atomic single-writer, fully inspectable. The Store
   class is the isolated swap point (§9.1).
8. **"Auth model?"** — bcrypt(8) hashes, JWT HS256 12 h with role claim, middleware gates
   (`requireAuth`, `requireRole('SUPERVISOR')` on SAHYOG), exact-origin CORS.
9. **"What happens on venue WiFi?"** — Six-hour disk cache of every fetch + deterministic
   simulator + stale price fallbacks. The demo cannot dead-end, and the mode badge keeps it
   honest.
10. **"Address validation — why bother?"** — Garbage in, wasted graph budget out. We verify
    BIP-173 polymod, base58check double-SHA256, EIP-55 keccak; fuzz-tested against every
    single-character corruption of test addresses.
11. **"How does complaint-text extraction work?"** — Tokenise text on separators, chain-shape
    regex prefilter (length/charset), then full cryptographic validation + chain ID; case-
    deduped; up to 25 per batch.
12. **"How is this different from Chainalysis/TRM?"** — Those are commercial closed products
    on licensed data. Trace-X is an open, India-first LEA workflow console (NCRP/SAHYOG
    alignment, roles, chain of custody, freezable-first attribution) built on public data —
    a working reference implementation, not a competitor claim.

---

## 11. Repo map

| Path | Responsibility |
|---|---|
| `apps/ml/app/adapters.py` | chain adapters + failover + disk cache |
| `apps/ml/app/tracer.py` | BFS tracer, thread pool, pattern detectors |
| `apps/ml/app/attribution.py` | union-find clustering, path search, confidence |
| `apps/ml/app/risk.py` | features, GBDT inference, heuristic fallback, typology |
| `apps/ml/app/validation.py` | bech32 / base58check / EIP-55, text extraction |
| `apps/ml/app/prices.py` / `watchlist.py` / `simulator.py` | price oracle / movement poller / deterministic demo graphs |
| `apps/ml/train_model.py` | synthetic dataset + GBDT training → `models/risk_model.pkl` |
| `apps/api/src/index.ts` | routes, CORS, static SPA mode, WS server |
| `apps/api/src/orchestration.ts` | trace/batch job lifecycle + polling + watch sync |
| `apps/api/src/auth.ts` / `db.ts` / `reports.ts` / `integrations.ts` | JWT+roles / JSON store / reports / NCRP+SAHYOG |
| `apps/web/src/views/*` | Dashboard, NewTrace, Investigation, BatchView, Watchlist, Cases, Registry, Alerts |
| `apps/web/src/components/FlowGraph.tsx` | Cytoscape fund-flow visualisation |
| `render.yaml` / `apps/web/vercel.json` / `DEPLOY.md` | infra-as-code + deploy runbook |

**Test surface:** 39 pytest (validation vectors, corruption fuzzing, extraction fixtures,
FakeAdapter watchlist diffing, price stale-fallback), 9 API tests (auth, dashboard, cases,
ML-down trace failure, NCRP import, SAHYOG role gate, report HTML).
