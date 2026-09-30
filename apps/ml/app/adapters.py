"""
Live chain adapters — multi-source with automatic failover.

Every adapter normalises raw public-API responses into AddressInfo / TxEdge
objects. Sources are tried in priority order; responses are cached to disk so
traces are replayable offline and the demo never depends on venue WiFi.

  BTC : blockchain.info  ->  blockstream.info
  ETH : Etherscan v2 (key)  ->  Blockscout mainnet (keyless)
  TRON: Tronscan native TRX  +  TRC-20 token transfers (USDT etc.)

All USD valuations flow through the live price oracle (prices.py).
"""
import os
import time
from typing import List, Optional, Tuple

import requests

from . import config, prices
from .models import AddressInfo, TraceGraph, TxEdge
from .util import load_json, save_json

session = requests.Session()
session.headers.update({"User-Agent": "Trace-X/1.0 (blockchain-analytics)"})


class AdapterError(Exception):
    """Raised when every live source for a chain fails."""


# ---------------------------------------------------------------- cache

def _cache_path(key: str) -> str:
    import hashlib
    safe = hashlib.md5(key.encode()).hexdigest()
    return os.path.join(config.CACHE_DIR, safe + ".json")


def _cache_get(key: str, max_age_ms: int = 6 * 3600_000) -> Optional[dict]:
    path = _cache_path(key)
    if not os.path.exists(path):
        return None
    if (time.time() - os.path.getmtime(path)) * 1000 > max_age_ms:
        return None
    return load_json(path, None)


def _cache_set(key: str, data: dict) -> None:
    save_json(_cache_path(key), data)


def merge_into_graph(address: str, info: AddressInfo, edges: List[TxEdge],
                     graph: TraceGraph) -> None:
    """Add (or enrich) a fetched address and merge its edges (deduped)."""
    existing = graph.addresses.get(address)
    if existing is None:
        graph.add_address(info)
    else:
        # Node pre-registered (e.g. the seed): enrich with fetched metadata.
        if not existing.label and info.label:
            existing.label = info.label
        if existing.type == "wallet" and info.type != "wallet":
            existing.type = info.type
        if not existing.vaspId and info.vaspId:
            existing.vaspId = info.vaspId
        existing.txCount = max(existing.txCount, info.txCount)
        existing.totalInUsd = max(existing.totalInUsd, info.totalInUsd)
        existing.totalOutUsd = max(existing.totalOutUsd, info.totalOutUsd)
        if info.firstIn is not None and (existing.firstIn is None or info.firstIn < existing.firstIn):
            existing.firstIn = info.firstIn
        if info.lastOut is not None and (existing.lastOut is None or info.lastOut > existing.lastOut):
            existing.lastOut = info.lastOut
        for cp in info.counterparties:
            if cp not in existing.counterparties:
                existing.counterparties.append(cp)
    seen = {(e.txHash, e.source, e.target, e.asset) for e in graph.edges}
    for e in edges:
        k = (e.txHash, e.source, e.target, e.asset)
        if k in seen:
            continue
        seen.add(k)
        graph.add_edge(e)


# ---------------------------------------------------------------- BTC

