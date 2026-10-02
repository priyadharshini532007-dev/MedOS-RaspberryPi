"""Machine-learning priority prediction (second opinion to the rules engine).

The model is trained by ml/train.py (TF-IDF of the symptoms + standardised vital signs → multinomial
logistic regression) on the synthetic dataset in ml/data/. It is exported as plain numbers in
medos/models/triage_model.json, and this module reproduces scikit-learn's prediction exactly in pure
Python, so the Raspberry Pi doesn't need scikit-learn or numpy.

How the scheduler uses it: the rules engine decides first; the model may only RAISE the level, and only
when it is at least `upgrade_threshold` (75%) confident. It never lowers a priority.
"""
from __future__ import annotations

import json
import math
import re
from collections import Counter
from pathlib import Path
from typing import Any, Dict, Optional

MODEL_PATH = Path(__file__).resolve().parent / "models" / "triage_model.json"
NUMERIC = ("age", "temp", "pulse", "spo2", "bp_sys", "pain")
LEVEL_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}

_model: Optional[Dict[str, Any]] = None
_token_re: Optional[re.Pattern] = None


def load() -> Optional[Dict[str, Any]]:
    """The exported model, loaded once (None if it hasn't been trained yet)."""
    global _model, _token_re
    if _model is None and MODEL_PATH.exists():
        _model = json.loads(MODEL_PATH.read_text(encoding="utf-8"))
        _token_re = re.compile(_model["tfidf"]["token_pattern"])
    return _model


def available() -> bool:
    return load() is not None


def _num(v: Any) -> Optional[float]:
    try:
        return None if v in (None, "") else float(v)
    except (TypeError, ValueError):
        return None


def _features(m: Dict[str, Any], symptoms: str, age: Any, vitals: Dict[str, Any], pregnant: bool) -> Dict[int, float]:
    """Sparse feature vector {index: value}, identical to the training pipeline."""
    tf = m["tfidf"]
    vocab, idf = tf["vocabulary"], tf["idf"]
    tokens = _token_re.findall((symptoms or "").lower())
    grams = tokens + [tokens[i] + " " + tokens[i + 1] for i in range(len(tokens) - 1)]
    counts = Counter(g for g in grams if g in vocab)
    x: Dict[int, float] = {}
    for g, c in counts.items():
        i = vocab[g]
        x[i] = (1.0 + math.log(c) if tf["sublinear_tf"] else float(c)) * idf[i]
    norm = math.sqrt(sum(v * v for v in x.values()))
    if norm:
        x = {i: v / norm for i, v in x.items()}

    raw = []
    values = {"age": _num(age), **{k: _num((vitals or {}).get(k)) for k in NUMERIC if k != "age"}}
    for k in NUMERIC:
        v = values[k]
        raw += [0.0 if v is None else v, 0.0 if v is None else 1.0]
    a = values["age"]
    raw += [1.0 if pregnant else 0.0, 1.0 if a is not None and (a >= 65 or a <= 5) else 0.0]
    base = len(idf)
    for j, (v, mu, sd) in enumerate(zip(raw, m["numeric"]["mean"], m["numeric"]["scale"])):
        z = (v - mu) / sd
        if z:
            x[base + j] = z
    return x


def predict(symptoms: str, age: Any = None, vitals: Optional[Dict[str, Any]] = None,
            pregnant: bool = False) -> Optional[Dict[str, Any]]:
    """{level, confidence, probabilities, top_terms} or None if no model is installed."""
    m = load()
    if m is None or not (symptoms or "").strip():
        return None
    x = _features(m, symptoms, age, vitals or {}, pregnant)
    logits = [b + sum(w[i] * v for i, v in x.items()) for w, b in zip(m["coef"], m["intercept"])]
    top = max(logits)
    exps = [math.exp(z - top) for z in logits]
    total = sum(exps)
    probs = {c: e / total for c, e in zip(m["classes"], exps)}
    level = max(probs, key=probs.get)
    # The words that pushed the model towards its answer (explainability).
    k = m["classes"].index(level)
    inv = {i: t for t, i in m["tfidf"]["vocabulary"].items()}
    contrib = sorted(((m["coef"][k][i] * v, inv[i]) for i, v in x.items() if i in inv), reverse=True)
    return {"level": level, "confidence": round(probs[level], 4),
            "probabilities": {c: round(p, 4) for c, p in probs.items()},
            "top_terms": [t for s, t in contrib[:4] if s > 0]}


def upgrade(rules_level: str, prediction: Optional[Dict[str, Any]]) -> Optional[str]:
    """The level to raise to, or None. Upgrade-only, and only when the model is confident."""
    m = load()
    if not prediction or m is None:
        return None
    if LEVEL_ORDER[prediction["level"]] < LEVEL_ORDER[rules_level] and prediction["confidence"] >= m.get("upgrade_threshold", 0.75):
        return prediction["level"]
    return None


def info() -> Dict[str, Any]:
    m = load()
    if m is None:
        return {"available": False}
    return {"available": True, "name": m["name"], "version": m["version"], "classes": m["classes"],
            "features": len(m["tfidf"]["idf"]) + len(m["numeric"]["names"]),
            "upgrade_threshold": m.get("upgrade_threshold", 0.75), "metrics": m.get("metrics", {})}
