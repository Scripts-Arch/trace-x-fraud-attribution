"""Trace-X ML service tests — simulator, tracer, attribution, risk."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

import app.tracer as tracer  # noqa: E402
from app import attribution, risk, simulator  # noqa: E402
from app.util import detect_chain  # noqa: E402


@pytest.fixture(scope="module")
def force_simulated():
    """Neutralise live adapters so tests are hermetic."""
    original = tracer.get_adapter
    tracer.get_adapter = lambda chain: None
    yield
    tracer.get_adapter = original


# ---------------------------------------------------------------- chain detection

def test_detect_chain_formats():
    assert detect_chain("TXk9Q4tGdwJcK8ZLPmA6rFZBxpig9cLZmN") == "TRON"
    assert detect_chain("0x7a3f9d1c4e5b6a82907d4f13e6c8b5a2d9e0f174") == "ETH"
    assert detect_chain("bc1qsxt0rti0nblckm4ilx9j2v5w7hq3zn8pe0kq4t") == "BTC"
    assert detect_chain("3FupZp77ySr7jwoLYEJ9mwzJpvoNBXsBnE") == "BTC"
    assert detect_chain("not-a-wallet") is None


# ---------------------------------------------------------------- simulator

def test_simulator_deterministic(force_simulated):
    g1 = simulator.simulate("seed-wallet-001", "TRON", "INVESTMENT_SCAM")
    g2 = simulator.simulate("seed-wallet-001", "TRON", "INVESTMENT_SCAM")
    assert len(g1.edges) == len(g2.edges)
    assert {e.txHash for e in g1.edges} == {e.txHash for e in g2.edges}
    assert g1.mode == "simulated"


def test_simulator_produces_victim_fan_in(force_simulated):
    g = simulator.simulate("seed-wallet-002", "BTC", "SEXTORTION")
    inbound = [e for e in g.edges if e.target == g.seed]
    assert len(inbound) >= 3, "victim fan-in leg missing"
    assert all(e.valueUsd > 0 for e in g.edges)


def test_sextortion_uses_mixer(force_simulated):
    g = simulator.simulate("seed-mixer-001", "BTC", "SEXTORTION")
    types = {a.type for a in g.addresses.values()}
    assert "mixer" in types, "sextortion scenario should route via mixer"


def test_investment_tron_uses_bridge(force_simulated):
    g = simulator.simulate("seed-bridge-001", "TRON", "INVESTMENT_SCAM")
    types = {a.type for a in g.addresses.values()}
    assert "bridge" in types
    assert any(e.isCrossChain for e in g.edges), "bridge hop must be cross-chain"


# ---------------------------------------------------------------- tracer + patterns

def test_trace_address_falls_back_to_simulation(force_simulated):
    g = tracer.trace_address("bc1qdemo0wallet0for0pytest0run000000", "BTC", "RANSOMWARE")
    assert g.mode == "simulated"
    assert g.seed == "bc1qdemo0wallet0for0pytest0run000000"
    assert len(g.edges) > 0


def test_pattern_detector_fan_in_and_peel(force_simulated):
    g = simulator.simulate("seed-patterns-001", "ETH", "TASK_FRAUD")
    patterns = {p["type"] for p in tracer.detect_patterns(g)}
    assert "FAN_IN" in patterns
    assert patterns & {"PEEL_CHAIN", "RAPID_MOVEMENT", "CROSS_CHAIN"}, \
        f"expected laundering pattern, got {patterns}"


# ---------------------------------------------------------------- attribution

def test_vasp_hits_ranked_with_paths(force_simulated):
    g = simulator.simulate("seed-attr-001", "TRON", "INVESTMENT_SCAM")
    hits = attribution.vasp_hits(g, g.seed)
    assert hits, "expected at least one VASP hit"
    top = hits[0]
    assert 0.3 <= top["confidence"] <= 0.99
    assert top["path"][0] == g.seed
    assert top["pathDepth"] >= 1
    # Actionability ranking: a freezable exchange outranks mixers/bridges.
    types = [h.get("vaspType") for h in hits]
    if any(t in ("CEX", "INSTANT_SWAP") for t in types):
        assert top["vaspType"] in ("CEX", "INSTANT_SWAP"), \
            f"freezable VASP should rank first, got {top['name']}"
    primary = attribution.attribution_summary(hits)
    assert primary is not None and primary["name"] == top["name"]


def test_cluster_addresses_union_find(force_simulated):
    g = simulator.simulate("seed-cluster-001", "BTC", "RANSOMWARE")
    clusters = attribution.cluster_addresses(g)
    assert len(clusters) == len(g.addresses)
    assert all(v in g.addresses for v in clusters.values())


# ---------------------------------------------------------------- risk

def test_risk_assessment_shape_and_level(force_simulated):
    g = simulator.simulate("seed-risk-001", "BTC", "SEXTORTION")
    patterns = tracer.detect_patterns(g)
    out = risk.assess(g, patterns, hint="SEXTORTION")
    assert 0 <= out["score"] <= 99
    assert out["level"] in ("LOW", "MEDIUM", "HIGH", "CRITICAL")
    assert out["typology"] == "SEXTORTION"
    assert len(out["factors"]) >= 1
    assert out["typologyScores"]["SEXTORTION"] == max(out["typologyScores"].values())


def test_high_value_scam_scores_higher_than_quiet_wallet(force_simulated):
    g_scam = simulator.simulate("seed-cmp-scam", "TRON", "INVESTMENT_SCAM")
    g_quiet = simulator.simulate("seed-cmp-quiet", "BTC", "UNKNOWN")
    s_scam = risk.assess(g_scam, tracer.detect_patterns(g_scam), "INVESTMENT_SCAM")["score"]
    s_quiet = risk.assess(g_quiet, tracer.detect_patterns(g_quiet), None)["score"]
    assert s_scam >= s_quiet


def test_feature_vector_complete(force_simulated):
    g = simulator.simulate("seed-feats-001", "ETH", "PHISHING")
    feats = risk.graph_features(g)
    missing = set(risk.FEATURES) - set(feats)
    assert not missing, f"missing features: {missing}"
