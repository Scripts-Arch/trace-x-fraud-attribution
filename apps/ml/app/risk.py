"""
ML risk scoring — graph-feature risk model + fraud typology classifier.

Uses a sklearn GradientBoosting model trained offline (train_model.py);
falls back to a transparent heuristic when the model artifact is missing.
"""
import os
from typing import Dict, List, Optional

from . import config
from .models import TraceGraph
from .util import clamp, load_json

FEATURES = [
    "fan_in", "fan_out", "tx_velocity", "avg_usd", "max_usd",
    "mixer_proximity", "bridge_usage", "counterparty_risk",
    "vasp_distance", "graph_size_norm", "fan_in_out_ratio", "usd_log",
]

MIXER_TYPES = {"mixer"}


def graph_features(graph: TraceGraph) -> Dict[str, float]:
    """Compute the model feature vector from a traced graph."""
    seed = graph.addresses.get(graph.seed)
    edges = graph.edges

    fan_in = sum(1 for e in edges if e.target == graph.seed)
    fan_out = sum(1 for e in edges if e.source == graph.seed)
    out_vals = [e.valueUsd for e in edges if e.source == graph.seed]
    all_vals = [e.valueUsd for e in edges]

    mixer_proximity = 0.0
    for a in graph.addresses.values():
        if a.type in MIXER_TYPES:
            mixer_proximity = 1.0
            break

    bridge_usage = 1.0 if any(e.isCrossChain for e in edges) else 0.0

    counterparty_risk = 0.0
    n_risky = 0
    for a in graph.addresses.values():
        if a.type in ("mixer", "bridge"):
            n_risky += 1
    if graph.addresses:
        counterparty_risk = clamp(n_risky / max(1, len(graph.addresses) - 1), 0, 1)

    vasp_distance = 6.0
    for a in graph.addresses.values():
        if a.vaspId and a.type == "exchange":
            vasp_distance = 2.0
            break

    avg_usd = (sum(out_vals) / len(out_vals)) if out_vals else 0.0
    max_usd = max(all_vals) if all_vals else 0.0
    import math
    usd_log = math.log10(max_usd) if max_usd > 0 else 0.0

    return {
        "fan_in": float(fan_in),
        "fan_out": float(fan_out),
        "tx_velocity": float(len(edges)),
        "avg_usd": avg_usd,
        "max_usd": max_usd,
        "mixer_proximity": mixer_proximity,
        "bridge_usage": bridge_usage,
        "counterparty_risk": counterparty_risk,
        "vasp_distance": vasp_distance,
        "graph_size_norm": clamp(len(graph.addresses) / 50.0, 0, 1),
        "fan_in_out_ratio": (fan_in / fan_out) if fan_out else float(fan_in),
        "usd_log": usd_log,
    }


def heuristic_score(graph: TraceGraph, feats: Dict[str, float]) -> Dict[str, object]:
    """Transparent fallback scoring when the trained model is unavailable."""
    score = 22.0
    factors: List[dict] = []

    def add(points: float, factor: str, detail: str):
        nonlocal score
        score += points
        factors.append({"factor": factor, "impact": round(points), "detail": detail})

    if feats["fan_in"] >= 3:
        add(min(14.0, feats["fan_in"] * 3.0), "Victim fan-in",
            f"{int(feats['fan_in'])} separate deposits into the suspect wallet")
    if feats["mixer_proximity"] > 0:
        add(24.0, "Mixer interaction", "Funds routed through a mixing service")
    if feats["bridge_usage"] > 0:
        add(11.0, "Cross-chain hop", "Bridges used to break traceability")
    if feats["fan_out"] >= 3:
        add(min(12.0, feats["fan_out"] * 2.0), "Rapid fan-out",
            f"{int(feats['fan_out'])} outbound splits — layering behaviour")
    if feats["usd_log"] >= 4.0:
        add(8.0, "High-value flows", f"Peak transfer ≈ ${int(10 ** feats['usd_log']):,}")
    if feats["vasp_distance"] <= 2.0:
        add(9.0, "Exchange cash-out", "Direct path to an exchange deposit wallet")
    if feats["counterparty_risk"] > 0.25:
        add(7.0, "Risky counterparties", "Significant share of mixer/bridge counterparties")

    score = clamp(score, 5, 99)
    return {"score": round(score), "factors": factors, "model": "heuristic-v1"}


