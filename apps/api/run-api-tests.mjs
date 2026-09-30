/**
 * Test runner: boots the API (with ML deliberately unreachable) against a
 * scratch database, waits for health, then runs node --test.
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4321;

try { fs.rmSync(path.join(here, "data", "test-tracex.db"), { force: true }); } catch { /* fresh */ }

const server = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
  cwd: here,
  env: { ...process.env, PORT: String(PORT), TRACE_X_DB: "data/test-tracex.db",
         ML_SERVICE_URL: "http://127.0.0.1:59999" },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (d) => process.stdout.write(`[api] ${d}`));
server.stderr.on("data", (d) => process.stderr.write(`[api:err] ${d}`));

async function waitForHealth(tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((res) => setTimeout(res, 250));
  }
  return false;
}

const up = await waitForHealth();
if (!up) {
  console.error("API did not become healthy in time");
  server.kill();
  process.exit(1);
}

const tests = spawn(process.execPath, ["--test", "--import", "tsx", "src/__tests__/api.test.ts"], {
  cwd: here, stdio: "inherit",
});
tests.on("exit", (code) => {
  server.kill();
  process.exit(code ?? 1);
});
