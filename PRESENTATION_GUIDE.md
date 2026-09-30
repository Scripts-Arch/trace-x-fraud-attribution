# Trace-X — Presentation Guide for the Team

*Everything you need to explain Trace-X to judges — no technical background required.*

---

## 1. The 30-second elevator pitch (memorise this)

> "When a crypto fraud victim files a complaint, all the police get is a random-looking wallet address — a string of characters. Right now, manually figuring out where that money went takes days, and criminals move funds in minutes. **Trace-X takes that one address and, in seconds, shows the investigator the full money trail on the blockchain, detects how the money is being laundered, identifies the nearest exchange where the funds can be frozen, and generates a court-ready report.** It works on live blockchain data across Bitcoin, Ethereum and TRON, and it never goes down even if the internet APIs fail — which makes it demo-proof and operation-ready."

---

## 2. The problem — tell it as a story

The Ministry of Home Affairs / I4C (Indian Cyber Crime Coordination Centre) sees thousands of crypto-fraud complaints every month:

- **Investment scams** — victim joins a WhatsApp "trading mentor" group, deposits USDT into a "trading account" that doesn't exist.
- **Task fraud** — victim is paid small amounts to "complete tasks", then asked for "unlock deposits".
- **Sextortion** — victim pays in Bitcoin to make a recording go away.
- **Ransomware** — a company pays ransom in BTC to unlock its files.

**What does the investigator actually receive?** Often just one thing: the wallet address the victim sent money to. That's it. No name, no bank account, no phone number — crypto wallets have no identity attached.

**Why is that a nightmare?**

