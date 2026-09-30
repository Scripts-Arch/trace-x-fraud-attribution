"""
Tracing engine — expands the suspect address into a fund-flow graph.

Hybrid policy: try the live chain adapter first; on failure (or zero usable
transactions) fall back to the deterministic simulator so a demo trace never
dead-ends. Includes heuristic laundering-pattern detectors.
"""
import time
from collections import Counter, deque
from concurrent.futures import ThreadPoolExecutor
from typing import Callable, Dict, List, Optional, Set

from . import config, registry
from .adapters import AdapterError, get_adapter
from .models import AddressInfo, TraceGraph, TxEdge
from .simulator import simulate as simulate_graph

_fetch_pool = ThreadPoolExecutor(max_workers=6, thread_name_prefix="tracex-fetch")


def trace_address(address: str, chain: str, typology_hint: Optional[str] = None,
                  progress: Optional[Callable[[int, int], None]] = None) -> TraceGraph:
    """Expand the seed address into a TraceGraph (live first, then fallback)."""
    started = time.time()
    graph = TraceGraph(seed=address, chain=chain, mode="live")

    seed_info = AddressInfo(address=address, chain=chain, label="Victim-reported suspect")
    lookup = registry.lookup(address)
    if lookup:
        seed_info.type = registry.type_for_vasp(lookup["vaspId"])
        seed_info.vaspId = lookup["vaspId"]
        seed_info.label = _vasp_name(lookup["vaspId"])
    graph.add_address(seed_info)

    adapter = get_adapter(chain)
    live_ok = False
    if adapter is not None:
        try:
            if progress:
                progress(1, 0)
            adapter.fetch(address, graph)
            live_ok = len(graph.edges) > 0
        except AdapterError:
            live_ok = False

    if not live_ok:
        if progress:
            progress(1, 1)
        return simulate_graph(address, chain, typology_hint, max_hops=config.MAX_HOPS)

    # ---------------- BFS expansion over live data (parallel fetches) -----
    queue: deque = deque([(address, 0)])
    visited: Set[str] = {address}

    def fetch_one(cp: str):
        """Fetch one neighbour into an ISOLATED sub-graph (thread-safe)."""
        if time.time() - started > config.TRACE_TIME_BUDGET_S:
            return cp, None
        sub = TraceGraph(seed=cp, chain=chain, mode="live")
        try:
            adapter.fetch(cp, sub)
            return cp, sub
        except AdapterError:
            return cp, None

    while queue:
        addr, depth = queue.popleft()
        if depth >= config.MAX_HOPS or len(graph.addresses) >= config.MAX_ADDRESSES:
            break
        node = graph.addresses.get(addr)
        if not node or not node.counterparties:
            continue
        batch = []
        for cp in node.counterparties[: config.MAX_TX_PER_ADDRESS]:
            if cp in visited or len(graph.addresses) >= config.MAX_ADDRESSES:
                continue
            visited.add(cp)
            batch.append(cp)
        if not batch:
            continue
        if progress:
            progress(len(graph.addresses), depth + 1)

        # fetch the whole frontier level in parallel, merge serially
        results = list(_fetch_pool.map(fetch_one, batch))
        for cp, sub in results:
            if sub is None:
                graph.add_address(AddressInfo(address=cp, chain=chain))
                continue
            _merge_subgraph(graph, sub)
            cp_node = graph.addresses.get(cp)
            if cp_node is not None:
                cp_lookup = registry.lookup(cp)
                if cp_lookup:
                    cp_node.type = registry.type_for_vasp(cp_lookup["vaspId"])
                    cp_node.vaspId = cp_lookup["vaspId"]
                    cp_node.label = _vasp_name(cp_lookup["vaspId"])
                queue.append((cp, depth + 1))

    return graph


def _merge_subgraph(graph: TraceGraph, sub: TraceGraph) -> None:
    """Serially merge a worker's sub-graph: nodes first, then deduped edges
    (add_edge maintains totals/timestamps/counterparties on both endpoints)."""
    for addr_s, info in list(sub.addresses.items()):
        if addr_s not in graph.addresses:
            graph.add_address(AddressInfo(
                address=info.address, chain=info.chain, label=info.label,
                type=info.type, vaspId=info.vaspId))
    existing = {(e.txHash, e.source, e.target, e.asset) for e in graph.edges}
    for e in sub.edges:
        k = (e.txHash, e.source, e.target, e.asset)
        if k in existing:
            continue
        existing.add(k)
        # ensure both endpoints exist so totals are maintained
        for endpoint in (e.source, e.target):
            if endpoint not in graph.addresses:
                meta = sub.addresses.get(endpoint)
                graph.add_address(AddressInfo(
                    address=endpoint, chain=meta.chain if meta else e.chain,
                    label=meta.label if meta else None,
                    type=meta.type if meta else "wallet",
                    vaspId=meta.vaspId if meta else None))
        graph.add_edge(e)


