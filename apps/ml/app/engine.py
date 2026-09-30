"""
Trace engine — orchestrates the full pipeline:
    trace_address -> detect_patterns -> vasp_hits -> risk.assess -> TraceResult
"""
import time
from typing import Callable, Dict, List, Optional

from . import attribution, config, risk, tracer
from .models import TraceGraph
from .util import now_ms


def run_trace(address: str, chain: str, typology_hint: Optional[str] = None,
              progress: Optional[Callable[[str, str, int], None]] = None) -> dict:
    """Run the complete analysis pipeline and return the TraceResult dict."""
    started = now_ms()
    t_start = time.time()

    def _stage(stage: str, detail: str, pct: int) -> None:
        if progress:
            progress(stage, detail, pct)

    _stage("INIT", f"Address accepted on {chain}", 5)
    _stage("FETCH", "Expanding transaction graph from seed wallet", 15)

    graph: TraceGraph = tracer.trace_address(
        address, chain, typology_hint,
        progress=lambda n, d: _stage("FETCH", f"Graph expansion: {n} wallets (hop {d})",
                                     min(60, 15 + n)))

    _stage("PATTERN", "Running laundering pattern detectors", 68)
    patterns: List[dict] = tracer.detect_patterns(graph)

    _stage("CLUSTER", "Clustering addresses into controlled entities", 78)
    clusters = attribution.cluster_addresses(graph)

    _stage("ATTRIBUTION", "Matching against VASP deposit-wallet registry", 86)
    hits: List[dict] = attribution.vasp_hits(graph, address)

    _stage("RISK", "Scoring risk and classifying fraud typology", 94)
    assessment = risk.assess(graph, patterns, hint=typology_hint)
    summary = tracer.build_summary(graph)

    completed = now_ms()
    primary = attribution.attribution_summary(hits)
    _stage("DONE", "Trace complete", 100)

    result = {
        "traceId": f"tx-{completed}-{chain.lower()}",
        "seedAddress": address,
        "chain": chain,
        "mode": graph.mode,
        "startedAt": started,
        "completedAt": completed,
        "durationMs": completed - started,
        "nodes": [_node_json(a, clusters) for a in graph.addresses.values()],
        "edges": [_edge_json(e) for e in graph.edges],
        "vaspHits": hits,
        "patterns": patterns,
        "crossChain": _cross_chain(graph),
        "risk": assessment,
        "summary": summary,
        "recommendations": _recommendations(graph, patterns, primary, assessment),
    }
    if primary:
        result["primaryAttribution"] = {
            "vaspId": primary["vaspId"], "name": primary["name"],
            "vaspType": primary.get("vaspType"),
            "wallet": primary["wallet"],
            "confidence": primary["confidence"], "pathDepth": primary["pathDepth"],
            "totalValueUsd": primary["totalValueUsd"],
        }
    return result


def _node_json(a, clusters: Dict[str, str]) -> dict:
    return {
        "id": a.address,
        "chain": a.chain,
        "label": a.label,
        "type": a.type,
        "vaspId": a.vaspId,
        "cluster": clusters.get(a.address, a.address),
        "firstIn": a.firstIn,
        "lastOut": a.lastOut,
        "totalInUsd": round(a.totalInUsd, 2),
        "totalOutUsd": round(a.totalOutUsd, 2),
        "txCount": a.txCount,
    }


def _edge_json(e) -> dict:
    return {
        "source": e.source, "target": e.target, "chain": e.chain,
        "asset": e.asset, "value": e.value, "valueUsd": e.valueUsd,
        "txHash": e.txHash, "timestamp": e.timestamp,
        "isCrossChain": e.isCrossChain, "bridgeId": e.bridgeId,
    }


def _cross_chain(graph: TraceGraph) -> dict:
    cross = [e for e in graph.edges if e.isCrossChain]
    hops = []
    for e in cross:
        src_node = graph.addresses.get(e.source)
        src_chain = src_node.chain if src_node else ("ETH" if e.chain == "TRON" else "TRON")
        hops.append({
            "fromChain": src_chain,
            "toChain": e.chain,
            "via": e.bridgeId or "unknown-bridge",
            "valueUsd": e.valueUsd,
        })
    bridge_ids = sorted({e.bridgeId for e in cross if e.bridgeId})
    return {"bridgesUsed": bridge_ids, "hops": hops}


def _recommendations(graph, patterns, primary, assessment) -> List[str]:
    recs: List[str] = []
    if primary and primary.get("vaspType") in ("CEX", "INSTANT_SWAP"):
        recs.append(
            f"Issue asset-freeze request to {primary['name']} referencing deposit wallet "
            f"{primary['wallet'][:14]}… (confidence {int(primary['confidence'] * 100)}%).")
    elif primary:
        recs.append(
            f"Traced through {primary['name']} (path depth {primary['pathDepth']}) — "
            "follow the post-service flow to the cash-out exchange before a freeze request.")
    else:
        recs.append("No exchange deposit wallet identified within hop budget — "
                    "extend trace depth or request provider-level data.")
    if any(p["type"] == "MIXER_PASS" for p in patterns):
        recs.append("Mixer pass detected: expect reduced traceability; preserve raw chain "
                    "data and request exchange-side KYT logs for the post-mix window.")
    if any(p["type"] == "CROSS_CHAIN" for p in patterns):
        recs.append("Cross-chain movement detected: trace the destination chain in a "
                    "separate case-linked analysis and include bridge hop in the report.")
    if assessment["level"] in ("HIGH", "CRITICAL"):
        recs.append("Risk level " + assessment["level"] +
                    " — prioritise 24h freeze window and SAHYOG alert to downstream LEAs.")
    if any(p["type"] == "FAN_IN" for p in patterns):
        recs.append("Multiple victim deposits observed: link other NCRP complaints "
                    "referencing the same collection wallet.")
    return recs
