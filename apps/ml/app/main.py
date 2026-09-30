"""Trace-X ML service — FastAPI application (extended API surface)."""
import threading
import uuid
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import config, engine, labels, prices, registry, validation, watchlist

app = FastAPI(title="Trace-X ML Service", version="2.0.0")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)


class TraceRequest(BaseModel):
    address: str = Field(..., min_length=8, max_length=200)
    chain: Optional[str] = None
    typologyHint: Optional[str] = None


class ValidateRequest(BaseModel):
    address: str
    chainHint: Optional[str] = None


class ExtractRequest(BaseModel):
    text: str = Field(..., max_length=50000)


class WatchRequest(BaseModel):
    address: str
    chain: str
    note: str = ""
    caseId: Optional[str] = None


class LabelRequest(BaseModel):
    address: str
    name: str
    kind: str = "exchange"
    jurisdiction: Optional[str] = None
    leaContact: Optional[str] = None


JOBS: dict = {}


@app.get("/health")
def health():
    return {
        "status": "ok", "mode": config.MODE, "service": "trace-x-ml",
        "version": "2.0.0", "vaspRegistry": len(registry.all_vasps()),
        "watcher": watchlist.watcher_status(),
    }


# ---------------------------------------------------------------- samples / vasps / prices
@app.get("/api/v1/samples")
def samples():
    return {"samples": config.SAMPLE_SEEDS}


@app.get("/api/v1/vasps")
def vasps(type: Optional[str] = None):
    items = registry.all_vasps()
    if type:
        items = [v for v in items if v.get("type") == type.upper()]
    return {"count": len(items), "vasps": items}


@app.get("/api/v1/prices")
def get_price_meta():
    """Live USD prices (CoinGecko) with cache age for the UI price chip."""
    return prices.price_meta()


# ---------------------------------------------------------------- validation & extraction
@app.post("/api/v1/validate")
def validate_address(req: ValidateRequest):
    v = validation.validate(req.address, req.chainHint)
    return {
        "address": v.address, "chain": v.chain, "valid": v.valid,
        "reason": v.reason, "checksum": v.checksum,
        "addressType": v.addressType,
    }


@app.post("/api/v1/extract")
def extract_from_text(req: ExtractRequest):
    found = validation.extract_addresses(req.text)
    return {
        "count": len(found),
        "addresses": found,
        "anyValid": any(f["valid"] for f in found),
    }


# ---------------------------------------------------------------- labels
@app.get("/api/v1/labels")
def list_labels():
    return {"labels": labels.list_labels()}


@app.post("/api/v1/labels")
def add_label(req: LabelRequest):
    try:
        entry = labels.add_label(req.address, req.name, req.kind,
                                 jurisdiction=req.jurisdiction,
                                 lea_contact=req.leaContact)
        return {"label": entry}
    except ValueError as exc:
        raise HTTPException(400, detail=str(exc))


@app.delete("/api/v1/labels/{address}")
def delete_label(address: str):
    return {"removed": labels.remove_label(address)}


# ---------------------------------------------------------------- watchlist
@app.get("/api/v1/watchlist")
def list_watch():
    return {"watchlist": watchlist.list_watches(), "status": watchlist.watcher_status()}


@app.post("/api/v1/watchlist")
def add_watch(req: WatchRequest):
    try:
        w = watchlist.add_watch(req.address, req.chain, req.note, req.caseId)
        return {"watch": w}
    except ValueError as exc:
        raise HTTPException(400, detail=str(exc))


@app.delete("/api/v1/watchlist/{address}")
def remove_watch(address: str):
    return {"removed": watchlist.remove_watch(address)}


@app.post("/api/v1/watchlist/{address}/check")
def check_now(address: str):
    try:
        w = watchlist.check_watch(address)
        return {"watch": w}
    except KeyError:
        raise HTTPException(404, detail="Address not on watchlist")
    except Exception as exc:
        raise HTTPException(502, detail=f"Chain fetch failed: {exc}")


# ---------------------------------------------------------------- trace
@app.post("/api/v1/trace")
async def start_trace(req: TraceRequest):
    chain = (req.chain or validation.validate(req.address).chain or "").upper()
    if chain not in ("BTC", "ETH", "TRON"):
        raise HTTPException(400, detail=f"Unrecognised address/chain: {req.address[:12]}…")

    job_id = uuid.uuid4().hex[:12]
    JOBS[job_id] = {"status": "RUNNING", "stage": "INIT", "detail": "Queued",
                    "progress": 0, "result": None}

    def progress(stage: str, detail: str, pct: int) -> None:
        job = JOBS.get(job_id)
        if job:
            job.update({"stage": stage, "detail": detail, "progress": pct,
                        "status": "RUNNING"})

    def _run() -> None:
        try:
            result = engine.run_trace(req.address, chain, req.typologyHint, progress)
            job = JOBS.get(job_id)
            if job:
                job.update({"status": "COMPLETED", "progress": 100, "result": result})
        except Exception as exc:  # pragma: no cover
            job = JOBS.get(job_id)
            if job:
                job.update({"status": "FAILED", "detail": str(exc)})

    threading.Thread(target=_run, name=f"trace-{job_id}", daemon=True).start()
    return {"jobId": job_id, "status": "RUNNING", "chain": chain}


@app.get("/api/v1/trace/{job_id}")
async def trace_status(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(404, detail="Unknown job id")
    payload = {"jobId": job_id, "status": job["status"], "stage": job["stage"],
               "detail": job["detail"], "progress": job["progress"]}
    if job["result"]:
        payload["result"] = job["result"]
    return payload


# ---------------------------------------------------------------- background watcher
def _on_movement(w: dict) -> None:
    """Hook for the poller; the API layer registers a richer handler."""
    print(f"[watcher] {w['address'][:12]}… new movements: {w.get('newMovements')}")


@app.on_event("startup")
def _startup() -> None:
    if config.MODE != "simulated":
        watchlist.start_poller(interval_s=300, on_movement=_on_movement)
