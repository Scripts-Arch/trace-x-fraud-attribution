# Deploying Trace-X Online

Two supported paths. **Option A is the recommended one** (clean separate URLs, phone-friendly console). **Option B is the simplest possible** (one URL, one service).

> SIH round-2 wants "deployed + localhost". Do **Option A** for the submission; localhost already works.

> **Fast path:** `render.yaml` in the repo root is a Render Blueprint — one **New + → Blueprint → Apply** creates both backend services with the right settings. [apps/web/vercel.json](apps/web/vercel.json) does the same for Vercel. The manual steps below are the fallback.

---

## 0. Prerequisites

1. **Code on GitHub** — see the "Push to GitHub" section at the bottom if you haven't yet.
2. Free accounts on:
   - [github.com](https://github.com)
   - [vercel.com](https://vercel.com) — *sign in with GitHub* (one click)
   - [render.com](https://render.com) — *sign in with GitHub* (one click)
3. No credit card needed for any of it (free tiers).

---

## 1. Option A — Vercel (web) + Render (API + ML) ✅ recommended

End result:
- Console: `https://trace-x.vercel.app` (or whatever name you pick)
- API: `https://trace-x-api.onrender.com`
- ML: `https://trace-x-ml.onrender.com`

### 1a. Deploy the ML service on Render (do this first)

1. Render dashboard → **New +** → **Web Service** → **Build and deploy from a Git repository** → pick your `trace-x` repo (connect GitHub if asked).
2. Settings:
   - **Name**: `trace-x-ml`
   - **Root Directory**: `apps/ml`
   - **Runtime**: Python 3
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
   - **Instance Type**: Free
3. **Environment variables** (Advanced → Add):
   | Key | Value |
   |---|---|
   | `TRACE_X_MODE` | `hybrid` |
4. **Create Web Service.** First build takes ~5 min (scikit-learn). When it's live, verify: open `https://trace-x-ml.onrender.com/health` → should show `"status": "ok"` with watcher info.

### 1b. Deploy the API on Render

1. **New +** → **Web Service** → same repo.
2. Settings:
   - **Name**: `trace-x-api`
   - **Root Directory**: **leave EMPTY (repo root)** — npm workspaces must resolve `@trace-x/shared` from `packages/shared`; setting this to `apps/api` breaks the install
   - **Runtime**: Node
   - **Build Command**: `npm install && npm run build -w @trace-x/shared && npm run build -w @trace-x/api`
   - **Start Command**: `node apps/api/dist/index.js`
   - **Instance Type**: Free
3. **Environment variables**:
   | Key | Value |
   |---|---|
   | `ML_SERVICE_URL` | `https://trace-x-ml.onrender.com` (from 1a) |
   | `JWT_SECRET` | any long random string (make one up, don't share it) |
   | `CORS_ORIGIN` | `https://trace-x.vercel.app` (your Vercel URL from 1c — add it after) |
   | `TRACE_X_DB` | `/tmp/tracex.db` (free tier disk is ephemeral; /tmp is writable) |
4. **Create Web Service.** Verify: `https://trace-x-api.onrender.com/health` → `"ml": "up"`.

> **Note on the free tier:** Render free services **sleep after ~15 min idle** and wake on the next request (first hit takes ~30–60 s). For the demo, open the ML and API health URLs in two tabs a few minutes before judging to wake both.

### 1c. Deploy the web console on Vercel

1. Vercel dashboard → **Add New...** → **Project** → import your `trace-x` repo.
2. Configure:
   - **Framework Preset**: Vite
   - **Root Directory**: `apps/web`
   - **Build Command**: `npx vite build` (leave default if it fills in)
   - **Output Directory**: `dist`
3. **Environment variables** (before deploying):
   | Key | Value |
   |---|---|
   | `VITE_API_URL` | `https://trace-x-api.onrender.com/api/v1` |
   | `VITE_WS_URL` | `wss://trace-x-api.onrender.com/ws` |
4. **Deploy.** You'll get `https://trace-x-<random>.vercel.app` → Settings → Domains → rename to something clean like `trace-x.vercel.app` if free.
5. Go back to Render (step 1b) and set `CORS_ORIGIN` to your final Vercel URL. Render will redeploy automatically.

### 1d. Verify the deployed demo (10 min)

Walk the exact judge flow on the deployed URLs:

1. Open the Vercel URL → login `admin / admin123` (the dashboard must load — this proves web→API works).
2. Run a one-click sample trace → completed with attribution (proves API→ML→live chain).
3. Batch tab → validate a list → trace as batch.
4. Watchlist → add → Check now.
5. If anything fails, see Troubleshooting below.

---

## 2. Option B — one Render service serves everything

> Also builds from the **repo root** (same workspace rule): Build `npm install && npm run build -w @trace-x/shared && npm run build -w @trace-x/api && cd apps/web && npx vite build`, Start `WEB_DIST=apps/web/dist node apps/api/dist/index.js`.

The API can serve the built web console itself (same origin — no CORS, no separate WS config).

1. Build the web app locally: `cd apps/web && npx vite build` → produces `apps/web/dist`.
2. **Temporarily** allow that folder into git (it's gitignored by default): comment out the `dist/` line in `.gitignore` for this push, then re-add it after. (Alternative: build on Render with a multi-step build command.)
3. Render → New Web Service:
   - **Root Directory**: `apps/api`
   - **Build**: `npm install && npm run build --workspace @trace-x/shared && npm run build`
   - **Start**: `WEB_DIST=../web/dist node dist/index.js`
   - Env: `ML_SERVICE_URL` → the ML service from Option A step 1a.
4. One URL serves the console *and* the API at the same origin.

> Use Option B only if you want the absolute minimum; Option A looks more professional and keeps the web on a fast global CDN.

---

## 3. Environment variable reference (what each does)

| Var | Where | Purpose |
|---|---|---|
| `TRACE_X_MODE` | ML | `hybrid` (live with fallback) / `live` / `simulated` |
| `ML_SERVICE_URL` | API | Where the ML service lives |
| `JWT_SECRET` | API | Login-token signing — set your own |
| `CORS_ORIGIN` | API | Which web origins may call the API (comma-separated) |
| `TRACE_X_DB` | API | Path of the JSON case database (use `/tmp/...` on Render) |
| `generateValue: true` | API | `render.yaml` asks Render to auto-generate `JWT_SECRET` on first deploy |
| `VITE_API_URL` | Web | Full API base, e.g. `https://trace-x-api.onrender.com/api/v1` |
| `VITE_WS_URL` | Web | WebSocket URL, e.g. `wss://trace-x-api.onrender.com/ws` |

> `VITE_*` vars are **baked in at build time** — if you change them, redeploy the web app.

---

## 4. Troubleshooting (the 5 you'll actually hit)

| Symptom | Cause | Fix |
|---|---|---|
| Login works on localhost but console shows nothing / blank data on Vercel | Web built without `VITE_API_URL` (falls back to same-origin `/api/v1`) | Add the env vars in Vercel → **Redeploy** (VITE_* only apply at build time) |
| `ML service unreachable` in traces | ML asleep (free tier) or wrong `ML_SERVICE_URL` | Open ML `/health` to wake it; check the env var spelling |
| `CORS` errors in browser console | `CORS_ORIGIN` doesn't include your Vercel URL | Add exact origin (with `https://`, no trailing slash) → redeploy |
| First request after idle takes 30–60 s | Render free-tier sleep | Warm up both health URLs before the demo |
| WS says "Connecting…" forever | `VITE_WS_URL` wrong or http/wss mismatch | Must be `wss://` on HTTPS deployments |

---

## 5. Push to GitHub (first time)

Run these from the project root (I can do this for you — just say the word):

```bash
git init
git add .
git commit -m "Trace-X v2 — real-time crypto fraud attribution platform"
# On github.com: create an EMPTY repo named e.g. "trace-x" (no README/license),
# then connect and push:
git remote add origin https://github.com/<your-username>/trace-x.git
git branch -M main
git push -u origin main
```

> The `.gitignore` already excludes secrets, caches, databases and node_modules. `VITE_*` vars are not secrets — they're meant to be public.

---

## 6. SIH submission tips

- Put **both URLs** (Vercel + Render API) in the submission form, plus the demo logins.
- Record a **backup demo video** walking the deployed flow — free-tier services can sleep, and venue WiFi is a wildcard. A 3-minute screen recording is your insurance.
- Keep the localhost demo ready as plan B (it's fully offline-capable in simulated mode).
- In the pitch, mention the honest mode badge ("◉ live chain data / ▣ simulation mode") — judges respond well to a platform that's transparent about its data sources.
