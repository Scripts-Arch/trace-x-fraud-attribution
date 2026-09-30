"""Internal data models for tracing (JSON-serialisable, pydantic-free)."""
from dataclasses import dataclass, field
from typing import Dict, List, Optional


@dataclass
class TxEdge:
    source: str
    target: str
    chain: str
    asset: str
    value: float
    valueUsd: float
    txHash: str
    timestamp: int
    isCrossChain: bool = False
    bridgeId: Optional[str] = None
    isToken: bool = False
    tokenId: Optional[str] = None


@dataclass
class AddressInfo:
    address: str
    chain: str
    label: Optional[str] = None
    type: str = "wallet"          # wallet | exchange | mixer | bridge | contract
    vaspId: Optional[str] = None
    firstIn: Optional[int] = None
    lastOut: Optional[int] = None
    txCount: int = 0
    totalInUsd: float = 0.0
    totalOutUsd: float = 0.0
    counterparties: List[str] = field(default_factory=list)
    # Percentile-rank features computed during tracing (0..1).
    features: Dict[str, float] = field(default_factory=dict)


@dataclass
class TraceGraph:
    seed: str
    chain: str
    mode: str                       # live | simulated
    addresses: Dict[str, AddressInfo] = field(default_factory=dict)
    edges: List[TxEdge] = field(default_factory=list)
    frontier: List[str] = field(default_factory=list)

    def add_address(self, info: AddressInfo) -> None:
        self.addresses[info.address] = info

    def add_edge(self, edge: TxEdge) -> None:
        self.edges.append(edge)
        src = self.addresses.get(edge.source)
        dst = self.addresses.get(edge.target)
        if src is not None:
            src.totalOutUsd += edge.valueUsd
            src.txCount += 1
            if src.lastOut is None or edge.timestamp > src.lastOut:
                src.lastOut = edge.timestamp
            if dst is not None and dst.address not in src.counterparties:
                src.counterparties.append(dst.address)
        if dst is not None:
            dst.totalInUsd += edge.valueUsd
            if dst.firstIn is None or edge.timestamp < dst.firstIn:
                dst.firstIn = edge.timestamp

    def summary(self) -> Dict[str, object]:
        chains = {a.chain for a in self.addresses.values()}
        return {
            "totalAddresses": len(self.addresses),
            "totalTransactions": len(self.edges),
            "totalValueUsd": round(sum(e.valueUsd for e in self.edges), 2),
            "chains": sorted(chains),
        }