class BtcAdapter:
    """blockchain.info rawaddr, failing over to blockstream.info."""
    chain = "BTC"

    def fetch(self, address: str, graph: TraceGraph) -> None:
        info, edges = self._load(address)
        merge_into_graph(address, info, edges, graph)

    def _load(self, address: str) -> Tuple[AddressInfo, List[TxEdge]]:
        key = f"btc:{address}"
        data = _cache_get(key)
        if data is None:
            data, source = self._request(address)
            data["_source"] = source
            _cache_set(key, data)
        return self._parse(address, data)

    def _request(self, address: str) -> Tuple[dict, str]:
        errors: List[str] = []
        try:
            r = session.get(
                f"https://blockchain.info/rawaddr/{address}"
                f"?limit={config.MAX_TX_PER_ADDRESS}&cors=true",
                timeout=config.HTTP_TIMEOUT)
            if r.status_code == 200:
                return r.json(), "blockchain.info"
            errors.append(f"blockchain.info HTTP {r.status_code}")
        except requests.RequestException as exc:
            errors.append(f"blockchain.info: {exc}")

        # blockstream fallback
        try:
            r = session.get(
                f"https://blockstream.info/api/address/{address}",
                timeout=config.HTTP_TIMEOUT)
            if r.status_code == 200:
                meta = r.json()
                txs_resp = session.get(
                    f"https://blockstream.info/api/address/{address}/txs",
                    timeout=config.HTTP_TIMEOUT)
                txs = txs_resp.json() if txs_resp.status_code == 200 else []
                return self._blockstream_shape(address, meta, txs), "blockstream"
            errors.append(f"blockstream HTTP {r.status_code}")
        except requests.RequestException as exc:
            errors.append(f"blockstream: {exc}")

        raise AdapterError(f"BTC sources unavailable ({'; '.join(errors)})")

    def _blockstream_shape(self, address: str, meta: dict, txs: list) -> dict:
        cs = meta.get("chain_stats", {})
        ms = meta.get("mempool_stats", {})
        received = cs.get("funded_txo_sum", 0) + ms.get("funded_txo_sum", 0)
        sent = cs.get("spent_txo_sum", 0) + ms.get("spent_txo_sum", 0)
        return {
            "addr": address,
            "n_tx": cs.get("tx_count", 0) + ms.get("tx_count", 0),
            "total_received": received,
            "total_sent": sent,
            "final_balance": received - sent,
            "txs": txs[: config.MAX_TX_PER_ADDRESS],
            "_blockstream": True,
        }

    def _parse(self, address: str, data: dict) -> Tuple[AddressInfo, List[TxEdge]]:
        info = AddressInfo(address=address, chain="BTC")
        edges: List[TxEdge] = []
        info.txCount = int(data.get("n_tx") or len(data.get("txs") or []))
        info.totalInUsd = prices.usd_value("BTC", (data.get("total_received") or 0) / 1e8)
        info.totalOutUsd = prices.usd_value("BTC", (data.get("total_sent") or 0) / 1e8)

        if data.get("_blockstream"):
            return self._parse_blockstream(address, info, data)

        for tx in data.get("txs") or []:
            ts_ms = int(tx.get("time") or 0) * 1000 or int(time.time() * 1000)
            inputs = [i.get("prev_out") or {} for i in tx.get("inputs") or []]
            outputs = tx.get("out") or []
            tx_hash = tx.get("hash") or ""
            is_outgoing = any(inp.get("addr") == address for inp in inputs)

            if is_outgoing:
                for out in outputs:
                    dst = out.get("addr")
                    if not dst or dst == address:
                        continue
                    btc = (out.get("value") or 0) / 1e8
                    edges.append(TxEdge(
                        source=address, target=dst, chain="BTC", asset="BTC",
                        value=round(btc, 8), valueUsd=prices.usd_value("BTC", btc),
                        txHash=tx_hash, timestamp=ts_ms))
                    if info.lastOut is None or ts_ms > info.lastOut:
                        info.lastOut = ts_ms
                    if dst not in info.counterparties:
                        info.counterparties.append(dst)
            else:
                src = next((inp.get("addr") for inp in inputs if inp.get("addr")), None)
                if not src:
                    continue  # coinbase / unmapped input
                for out in outputs:
                    if out.get("addr") != address:
                        continue
                    btc = (out.get("value") or 0) / 1e8
                    edges.append(TxEdge(
                        source=src, target=address, chain="BTC", asset="BTC",
                        value=round(btc, 8), valueUsd=prices.usd_value("BTC", btc),
                        txHash=tx_hash, timestamp=ts_ms))
                    if info.firstIn is None or ts_ms < info.firstIn:
                        info.firstIn = ts_ms
                    if src not in info.counterparties:
                        info.counterparties.append(src)
        return info, edges

    def _parse_blockstream(self, address: str, info: AddressInfo,
                           data: dict) -> Tuple[AddressInfo, List[TxEdge]]:
        edges: List[TxEdge] = []
        for tx in data.get("txs") or []:
            ts_ms = int(tx.get("status", {}).get("block_time") or 0) * 1000
            tx_hash = tx.get("txid") or ""
            vin_addrs: List[str] = []
            for vin in tx.get("vin") or []:
                if vin.get("is_coinbase"):
                    continue
                prev = vin.get("prevout") or {}
                a = prev.get("scriptpubkey_address")
                if a:
                    vin_addrs.append(a)
            is_outgoing = address in vin_addrs

            for vout in tx.get("vout") or []:
                dst = vout.get("scriptpubkey_address")
                if not dst:
                    continue
                val_btc = (vout.get("value") or 0) / 1e8
                if is_outgoing and dst != address:
                    edges.append(TxEdge(
                        source=address, target=dst, chain="BTC", asset="BTC",
                        value=round(val_btc, 8), valueUsd=prices.usd_value("BTC", val_btc),
                        txHash=tx_hash, timestamp=ts_ms))
                    if info.lastOut is None or ts_ms > info.lastOut:
                        info.lastOut = ts_ms
                    if dst not in info.counterparties:
                        info.counterparties.append(dst)
                elif not is_outgoing and dst == address:
                    src = next((a for a in vin_addrs if a != address), None)
                    if not src:
                        continue
                    edges.append(TxEdge(
                        source=src, target=address, chain="BTC", asset="BTC",
                        value=round(val_btc, 8), valueUsd=prices.usd_value("BTC", val_btc),
                        txHash=tx_hash, timestamp=ts_ms))
                    if info.firstIn is None or ts_ms < info.firstIn:
                        info.firstIn = ts_ms
                    if src not in info.counterparties:
                        info.counterparties.append(src)
        return info, edges


