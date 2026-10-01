# Trace-X — Explained for Everyone (Non-Technical Guide)

You do **not** need to understand code, crypto, or data science to use Trace-X or to explain it.
This document gives you: what it is (with one analogy), how to click through it, what each
feature does in plain words, and how it was built — so you can demo it and answer questions.

- **Website (online):** https://trace-x-fraud-attribution.vercel.app
- **Engine (backend):** https://trace-x-api-w8ct.onrender.com
- **Logins:** `admin / admin123` (everything) · `investigator / io123` (casework) · `supervisor / sup123` (approvals)

---

## 1. What is Trace-X? (30-second version)

When someone gets scammed — fake investment app, "task fraud", sextortion — the criminal tells
the victim to send crypto to a **wallet address**. That address is the one solid clue the police get.

**Trace-X is a tracking system for that clue.** Paste the suspect wallet address, and in about
15 seconds Trace-X draws you a map of where the money went, points at the **exchange (VASP) it
most likely ended up at**, says **how risky and what kind of fraud** it looks like, and prints an
**official-style report** for the case file.

### The one analogy (use this when explaining)

> A stolen bag passes through many buses and theft still ends in one big lost-and-found.
> Every crypto "bus" (wallet) leaves a public receipt on the blockchain. Trace-X reads the
> receipts, follows the bag from bus to bus, and tells you **which lost-and-found office it
> reached** (the exchange, where police can freeze it) — with the full hop-by-hop route as proof.

Why "exchange" matters: once money sits inside a big exchange (Binance, Bybit, WazirX…), police
can send a legal request to **freeze and return it**. Inside a private wallet, it's untraceable
to a person. So Trace-X is tuned to find the **nearest freezable exchange**.

---

## 2. Who logs in with what (the 3 roles)

| Role | Login | What they do in Trace-X |
|---|---|---|
| **Investigator** | `investigator / io123` | Runs traces, investigates graphs, manages cases, labels wallets |
| **Supervisor** | `supervisor / sup123` | Oversees cases and alerts, approves escalation (e.g. SAHYOG push) |
| **Admin** | `admin / admin123` | Everything: dashboard, tracing, cases, alerts, registry, watchlist |

Real systems split powers like this so a junior officer can't, say, push alerts to a national
portal without approval. It's also a talking point: "we implemented police-workflow roles."

---

## 3. Guided tour — every page, what it's for, how to use it

### 3.1 Login page
- Type username + password → **Sign in**.
- Behind the scenes: your password is checked (it's stored only as an unreadable hash), and you
  get a **digital wristband (JWT token)** that every click shows to prove you're logged in.
  It expires after a while — that's normal security, just log in again.

### 3.2 Dashboard (the home screen after login)
- **What you see:** big number cards (cases, traces completed, attribution rate, P1 alerts),
  a risk-level breakdown (LOW→CRITICAL), typology breakdown (which fraud types you see most),
  which blockchains are covered, recent traces, recent alerts.
- **How to use it:** it's your "morning briefing". Nothing to configure. Click any recent trace
  to jump straight into its investigation.
- **Behind the scenes:** one API call asks the backend "give me today's totals"; the backend
  counts over its case database and replies in one packet.

### 3.3 New Trace (the main tool — 3 tabs)

**Tab 1 — Single wallet** (the classic demo flow)
1. Paste the suspect address (e.g. `bc1q…` for Bitcoin, `0x…` for Ethereum, `T…` for TRON).
   The system **auto-detects the chain** from the shape of the address.
2. (Optional) pick a **typology hint** — what fraud the victim reported (investment scam, etc.).
   This sharpens the classification.
3. Click **Trace**. You're taken to the Investigation screen while it works (~15s).
4. Or click a **sample wallet** button to trace instantly — perfect for demos.

**Tab 2 — Batch list** (many suspects at once)
1. Paste up to 25 addresses, separated by anything (new lines, commas, spaces).
2. Click **Validate** first → you get a green/red list. Typos are **rejected with a reason**
   ("checksum failed — one character is wrong"), never silently accepted.
3. Click **Trace as batch** → all valid ones run in parallel → one combined report page.

**Tab 3 — From complaint text** (the "wow" feature)
1. Paste the **raw complaint / FIR text** (any messy English text).
2. Trace-X reads the text and **pulls out every wallet address mentioned** — even across
   Bitcoin, Ethereum and TRON — then validates them.
3. From there it's the batch flow. Copy-paste-a-complaint-in, suspects-out.

### 3.4 Investigation screen (what one trace gives you)
- **Fund-flow graph:** a visual map. Your suspect is the centre dot; lines show money hops;
  colour = blockchain; highlighted dots = exchanges/VASPs found. Click any dot to inspect it.
  You can filter to one chain if the money jumped between chains.
- **Primary attribution card:** "money most likely reached **Bybit** (49% confidence, 4 hops,
  $421 exposure)" with the **explainable path**: wallet-by-wallet route from suspect → exchange.
  This is the chain of evidence a prosecutor asks for.
