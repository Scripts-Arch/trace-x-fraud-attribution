"""
Runtime-extensible label registry.

Investigators can label any address as a VASP/deposit/mixer/bridge during an
investigation (JSON via API); labels persist to user_labels.json and take
priority over the curated registry for lookups.
"""
import os
import threading
from typing import Dict, List, Optional

from . import config, registry
from .util import load_json, now_ms, save_json

_lock = threading.Lock()
_labels: Optional[Dict[str, dict]] = None


def _file() -> str:
    return os.path.join(config.ML_DIR, "data", "user_labels.json")


def _load() -> Dict[str, dict]:
    global _labels
    if _labels is None:
        _labels = load_json(_file(), {})
    return _labels


def _flush() -> None:
    save_json(_file(), _labels or {})


def add_label(address: str, name: str, kind: str = "exchange",
              vasp_id: Optional[str] = None,
              jurisdiction: Optional[str] = None,
              lea_contact: Optional[str] = None,
              added_by: str = "investigator") -> dict:
    a = (address or "").strip()
    if not a:
        raise ValueError("address required")
    with _lock:
        labels = _load()
        entry = {
            "address": a,
            "name": name or a[:12],
            "kind": kind if kind in ("exchange", "mixer", "bridge", "deposit", "contract") else "exchange",
            "vaspId": vasp_id or f"user-{a.lower()[:10]}",
            "jurisdiction": jurisdiction,
            "leaContact": lea_contact,
            "addedBy": added_by,
            "addedAt": now_ms(),
        }
        labels[a.lower()] = entry
        _flush()
        return entry


def remove_label(address: str) -> bool:
    with _lock:
        labels = _load()
        key = (address or "").lower()
        existed = key in labels
        labels.pop(key, None)
        _flush()
        return existed


def list_labels() -> List[dict]:
    return sorted(_load().values(), key=lambda e: -e.get("addedAt", 0))


def lookup(address: str) -> Optional[dict]:
    """User labels take priority over the curated registry."""
    a = (address or "").lower()
    user = _load().get(a)
    if user:
        return {
            "vaspId": user["vaspId"],
            "type": user["kind"],
            "chain": None,
            "name": user["name"],
            "source": "user",
        }
    curated = registry.lookup(address)
    if curated:
        curated = dict(curated)
        curated["source"] = "curated"
        vasp = registry.vasp_by_id(curated["vaspId"])
        if vasp:
            curated["name"] = vasp["name"]
        return curated
    return None