# ---------------------------------------------------------------- ETH

class EthAdapter:
    """Etherscan v2 (keyed) failing over to Blockscout mainnet (keyless)."""
    chain = "ETH"
    ETHERSCAN = "https://api.etherscan.io/v2/api"
    BLOCKSCOUT = "https://eth.blockscout.com/api"

    def fetch(self, address: str, graph: TraceGraph) -> None:
        info, edges = self._load(address)
        merge_into_graph(address, info, edges, graph)

    def _load(self, address: str) -> Tuple[AddressInfo, List[TxEdge]]:
        key = f"eth:{address.lower()}"
        data = _cache_get(key)
        if data is None:
            data, source = self._request(address)
            data["_source"] = source
            _cache_set(key, data)
        return self._parse(address, data)

    def _request(self, address: str) -> Tuple[dict, str]:
        errors: List[str] = []
        api_key = os.getenv("ETHERSCAN_API_KEY", "")
        if api_key:
            try:
                resp = session.get(self.ETHERSCAN, params={
                    "chainid": 1, "module": "account", "action": "txlist",
                    "address": address, "startblock": 0, "endblock": 99999999,
                    "page": 1, "offset": config.MAX_TX_PER_ADDRESS, "sort": "desc",
                    "apikey": api_key,
                }, timeout=config.HTTP_TIMEOUT)
                payload = resp.json() if resp.status_code == 200 else None
                if payload and str(payload.get("status")) == "1":
                    return payload, "etherscan"
                if payload and "no transactions" in str(payload.get("message", "")).lower():
                    return {"result": []}, "etherscan"
                errors.append(f"etherscan: {payload.get('message') if payload else resp.status_code}")
            except (requests.RequestException, ValueError) as exc:
                errors.append(f"etherscan: {exc}")

        # Blockscout v2 API (keyless)
        try:
            resp = session.get(f"{self.BLOCKSCOUT}/v2/addresses/{address}/transactions",
                               params={"filter": "to|from"}, timeout=config.HTTP_TIMEOUT)
            if resp.status_code == 200:
                body = resp.json()
                items = body.get("items") or []
                return {"items": items, "result": self._blockscout_rows(items)}, "blockscout"
            errors.append(f"blockscout HTTP {resp.status_code}")
        except (requests.RequestException, ValueError) as exc:
            errors.append(f"blockscout: {exc}")

        raise AdapterError(f"ETH sources unavailable ({'; '.join(errors)})")

    def _blockscout_rows(self, items: List[dict]) -> List[dict]:
        """Convert Blockscout items into etherscan-style rows."""
        rows = []
        for it in items[: config.MAX_TX_PER_ADDRESS]:
            val = it.get("value") or "0"
            rows.append({
                "from": it.get("from", {}).get("hash", ""),
                "to": it.get("to", {}).get("hash", ""),
                "value": str(int(val) if str(val).isdigit() else 0),
                "timeStamp": str(int(it.get("timestamp") or 0)),
                "hash": it.get("hash", ""),
            })
        return rows

    def _parse(self, address: str, data: dict) -> Tuple[AddressInfo, List[TxEdge]]:
        info = AddressInfo(address=address, chain="ETH")
        edges: List[TxEdge] = []
        addr = address.lower()

        for tx in data.get("result") or []:
            value_wei = int(tx.get("value") or 0)
            if value_wei <= 0:
                continue
            src = (tx.get("from") or "").lower()
            dst = (tx.get("to") or "").lower()
            eth = value_wei / 1e18
            ts_ms = int(tx.get("timeStamp") or 0) * 1000
            tx_hash = tx.get("hash") or ""

            if src == addr and dst and dst != addr:
                edges.append(TxEdge(
                    source=address, target=dst, chain="ETH", asset="ETH",
                    value=round(eth, 8), valueUsd=prices.usd_value("ETH", eth),
                    txHash=tx_hash, timestamp=ts_ms))
                if info.lastOut is None or ts_ms > info.lastOut:
                    info.lastOut = ts_ms
                if dst not in info.counterparties:
                    info.counterparties.append(dst)
            elif dst == addr and src and src != addr:
                edges.append(TxEdge(
                    source=src, target=address, chain="ETH", asset="ETH",
                    value=round(eth, 8), valueUsd=prices.usd_value("ETH", eth),
                    txHash=tx_hash, timestamp=ts_ms))
                if info.firstIn is None or ts_ms < info.firstIn:
                    info.firstIn = ts_ms
                if src not in info.counterparties:
                    info.counterparties.append(src)

        info.txCount = len(edges)
        info.totalInUsd = round(sum(e.valueUsd for e in edges if e.target == address), 2)
        info.totalOutUsd = round(sum(e.valueUsd for e in edges if e.source == address), 2)
        return info, edges


