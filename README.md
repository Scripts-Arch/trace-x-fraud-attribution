# Trace-X — Real-Time Crypto Fraud Attribution Platform

**Smart India Hackathon 2026 · Problem 26183 · MHA / I4C — CIS Division**
*Real-Time Identification of Fraud-Linked Cryptocurrency Exchanges from Victim-Reported Suspect Wallet Addresses through Automated Blockchain Analytics*

Paste a suspect wallet → get the **nearest exchange/VASP attribution with an explainable path**, full fund-flow graph, ML risk score, fraud typology, laundering-pattern flags and a standardised investigation report — in seconds.

**v2:** no hardcoded data anywhere — live price oracle, multi-source chain adapters with automatic failover, cryptographic address validation, batch tracing, complaint-text wallet extraction, and a live wallet watchlist with P1 movement alerts.

---

## What it does

| Capability | How |
|---|---|
| **Multi-chain tracing** | Live public-chain adapters for **BTC** (blockchain.info → blockstream failover), **ETH** (Etherscan v2 → Blockscout failover) and **TRON** (Tronscan + TRC-20), with a disk cache so every trace is replayable offline |
| **Demo-proof hybrid mode** | If a chain API is unreachable, a deterministic fraud-graph simulator takes over — the round-2 demo can never dead-end on bad venue WiFi (`mode: live / simulated` is shown on every trace) |
| **VASP attribution** | Curated registry of 36 labelled entities (Binance, OKX, Bybit, KuCoin, Coinbase, WazirX, CoinDCX, Tornado Cash, Stargate…). Value-weighted shortest-path search ranks **freezable exchanges first**, with the explainable wallet-by-wallet path and confidence % |
| **Pattern detection** | Peel chains, mixer passes, victim fan-in, dusting, cross-chain bridge hops, round-tripping, rapid movement |
| **ML risk scoring** | scikit-learn GradientBoosting trained on 600 synthetic fraud traces (12 graph features) → 0–100 score, risk level, and an explainable factor table. Heuristic fallback when the model file is absent |
| **Typology classification** | Investment scam · task fraud · sextortion · ransomware · phishing · darknet — hint-weighted graph evidence |
| **LEA workflow** | JWT auth with roles (Investigator / Supervisor / Admin), case management with immutable audit trail (chain of custody), NCRP complaint ingestion, SAHYOG alert push, auto-generated P1/P2/P3 alerts, WebSocket live progress |
| **Reports** | Standardised investigation report (print-to-PDF HTML), JSON API, CSV fund-flow export |
| **Batch tracing (v2)** | Paste up to 25 wallets (or an entire complaint narrative) → per-address cryptographic validation, intake rejection with reasons, parallel traces, and a consolidated view: attribution rate, per-VASP exposure, risk distribution |
| **Complaint extraction (v2)** | `extract_addresses()` pulls every BTC/ETH/TRON wallet out of raw NCRP/FIR text (case-deduped, checksum-verified) — paste the complaint, get the suspects |
| **Address validation (v2)** | Full cryptographic checks: BIP-173 bech32, double-SHA256 base58check (BTC P2PKH/P2SH + TRON 0x41), EIP-55 keccak checksums. Typos rejected with a reason, never silently accepted |
| **Live price oracle (v2)** | CoinGecko USD prices (10-min cache, stale last-known-good fallback) — every valuation in the platform is market-rate; price chip on Investigation & Watchlist views |
| **Wallet watchlist (v2)** | Pin suspect wallets; a background poller re-fetches live chain activity and raises **P1 alerts over WebSocket** on new movements; manual "Check now"; SAHYOG push on P1 |
| **Extensible labeling (v2)** | Investigators label any address as exchange/mixer/bridge mid-investigation; user labels persist and **take priority over the curated registry** for future attributions |

## Architecture

```
┌─────────────┐   REST + WebSocket    ┌─────────────┐    REST     ┌──────────────────┐
│  apps/web   │ ────────────────────▶ │  apps/api   │ ──────────▶ │     apps/ml      │
│ React+Vite  │   live trace progress │ Node/Express│  trace jobs │  Python/FastAPI  │
│ Cytoscape   │ ◀──────────────────── │  auth/cases │             │ tracing+ML       │
└─────────────┘                       └─────────────┘             └──────────────────┘
   :5173                                  :4000                        :8000
```

- **apps/ml** — chain adapters, BFS tracer, union-find co-spend clustering, VASP attribution, pattern detectors, risk model (`train_model.py`), demo simulator
- **apps/api** — auth, case store (JSON-file DB, zero native deps), trace orchestration + polling, WS broadcast, NCRP/SAHYOG sandbox integrations, reports
- **apps/web** — intel console: dashboard, new trace, investigation graph, cases, VASP registry, alerts
- **packages/shared** — TypeScript types shared by api + web

## Quickstart (local, 3 terminals)