- **Risk score:** 0–100 with level (LOW/MEDIUM/HIGH/CRITICAL) and an **explainable factor list**
  ("rapid movement +6", "mixer in path +9"…). Not a black box — every point is explained.
- **Typology:** best guess of the fraud type (investment scam, task fraud, sextortion…).
- **Patterns detected:** machine-spotted laundering tricks (see §4.6).
- **Live price chip:** current USD market rate for valuations.
- **Reports (buttons):** **HTML report** (opens as a printable official-style document →
  print to PDF), **CSV export** of the fund flow (opens in Excel).
- **Label a wallet:** click a node → "label as exchange/mixer/bridge" → saved; future traces
  use your label with priority. Investigators teach the system as they work.
- **Live progress:** while tracing, you see status updates stream in ("fetching block data →
  building graph → scoring…") without refreshing — that's WebSocket live messaging.

### 3.5 Batch view
- One page for a batch: every wallet's result as rows + the **aggregate panel**:
  **attribution rate** (% of wallets that landed at a known exchange), **per-exchange exposure**
  (₹/USD grouped by exchange), **risk distribution** (how many HIGH vs MEDIUM…).
- Use case: a scam app with hundreds of victims collects to 20 wallets → paste all 20 → see
  "73% of funds land at Binance" — a single strong freeze-request fact.

### 3.6 Watchlist (24/7 guard duty)
1. **Add wallet** → optionally name it ("Suspect-7, Case 22/2026").
2. **Check now** → instant activity check. Or leave it: a background poller re-checks every ~45s.
3. If a watched wallet **moves money**, Trace-X fires a **P1 alert** instantly (Alerts page +
   live toast), and can push it to the SAHYOG portal (supervisor-gated).
- Why it matters: fraudsters wait days for heat to die down, then cash out. The watchlist is
  the tripwire for that cash-out moment.

### 3.7 Alerts page
- All auto-generated alerts with severity: **P1** (watched wallet moved / critical risk),
  **P2**, **P3**. Acknowledge them after reading (audit trail of who saw what).

### 3.8 Cases
- Every trace can be attached to a **case** (like an FIR file). Cases keep an **immutable audit
  trail** (chain of custody): who did what, when, unchangeable — evidence standards.
- **NCRP import (sandbox):** pull complaint records from the national portal (demo-mode) to
  create cases without typing.

### 3.9 VASP Registry
- The internal directory of 36 known entities (exchanges, mixers like Tornado Cash, bridges).
- Add/edit entities; investigators' labels are included automatically.

---

## 4. How each feature actually works (plain-words science)

**4.1 Address validation — "is this even real?"**
Wallet addresses aren't random text; they contain a built-in **checksum** (like the last digit
of a UPI/credit card number). Trace-X recomputes the maths (SHA-256 / Keccak / bech32 standards)
and can say *"this address has a typo"* before wasting a trace. We tested it against official
test-vectors and every possible single-character corruption — it never wrongly accepts.

**4.2 Tracing — "where did the money go?"**
The blockchain is a public ledger: every transaction says "address A sent X coins to address B"
forever. Trace-X asks public blockchain data APIs (blockchain.info/Blockstream for BTC,
Etherscan/Blockscout for ETH, Tronscan/TronGrid for TRON) and walks outward from the suspect:
hop 1 (who received money from them), hop 2, hop 3… building a **graph** (a dot-and-line map)
up to a depth limit. Results are cached so re-opening is instant and evidence is stable.

