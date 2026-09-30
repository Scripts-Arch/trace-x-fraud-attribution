"""
Offline training for the Trace-X risk model.

Generates labelled synthetic traces with the simulation engine, computes graph
features, and fits a GradientBoostingRegressor mapping features -> risk score
(teacher signal: the transparent heuristic, plus controlled noise so the model
generalises rather than memorises). Artifact: models/risk_model.pkl
"""
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app import config, risk, simulator  # noqa: E402
from app.util import save_json  # noqa: E402

TYPOLOGIES = ["INVESTMENT_SCAM", "TASK_FRAUD", "SEXTORTION", "RANSOMWARE",
              "PHISHING", "DARKNET"]
CHAINS = ["BTC", "ETH", "TRON"]


def synth_dataset(n: int = 600, seed: int = 42):
    rng = random.Random(seed)
    X, y = [], []
    for i in range(n):
        chain = CHAINS[i % 3]
        addr = f"synth{i:05d}-{chain}"
        typo = TYPOLOGIES[rng.randrange(len(TYPOLOGIES))]
        graph = simulator.simulate(addr, chain, typo, max_hops=rng.randint(2, 5))
        feats = risk.graph_features(graph)
        teacher = risk.heuristic_score(graph, feats)
        label = float(teacher["score"]) + rng.gauss(0, 3.5)
        X.append([feats[f] for f in risk.FEATURES])
        y.append(min(100.0, max(0.0, label)))
    return X, y


def main() -> None:
    from sklearn.ensemble import GradientBoostingRegressor
    import joblib
    import numpy as np

    print("[train] generating synthetic traces …")
    X, y = synth_dataset()
    X, y = np.array(X), np.array(y)
    print(f"[train] dataset: {X.shape[0]} traces, {X.shape[1]} features")

    model = GradientBoostingRegressor(
        n_estimators=240, learning_rate=0.07, max_depth=3,
        subsample=0.9, random_state=7)
    model.fit(X, y)

    preds = model.predict(X)
    mae = float(np.mean(np.abs(preds - y)))
    print(f"[train] in-sample MAE: {mae:.2f}")

    os.makedirs(config.MODELS_DIR, exist_ok=True)
    path = os.path.join(config.MODELS_DIR, "risk_model.pkl")
    joblib.dump({"regressor": model, "features": risk.FEATURES,
                 "version": config.MODEL_VERSION}, path)
    save_json(path + ".meta.json", {
        "version": config.MODEL_VERSION, "features": risk.FEATURES,
        "trainedOn": "trace-x-synthetic-fraud-corpus-600", "mae": round(mae, 2),
    })
    print(f"[train] saved {path}")


if __name__ == "__main__":
    main()