```bash
# 1 — ML service
pip install -r apps/ml/requirements.txt
python -m uvicorn app.main:app --port 8000 --app-dir apps/ml

# 2 — API
npm install
npm run dev:api

# 3 — Web console
npm run dev:web        # http://localhost:5173
```

**Demo logins:** `admin / admin123` · `investigator / io123` · `supervisor / sup123`

### Docker (one command)

```bash
docker compose up --build
# console on http://localhost:5173
```

## 5-minute judge walkthrough

1. **Login** (`admin/admin123`) → dashboard shows seeded operations history: KPIs, risk distribution, typologies, chain coverage.
2. **New Trace → one-click "Investment scam — TRON USDT peel chain"** → watch the live progress stream (graph expansion → pattern detection → clustering → attribution).
3. **Investigation view**: animated fund-flow graph; red seed node, green exchange nodes, purple mixer, dashed orange bridge edge. The **attribution panel** shows *KuCoin — 77% — 2 hops* with the click-through explainable path. Click any node for the inspector (inflow/outflow, txns, cluster).
4. Point out **risk 74 HIGH**, typology **INVESTMENT_SCAM**, pattern chips (PEEL_CHAIN, CROSS_CHAIN, FAN_IN), and the auto-generated **investigative recommendations** (freeze request wording).
5. **Report (PDF)** → standardised flow-of-funds report with attribution, factors and chain-of-custody; **CSV** exports the raw flow table.
6. **New Trace → paste a real BTC address** (e.g. `1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa`) → trace runs against **live blockchain.info data** (`◉ live chain data` badge, ~80+ real wallets in seconds).
7. **Cases** → NCRP sandbox sync imports complaints; open one to show the **audit trail**; **Alerts** → acknowledge / push to **SAHYOG outbox**; **VASP Registry** → 36 labelled entities with LEA liaison + freeze channels.
8. **v2 flows**: New Trace → **Batch list** tab → paste several wallets (mix valid + typo'd) → *Validate list* shows per-address checksum verdicts → *Trace as batch* → consolidated batch view (attribution rate, per-VASP exposure, risk distribution). **✎ From complaint text** → paste a raw FIR narrative → wallets extracted & checksum-verified automatically. **Watchlist** → pin a wallet → *Check now* pulls live chain activity; new movements raise P1 alerts over the live feed. In any Investigation: asset filter on the graph, value timeline, live price chip, **Watch seed**, and node-level *Label entity* (user labels outrank the curated registry).

## Configuration

| Env (ml) | Default | Meaning |
|---|---|---|
| `TRACE_X_MODE` | `hybrid` | `live` / `simulated` / `hybrid` (live first, auto-fallback) |
| `TRACE_X_MAX_HOPS` | `6` | BFS depth budget |
| `ETHERSCAN_API_KEY` | — | optional, enables live ETH tracing |
| Env (api) | | |
| `JWT_SECRET` | demo value | set in production |
| `ML_SERVICE_URL` | `http://localhost:8000` | ML service location |

## Tests & verification

```bash
python -m pytest apps/ml -q     # 39 tests — v1 engine + v2 robustness suite (validation
                                #   matrix w/ official BIP-173 vectors, chaos inputs,
                                #   complaint-extraction fixtures, watchlist diffing,
                                #   price-oracle fallback, hermetic chaos tracing)
cd apps/api && node run-api-tests.mjs   # 9 tests — auth, cases, traces, NCRP, roles, reports
cd apps/web && npx tsc -p tsconfig.json --noEmit && npx vite build   # typecheck + bundle

# LIVE end-to-end check against real chain data — discovers fresh addresses
# from the latest BTC/ETH/TRON blocks at runtime (mempool.space, blockstream,
# Blockscout, Tronscan — with per-chain fallbacks), validates them, traces one
# live, and round-trips the watchlist. No hardcoded fixtures:
cd apps/ml && python scripts/live_check.py
```

## Deploying online (round-2 "Both" mode)

- **web → Vercel**: root `apps/web`, build `npx vite build`, output `dist`, env `VITE_API_URL=https://<api-host>/api/v1`, `VITE_WS_URL=wss://<api-host>/ws`
- **api → Render**: root `apps/api`, build `npx tsc -p tsconfig.json && npx tsc -p ../../packages/shared/tsconfig.json`, start `node dist/index.js`, env `ML_SERVICE_URL`, `JWT_SECRET`
- **ml → Render**: root `apps/ml`, start `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Or `docker compose up --build` on any VM and expose :5173.

## Demo data provenance

Simulated scenarios are **deterministic** (seeded from the wallet address) and model real Indian cyber-fraud typologies (investment/trading groups, task fraud, sextortion, ransomware). Exchange deposit wallets in the registry are representative clusters for demo purposes; the VASP registry content (jurisdictions, LEA contacts) is illustrative and must be verified operationally. The genesis-address trace uses genuine blockchain data.
