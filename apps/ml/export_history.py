"""
Exports realistic historical trace history for the dashboard seed.

Generates a back-dated set of completed traces across chains, typologies and
VASPs (status/counts only — no graphs) and saves ../api/seeds/history.json.
"""
import json
import os
import random
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app import config, registry  # noqa: E402
from app.util import now_ms  # noqa: E402

CHAINS = ["BTC", "ETH", "TRON"]
TYPOLOGIES = ["INVESTMENT_SCAM", "TASK_FRAUD", "SEXTORTION", "RANSOMWARE",
              "PHISHING", "DARKNET"]
CATEGORIES = {
    "INVESTMENT_SCAM": "Investment / trading fraud",
    "TASK_FRAUD": "Task-based fraud",
    "SEXTORTION": "Sextortion",
    "RANSOMWARE": "Ransomware",
    "PHISHING": "Phishing",
    "DARKNET": "Darknet transaction",
}
CEX_IDS = [v["id"] for v in registry.all_vasps() if v.get("type") == "CEX"]


def main(n: int = 60) -> None:
    rng = random.Random(2026)
    history = []
    for i in range(n):
        days_ago = rng.randint(1, 45)
        at = int((datetime.now(timezone.utc) - timedelta(days=days_ago,
                   hours=rng.randint(0, 23))).timestamp() * 1000)
        chain = CHAINS[rng.randrange(3)]
        typo = TYPOLOGIES[rng.randrange(len(TYPOLOGIES))]
        score = min(97, max(12, int(rng.gauss(72, 16))))
        attributed = rng.random() < 0.78
        history.append({
            "traceId": f"tx-hist-{i:04d}",
            "at": at,
            "chain": chain,
            "typology": typo,
            "category": CATEGORIES[typo],
            "riskScore": score,
            "riskLevel": ("CRITICAL" if score >= 80 else "HIGH" if score >= 60
                          else "MEDIUM" if score >= 35 else "LOW"),
            "attributedVasp": rng.choice(CEX_IDS) if attributed else None,
            "durationMs": rng.randint(900, 6500),
            "wallets": rng.randint(6, 120),
        })
    history.sort(key=lambda h: -h["at"])

    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "..", "api", "seeds", "history.json")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump({"exportedAt": now_ms(), "history": history}, fh)
    print(f"[history] wrote {len(history)} records -> {out_path}")


if __name__ == "__main__":
    main()
