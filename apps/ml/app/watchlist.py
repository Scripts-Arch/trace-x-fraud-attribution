"""
Wallet watchlist with automatic movement polling.

Investigators pin suspect addresses; a background poller re-fetches chain
activity every cycle and raises P1 alerts when new inflows/outflows appear
after the watch started. A manual "check now" endpoint forces an immediate
poll. All live data — the poller uses the same adapters as tracing.
"""
import os
import threading
import time
from typing import Dict, List, Optional

from . import config, labels, validation
from .adapters import AdapterError, get_adapter
from .models import TraceGraph
from .util import load_json, now_ms, save_json

_lock = threading.Lock()
_watches: Optional[Dict[str, dict]] = None
_poller_started = False


def _file() -> str:
    return os.path.join(config.CACHE_DIR, "watchlist.json")


def _load() -> Dict[str, dict]:
    global _watches
    if _watches is None:
        raw = load_json(_file(), {})
        _watches = {k: v for k, v in (raw or {}).items()}
    return _watches


def _flush() -> None:
    save_json(_file(), _watches or {})


def add_watch(address: str, chain: str, note: str = "",
              case_id: Optional[str] = None,
              added_by: str = "investigator") -> dict:
    a = (address or "").strip()
    if not a:
        raise ValueError("address required")
    v = validation.validate(a)
    if not v.valid:
        raise ValueError(f"invalid address: {v.reason}")
    with _lock:
        watches = _load()
        key = a.lower()
        existing = watches.get(key)
        if existing:
            existing["active"] = True
            existing["note"] = note or existing.get("note", "")
            if case_id:
                existing["caseId"] = case_id
            _flush()
            return existing
        entry = {
            "id": f"wth-{int(time.time() * 1000) % 10**10:x}",
            "address": a,
            "chain": (chain or "BTC").upper(),
            "note": note,
            "caseId": case_id,
            "addedBy": added_by,
            "addedAt": now_ms(),
            "lastCheckedAt": None,
            "lastTxAt": None,
            "knownTxHashes": [],
            "movements": [],
            "active": True,
        }
        watches[key] = entry
        _flush()
        return entry


def remove_watch(address: str) -> bool:
    with _lock:
        watches = _load()
        key = (address or "").lower()
        existed = key in watches
        watches.pop(key, None)
        _flush()
        return existed


def list_watches() -> List[dict]:
    return sorted(_load().values(), key=lambda w: -(w.get("addedAt") or 0))


def get_watch(address: str) -> Optional[dict]:
    return _load().get((address or "").lower())


def check_watch(address: str) -> dict:
    """
    Fetch current chain activity for a watched address and diff it against
    previously seen tx hashes. Returns the updated watch record with any new
    movements appended (and P1-worthy flag for the API alert layer).
    """
    watches = _load()
    key = (address or "").lower()
    w = watches.get(key)
    if not w:
        raise KeyError(f"not watched: {address}")

    adapter = get_adapter(w["chain"])
    if adapter is None:
        raise AdapterError(f"no adapter for chain {w['chain']}")

    graph = TraceGraph(seed=w["address"], chain=w["chain"], mode="live")
    adapter.fetch(w["address"], graph)

    seen = set(w.get("knownTxHashes") or [])
    new_edges = [e for e in graph.edges if e.txHash and e.txHash not in seen]
    movements = []
    for e in new_edges[:20]:
        movements.append({
            "at": e.timestamp,
            "direction": "in" if e.target == w["address"] else "out",
            "counterparty": e.source if e.target == w["address"] else e.target,
            "asset": e.asset,
            "value": e.value,
            "valueUsd": e.valueUsd,
            "txHash": e.txHash,
        })

    if movements:
        w.setdefault("movements", [])
        w["movements"] = (movements + w["movements"])[:100]
        w["lastTxAt"] = max(m["at"] for m in movements)
        w["movementsSinceWatch"] = True
    w["knownTxHashes"] = sorted({e.txHash for e in graph.edges if e.txHash})[-200:]
    w["lastCheckedAt"] = now_ms()
    w["currentTxCount"] = len(graph.edges)
    w["currentValueUsd"] = round(sum(e.valueUsd for e in graph.edges), 2)
    w["newMovements"] = len(movements)
    _flush()
    return w


def watcher_status() -> dict:
    watches = list_watches()
    return {
        "active": _poller_started,
        "watching": len([w for w in watches if w.get("active")]),
        "total": len(watches),
        "withNewMovements": len([w for w in watches if w.get("movementsSinceWatch")]),
    }


def start_poller(interval_s: int = 300, on_movement=None) -> None:
    """Background loop that checks every active watch on a rolling schedule."""
    global _poller_started
    if _poller_started:
        return
    _poller_started = True

    def _loop():
        idx = 0
        while True:
            try:
                watches = [w for w in list_watches() if w.get("active")]
                if watches:
                    w = watches[idx % len(watches)]
                    idx += 1
                    before = len(w.get("movements") or [])
                    result = check_watch(w["address"])
                    new_count = result.get("newMovements", 0)
                    if new_count and on_movement:
                        try:
                            on_movement(result)
                        except Exception:
                            pass
            except Exception:
                pass
            time.sleep(max(15, interval_s // max(1, len(watches) if watches else 1)))

    threading.Thread(target=_loop, name="tracex-watcher", daemon=True).start()
