"""Runtime configuration for the Trace-X ML service."""
import os
from typing import Dict, List

# TRACE_X_MODE: live = public APIs only; simulated = demo engine only;
# hybrid = live first with automatic simulated fallback (demo-safe).
MODE: str = os.getenv("TRACE_X_MODE", "hybrid").lower()

CACHE_DIR: str = os.getenv("TRACE_X_CACHE_DIR", os.path.join(os.path.dirname(__file__), "..", "cache"))

HTTP_TIMEOUT: int = int(os.getenv("TRACE_X_HTTP_TIMEOUT", "12"))

MAX_HOPS: int = int(os.getenv("TRACE_X_MAX_HOPS", "6"))
MAX_ADDRESSES: int = int(os.getenv("TRACE_X_MAX_ADDRESSES", "220"))
MAX_TX_PER_ADDRESS: int = int(os.getenv("TRACE_X_MAX_TX", "40"))
TRACE_TIME_BUDGET_S: float = float(os.getenv("TRACE_X_TIME_BUDGET", "55"))

ML_DIR: str = os.path.dirname(__file__)
MODELS_DIR: str = os.path.join(ML_DIR, "..", "models")
SEEDS_DIR: str = os.path.join(ML_DIR, "..", "seeds")

MODEL_VERSION: str = "tx-risk-1.0.0"

# Approximate USD prices used to normalise value across chains/assets.
USD_PRICES: Dict[str, float] = {
    "BTC": 65000.0,
    "ETH": 3300.0,
    "TRX": 0.13,
    "USDT": 1.0,
    "USDC": 1.0,
}

# Sample cases surfaced on the frontend "New Trace" page (simulated mode,
# deterministic). All demo addresses are cryptographically VALID (checksums
# verified — see scripts/make_demo_wallets.py) but are not real wallets.
SAMPLE_SEEDS: List[dict] = [
    {
        "key": "investment",
        "title": "Investment scam — TRON USDT peel chain",
        "narrative": (
            "Victim was added to a WhatsApp 'trading mentor' group and persuaded to "
            "deposit USDT into the suspect wallet across four transactions."
        ),
        "address": "TJLKnZKEWM2VdTqXhUK8LWG1cQ4uHBBurn",
        "chain": "TRON",
        "typology": "INVESTMENT_SCAM",
    },
    {
        "key": "sextortion",
        "title": "Sextortion — BTC mixer pass to OKX",
        "narrative": (
            "Victim was blackmailed over a video call recording; funds were paid in BTC "
            "and rapidly split through a mixing service."
        ),
        "address": "bc1qe36w2wz9828z567vlw5r4zv0f39p5wetpge6tl",
        "chain": "BTC",
        "typology": "SEXTORTION",
    },
    {
        "key": "task",
        "title": "Task-based fraud — ETH dust fan-in",
        "narrative": (
            "Victims were paid small 'task completion' incentives and asked to send "
            "'unlock deposits' that funnelled into one collector wallet."
        ),
        "address": "0x7358e2aB59D4A01EDfE1CC52f410316131669e20",
        "chain": "ETH",
        "typology": "TASK_FRAUD",
    },
    {
        "key": "ransomware",
        "title": "Ransomware — BTC consolidation to exchange",
        "narrative": (
            "Multiple victim companies paid ransoms to the same deposit address; funds "
            "consolidated and attempted exchange cash-out."
        ),
        "address": "1657TAVscUsbzmvf52x8X9APgfTPndrsNE",
        "chain": "BTC",
        "typology": "RANSOMWARE",
    },
]