def typology(graph: TraceGraph, feats: Dict[str, float],
             patterns: List[dict], hint: Optional[str]) -> Dict[str, object]:
    """Rule-assisted typology classifier (hint-weighted graph evidence)."""
    scored: Dict[str, float] = {
        "INVESTMENT_SCAM": 0.2, "TASK_FRAUD": 0.2, "SEXTORTION": 0.15,
        "RANSOMWARE": 0.15, "PHISHING": 0.1, "DARKNET": 0.1,
    }
    if hint and hint in scored:
        scored[hint] += 0.45

    if feats["mixer_proximity"] > 0:
        scored["SEXTORTION"] += 0.2
        scored["RANSOMWARE"] += 0.15
        scored["DARKNET"] += 0.15
    if feats["bridge_usage"] > 0 and feats["avg_usd"] > 800:
        scored["INVESTMENT_SCAM"] += 0.25
    if feats["fan_in"] >= 4 and feats["avg_usd"] < 400:
        scored["TASK_FRAUD"] += 0.3
    if feats["fan_in"] >= 3 and feats["avg_usd"] >= 400:
        scored["SEXTORTION"] += 0.1
        scored["RANSOMWARE"] += 0.2
    if feats["max_usd"] > 15000:
        scored["INVESTMENT_SCAM"] += 0.15
        scored["RANSOMWARE"] += 0.1
    ptypes = {p["type"] for p in patterns}
    if "DUSTING" in ptypes:
        scored["PHISHING"] += 0.2
    if "ROUND_TRIP" in ptypes:
        scored["DARKNET"] += 0.15

    top = max(scored, key=scored.get)
    total = sum(scored.values()) or 1.0
    return {
        "typology": top if scored[top] >= 0.4 else "UNKNOWN",
        "confidence": round(clamp(scored[top] / total, 0.2, 0.97), 2),
        "scores": {k: round(v, 2) for k, v in sorted(scored.items(), key=lambda kv: -kv[1])},
    }


def risk_level(score: float) -> str:
    if score >= 80:
        return "CRITICAL"
    if score >= 60:
        return "HIGH"
    if score >= 35:
        return "MEDIUM"
    return "LOW"


def assess(graph: TraceGraph, patterns: List[dict],
           hint: Optional[str] = None) -> Dict[str, object]:
    """Full risk assessment: score, level, typology, explainable factors."""
    feats = graph_features(graph)
    model_path = os.path.join(config.MODELS_DIR, "risk_model.pkl")

    model_used = "heuristic-v1"
    score_val: Optional[float] = None
    factors: List[dict] = []

    model = load_json(model_path + ".meta.json", None)  # availability probe
    if model and os.path.exists(model_path):
        try:
            import joblib
            import numpy as np
            bundle = joblib.load(model_path)
            reg = bundle["regressor"]
            vec = [feats[f] for f in bundle["features"]]
            score_val = float(np.clip(reg.predict([vec])[0], 0, 100))
            model_used = bundle.get("version", config.MODEL_VERSION)
            factors = _explain_from_training(bundle, feats)
        except Exception:
            score_val = None

    if score_val is None:
        heur = heuristic_score(graph, feats)
        score_val = float(heur["score"])
        factors = heur["factors"]

    # pattern boost: detectors corroborate the model
    pattern_boost = min(10.0, 2.5 * len(patterns))
    score_val = clamp(score_val + pattern_boost, 0, 99)
    if pattern_boost:
        factors.append({"factor": "Pattern corroboration",
                        "impact": round(pattern_boost),
                        "detail": f"{len(patterns)} laundering pattern(s) detected"})

    typo = typology(graph, feats, patterns, hint)
    return {
        "score": round(score_val),
        "level": risk_level(score_val),
        "typology": typo["typology"],
        "typologyConfidence": typo["confidence"],
        "typologyScores": typo["scores"],
        "factors": sorted(factors, key=lambda f: -abs(f["impact"])),
        "modelVersion": model_used,
    }


def _explain_from_training(bundle: dict, feats: Dict[str, float]) -> List[dict]:
    """Top factor contributions from the trained model's feature importances."""
    try:
        imps = bundle["regressor"].feature_importances_
        pairs = sorted(zip(bundle["features"], imps), key=lambda p: -p[1])[:4]
        return [{"factor": name.replace("_", " ").title(),
                 "impact": round(float(imp) * 60, 1),
                 "detail": f"model feature importance {float(imp):.2f} (observed {feats[name]:.2f})"}
                for name, imp in pairs]
    except Exception:
        return []
