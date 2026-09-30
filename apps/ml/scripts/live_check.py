"""
Trace-X live-check — end-to-end verification against REAL chain data.

Unlike the demo seeds (which are valid but synthetic), this script discovers
fresh addresses from the latest blocks of each chain at runtime, so every run
exercises different live data:

  1. price oracle  — real CoinGecko USD prices
  2. discovery     — pull addresses from the newest BTC block, newest ETH
                     block and newest TRON block via public APIs
  3. validation    — run the full validator over every discovered address
  4. extraction    — build a synthetic complaint from discovered addresses,
                     extract them back out
  5. trace         — trace one discovered live address through the engine
  6. watchlist     — add + check-now + remove a discovered address

Exit code 0 = all live checks passed. Run:  python scripts/live_check.py
"""
import sys
import time
import urllib.request

if hasattr(sys.stdout, "reconfigure"):  # Windows cp1252 console safety
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, ".")

from app import config, prices, validation, watchlist  # noqa: E402

PASS, FAIL = [], []
UA = {"User-Agent": "Trace-X-livecheck/2.0"}


def fetch_json(url: str, timeout: int = 15):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        import json
        return json.loads(r.read().decode("utf-8"))


def fetch_text(url: str, timeout: int = 15) -> str:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8").strip()


def check(name: str, fn):
    t0 = time.time()
    try:
        detail = fn()
        dt = time.time() - t0
        PASS.append(name)
        print(f"  ✓ {name} ({dt:.1f}s){' — ' + str(detail) if detail else ''}")
        return True
    except Exception as exc:  # noqa: BLE001
        FAIL.append(name)
        print(f"  ✗ {name} — {exc}")
        return False


# ------------------------------------------------------------------ discovery
def discover_btc_addresses(limit=6):
    """Addresses from the latest mined BTC block — mempool.space, falling
    back to blockstream.info; whichever is reachable wins."""
    errors = []
    for source in (_btc_from_mempool, _btc_from_blockstream):
        try:
            out = source(limit)
            if out:
                return out
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{source.__name__}: {exc}")
    raise RuntimeError("; ".join(errors) or "no btc discovery source succeeded")


def _btc_from_mempool(limit):
    blk = fetch_json("https://mempool.space/api/blocks/tip/height", timeout=20)
    out = []
    for delta in range(0, 4):
        try:
            block = fetch_json(f"https://mempool.space/api/block/{int(blk) - delta}", timeout=20)
            txs = fetch_json(f"https://mempool.space/api/block/{block['id']}/txids", timeout=20)
            for txid in txs[:40]:
                tx = fetch_json(f"https://mempool.space/api/tx/{txid}", timeout=20)
                for vo in tx.get("vout", []):
                    addr = (vo.get("scriptpubkey_address") or "").strip()
                    if addr:
                        out.append(addr)
                if len(out) >= limit:
                    return out
        except Exception:
            continue  # transient block errors: try the next block down
    return out


def _btc_from_blockstream(limit):
    """Latest block via blockstream.info (height → hash → txs)."""
    out = []
    for delta in range(0, 4):
        try:
            tip = int(fetch_text("https://blockstream.info/api/blocks/tip/height"))
            block_hash = fetch_text(f"https://blockstream.info/api/block-height/{tip - delta}")
            txs = fetch_json(f"https://blockstream.info/api/block/{block_hash}/txs")
            for tx in txs[:25]:
                for vo in tx.get("vout", []):
                    addr = (vo.get("scriptpubkey_address") or "").strip()
                    if addr:
                        out.append(addr)
            if len(out) >= limit:
                return out
        except Exception:
            continue  # transient 404/5xx: retry one block down
    return out


def discover_eth_addresses(limit=4):
    """Addresses transacting in the latest ETH block (Blockscout v2 REST)."""
    blocks = fetch_json("https://eth.blockscout.com/api/v2/blocks")
    items = blocks.get("items") or []
    out = []
    for b in items[:4]:
        try:
            txs = fetch_json(f"https://eth.blockscout.com/api/v2/blocks/{b['hash']}/transactions")
            for tx in (txs.get("items") or []):
                for k in ("from", "to"):
                    a = ((tx.get(k) or {}).get("hash") or "").strip()
                    if a.startswith("0x") and len(a) == 42:
                        out.append(a)
                if len(out) >= limit:
                    return out
        except Exception:
            continue
    if not out:
        raise RuntimeError("blockscout v2 discovery failed")
    return out


def discover_tron_addresses(limit=3):
    """TRON block flow addresses — Tronscan first, TronGrid fallback
    (TronGrid returns hex addresses; convert to base58check T… form)."""
    errors = []
    for source in (_tron_from_tronscan, _tron_from_trongrid):
        try:
            out = source(limit)
            if out:
                return out
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{source.__name__}: {exc}")
    raise RuntimeError("; ".join(errors) or "no tron discovery source succeeded")


def _tron_from_tronscan(limit):
    data = fetch_json("https://api.tronscan.org/api/block?sort=-number&count=true&limit=20&start=0")
    out = []
    for b in data.get("data") or []:
        for k in ("ownerAddress", "toAddress", "representativeAddress"):
            a = (b.get(k) or "").strip()
            # validate: some tronscan fields are not checksum-correct addresses
            if a.startswith("T") and validation.tron_is_valid(a):
                out.append(a)
        if len(out) >= limit:
            return out
    return out


