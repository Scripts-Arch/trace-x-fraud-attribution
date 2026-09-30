"""Small helpers shared across the ML service."""
import hashlib
import json
import os
import time
from typing import Any, Dict


def now_ms() -> int:
    return int(time.time() * 1000)


def stable_hash(text: str) -> int:
    """Deterministic 64-bit-ish hash used for seeding simulated data."""
    return int.from_bytes(hashlib.sha256(text.encode()).digest()[:8], "big")


def seed_from(address: str) -> str:
    """Derive a reproducible RNG seed string from an address."""
    return hashlib.sha256(("tracex:" + address).encode()).hexdigest()


def usd(price_map: Dict[str, float], asset: str, amount: float) -> float:
    return round(amount * price_map.get(asset, 0.0), 2)


def load_json(path: str, default: Any) -> Any:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return default


def save_json(path: str, data: Any) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=1)


def short(addr: str, n: int = 10) -> str:
    return addr if len(addr) <= n * 2 + 3 else addr[: n + 2] + "…" + addr[-6:]


def clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def detect_chain(address: str) -> str | None:
    """Best-effort chain detection from address format."""
    a = address.strip()
    if a.startswith("0x") and len(a) == 42:
        return "ETH"
    if a.startswith("T") and 26 <= len(a) <= 34:
        return "TRON"
    if a.startswith("bc1") or (a.startswith(("1", "3")) and 25 <= len(a) <= 42):
        return "BTC"
    return None
