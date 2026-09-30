"""
VASP attribution — finds the nearest exchange/VASP receiving direct deposits.

Uses union-find co-spend clustering to group addresses into entities, then a
value-weighted shortest-path search from the seed wallet to every labelled
VASP wallet, scored into confidence-ranked VASP hits.
"""
from collections import deque
from typing import Dict, List, Optional, Tuple

from . import registry
from .models import TraceGraph


def cluster_addresses(graph: TraceGraph) -> Dict[str, str]:
    """
    Union-find over co-spending relationships (two addresses spending in the
    same transaction implies common control). Returns address -> cluster root.
    """
    parent: Dict[str, str] = {a: a for a in graph.addresses}

    def find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: str, b: str) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    by_hash: Dict[str, List[str]] = {}
    for e in graph.edges:
        if not e.isCrossChain:
            by_hash.setdefault(e.txHash, [])
            by_hash[e.txHash].extend({e.source, e.target})
    for participants in by_hash.values():
        for other in participants[1:]:
            if other in parent and participants[0] in parent:
                union(participants[0], other)

    return {a: find(a) for a in parent}


def vasp_hits(graph: TraceGraph, seed: str) -> List[dict]:
    """
    Rank VASPs by value-weighted distance from the seed. Each hit carries the
    explainable address path, hop depth, confidence and USD exposure.
    """
    # adjacency with USD weights
    adj: Dict[str, List[Tuple[str, float, str]]] = {}
    for e in graph.edges:
        adj.setdefault(e.source, []).append((e.target, e.valueUsd, e.txHash))
        adj.setdefault(e.target, []).append((e.source, e.valueUsd, e.txHash))

    labelled = {a.address: a for a in graph.addresses.values() if a.vaspId}

    # BFS least-hops paths from seed to each labelled VASP wallet.
    # Paths may run *through* labelled nodes (e.g. bridge -> exchange), so we
    # record the hit but keep expanding the frontier.
    first_path: Dict[str, List[str]] = {}
    queue: deque = deque([[seed]])
    seen = {seed}
    while queue and len(first_path) < len(labelled):
        path = queue.popleft()
        cur = path[-1]
        if cur in labelled and cur != seed and cur not in first_path:
            first_path[cur] = path
        for nxt, _w, _h in adj.get(cur, []):
            if nxt not in seen:
                seen.add(nxt)
                queue.append(path + [nxt])

    best: Dict[str, dict] = {}
    for wallet, info in labelled.items():
        path = first_path.get(wallet)
        if not path:
            continue
        depth = len(path) - 1
        # exposure = USD along edges of the path (min edge is bottleneck)
        exposure = _path_exposure(graph, path)
        hit = {
            "vaspId": info.vaspId,
            "wallet": wallet,
            "chain": info.chain,
            "pathDepth": depth,
            "path": path,
            "totalValueUsd": exposure,
        }
        prev = best.get(info.vaspId)
        if prev is None or _score(hit) > _score(prev):
            best[info.vaspId] = hit

    hits: List[dict] = []
    for vasp_id, hit in best.items():
        vasp = registry.vasp_by_id(vasp_id)
        if not vasp:
            continue
        confidence = _confidence(hit, vasp, len(graph.addresses))
        hits.append({
            "vaspId": vasp_id,
            "name": vasp["name"],
            "vaspType": vasp.get("type"),
            "chain": hit["chain"],
            "wallet": hit["wallet"],
            "path": hit["path"],
            "pathDepth": hit["pathDepth"],
            "confidence": confidence,
            "totalValueUsd": hit["totalValueUsd"],
            "firstSeen": graph.addresses.get(hit["wallet"]).firstIn
            if graph.addresses.get(hit["wallet"]) else None,
        })
    # Rank by actionability: freezable exchanges first, then instant swaps,
    # then mixers/bridges (intel value, not freeze targets). Ties by confidence.
    weight = {"CEX": 1.0, "INSTANT_SWAP": 0.94, "DARKNET": 0.62,
              "MIXER": 0.58, "BRIDGE": 0.45}
    hits.sort(key=lambda h: (-(h["confidence"] * weight.get(h.get("vaspType"), 0.5)),
                             -h["totalValueUsd"]))
    return hits[:8]


def _path_exposure(graph: TraceGraph, path: List[str]) -> float:
    """Min edge value along the path = max value that can travel it (bottleneck)."""
    if len(path) < 2:
        return 0.0
    index: Dict[Tuple[str, str], List[float]] = {}
    for e in graph.edges:
        index.setdefault((e.source, e.target), []).append(e.valueUsd)
        index.setdefault((e.target, e.source), []).append(e.valueUsd)
    vals: List[float] = []
    for i in range(len(path) - 1):
        options = index.get((path[i], path[i + 1])) or [0.0]
        vals.append(max(options))
    return round(min(vals), 2)


def _score(hit: dict) -> float:
    return hit["totalValueUsd"] / max(1, hit["pathDepth"])


def _confidence(hit: dict, vasp: dict, graph_size: int) -> float:
    """Heuristic confidence: shallow path + real exposure + known VASP."""
    depth_pen = {1: 0.0, 2: 0.08, 3: 0.18, 4: 0.3}.get(hit["pathDepth"], 0.42)
    exposure_factor = 0.06 if hit["totalValueUsd"] > 1000 else 0.12
    kyt = float(vasp.get("kytScore") or 0.5)
    conf = 0.97 - depth_pen - exposure_factor - kyt * 0.12
    return round(max(0.35, min(0.98, conf)), 2)


def attribution_summary(hits: List[dict]) -> Optional[dict]:
    """Primary attribution: highest-ranked freezable VASP hit (full hit dict)."""
    for h in hits:
        vasp = registry.vasp_by_id(h["vaspId"])
        if vasp and vasp.get("type") in ("CEX", "INSTANT_SWAP"):
            return h
    return hits[0] if hits else None