def _hex_to_base58check(hex_addr: str) -> str:
    """TRON hex address → T… base58check. Accepts a 20-byte EVM-style body
    (0x…) or a full 21-byte TRON-style value already carrying the 0x41
    version byte — exactly one prefix is applied."""
    import hashlib
    h = hex_addr.lower().replace("0x", "")
    if len(h) == 42 and h.startswith("41"):
        h = h[2:]  # strip the existing version byte; we re-add it below
    payload = bytes([0x41]) + bytes.fromhex(h)
    checksum = hashlib.sha256(hashlib.sha256(payload).digest()).digest()[:4]
    alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
    n = int.from_bytes(payload + checksum, "big")
    out = ""
    while n:
        n, rem = divmod(n, 58)
        out = alphabet[rem] + out
    pad = 0
    for byte in payload + checksum:
        if byte == 0:
            pad += 1
        else:
            break
    return "1" * pad + out


def _tron_from_trongrid(limit):
    """Latest solidified block; collect hex flow addresses, convert."""
    blk = fetch_json("https://api.trongrid.io/walletsolidity/getnowblock", timeout=15)
    out = []

    def walk(obj):
        if isinstance(obj, dict):
            for k, v in obj.items():
                if k in ("owner_address", "to_address", "contract_address") and isinstance(v, str):
                    try:
                        raw = bytes.fromhex(v)
                        if len(raw) == 21 and raw[0] == 0x41:
                            out.append(_hex_to_base58check(v))
                    except ValueError:
                        pass
                else:
                    walk(v)
        elif isinstance(obj, list):
            for item in obj:
                walk(item)

    walk(blk)
    return list(dict.fromkeys(out))[:limit]


# ------------------------------------------------------------------ checks
def main():
    print("=" * 62)
    print("Trace-X live-check — real chain data, no hardcoded fixtures")
    print("=" * 62)

    disc: dict = {}

    def _prices():
        p = prices.get_prices(force=True)
        if "BTC" not in p:
            raise RuntimeError("no BTC price from oracle")
        return f"BTC ${p['BTC']:,.0f} · ETH ${p.get('ETH', 0):,.0f}"
    check("1. price oracle (CoinGecko live)", _prices)

    def _btc():
        disc["BTC"] = discover_btc_addresses()
        return f"{len(disc['BTC'])} addresses from latest block"
    check("2. discover fresh BTC addresses (mempool.space)", _btc)

    def _eth():
        disc["ETH"] = discover_eth_addresses()
        return f"{len(disc['ETH'])} addresses from latest block"
    check("3. discover fresh ETH addresses (Blockscout)", _eth)

    def _tron():
        disc["TRON"] = discover_tron_addresses()
        return f"{len(disc['TRON'])} block-flow addresses"
    check("4. discover fresh TRON addresses (Tronscan)", _tron)

    def _validate():
        good = bad = 0
        samples = []
        for chain, addrs in disc.items():
            for a in addrs:
                v = validation.validate(a)
                good += 1 if v.valid else 0
                bad += 0 if v.valid else 1
                if v.valid and len(samples) < 3:
                    samples.append(f"{a[:10]}…={v.chain}/{v.addressType or 'ok'}")
        if good == 0:
            raise RuntimeError("no discovered address validated")
        return f"{good} valid / {bad} rejected · {', '.join(samples)}"
    check("5. validate all discovered addresses", _validate)

    def _extract():
        # synthetic complaint text built from LIVE addresses, then round-trip
        blob = ("Complaint: hackers used these wallets " +
                " ".join(a for v in disc.values() for a in v[:4]) +
                " to launder proceeds.")
        found = validation.extract_addresses(blob)
        got = {f["address"] for f in found}
        missing = [a for v in disc.values() for a in v[:4] if a not in got]
        if missing:
            raise RuntimeError(f"extractor missed {missing[:2]}")
        return f"{len(found)} addresses extracted from synthetic complaint"
    check("6. extract round-trip on synthetic complaint", _extract)

    traced = {}

    def _trace():
        from app.tracer import trace_address
        # try candidates in reliability order until one traces LIVE;
        # block-flow addresses (some with thin activity) may simulate-fallback
        attempts, errors = 0, []
        for chain in ("BTC", "TRON", "ETH"):
            for a in disc.get(chain, []):
                if not validation.validate(a).valid:
                    continue
                attempts += 1
                if attempts > 6:
                    break
                try:
                    g = trace_address(a, chain, None)
                except Exception as exc:  # noqa: BLE001
                    errors.append(f"{a[:10]}…: {exc}")
                    continue
                if g.mode == "live":
                    traced["seed"], traced["chain"] = a, chain
                    return (f"{len(g.addresses)} nodes / {len(g.edges)} txns "
                            f"from {chain} block flow ({a[:10]}…)")
                errors.append(f"{a[:10]}…: simulated fallback")
        raise RuntimeError(f"no live trace in {attempts} attempts — " + "; ".join(errors[:3]))
    check("7. live trace of discovered address", _trace)

    def _watch():
        if "seed" not in traced:
            raise RuntimeError("no traced address to watch")
        chain = traced.get("chain", "BTC")
        watchlist.add_watch(traced["seed"], chain, note="live-check temporary")
        w = watchlist.check_watch(traced["seed"])
        n = w.get("currentTxCount", 0)
        removed = watchlist.remove_watch(traced["seed"])
        if not removed or n < 0:
            raise RuntimeError("watch add/check/remove round-trip failed")
        return f"checked {n} txns on {chain}, cleaned up"
    check("8. watchlist add/check-now/remove", _watch)

    print("-" * 62)
    print(f"RESULT: {len(PASS)} passed, {len(FAIL)} failed")
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