**4.3 Attribution — "which exchange did it land at?"**
We keep a registry of 36 real-world entities and some of their known wallet addresses. The
search ranks paths not just by shortest, but by **value-weighted** (more money = stronger
signal) and by **"freezable"** (a big exchange beats an unidentifiable wallet). Output =
entity, confidence %, and the exact hop path. Judges love the word **explainable**: we show
the route, not just a verdict.

**4.4 Risk score — "how bad is this wallet?"**
A trained ML model (see §5) looks at ~12 graph features — total value, number of hops, fan-in
(how many victims paid in), mixer proximity, cycle patterns… — and outputs 0–100. Then every
factor is listed with its contribution, plus a small boost per laundering pattern found.
If the model file is missing, a hand-written expert rules system takes over — the feature
never dies.

**4.5 Typology — "what kind of scam is this?"**
Combines the graph evidence (how money behaves) with the investigator's hint (from the
complaint): investment scams show many victims fanning into one point; sextortion shows
rapid single hops to cash-out; ransomware often passes mixers. Output = type + confidence.

**4.6 Patterns — the named laundering tricks**
- **Peel chain:** money keeps splitting off small amounts, like peeling an onion.
- **Mixer pass:** funds went through a "blender" service (e.g. Tornado Cash).
- **Victim fan-in:** many paying-in addresses → typical of scam platforms.
- **Rapid movement:** cash-outs within minutes to avoid freezing.
- **Cross-chain bridge hop:** jumped Bitcoin→Ethereum etc. via a bridge to confuse trackers.
- **Round-tripping / dusting** similarly flagged.

**4.7 Live prices**
Public CoinGecko rates (cached 10 minutes; falls back to last-known price if offline) so every
amount is shown in real USD — no stale made-up numbers.

**4.8 Live vs simulated mode — the honesty feature**
Real blockchain APIs sometimes fail (rate limits, venue WiFi). Every trace shows its mode:
**live** (real chain data) or **simulated** (a deterministic fraud-graph generator takes over).
The demo can never dead-end, and the UI never pretends simulated data is live. Say this
explicitly in the pitch — transparency scores points.

**4.9 Live updates (WebSocket)**
Normal websites only update when you refresh. Trace-X keeps a live line open so progress and
P1 alerts appear the moment they happen — like a delivery-tracking app pushing notifications.

**4.10 Reports**
HTML report = official-style document (classification banner, case reference, attribution,
risk factors, chain-of-custody) → print-to-PDF for the case file. CSV = raw fund-flow rows
for analysts. JSON API = for other software.

---

## 5. How it was made (the honest 3-layer story)

Think of it as a **restaurant**:
- **The dining area (website)** — React (the same tech family as Instagram/Facebook front
  ends) + TypeScript + Tailwind for looks + Cytoscape.js for the interactive graph. Hosted
  on **Vercel**, a global CDN, so it loads fast anywhere.
- **The kitchen (API)** — Node.js + Express: logins, cases, alerts, reports, orchestrating
  traces. Hosted on **Render**.
- **The master chef (ML engine)** — Python + FastAPI: chain adapters, the tracer, pattern
  detectors, and the **risk model built with scikit-learn** (a standard, respected ML
  library): a Gradient-Boosting model trained on 600 synthetic fraud traces with 12 graph
  features. Also on Render.
- **Shared types package** so website and kitchen speak the same language (TypeScript).

Data comes from **public blockchain APIs** (no scraping, no keys hidden), **CoinGecko** for
prices, and a **curated 36-entity VASP registry** — plus investigators' own labels.
The whole thing speaks **REST + WebSocket**; login is **JWT** with hashed passwords.

**Where it runs:** web on Vercel, API + ML on Render free tier (they sleep after ~15 idle
minutes — open the health URLs a few minutes before a demo; first visit takes ~30–60s to wake).
It also runs fully on localhost for offline demos (plan B).

**Why it was made this way (FAQ ammo):**
- *Why not one giant program?* Separation = each part can be fixed/scaled alone; mirrors how
  real products are built.
- *Why a JSON file DB, not a fancy database?* Zero-setup, zero native deps, instantly
  deployable anywhere; the API layer is written so a real DB can replace it later.
