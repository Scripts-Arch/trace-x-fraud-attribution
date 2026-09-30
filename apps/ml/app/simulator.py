"""
Deterministic simulation engine.

Generates realistic fraud graphs (peel chains, mixer passes, bridge hops,
exchange cash-outs) seeded from the suspect address, so demos are fully
reproducible regardless of network availability.
"""
import random
from typing import Dict, List, Optional, Tuple

from . import config, registry
from .models import AddressInfo, TraceGraph, TxEdge
from .util import now_ms, seed_from, stable_hash, usd


def _price(chain: str) -> Tuple[str, float]:
    if chain == "BTC":
        return "BTC", config.USD_PRICES["BTC"]
    if chain == "ETH":
        return "ETH", config.USD_PRICES["ETH"]
    return "USDT", 1.0


def _addr_for_vasp(vasp_id: str, chain: str) -> Optional[str]:
    clusters = registry.label_clusters().get("exchanges", {}).get(chain, [])
    if not clusters:
        return None
    idx = stable_hash(vasp_id + chain) % len(clusters)
    return clusters[idx]


def simulate(seed: str, chain: str, typology_hint: Optional[str] = None,
             max_hops: int = None) -> TraceGraph:
    """Build a deterministic fraud graph for the given seed address."""
    rng = random.Random(seed_from(seed))
    hops = max_hops if max_hops is not None else min(config.MAX_HOPS, 5)
    graph = TraceGraph(seed=seed, chain=chain, mode="simulated")

    asset, price = _price(chain)
    t0 = now_ms() - rng.randint(2, 9) * 86_400_000  # reported activity 2–9 days ago

    def add(addr: str, chain_: str, type_: str = "wallet", label: Optional[str] = None,
            vasp_id: Optional[str] = None) -> AddressInfo:
        info = graph.addresses.get(addr)
        if info is None:
            info = AddressInfo(address=addr, chain=chain_, type=type_, label=label, vaspId=vasp_id)
            graph.add_address(info)
        return info

    seed_info = add(seed, chain, type_="wallet", label="Victim-reported suspect")

    # ---------------- victims fan-in (inbound leg) ----------------
    victim_count = rng.randint(3, 6)
    victim_total = 0.0
    for i in range(victim_count):
        vaddr = _sim_address(rng, chain, "victim")
        add(vaddr, chain, type_="wallet")
        amount = round(rng.uniform(400, 5200), 2)
        victim_total += amount
        graph.add_edge(TxEdge(
            source=vaddr, target=seed, chain=chain, asset=asset,
            value=round(amount / price, 8) if price > 1 else amount,
            valueUsd=amount, txHash=_sim_txhash(rng), timestamp=t0 - rng.randint(3, 72) * 3_600_000,
        ))
    seed_info.totalInUsd = victim_total

    # ---------------- outbound laundering leg ----------------
    current = [seed]
    current_usd = victim_total
    used_vasps: List[str] = []
    bridge_used = None
    mixer_used = None

    # Typology shaping: sextortion/ransomware use mixers, investment scams bridge.
    wants_mixer = typology_hint in ("SEXTORTION", "RANSOMWARE", "DARKNET")
    wants_bridge = chain != "BTC" and typology_hint in ("INVESTMENT_SCAM", "TASK_FRAUD", "PHISHING")

    for hop in range(hops):
        nxt: List[Tuple[str, float]] = []
        if hop == 0 and wants_mixer and current_usd > 900:
            mixers = registry.label_clusters().get("mixers", {}).get(chain, [])
            if mixers:
                mixer_used = mixers[0]
                add(mixer_used, chain, type_="mixer",
                    label=registry.vasp_by_id(registry.lookup(mixer_used)["vaspId"])["name"],
                    vasp_id=registry.lookup(mixer_used)["vaspId"])
                fee = current_usd * rng.uniform(0.04, 0.08)
                graph.add_edge(TxEdge(source=current[0], target=mixer_used, chain=chain,
                                      asset=asset, value=round((current_usd - fee) / price, 8) if price > 1 else current_usd - fee,
                                      valueUsd=round(current_usd - fee, 2), txHash=_sim_txhash(rng),
                                      timestamp=t0 + rng.randint(1, 4) * 3_600_000))
                current = [mixer_used]
                current_usd -= fee
                continue
        if hop == 1 and wants_bridge and bridge_used is None:
            bridges = registry.label_clusters().get("bridges", {}).get(chain, [])
            if bridges:
                bridge_used = bridges[0]
                br_info = registry.lookup(bridge_used)
                br_vasp = registry.vasp_by_id(br_info["vaspId"])
                add(bridge_used, chain, type_="bridge", label=br_vasp["name"], vasp_id=br_info["vaspId"])
                # outbound to bridge
                graph.add_edge(TxEdge(source=current[0], target=bridge_used, chain=chain,
                                      asset=asset, value=round(current_usd / price, 8) if price > 1 else current_usd,
                                      valueUsd=round(current_usd, 2), txHash=_sim_txhash(rng),
                                      timestamp=t0 + rng.randint(2, 9) * 3_600_000))
                # inbound on the other chain (synthetic hop-2 address)
                dst_chain = "ETH" if chain == "TRON" else "TRON"
                dst_asset, dst_price = _price(dst_chain)
                hop2 = _sim_address(rng, dst_chain, "postbridge")
                add(hop2, dst_chain, type_="wallet")
                graph.add_edge(TxEdge(source=bridge_used, target=hop2, chain=dst_chain,
                                      asset=dst_asset,
                                      value=round(current_usd / dst_price, 8) if dst_price > 1 else current_usd,
                                      valueUsd=round(current_usd * 0.995, 2), txHash=_sim_txhash(rng),
                                      timestamp=t0 + rng.randint(2, 10) * 3_600_000,
                                      isCrossChain=True, bridgeId=br_info["vaspId"]))
                current = [hop2]
                current_usd *= 0.995
                chain = dst_chain
                asset, price = dst_asset, dst_price
                continue
        # peel chain: 2-4 splits, largest continues
        splits = rng.randint(2, 4)
        for s in range(splits):
            share = current_usd * rng.uniform(0.08, 0.35) if s < splits - 1 else current_usd * 0.45
            share = min(share, current_usd * 0.6)
            if share < 40:
                continue
            nxt_addr = _sim_address(rng, chain, "peel")
            add(nxt_addr, chain, type_="wallet")
            graph.add_edge(TxEdge(source=current[0], target=nxt_addr, chain=chain, asset=asset,
                                  value=round(share / price, 8) if price > 1 else share,
                                  valueUsd=round(share, 2), txHash=_sim_txhash(rng),
                                  timestamp=t0 + (hop + 1) * rng.randint(2, 20) * 1_800_000))
            nxt.append((nxt_addr, share))
        if not nxt:
            break
        # final hop: exchange cash-out from the largest branch
        if hop == hops - 1 or (hop >= 2 and rng.random() < 0.75):
            main_addr, main_usd = max(nxt, key=lambda x: x[1])
            clusters = registry.label_clusters().get("exchanges", {}).get(chain, [])
            if clusters:
                ex_addr = clusters[stable_hash(seed + str(hop)) % len(clusters)]
                lbl = registry.lookup(ex_addr)
                vasp = registry.vasp_by_id(lbl["vaspId"])
                add(ex_addr, chain, type_="exchange", label=vasp["name"], vasp_id=lbl["vaspId"])
                fee = main_usd * rng.uniform(0.005, 0.02)
                graph.add_edge(TxEdge(source=main_addr, target=ex_addr, chain=chain, asset=asset,
                                      value=round((main_usd - fee) / price, 8) if price > 1 else main_usd - fee,
                                      valueUsd=round(main_usd - fee, 2), txHash=_sim_txhash(rng),
                                      timestamp=t0 + (hop + 2) * rng.randint(3, 24) * 1_800_000))
                used_vasps.append(lbl["vaspId"])
                break
        current = [nxt[0][0]]
        current_usd = nxt[0][1]

    return graph


def _sim_address(rng: random.Random, chain: str, kind: str) -> str:
    if chain == "BTC":
        version = rng.choice(["bc1q", "bc1q", "3"])
        body = "".join(rng.choice("023456789acdefghjklmnpqrstuvwxyz") for _ in range(34 if version == "3" else 38))
        return f"{version}{body}"[:42]
    if chain == "ETH":
        return "0x" + "".join(rng.choice("0123456789abcdef") for _ in range(40))
    body = "".join(rng.choice("ABCDEFGHJKLMNPQRSTUVWXYZ123456789") for _ in range(34))
    return "T" + body[:33]


def _sim_txhash(rng: random.Random) -> str:
    return "0x" + "".join(rng.choice("0123456789abcdef") for _ in range(64))