def _vasp_name(vasp_id: str) -> str:
    v = registry.vasp_by_id(vasp_id)
    return v["name"] if v else vasp_id


# ---------------------------------------------------------------- patterns

def detect_patterns(graph: TraceGraph) -> List[dict]:
    """Heuristic laundering-pattern detectors over the traced graph."""
    patterns: List[dict] = []

    # Dusting: many sub-$1 inbound transfers
    dust = [e for e in graph.edges if e.valueUsd < 1.0]
    if len(dust) >= 3:
        patterns.append({
            "type": "DUSTING",
            "detail": f"{len(dust)} sub-$1 transfers — address-dusting vector detected",
            "addresses": sorted({e.source for e in dust})[:8],
        })

    # Fan-in: multiple victims paying the seed (task fraud / sextortion shape)
    inbound = [e for e in graph.edges if e.target == graph.seed]
    if len(inbound) >= 3:
        patterns.append({
            "type": "FAN_IN",
            "detail": f"{len(inbound)} separate deposits funnelled into the suspect wallet",
            "addresses": sorted({e.source for e in inbound})[:8],
        })

    # Peel chain: fan-outs of decreasing value from one wallet
    by_src: Dict[str, List[TxEdge]] = {}
    for e in graph.edges:
        by_src.setdefault(e.source, []).append(e)
    peel_sources = []
    for src, es in by_src.items():
        outs = sorted(es, key=lambda x: x.timestamp)
        if len(outs) >= 3:
            vals = [e.valueUsd for e in outs]
            drops = sum(1 for i in range(1, len(vals)) if vals[i] < vals[i - 1])
            if drops >= 1:
                peel_sources.append(src)
    if peel_sources:
        patterns.append({
            "type": "PEEL_CHAIN",
            "detail": (f"{len(peel_sources)} wallet(s) splitting funds into multiple "
                       "decreasing-value outputs — layered laundering"),
            "addresses": peel_sources[:8],
        })

    # Mixer proximity
    mixers = [a for a in graph.addresses.values() if a.type == "mixer"]
    if mixers:
        names = ", ".join((a.label or a.address[:14]) for a in mixers)
        patterns.append({
            "type": "MIXER_PASS",
            "detail": f"Funds routed through mixing service: {names}",
            "addresses": [a.address for a in mixers],
        })

    # Cross-chain movement
    cross = [e for e in graph.edges if e.isCrossChain]
    if cross:
        patterns.append({
            "type": "CROSS_CHAIN",
            "detail": f"{len(cross)} cross-chain hop(s) via bridge contracts",
            "addresses": sorted({e.source for e in cross})[:8],
        })

    # Rapid movement: burst of transfers in a short window
    for src, es in by_src.items():
        if len(es) >= 3:
            ts = sorted(e.timestamp for e in es)
            if ts[-1] - ts[0] < 6 * 3600_000:
                patterns.append({
                    "type": "RAPID_MOVEMENT",
                    "detail": f"{len(es)} transfers within 6h from one wallet",
                    "addresses": [src],
                })
                break

    # Round-tripping: same pair transacting in both directions
    pair_counts: Counter = Counter()
    for e in graph.edges:
        pair_counts[frozenset((e.source, e.target))] += 1
    cycles = [p for p, c in pair_counts.items() if c >= 2 and len(p) == 2]
    if cycles:
        patterns.append({
            "type": "ROUND_TRIP",
            "detail": "Funds observed moving both directions between the same wallets",
            "addresses": [next(iter(p)) for p in cycles[:8]],
        })

    return patterns


# ---------------------------------------------------------------- summary

def build_summary(graph: TraceGraph) -> dict:
    """Aggregate graph stats into the API summary shape."""
    depth = _depth_map(graph)
    mixers = [a for a in graph.addresses.values() if a.type == "mixer"]
    bridges = [a for a in graph.addresses.values() if a.type == "bridge"]
    vasps = {a.vaspId for a in graph.addresses.values() if a.vaspId}
    return {
        "totalAddresses": len(graph.addresses),
        "totalTransactions": len(graph.edges),
        "totalValueUsd": round(sum(e.valueUsd for e in graph.edges), 2),
        "maxDepth": max(depth.values()) if depth else 0,
        "vaspCount": len(vasps),
        "mixerCount": len(mixers),
        "bridgeCount": len(bridges),
        "chains": sorted({a.chain for a in graph.addresses.values()}),
    }


def _depth_map(graph: TraceGraph) -> Dict[str, int]:
    """BFS distance from the seed over the (undirected) edge set."""
    adj: Dict[str, List[str]] = {}
    for e in graph.edges:
        adj.setdefault(e.source, []).append(e.target)
        adj.setdefault(e.target, []).append(e.source)
    dist = {graph.seed: 0}
    q: deque = deque([graph.seed])
    while q:
        cur = q.popleft()
        for nxt in adj.get(cur, []):
            if nxt not in dist:
                dist[nxt] = dist[cur] + 1
                q.append(nxt)
    return dist