- *Is the ML a black box?* No — every score ships with its factor table, and the model's
  inputs are plain graph features a human can argue with in court.
- *What if the internet dies mid-demo?* Hybrid mode → simulator takes over, badge shown.

---

## 6. The journey of one trace (tell it as a story)

1. Victim files complaint; the suspect wallet address is the clue.
2. Officer pastes it into **New Trace** (or pastes the whole complaint → addresses auto-extracted).
3. Validation confirms the address is even real (checksum).
4. Backend asks the ML engine: "trace this".
5. Engine pulls live transactions from public blockchain APIs → builds the hop graph.
6. Registry matching finds known exchange wallets in the graph → **Bybit, 49%, 4 hops**.
7. Pattern detectors flag a **peel chain**; the model scores **58/100 (MEDIUM)**.
8. Officer attaches it to the case, prints the report; a **watchlist** pin waits for movement.
9. Wallet moves at 2 AM → **P1 alert** → supervisor approves → SAHYOG push → exchange freeze
   request with the explainable path attached. Money recovered. 🎉

---

## 7. Five-minute demo script (use exactly this)

1. **(0:00)** Login `admin/admin123` → Dashboard: "this is the morning briefing for a cyber-police unit."
2. **(0:40)** New Trace → paste a **sample wallet** → "we're reading the public receipts of the blockchain."
3. **(1:10)** Investigation: point at the attribution card → "money ends at Bybit — here's the exact route as evidence." Click a node → label it. Show the risk factor list → "every point is explained, no black box."
4. **(2:20)** Open the **HTML report** → "print-to-PDF, chain of custody, court-ready."
5. **(3:00)** Batch tab → paste a few wallets → Validate (show a rejected typo!) → trace batch → aggregate: "73% lands at one exchange."
6. **(4:00)** Watchlist → add → **Check now** → Alerts: "the tripwire that catches the 2 AM cash-out."
7. **(4:40)** Close: "live blockchain data, honest mode badges, deployed and running right now — URL is on screen."

**Demo-day checklist:** wake both services (open `/health` URLs 5 min early) · have the
localhost demo ready offline · keep a **recorded backup video** of the exact script above.

---

## 8. Quick answers to questions you might get

- *"Is this even legal / where's the data from?"* — Public blockchains are public ledgers;
  we read public APIs like anyone can. No personal data is scraped.
- *"Can't criminals hide?"* — Mixers and bridges hide, but leave patterns; that's exactly
  what §4.6 detects. 100% anonymity is a myth once funds touch a KYC exchange.
- *"What's a VASP?"* — Virtual Asset Service Provider: any business that holds/exchanges
  crypto for customers (exchanges, custodians). Regulated entities can freeze funds.
- *"Why does the score say MEDIUM — is that good?"* — It means moderate laundering evidence;
  the factor list says why. HIGH/CRITICAL = prioritise freeze request.
- *"Can it work for police tomorrow?"* — The workflow, roles, NCRP/SAHYOG integrations
  (sandboxed here) and reports mirror real LEA needs; production would swap the file DB
  for a real database and plug live NCRP credentials.

---

## 9. Mini glossary

| Term | Plain meaning |
|---|---|
| **Wallet / address** | A bank-account-like string (e.g. `bc1q…`, `0x…`, `T…`) that holds crypto |
| **Blockchain** | A public, append-only ledger of every transaction, replicated worldwide |
| **VASP** | Exchange / crypto business (Binance, WazirX…) — the freezable end-points |
| **Mixer** | A "blender" service mixing many people's coins to hide origins |
| **Peel chain** | Laundering trick: repeatedly splitting off small amounts to new wallets |
| **Bridge** | Service converting coins from one blockchain to another |
| **BFS / hop** | One step of "money moved from A to B"; tracing walks hops outward |
| **Checksum** | Built-in arithmetic guard inside an address that catches typos |
| **JWT** | The temporary "wristband" proving you're logged in |
| **REST / WebSocket** | Ask-and-answer messaging / always-open live line |
| **Hybrid mode** | Live chain data with an automatic, honestly-labelled simulated fallback |
| **Chain of custody** | Tamper-proof record of who touched evidence and when |