1. **Blockchain is anonymous** — an address is like a bank account number with no account holder's name.
2. **Money moves at the speed of a text message** — within minutes the criminal sends it onward, splits it, runs it through "mixers" (services that deliberately shuffle everyone's money together like a blender), or converts it to another blockchain entirely.
3. **Manual analysis is hopeless under time pressure** — an analyst clicking through blockchain explorers needs hours or days to follow hundreds of transactions. By then the money is long gone.

**The one place the money CAN be caught:** an exchange. Criminals eventually want real money out, so they deposit into an exchange like Binance, Bybit, KuCoin or the Indian exchanges (WazirX, CoinDCX). Exchanges do KYC (identity verification) and can **freeze an account** when police send a legal request. So the whole game is: **find the exchange fast, before the money gets there or before it's withdrawn.**

> **That is the entire purpose of Trace-X: automatically find the nearest freeze-able exchange for any suspect wallet, fast, with evidence.**

---

## 3. What the product is — one screen at a time

Trace-X is a **law-enforcement console** — think of it as a secure internal website used by police officers, not a public app. It has three parts working together, and the easiest way to explain it is a **police station analogy**:

| Part | Analogy | What it actually is |
|---|---|---|
| **The Console** (React web app) | The war-room with big screens | What the investigator sees and clicks — dashboards, graphs, maps of money flow |
| **The Coordinator** (Node API server) | The records office + radio dispatcher | Checks who is logged in, keeps case files with a tamper-evident audit trail, hands analysis jobs to the lab, and *instantly pushes updates* to every open screen |
| **The Brain** (Python ML service) | The forensic lab | Does the actual heavy lifting: reads raw blockchain data, walks the money trail, runs the pattern detectors and the machine-learning risk model |

The three parts talk to each other over the network. That separation matters and is worth saying to judges: **each part can be scaled or redeployed independently** — e.g., if 50 officers use it at once, you add more Coordinator instances without touching the lab.

---

## 4. Feature-by-feature — what it does, how, and why it matters

*(Each feature: what the judge sees → how it works in plain English → why it matters.)*

### 4.1 Single-wallet tracing — the core loop

- **What the judge sees:** Investigator pastes one address → a progress bar streams live stages ("expanding graph… detecting patterns… clustering… attributing…") → a full investigation screen appears.
- **How it works:** The system auto-detects which blockchain the address belongs to just from its shape (starts with `0x` → Ethereum; starts with `T` → TRON; starts with `bc1`, `1` or `3` → Bitcoin). Then it fetches that wallet's real transactions from public blockchain data, adds every wallet it touched, and repeats — following the money hop by hop, up to a budget. Along the way it checks every wallet against the exchange registry, runs the laundering-pattern detectors, and scores the risk. Everything is valued in US dollars at **live market prices**.
- **Why it matters:** This is "one complaint → complete intelligence" in seconds instead of days.

### 4.2 Cryptographic address validation — the spell-checker

- **What the judge sees:** Type a wrong character into a wallet address and the system *rejects it with a reason* ("bech32 checksum FAILED — typo or malformed") before any analysis is wasted.
- **How it works:** Every real crypto address secretly carries its own checksum — a mathematical "spell-check number" computed from its own characters. Bitcoin uses two different schemes (bech32 and double-SHA256), Ethereum a third (EIP-55), TRON shares Bitcoin's. Trace-X implements all of them exactly as the official standards describe, and we test it against the *official Bitcoin test vectors* plus a test that flips **every single character** of an address and confirms the system catches each one.
- **Why it matters:** A mistyped address means chasing a wallet that belongs to nobody — or worse, to an innocent person. This kills that risk at the door. It also means the platform can take a whole document and tell genuine wallets from garbage.

### 4.3 Complaint-text extraction — paste the FIR, get the suspects

- **What the judge sees:** The investigator pastes the *entire raw complaint text* — the victim's narrative as written to the cybercrime portal — clicks one button, and the system highlights every wallet found in the text with a ✓ (valid) or ✗ (typo) mark.
- **How it works:** A pattern scanner reads the text and pulls out anything wallet-shaped across all three chains, then runs every candidate through the full cryptographic validation from 4.2. It automatically merges duplicates that differ only by capitalisation (a common copying error) and counts how often each wallet appears.
- **Why it matters:** Real complaints are written by victims, not experts. This means anyone — even the complainant clerk — can go from "a wall of text" to "here are the verified suspect wallets" with one click. It also removes the most common human error: copying the address wrong.

### 4.4 Batch tracing — investigating a whole gang at once

- **What the judge sees:** A paste box for up to 25 addresses. Invalid ones are rejected at intake **with the reason**. Valid ones are all traced simultaneously. A consolidated view shows: attribution rate, total money exposure, a table of **which exchanges this whole batch is cashing out through**, and the risk distribution.
- **How it works:** Each address is validated first, then all traces run in parallel (the API launches them together, each streaming progress). The aggregate view sums exposure per exchange across all members.
- **Why it matters:** In reality, one gang receives money from *many victims into many wallets*. Individual traces answer "where did THIS victim's money go?" — the batch answers the question police actually need: **"What is the single best freeze target for this entire operation?"** If 8 of 10 wallets all funnel into Bybit, that's where you send the freeze request.

### 4.5 The fund-flow graph — the money map

- **What the judge sees:** An animated network diagram. **Red ring = the suspect seed wallet**, green dots = exchange wallets, purple = mixers, orange = bridges (chain-to-chain transfers), dashed orange lines = cross-chain jumps. Thicker lines = more money. Click any node for its details: money in, money out, who it deals with, every transaction.
- **How it works:** The graph is rendered from the exact data the tracer collected — nothing is decorative. There's an **asset filter** (show only USDT flows, hide the noise) and a **value timeline** (a bar chart of money movement over time — you can literally see the collection burst, then consolidation, then the cash-out).
- **Why it matters:** Superior officers and courts understand a picture instantly. And the **highlighted attribution path** — the hop-by-hop route from suspect to exchange — *is* the evidence chain for the freeze request.

### 4.6 Exchange attribution — the heart of the product

- **What the judge sees:** A big card: "**OKX — 49% confidence — 4 hops — $146 exposure**" plus the explainable path and a table of *all* exchange hits ranked.
- **How it works:** Trace-X carries a curated registry of **36 labelled entities** — the major global exchanges (Binance, OKX, Bybit, KuCoin, Coinbase), Indian exchanges (WazirX, CoinDCX), and illicit infrastructure (Tornado Cash mixer, bridges). While the tracer walks the money trail, it checks every wallet against this registry. When it finds a match, it records: which entity, how many hops away, how much value flows there. Then it **ranks the hits by actionability**: an exchange police can actually freeze outranks a mixer or a bridge. Confidence rises the shorter the path and the larger the value share.
- **Why it matters:** This is the actionable answer — not "here's some data" but "**here is where to send the freeze request, and here's the evidence**". And the registry is *extensible*: any investigator can label a new address mid-investigation ("this wallet = 'OKX deposit wallet #7'"), and user labels **override** the curated registry — the system learns from its users.

### 4.7 Laundering-pattern detection — reading the criminal's playbook

- **What the judge sees:** Chips like "PEEL CHAIN", "FAN IN", "MIXER PASS", "CROSS_CHAIN" with one-line explanations in plain English, e.g. *"4 separate deposits funnelled into the suspect wallet"*.
- **How it works:** Detectors look for known money-laundering shapes in the graph: **fan-in** (many victims paying one collector — the signature of a mass-fraud), **peel chain** (money repeatedly split, a little skimmed off each time), **mixer pass** (funds routed through a blending service), **rapid movement**, **bridge hops** (jumping blockchain to shake followers), **dusting**.
- **Why it matters:** It tells the investigator *how the money is being hidden and what to expect next* — e.g., a mixer pass means "don't wait for a clean trail; act on the exchange hit you have now".

### 4.8 ML risk score & typology — the triage engine

- **What the judge sees:** A 0–100 score dial (e.g. "61/100 HIGH"), a typology label ("Ransomware"), and an **explainable factor table** showing exactly which evidence pushed the score up or down.
- **How it works:** The tracer computes 12 numeric "graph features" (how many wallets paid in, how fast money leaves, proximity to mixers, bridge usage, value statistics, timing bursts…). A machine-learning model (Gradient Boosting, trained on 600 labelled fraud-graph scenarios) turns those into a score and a fraud-type classification. There's a transparent heuristic fallback so the score *never* goes dark. Crucially, the score is **explainable** — every factor's contribution is listed.
- **Why it matters:** Units have 100 cases and capacity for 5. The score is the triage: work the 90s first. And *explainable* matters legally — an analyst can defend *why* a wallet was flagged, rather than trusting an unexplainable black box.

### 4.9 Live price oracle — real rupees-and-dollars, not made-up numbers

- **What the judge sees:** A small chip showing "BTC $83,923 · ETH $2,719 · USDT $1" and every value in the platform converted at market rate.
- **How it works:** Live prices from the CoinGecko public API, cached for 10 minutes; if the price API is down, it keeps using the last known prices (and says so — "stale"). Stablecoins like USDT are pinned to $1.
- **Why it matters:** The complaint says "I lost ₹10 lakh" — the platform shows the crypto amounts at real prices, so loss figures in the report are defensible. Nothing in the platform is hardcoded.

### 4.10 The watchlist — the 24/7 tripwire

- **What the judge sees:** A "Watchlist" page. Add any suspect wallet with a note. Click "**Check now**" → it immediately re-reads the blockchain for that wallet and reports any new activity. Leave it pinned, and the background watcher keeps checking automatically. **The moment new money moves, an alert appears live on every screen.**
- **How it works:** The ML service runs a background poller that re-fetches each watched wallet's live transactions and diffs the transaction list against what it saw before — only *genuinely new* transactions raise alerts, graded P1 (over $5,000 — also auto-pushed to the inter-agency SAHYOG channel) or P2.
- **Why it matters:** The first trace is a snapshot; gangs move funds any minute after a victim complains. This turns Trace-X from a one-off report into **standing surveillance** — the "ring the bell when the money moves" capability.

### 4.11 Alerts, NCRP & SAHYOG — plugged into the real workflow

- **What the judge sees:** An Alerts inbox (auto-generated P1/P2/P3, with acknowledge buttons) and a SAHYOG outbox. A "Sync NCRP" button imports sandbox complaints.
- **How it works:** Alerts are raised automatically from trace results (exchange hit, mixer pass, bridge usage, high risk) and from watchlist movements. P1 alerts are auto-pushed to the SAHYOG outbox (the inter-agency coordination channel between states and agencies). NCRP is the national complaint portal — complaints flow *in* from there.
- **Why it matters:** It mirrors exactly how I4C actually works — **complaint in via NCRP, intelligence produced by Trace-X, action out via SAHYOG and freeze requests**. The judges wrote the problem statement; showing their own workflow back to them is powerful.

### 4.12 Cases & the audit trail — evidence that holds up in court

- **What the judge sees:** A case list; open any case and read an **audit trail**: who did what, and when (created, trace launched, trace completed, alert raised, pushed to SAHYOG…).
- **How it works:** Every action by every user is appended to the case record with username and timestamp. Login is role-based: **Investigator** (runs traces), **Supervisor** (reviews, pushes alerts), **Admin** (full control).
- **Why it matters:** In court, the defence attacks *chain of custody* — "who touched this evidence and could they have altered it?" A complete, append-only audit trail is the standard answer. Role-based access shows due process.

### 4.13 Reports — the deliverable

- **What the judge sees:** Two buttons: "Report (PDF)" opens a formatted, standardised investigation report; "CSV" downloads the raw fund-flow table.
- **How it works:** The report is generated from the trace result: attribution with the path, risk factors, patterns, recommendations (including freeze-request wording), and the chain-of-custody data.
- **Why it matters:** This is the artefact that goes to the exchange's legal team or the court. The investigator walks in with a standardised document, not screenshots.

### 4.14 Never-goes-down engineering (mention when judges ask "what if the internet is bad?")

- **What the judge sees:** Every trace shows a badge: **"◉ live chain data"** or **"▣ simulation mode"** — always honest about which it is.
- **How it works:** Each blockchain has **two independent data sources** (Bitcoin: blockchain.info *and* Blockstream; Ethereum: Etherscan *and* Blockscout; TRON: Tronscan *and* TronGrid) — if one is down, the other takes over automatically. Traced data is also cached on disk, so any past trace can be re-opened and replayed offline. And if *everything* live fails, a deterministic simulation engine produces a realistic fraud graph seeded from the address — so a demo or training session can never dead-end.
- **Why it matters:** Real operations can't stop because one vendor had a bad day. And for the demo itself: **no more praying to the venue WiFi gods.**

### 4.15 Speed — the parallel tracer

- **How it works:** The tracer expands the money trail with **6 parallel workers** fetching different wallets simultaneously, then merges their results into one graph — under a strict time budget with sensible caps on hops and addresses so no single trace can run away.
- **Proof point:** On live Bitcoin data it expanded **337 nodes / 541 real transactions in 8.2 seconds**. That's roughly 4× more graph than a sequential approach in the same time.
- **Why it matters:** In this problem, speed *is* the feature — every minute saved is money not yet withdrawn.

---

## 5. The 5-minute live demo script

*Click-by-click, with what to say. Practice it twice and it'll run itself.*

**Setup before judges arrive:** open the browser logged in as `admin / admin123`, dashboard showing.

1. **Dashboard (30s).** "This is the operations dashboard — open cases, attribution rate, risk distribution, typologies, chain coverage, live alerts. Everything here comes from real completed analyses."

2. **New Trace → one-click scenario (1 min).** "A complaint comes in — say an investment scam. The victim's money went to this TRON wallet." Click the *"Investment scam — TRON peel chain"* card. **Narrate while the progress streams:** "Watch — it's expanding the transaction graph on live chain data… detecting laundering patterns… clustering related wallets… and now attributing the nearest exchange."

3. **Investigation view (90s) — the centerpiece.** Point at things in this order:
   - "The **red node is the suspect wallet** from the complaint; the green ones are exchange wallets; purple is a mixing service; the dashed orange line is a **jump to another blockchain**."
   - "The system says the nearest cash-out point is **[exchange name], with this explainable path** — every hop between the suspect and the exchange. That path is what goes into the freeze request."
   - "**Risk 74/100 — HIGH**, classified **investment scam**, and here's *why*: every factor with its contribution. It's explainable, not a black box."
   - Click a node: "Any wallet — money in, money out, counterparties, every transaction."
   - "This button — **Watch seed** — pins the suspect wallet to surveillance." Click it. "From now on, if *any* new money moves, every screen in the room gets an alert."

4. **Batch + extraction (60s).** New Trace → **"From complaint text"**: paste a raw complaint narrative. "Victims don't write clean data. We paste the whole complaint — the system finds every wallet in the text, checksum-verifies each one, and flags typos." Then **"Batch list"**: paste a few wallets including a deliberately typo'd one → *Validate list* → show the ✗ with the reason → *Trace as batch*. "One gang, many wallets, one click — and the consolidated view shows **which exchange the whole operation is cashing out through**. That's the freeze target."

5. **Watchlist (45s).** "Surveillance: this wallet is pinned. 'Check now' re-reads the blockchain immediately — and the background watcher does this automatically around the clock. New movement → **P1 alert, live, over the feed** — and automatically pushed to the SAHYOG inter-agency channel."

6. **Report + close (30s).** Open the Report. "This is the deliverable — attribution, path, risk factors, freeze-request wording, full chain of custody, ready for the exchange's legal team. **From one pasted address to this, in seconds.**"

**If a judge asks "is this real data?"** — point at the badge on the trace: "That trace ran on live blockchain data — this badge is always honest about live vs simulation. We *chose* to make honesty a feature."

---

## 6. Numbers worth memorising

| Number | What it proves |
|---|---|
| **3 chains** — BTC, ETH, TRON | TRON/USDT is the dominant rail for Indian fraud; BTC for ransomware/sextortion; ETH for task fraud |
| **36 labelled VASPs** in the registry, **user-extensible** | Coverage of major exchanges + Indian exchanges + illicit infra |
| **337 nodes / 541 real txns in 8.2 s** | Live-data speed of the parallel tracer |
| **12 ML features → 0–100 score**, trained on **600 labelled traces** | The model, and its explainability |
| **2 independent data sources per chain** + disk cache + simulation fallback | Resilience: 4 layers deep |
| **39 + 9 automated tests**, incl. official BIP-173 vectors and every single-character corruption test | Engineering rigour |
| **A live-check script that every run pulls fresh addresses from the latest blocks** and traces one — nothing hardcoded | "Live data" is demonstrated, not claimed |
| **25 wallets per batch**, seconds to consolidated answer | Gang-level investigations |

---

## 7. Judge Q&A — likely questions and the answers

**Q: "The blockchain is anonymous. How can you identify anyone?"**
A: "We don't deanonymise wallets — that's the point. We find where the money *touches the real world*: the exchange. Exchanges do KYC, so a freeze request there converts an anonymous address into a named account. We're the bridge between on-chain anonymity and off-chain identity."

**Q: "What if the exchange registry is incomplete?"**
A: "It's designed to grow. Any investigator can label a new address mid-investigation, and user labels take priority over the curated registry — the platform learns from use. Ranking also fails safe: if nothing is labelled, the trace still returns the full graph, patterns and risk."

**Q: "How do you handle mixers like Tornado Cash?"**
A: "We can't follow funds *through* a mixer — nobody honestly can. So we detect the mixer pass, flag it prominently, and adjust the recommendation: act now on the attribution you have, don't wait for a clean trail that will never come."

**Q: "Is the ML a black box?"**
A: "The opposite — every score ships with a factor table showing each piece of evidence and its contribution. In court, 'the algorithm said so' is useless; 'the wallet received 14 deposits from 14 unrelated sources within 48 hours' is evidence."

**Q: "Where does the training data come from?"**
A: "600 labelled fraud-graph scenarios generated by our scenario engine modelling the real Indian typologies — investment scams, task fraud, sextortion, ransomware — plus a transparent heuristic fallback. Honest answer: ground-truth labelled chain data for active Indian cases isn't public, and this is the right first step; with I4C data the model retrains on reality."

**Q: "What if a chain API goes down mid-operation?"**
A: "Four layers: a second independent API per chain takes over automatically; traced data is disk-cached and replayable offline; the mode badge always tells the user what they're looking at; and in the worst case a deterministic simulation keeps training and demos alive. It's built so it *cannot* dead-end."

**Q: "Privacy and legality?"**
A: "We only read *public* blockchain data — the same data anyone can see on a block explorer. No personal data is scraped. The platform is built around due process: a case file, an immutable audit trail, role-based access, and outputs designed to become legal freeze requests."

**Q: "Why these three chains?"**
A: "Coverage follows the crime: USDT on TRON dominates Indian investment/task fraud, BTC dominates ransomware and sextortion, ETH covers the rest. The adapter design is deliberately modular — a fourth chain is one new module, not a redesign."

**Q: "What's the tech stack and why?"**
A: "React for the console, Node for the coordination layer (roles, cases, audit, WebSocket live updates), Python for the analytics/ML layer (the ecosystem's best tooling for both). Three independent services, each scalable separately. Zero exotic dependencies — it runs on a laptop *and* on cloud."

**Q: "How do you know it actually works on live data?"**
A: "Two ways. First, a test suite: 39 Python tests including the official Bitcoin checksum vectors, 9 API tests, and full type-checked builds. Second — and unique — a live-check script that, *every time it runs*, pulls fresh addresses from the latest mined blocks of all three chains, validates them, traces one live, and round-trips the watchlist. It found and forced us to fix real bugs, like a case-sensitivity flaw in our bech32 checker and a double-prefix bug in address conversion. Live data is how we test."

---

## 8. Glossary — the ten terms you need

| Term | Plain meaning |
|---|---|
| **Wallet address** | A "bank account number" on a blockchain — e.g. `bc1q…` (Bitcoin), `0x…` (Ethereum), `T…` (TRON). No name attached. |
| **Transaction / txn** | A record of money moving from one address to another. Everything is public and permanent. |
| **Blockchain** | A public, tamper-proof global ledger. Anyone can read it — that's what makes tracing possible at all. |
| **Exchange / VASP** | A company that converts crypto↔real money (Binance, Bybit, WazirX). "Virtual Asset Service Provider" is the regulator's term. The only place with KYC. |
| **Deposit wallet** | An address an exchange publishes for receiving customer funds. *Finding one in the trail = the money is heading to an identifiable company.* |
| **Mixer** | A service that blends many people's coins together to hide origins — a "money blender". |
| **Bridge** | A service that moves value from one blockchain to another — used by criminals to shake followers. |
| **USDT** | A crypto token pegged to $1. The criminal favourite because it behaves like dollars but moves like crypto. |
| **Hop** | One step in the money trail: wallet A → wallet B is one hop. Fewer hops to an exchange = higher confidence. |
| **Freeze** | The legal action where an exchange locks a suspect account so funds can't be withdrawn. **The entire point of the product is to enable this fast.** |
| *(bonus)* **Checksum** | The self-contained "spell-check number" inside every address that lets us catch typos mathematically. |

---

## 9. If you only remember three things

1. **The problem is speed:** crypto laundering is measured in minutes; manual tracing takes days. Trace-X makes it seconds — and the freeze window is the whole game.
2. **The answer is the exchange:** you can't freeze a blockchain, but you can freeze a KYC'd exchange account. Everything in the product — tracing, patterns, scoring — exists to find the *nearest freeze-able exchange, fast, with evidence*.
3. **Everything is real and honest:** live blockchain data, live prices, live alerts — and when live data isn't available, the platform says so on screen and falls back gracefully. Test-proven, audit-trailed, and built around the actual I4C workflow (NCRP in → intelligence → SAHYOG/freeze out).
