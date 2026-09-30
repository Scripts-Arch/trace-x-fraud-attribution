"""VASP registry — loads curated labelled clusters and provides lookups."""
import os
from typing import Dict, List, Optional

from . import config
from .util import load_json

RegistryData = Dict[str, object]

_registry: Optional[dict] = None


def _load() -> dict:
    global _registry
    if _registry is None:
        path = os.path.join(config.ML_DIR, "data", "vasp_registry.json")
        _registry = load_json(path, {"version": 0, "vasps": []})
    return _registry


def label_clusters() -> dict:
    path = os.path.join(config.ML_DIR, "data", "label_clusters.json")
    return load_json(path, {})


def all_vasps() -> List[dict]:
    return _load().get("vasps", [])  # type: ignore[return-value]


def vasp_by_id(vasp_id: str) -> Optional[dict]:
    for v in all_vasps():
        if v.get("id") == vasp_id:
            return v
    return None


def vasp_ids_by_type(vtype: str) -> List[str]:
    return [v["id"] for v in all_vasps() if v.get("type") == vtype]


def labelled_addresses() -> Dict[str, dict]:
    """Map every labelled address -> {vaspId, type} for fast lookup."""
    out: Dict[str, dict] = {}
    clusters = label_clusters()
    for chain, addresses in (clusters.get("exchanges") or {}).items():
        for idx, addr in enumerate(addresses):
            vasp_ids = vasp_ids_by_type("CEX")
            out[addr.lower()] = {
                "vaspId": vasp_ids[idx % len(vasp_ids)],
                "type": "exchange",
                "chain": chain,
            }
    for chain, addresses in (clusters.get("mixers") or {}).items():
        for idx, addr in enumerate(addresses):
            mixers = vasp_ids_by_type("MIXER")
            out[addr.lower()] = {
                "vaspId": mixers[idx % len(mixers)],
                "type": "mixer",
                "chain": chain,
            }
    for chain, addresses in (clusters.get("bridges") or {}).items():
        for idx, addr in enumerate(addresses):
            bridges = vasp_ids_by_type("BRIDGE")
            out[addr.lower()] = {
                "vaspId": bridges[idx % len(bridges)],
                "type": "bridge",
                "chain": chain,
            }
    return out


def lookup(address: str) -> Optional[dict]:
    return labelled_addresses().get(address.lower())


def type_for_vasp(vasp_id: str) -> str:
    v = vasp_by_id(vasp_id)
    if not v:
        return "wallet"
    t = v.get("type")
    if t in ("MIXER",):
        return "mixer"
    if t in ("BRIDGE",):
        return "bridge"
    if t in ("DARKNET",):
        return "exchange"
    return "exchange"