# ---------------------------------------------------------------- TRON

class TronAdapter:
    """Tronscan: native TRX transfers + TRC-20 token transfers (USDT etc.)."""
    chain = "TRON"
    NATIVE = "https://apilist.tronscanapi.com/api/transfer"
    TOKEN = "https://apilist.tronscanapi.com/api/token_trc20/transfers"

    def fetch(self, address: str, graph: TraceGraph) -> None:
        info, edges = self._load(address)
        merge_into_graph(address, info, edges, graph)

    def _load(self, address: str) -> Tuple[AddressInfo, List[TxEdge]]:
        key = f"tron:{address}"
        data = _cache_get(key)
        if data is None:
            data = self._request(address)
            _cache_set(key, data)
        return self._parse(address, data)

    def _request(self, address: str) -> dict:
        errors: List[str] = []
        native: dict = {}
        token: dict = {}

        try:
            r = session.get(self.NATIVE, params={
                "limit": config.MAX_TX_PER_ADDRESS, "start": 0,
                "sort": "-timestamp", "count": "true", "address": address,
            }, timeout=config.HTTP_TIMEOUT)
            if r.status_code == 200:
                native = r.json()
            else:
                errors.append(f"native HTTP {r.status_code}")
        except requests.RequestException as exc:
            errors.append(f"native: {exc}")

        try:
            r = session.get(self.TOKEN, params={
                "limit": config.MAX_TX_PER_ADDRESS, "start": 0,
                "sort": "-timestamp", "count": "true",
                "relatedAddress": address,
            }, timeout=config.HTTP_TIMEOUT)
            if r.status_code == 200:
                token = r.json()
            else:
                errors.append(f"trc20 HTTP {r.status_code}")
        except requests.RequestException as exc:
            errors.append(f"trc20: {exc}")

        if not native.get("data") and not token.get("token_transfers"):
            raise AdapterError(f"TRON sources unavailable ({'; '.join(errors) or 'empty'})")
        return {"native": native, "token": token}

    def _parse(self, address: str, data: dict) -> Tuple[AddressInfo, List[TxEdge]]:
        info = AddressInfo(address=address, chain="TRON")
        edges: List[TxEdge] = []

        for tx in (data.get("native", {}).get("data") or []):
            e = self._native_row(address, tx)
            if e:
                edges.append(e)

        for tx in (data.get("token", {}).get("token_transfers") or []):
            e = self._token_row(address, tx)
            if e:
                edges.append(e)

        info.txCount = len(edges)
        info.totalInUsd = round(sum(e.valueUsd for e in edges if e.target == address), 2)
        info.totalOutUsd = round(sum(e.valueUsd for e in edges if e.source == address), 2)
        return info, edges

    def _native_row(self, address: str, tx: dict) -> Optional[TxEdge]:
        src = tx.get("transferFromAddress") or ""
        dst = tx.get("transferToAddress") or ""
        token_info = tx.get("tokenInfo") or {}
        token = (token_info.get("tokenAbbr") or "TRX").upper()
        decimals = int(token_info.get("decimals") or 6)
        amount = (tx.get("amount") or 0) / (10 ** decimals)
        ts_ms = int(tx.get("block_ts") or tx.get("timestamp") or 0)
        tx_hash = tx.get("hash") or ""
        if amount <= 0:
            return None
        if src == address and dst and dst != address:
            return TxEdge(source=address, target=dst, chain="TRON", asset=token,
                          value=round(amount, 6), valueUsd=prices.usd_value(token, amount),
                          txHash=tx_hash, timestamp=ts_ms,
                          isToken=token not in ("TRX",), tokenId=token if token != "TRX" else None)
        if dst == address and src and src != address:
            return TxEdge(source=src, target=address, chain="TRON", asset=token,
                          value=round(amount, 6), valueUsd=prices.usd_value(token, amount),
                          txHash=tx_hash, timestamp=ts_ms,
                          isToken=token not in ("TRX",), tokenId=token if token != "TRX" else None)
        return None

    def _token_row(self, address: str, tx: dict) -> Optional[TxEdge]:
        src = (tx.get("from_address") or "").lower()
        dst = (tx.get("to_address") or "").lower()
        token_info = tx.get("tokenInfo") or {}
        token = (token_info.get("symbol") or tx.get("symbol") or "TRC20").upper()
        decimals = int(token_info.get("decimals") or tx.get("decimals") or 6)
        try:
            amount = int(tx.get("quant") or 0) / (10 ** decimals)
        except (TypeError, ValueError):
            amount = float(tx.get("amount") or 0)
        ts_ms = int(tx.get("block_ts") or tx.get("timestamp") or 0)
        tx_hash = tx.get("transaction_id") or tx.get("hash") or ""
        if amount <= 0:
            return None
        if src == address.lower() and dst and dst != address.lower():
            return TxEdge(source=address, target=dst, chain="TRON", asset=token,
                          value=round(amount, 6), valueUsd=prices.usd_value(token, amount),
                          txHash=tx_hash, timestamp=ts_ms, isToken=True, tokenId=token)
        if dst == address.lower() and src and src != address.lower():
            return TxEdge(source=src, target=address, chain="TRON", asset=token,
                          value=round(amount, 6), valueUsd=prices.usd_value(token, amount),
                          txHash=tx_hash, timestamp=ts_ms, isToken=True, tokenId=token)
        return None


# ---------------------------------------------------------------- registry

ADAPTERS = {"BTC": BtcAdapter(), "ETH": EthAdapter(), "TRON": TronAdapter()}


def get_adapter(chain: str):
    return ADAPTERS.get(chain)
