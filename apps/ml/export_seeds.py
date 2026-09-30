"""
Exports deterministic demo traces for the Node API seed.

Runs each sample scenario through the full engine in simulated mode and saves
the TraceResults to ../api/seeds/traces.json (mode forced to simulated for
hermetic, reproducible demo data).
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import app.tracer as tracer  # noqa: E402
from app import config, engine  # noqa: E402
from app.util import now_ms  # noqa: E402


def main() -> None:
    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "..", "api", "seeds", "traces.json")

    # force simulated path so seeds are hermetic (no network calls)
    original = tracer.get_adapter
    tracer.get_adapter = lambda chain: None

    traces = {}
    try:
        for sample in config.SAMPLE_SEEDS:
            print(f"[export] tracing {sample['key']} ({sample['chain']}) …")
            result = engine.run_trace(sample["address"], sample["chain"],
                                      sample["typology"])
            traces[sample["key"]] = result
            print(f"   -> risk {result['risk']['score']} "
                  f"({result['risk']['level']}), "
                  f"{len(result['nodes'])} nodes, "
                  f"primary: {result.get('primaryAttribution', {}).get('name', 'n/a')}")
    finally:
        tracer.get_adapter = original

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump({"exportedAt": now_ms(), "traces": traces}, fh)
    print(f"[export] wrote {out_path}")


if __name__ == "__main__":
    main()
