"""Batch + watchlist + proxy smoke test against a RUNNING stack (:4000/:8000)."""
import json
import sys
import time
import urllib.request

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

API = "http://localhost:4000/api/v1"


def call(method, path, body=None, token=None):
    req = urllib.request.Request(
        API + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json",
                 **({"Authorization": f"Bearer {token}"} if token else {})})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


tok = call("POST", "/auth/login", {"username": "admin", "password": "admin123"})["token"]
print("login ok")

# 1. batch with a mix of valid + garbage
b = call("POST", "/batches", {"addresses": [
    "1657TAVscUsbzmvf52x8X9APgfTPndrsNE",
    "0x7358e2aB59D4A01EDfE1CC52f410316131669e20",
    "bc1qdeadbeefinvalidchecksum000000000000",
    "not-a-wallet",
]}, token=tok)["batch"]
print(f"batch {b['id']}: accepted={b['accepted']} rejected={[r['reason'][:38] for r in b['rejected']]}")

# 2. wait for member traces to finish
for _ in range(30):
    time.sleep(3)
    d = call("GET", f"/batches/{b['id']}", token=tok)
    if d["aggregate"]["completed"] >= b["accepted"]:
        break
a = d["aggregate"]
print(f"aggregate: {a['completed']}/{a['traces']} done · attributed={a['attributed']} · ${a['totalValueUsd']:,}")
print("riskDist:", a["riskDist"])
print("vaspExposure:", [(v["name"], v["totalUsd"]) for v in a["vaspExposure"][:3]])
for t in d["traces"]:
    pv = t["primaryVasp"]["name"] if t["primaryVasp"] else "—"
    print(f"  {t['chain']} {t['seedAddress'][:14]}… risk={t['riskScore']} {t['riskLevel']} → {pv}")

# 3. ML proxies through the API
v = call("POST", "/validate", {"address": "TJLKnZKEWM2VdTqXhUK8LWG1cQ4uHBBurn"}, token=tok)
print("validate proxy:", v["valid"], v["chain"], v["addressType"])
p = call("GET", "/prices", token=tok)
print("prices proxy:", {k: v for k, v in p["prices"].items()}, "stale:", p["stale"])
e = call("POST", "/extract", {"text": "sent 2 BTC to 1657TAVscUsbzmvf52x8X9APgfTPndrsNE then USDT to TJLKnZKEWM2VdTqXhUK8LWG1cQ4uHBBurn"}, token=tok)
print("extract proxy:", e["count"], "found,", e["anyValid"])

# 4. labels round trip
call("POST", "/labels", {"address": "TJLKnZKEWM2VdTqXhUK8LWG1cQ4uHBBurn", "name": "smoke-test entity", "kind": "exchange"}, token=tok)
labels = call("GET", "/labels", token=tok)["labels"]
print("labels proxy:", [(l["name"], l["kind"]) for l in labels[:2]])
call("DELETE", "/labels/TJLKnZKEWM2VdTqXhUK8LWG1cQ4uHBBurn", token=tok)

# 5. watchlist round trip through the API
call("POST", "/watchlist", {"address": "3BeTSPDF6hxhmaqazmWYMrVKJPHXdmsXns", "chain": "BTC", "note": "smoke"}, token=tok)
w = call("GET", "/watchlist", token=tok)["watchlist"]
print("watchlist proxy:", [(x["address"][:12], x["chain"]) for x in w])
call("DELETE", "/watchlist/3BeTSPDF6hxhmaqazmWYMrVKJPHXdmsXns", token=tok)

print("SMOKE OK")
