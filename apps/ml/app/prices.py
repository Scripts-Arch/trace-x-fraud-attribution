"""
Live price oracle — real-time USD prices from CoinGecko with disk caching.

Removes all hardcoded fiat pricing: every valuation in the platform flows
through here. Prices are cached (default 10 min) with a last-known-good
stale fallback so tracing keeps working when the price API is down.
"""
import threading
import time
from typing import Dict, Optional

import requests

from . import config
from .util import load_json, save_json

session = requests.Session()
session.headers.update({"User-Agent": "Trace-X/1.0 (blockchain-analytics)"})

# asset -> CoinGecko id
COINGECKO_IDS: Dict[str, str] = {
    "BTC": "bitcoin",
    "ETH": "ethereum",
    "TRX": "tron",
    "USDT": "tether",
    "USDC": "usd-coin",
}

_lock = threading.Lock()
_cache: Dict[str, float] = {}
_cache_at: float = 0.0

STABLECOINS = {"USDT", "USDC", "DAI", "BUSD", "TUSD"}


def _cache_file() -> str:
    import os
    return os.path.join(config.CACHE_DIR, "prices.json")


def _fetch_all() -> Optional[Dict[str, float]]:
    ids = ",".join(COINGECKO_IDS.values())
    try:
        r = session.get(
            "https://api.coingecko.com/api/v3/simple/price",
            params={"ids": ids, "vs_currencies": "usd"},
            timeout=config.HTTP_TIMEOUT,
        )
        if r.status_code != 200:
            return None
        raw = r.json()
        out: Dict[str, float] = {}
        for asset, gid in COINGECKO_IDS.items():
            px = (raw.get(gid) or {}).get("usd")
            if px:
                out[asset] = float(px)
        return out or None
    except (requests.RequestException, ValueError):
        return None


def get_prices(force: bool = False) -> Dict[str, float]:
    """Current USD prices (cached ~10 min; stale fallback after that)."""
    global _cache, _cache_at
    with _lock:
        fresh = (time.time() - _cache_at) < 600
        if _cache and fresh and not force:
            return dict(_cache)

        prices = _fetch_all()
        if prices:
            _cache = prices
            _cache_at = time.time()
            save_json(_cache_file(), {"at": _cache_at, "prices": prices})
            return dict(_cache)

        if _cache and not force:
            return dict(_cache)

        # cold start + API down: last-known-good from disk, else fallback table
        disk = load_json(_cache_file(), None)
        if disk and disk.get("prices"):
            _cache = disk["prices"]
            _cache_at = disk.get("at", 0)
            return dict(_cache)

        return {
            "BTC": config.USD_PRICES["BTC"],
            "ETH": config.USD_PRICES["ETH"],
            "TRX": config.USD_PRICES["TRX"],
            "USDT": 1.0,
            "USDC": 1.0,
        }


def usd_value(asset: str, amount: float) -> float:
    """USD value of an asset amount. Stablecoins pinned to $1."""
    if not asset:
        return 0.0
    a = asset.upper()
    if a in STABLECOINS:
        return round(amount, 2)
    px = get_prices().get(a)
    if px is None:
        return 0.0
    return round(amount * px, 2)


def price_of(asset: str) -> float:
    a = asset.upper()
    if a in STABLECOINS:
        return 1.0
    return get_prices().get(a, 0.0)


def price_meta() -> dict:
    """Metadata for the UI price chip: prices + source freshness."""
    prices = get_prices()
    age_s = int(time.time() - _cache_at) if _cache_at else None
    return {
        "prices": prices,
        "source": "coingecko",
        "ageSeconds": age_s,
        "stale": bool(age_s and age_s > 1800),
    }
