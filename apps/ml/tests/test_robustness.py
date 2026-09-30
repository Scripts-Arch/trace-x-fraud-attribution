"""
Trace-X v2 robustness suite — validation matrix, chaos inputs, complaint-text
extraction fixtures, watchlist movement diffing and the price oracle.

Hermetic by design: no network calls. Live adapters, the price fetcher and
the watchlist poller are monkeypatched; file-backed state goes to a tmp dir.
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

from app import config, labels, prices, validation, watchlist  # noqa: E402
from app.models import AddressInfo, TraceGraph, TxEdge  # noqa: E402
from app.tracer import trace_address  # noqa: E402


# ------------------------------------------------------------------ fixtures

@pytest.fixture()
def tmp_state(monkeypatch):
    """Redirect every file-backed store to a throwaway dir and reset caches."""
    tmp = tempfile.mkdtemp(prefix="tracex-test-")
    monkeypatch.setattr(config, "CACHE_DIR", tmp)
    monkeypatch.setattr(config, "ML_DIR", tmp)
    os.makedirs(os.path.join(tmp, "data"), exist_ok=True)
    # reset module-level singletons between tests
    monkeypatch.setattr(watchlist, "_watches", None)
    monkeypatch.setattr(watchlist, "_poller_started", False)
    monkeypatch.setattr(labels, "_labels", None)
    monkeypatch.setattr(prices, "_cache", {})
    monkeypatch.setattr(prices, "_cache_at", 0.0)
    yield tmp


# ------------------------------------------------------------------ validation matrix

class TestValidationMatrix:
    def test_bip173_official_vectors(self):
        # Official BIP-173 test vectors (mainnet P2WPKH / P2WSH, testnet, ALL-CAPS)
        assert validation.bech32_is_valid("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4")
        assert validation.bech32_is_valid(
            "bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3")
        assert validation.bech32_is_valid("tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx")
        assert validation.bech32_is_valid("BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4")

    def test_bip173_corrupted_vectors_rejected(self):
        good = "BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4"
        for i in range(len(good)):
            for sub in "qpzry9x8gf2tvdw0s3jn54khce6mua7l0":
                if sub == good[i].lower():
                    continue
                bad = good[:i] + sub + good[i + 1:]
                assert not validation.bech32_is_valid(bad), f"corruption at {i} accepted: {bad}"

    def test_validate_valid_addresses_all_chains(self):
        # crypto-valid demo wallets (generated via scripts/make_demo_wallets.py)
        cases = [
            ("1657TAVscUsbzmvf52x8X9APgfTPndrsNE", "BTC", "P2PKH"),
            ("3BeTSPDF6hxhmaqazmWYMrVKJPHXdmsXns", "BTC", "P2SH"),
            ("bc1qe36w2wz9828z567vlw5r4zv0f39p5wetpge6tl", "BTC", "P2WPKH"),
            ("0x7358e2aB59D4A01EDfE1CC52f410316131669e20", "ETH", None),
            ("TJLKnZKEWM2VdTqXhUK8LWG1cQ4uHBBurn", "TRON", "T256"),
        ]
        for addr, chain, atype in cases:
            v = validation.validate(addr)
            assert v.valid, f"{addr} rejected: {v.reason}"
            assert v.chain == chain
            if atype:
                assert v.addressType == atype

    def test_single_character_flip_rejected(self):
        pairs = [
            ("1657TAVscUsbzmvf52x8X9APgfTPndrsNE", "2657TAVscUsbzmvf52x8X9APgfTPndrsNE"),
            ("TJLKnZKEWM2VdTqXhUK8LWG1cQ4uHBBurn", "TJLKnZKEWM2VdTqXhUK8LWG1cQ4uHBBurp"),
        ]
        for good, bad in pairs:
            v = validation.validate(bad)
            assert not v.valid, f"typo'd {bad} accepted"
            # rejection must explain itself (checksum/typo/format) rather than silently pass
            assert v.reason, f"no reason given for {bad}"

    def test_eip55_checksum_case_enforced(self):
        good = "0x7358e2aB59D4A01EDfE1CC52f410316131669e20"
        # flip one letter's case → checksum must fail
        bad = good[:5] + ("b" if good[5].isupper() else "B") + good[6:]
        assert validation.eth_is_valid(good)
        assert not validation.eth_is_valid(bad)
        # all-lower and all-upper hex remain acceptable (no checksum encoded)
        assert validation.eth_is_valid(good.lower())

    def test_chaos_inputs_never_raise(self):
        chaos = [
            "", "   ", "x", "0" * 500, "bc1", "bc1qqqq", "0x", "0xzz",
            "T" * 34, "1" * 40, "3", "bc1q" + "l" * 60,
            "🚨🚨police🚨🚨", "address; DROP TABLE users;--",
            "0x7358e2ab59d4a01edfe1cc52f410316131669e20 extra text",
            None if False else "\x00\x01binary",
        ]
        for c in chaos:
            v = validation.validate(c)          # must not raise
            if c.strip() not in (
                "1657TAVscUsbzmvf52x8X9APgfTPndrsNE",
                "TJLKnZKEWM2VdTqXhUK8LWG1cQ4uHBBurn",
                "0x7358e2ab59d4a01edfe1cc52f410316131669e20",
            ):
                assert not v.valid, f"chaos input accepted: {c!r}"

    def test_chain_hint_forces_rejection_with_reason(self):
        v = validation.validate("not-even-close", "BTC")
        assert not v.valid and v.chain == "BTC" and v.reason


# ------------------------------------------------------------------ extraction

class TestExtraction:
    COMPLAINT = """
    FIR 2026/114 — victim statement. On 12 Jan the complainant transferred
    0.4 BTC to 1657TAVscUsbzmvf52x8X9APgfTPndrsNE after a WhatsApp investment
    pitch. Later, 12,000 USDT (TRC-20) was sent to TJLKnZKEWM2VdTqXhUK8LWG1cQ4uHBBurn
    from their exchange withdrawal to 0x7358e2ab59d4a01edfe1cc52f410316131669e20.
    The fraudster's website also displayed deposit wallet
    1657tavscusbzmvf52x8x9apgftPndrsNE (probably the same BTC wallet typed
    differently) and asked for "unlock fees" in 3BeTSPDF6hxhmaqazmWYMrVKJPHXdmsXns.
    Contact number 98xxxxxx01. Nothing here: bc1qdeadbeefinvalidchecksum0000000000.
    """

    def test_extracts_all_three_chains(self):
        found = validation.extract_addresses(self.COMPLAINT)
        chains = {f["chain"] for f in found if f["valid"]}
        assert {"BTC", "ETH", "TRON"} <= chains, f"chains found: {chains}"

    def test_valid_and_invalid_flagged(self):
        found = validation.extract_addresses(self.COMPLAINT)
        valid = {f["address"] for f in found if f["valid"]}
        invalid = {f["address"] for f in found if not f["valid"]}
        assert "1657TAVscUsbzmvf52x8X9APgfTPndrsNE" in valid
        assert any("deadbeef" in a for a in invalid), "invalid checksum wallet not flagged"

    def test_case_insensitive_dedupe_with_occurrences(self):
        found = validation.extract_addresses(self.COMPLAINT)
        btc = [f for f in found if f["address"].startswith("1")]
        assert len(btc) == 1, "mixed-case duplicate not merged"
        assert btc[0]["occurrences"] >= 2

    def test_empty_and_garbage_text(self):
        assert validation.extract_addresses("") == []
        assert validation.extract_addresses("no wallets here, just prose " * 50) == []

    def test_5000_char_bulk_text(self):
        blob = ("suspect wallet 1657TAVscUsbzmvf52x8X9APgfTPndrsNE reported repeatedly. " * 60)
        found = validation.extract_addresses(blob)
        assert len(found) == 1 and found[0]["occurrences"] == 60


# ------------------------------------------------------------------ watchlist (simulated adapter)

class FakeAdapter:
    """Serves a canned graph; mutable so tests can add 'new' activity."""

    def __init__(self):
        self.graph = TraceGraph(seed="", chain="BTC", mode="live")
        self.seed = None

    def fetch(self, address, graph):
        graph.add_address(AddressInfo(address=address, chain="BTC"))
        peer = "1BitcoinPeerXXXXXXXXXXXXXXXXXXXXXXXXX"[:34]
        graph.add_address(AddressInfo(address=peer, chain="BTC"))
        for h in getattr(self, "hashes", []):
            graph.add_edge(TxEdge(
                source=peer, target=address, chain="BTC", asset="BTC",
                value=0.1, valueUsd=8000.0, txHash=h,
                timestamp=1700000000000 + len(h),
            ))


class TestWatchlist:
    def test_add_list_remove_roundtrip(self, tmp_state):
        watchlist.add_watch("1657TAVscUsbzmvf52x8X9APgfTPndrsNE", "BTC", note="ransomware")
        assert len(watchlist.list_watches()) == 1
        # re-adding updates rather than duplicates
        watchlist.add_watch("1657TAVscUsbzmvf52x8X9APgfTPndrsNE", "BTC", note="updated")
        assert len(watchlist.list_watches()) == 1
        assert watchlist.list_watches()[0]["note"] == "updated"
        assert watchlist.remove_watch("1657TAVscUsbzmvf52x8X9APgfTPndrsNE") is True
        assert watchlist.list_watches() == []

    def test_add_watch_rejects_garbage(self, tmp_state):
        for bad in ("", "   ", "x"):
            with pytest.raises(ValueError):
                watchlist.add_watch(bad, "BTC")

    def test_check_watch_diffs_movements(self, tmp_state, monkeypatch):
        addr = "1657TAVscUsbzmvf52x8X9APgfTPndrsNE"
        watchlist.add_watch(addr, "BTC")

        fake = FakeAdapter()
        fake.hashes = ["tx-aaa", "tx-bbb"]
        monkeypatch.setattr(watchlist, "get_adapter", lambda chain: fake)

        w = watchlist.check_watch(addr)
        assert w["newMovements"] == 2
        assert len(w["movements"]) == 2
        assert w["movements"][0]["direction"] == "in"

        # same hashes again → nothing new
        w2 = watchlist.check_watch(addr)
        assert w2["newMovements"] == 0

        # one new txn lands → exactly one movement raised
        fake.hashes.append("tx-ccc")
        w3 = watchlist.check_watch(addr)
        assert w3["newMovements"] == 1
        assert w3["movementsSinceWatch"] is True
        # newest first; order of pre-existing entries is adapter-dependent
        assert w3["movements"][0]["txHash"] == "tx-ccc"
        assert set(m["txHash"] for m in w3["movements"]) == {"tx-aaa", "tx-bbb", "tx-ccc"}

    def test_check_watch_unknown_address_404s(self, tmp_state):
        with pytest.raises(KeyError):
            watchlist.check_watch("1NeverWatchedXXXXXXXXXXXXXXXXXXXXXXX")

    def test_watcher_status_counts(self, tmp_state):
        watchlist.add_watch("1657TAVscUsbzmvf52x8X9APgfTPndrsNE", "BTC")
        status = watchlist.watcher_status()
        assert status["total"] == 1 and status["watching"] == 1 and status["active"] is False


# ------------------------------------------------------------------ labels

class TestLabels:
    def test_add_lookup_remove(self, tmp_state):
        addr = "1657TAVscUsbzmvf52x8X9APgfTPndrsNE"
        labels.add_label(addr, "Ransomware consolidator", kind="mixer")
        hit = labels.lookup(addr)
        assert hit and hit["name"] == "Ransomware consolidator" and hit["source"] == "user"
        assert labels.remove_label(addr) is True
        assert labels.lookup(addr) is None

    def test_label_kind_whitelist(self, tmp_state):
        entry = labels.add_label("TJLKnZKEWM2VdTqXhUK8LWG1cQ4uHBBurn", "Weird", kind="not-a-kind")
        assert entry["kind"] == "exchange", "unknown kinds must fall back to exchange"

    def test_persistence_across_reload(self, tmp_state):
        addr = "1657TAVscUsbzmvf52x8X9APgfTPndrsNE"
        labels.add_label(addr, "Persisted entity")
        labels._labels = None  # simulate process restart
        assert labels.lookup(addr)["name"] == "Persisted entity"


# ------------------------------------------------------------------ prices

class TestPrices:
    def test_usd_values_with_mocked_fetch(self, tmp_state, monkeypatch):
        monkeypatch.setattr(prices, "_fetch_all", lambda: {"BTC": 100000.0, "ETH": 5000.0, "TRX": 0.25})
        assert prices.usd_value("BTC", 2) == 200000.0
        assert prices.usd_value("ETH", 0.5) == 2500.0
        assert prices.usd_value("TRX", 100) == 25.0
        meta = prices.price_meta()
        assert meta["source"] == "coingecko" and meta["prices"]["BTC"] == 100000.0

    def test_stablecoins_pinned_to_dollar(self, tmp_state):
        assert prices.usd_value("USDT", 12500) == 12500
        assert prices.usd_value("USDC", 0.01) == 0.01
        assert prices.price_of("USDT") == 1.0

    def test_stale_fallback_when_api_down(self, tmp_state, monkeypatch):
        monkeypatch.setattr(prices, "_fetch_all", lambda: {"BTC": 100000.0})
        prices.get_prices(force=True)
        # API dies afterwards → cached value still served
        monkeypatch.setattr(prices, "_fetch_all", lambda: None)
        assert prices.price_of("BTC") == 100000.0

    def test_unknown_asset_is_zero_not_crash(self, tmp_state, monkeypatch):
        monkeypatch.setattr(prices, "_fetch_all", lambda: {"BTC": 100000.0})
        assert prices.usd_value("DOGE", 100) == 0.0
        assert prices.usd_value("", 100) == 0.0


# ------------------------------------------------------------------ chaos tracing

@pytest.fixture()
def force_simulated(monkeypatch):
    """Neutralise live adapters so chaos traces stay hermetic."""
    import app.tracer as tracer
    monkeypatch.setattr(tracer, "get_adapter", lambda chain: None)


class TestChaosTraces:
    def test_simulated_trace_handles_garbage_seeds(self, force_simulated):
        for seed in ("", "not-a-wallet", "🚨", "0x" + "f" * 40, "x" * 300):
            g = trace_address(seed or "seed", "BTC", "UNKNOWN")
            assert g.mode == "simulated"
            assert len(g.edges) > 0, f"empty graph for seed {seed!r}"

    def test_simulated_trace_deterministic_per_seed(self, force_simulated):
        g1 = trace_address("chaos-seed-1", "ETH", "PHISHING")
        g2 = trace_address("chaos-seed-1", "ETH", "PHISHING")
        g3 = trace_address("chaos-seed-2", "ETH", "PHISHING")
        assert g1.seed == g2.seed and len(g1.edges) == len(g2.edges)
        assert len(g1.edges) != len(g3.edges) or g1.seed != g3.seed

    def test_summary_totals_consistent(self, force_simulated):
        g = trace_address("summary-consistency", "TRON", "INVESTMENT_SCAM")
        s = g.summary()
        assert s["totalAddresses"] == len(g.addresses)
        assert s["totalTransactions"] == len(g.edges)
        assert abs(s["totalValueUsd"] - sum(e.valueUsd for e in g.edges)) < 0.01
