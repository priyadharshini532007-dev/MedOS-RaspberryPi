"""Machine-learning triage: priority and condition from what the patient said, in English, Tamil or Tanglish.

Trained by ml/train.py on the synthetic dataset in ml/data/ (see ml/README.md). Two heads share one text
representation:

  priority   Critical / High / Medium / Low — from the words and the vital signs. Used by the scheduler as an
             upgrade-only second opinion to the rules: it can raise a priority when it is confident, never lower one.
  condition  which protocol condition the complaint describes (e.g. "Severe abdominal pain"), and so its department
             (e.g. General Surgery). Booking uses it to pick a hospital with the right specialist, and it is how a
             Tamil complaint is explained in English when there is no internet translation.

Text features (tokens() below, mirrored exactly by website/js/ml.js):
  w:  whole words                     "வலிக்குது", "pain"
  b:  word pairs                      "வலி இல்லை" — so negation and order count
  c:  3–5 character pieces of words   " வலி", "லிக்கு" — matches Tamil endings (வலி / வலிக்குது / வலியா) and misspellings
weighted by TF-IDF. Vital signs are standardised numbers. Each head is a multinomial logistic regression whose
weights are stored as 8-bit integers with one scale per class (base64), which keeps the website download small.
This module recomputes the predictions in plain Python, so the Raspberry Pi needs neither scikit-learn nor numpy.
"""
from __future__ import annotations

import base64
import json
import math
import re
import unicodedata
from array import array
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List, Optional

MODEL_PATH = Path(__file__).resolve().parent / "models" / "triage_model.json"
NUMERIC = ("age", "temp", "pulse", "spo2", "bp_sys", "pain")
LEVEL_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}
_KEEP = re.compile(r"[^0-9a-z஀-௿]+")
CHAR_N = (3, 4, 5)

_model: Optional[Dict[str, Any]] = None


# ---------------------------------------------------------------- features (shared with training)
def tokens(text: str) -> List[str]:
    """The text features of one complaint. Training (ml/train.py) and prediction both use this function."""
    t = unicodedata.normalize("NFC", text or "").lower()
    words = _KEEP.sub(" ", t).split()
    out = ["w:" + w for w in words if len(w) >= 2]
    out += ["b:" + a + " " + b for a, b in zip(words, words[1:])]
    for w in words:
        p = " " + w + " "
        for n in CHAR_N:
            out += ["c:" + p[i:i + n] for i in range(len(p) - n + 1)]
    return out


def _num(v: Any) -> Optional[float]:
    try:
        return None if v in (None, "") else float(v)
    except (TypeError, ValueError):
        return None


def numeric_raw(age: Any, vitals: Optional[Dict[str, Any]], pregnant: bool) -> List[float]:
    """Each vital (missing → 0) with a "was it measured" flag, then pregnancy and an age-extreme flag."""
    values = {"age": _num(age), **{k: _num((vitals or {}).get(k)) for k in NUMERIC if k != "age"}}
    raw: List[float] = []
    for k in NUMERIC:
        v = values[k]
        raw += [0.0 if v is None else v, 0.0 if v is None else 1.0]
    a = values["age"]
    raw += [1.0 if pregnant else 0.0, 1.0 if a is not None and (a >= 65 or a <= 5) else 0.0]
    return raw


# ---------------------------------------------------------------- model
def load() -> Optional[Dict[str, Any]]:
    """The exported model, loaded once (None if it hasn't been trained yet)."""
    global _model
    if _model is None and MODEL_PATH.exists():
        m = json.loads(MODEL_PATH.read_text(encoding="utf-8"))
        for head in ("priority", "condition"):
            m[head]["q"] = array("b", base64.b64decode(m[head]["w"]))     # signed 8-bit weights
        m["n_text"] = len(m["idf"])
        _model = m
    return _model


def available() -> bool:
    return load() is not None


def _text_vector(m: Dict[str, Any], text: str) -> Dict[int, float]:
    vocab, idf = m["vocab"], m["idf"]
    counts = Counter(t for t in tokens(text) if t in vocab)
    x = {vocab[t]: (1.0 + math.log(c)) * idf[vocab[t]] for t, c in counts.items()}   # sublinear tf × idf
    norm = math.sqrt(sum(v * v for v in x.values()))
    return {i: v / norm for i, v in x.items()} if norm else {}


def _softmax(head: Dict[str, Any], x: Dict[int, float], width: int) -> Dict[str, float]:
    q, scale = head["q"], head["scale"]
    logits = []
    for k, b in enumerate(head["intercept"]):
        row = k * width
        logits.append(b + scale[k] * sum(q[row + i] * v for i, v in x.items()))
    top = max(logits)
    exps = [math.exp(z - top) for z in logits]
    total = sum(exps)
    return {c: e / total for c, e in zip(head["classes"], exps)}


def predict(symptoms: str, age: Any = None, vitals: Optional[Dict[str, Any]] = None,
            pregnant: bool = False) -> Optional[Dict[str, Any]]:
    """Priority and condition for one complaint, or None when there's no model or no word it knows."""
    m = load()
    if m is None or not (symptoms or "").strip():
        return None
    x_text = _text_vector(m, symptoms)
    if not x_text:
        return None          # nothing it recognises: it gives no opinion rather than guessing
    n = m["n_text"]
    x = dict(x_text)
    num = m["numeric"]
    for j, (v, mu, sd) in enumerate(zip(numeric_raw(age, vitals, pregnant), num["mean"], num["scale"])):
        z = (v - mu) / sd
        if z:
            x[n + j] = z
    pr = _softmax(m["priority"], x, n + len(num["mean"]))
    level = max(pr, key=pr.get)
    cd = _softmax(m["condition"], x_text, n)
    condition = max(cd, key=cd.get)
    # The words that pushed the priority model towards its answer (explainability).
    k = m["priority"]["classes"].index(level)
    inv = m.get("_inv") or {i: t for t, i in m["vocab"].items()}
    m["_inv"] = inv
    width = n + len(num["mean"])
    contrib = sorted(((m["priority"]["q"][k * width + i] * v, inv[i][2:]) for i, v in x_text.items() if inv[i].startswith("w:")),
                     reverse=True)
    return {"level": level, "confidence": round(pr[level], 4),
            "probabilities": {c: round(p, 4) for c, p in pr.items()},
            "top_terms": [t for s, t in contrib[:4] if s > 0],
            "condition": condition, "condition_confidence": round(cd[condition], 4),
            "department": m["condition"]["department"][condition],
            "condition_level": m["condition"]["level"][condition]}


def target_level(prediction: Optional[Dict[str, Any]]) -> Optional[str]:
    """The level the model argues for. When it is confident which condition this is, that condition's protocol
    level (Stroke signs → critical, Routine check-up → low); otherwise the priority head's answer, if it is
    confident and the condition head agrees."""
    m = load()
    if not prediction or m is None:
        return None
    cc = prediction.get("condition_confidence", 0)
    # Safety first: the more serious the condition, the less sure the model needs to be before it raises a priority.
    need = m.get("condition_threshold_by_level", {}).get(prediction["condition_level"], m.get("condition_threshold", 0.55))
    if cc >= need:
        return prediction["condition_level"]
    # The priority head may act alone only if it is confident AND the condition head leans the same way: on
    # wording it has never seen, the priority head can be confidently wrong.
    if (cc >= m.get("condition_support", 0.25) and prediction["confidence"] >= m.get("upgrade_threshold", 0.75)
            and prediction["level"] == prediction["condition_level"]):
        return prediction["level"]
    return None


def _denied(prediction: Dict[str, Any], text: Optional[str], conditions=None) -> bool:
    """The text only mentions the predicted condition to deny it ("no chest pain", "நெஞ்சு வலி இல்லை")."""
    if not text:
        return False
    from . import triage
    return triage.condition_denied(text, prediction["condition"], conditions)


def upgrade(rules_level: str, prediction: Optional[Dict[str, Any]], text: Optional[str] = None, conditions=None) -> Optional[str]:
    """The level to raise to, or None. Upgrade-only: the model can raise a priority, never lower it. With the
    text, a symptom the patient denies never raises anything."""
    t = target_level(prediction)
    if not t or LEVEL_ORDER[t] >= LEVEL_ORDER[rules_level]:
        return None
    return None if _denied(prediction, text, conditions) else t


def confident_condition(prediction: Optional[Dict[str, Any]], text: Optional[str] = None, conditions=None) -> Optional[str]:
    """The predicted condition when the model is sure enough to act on it (booking, offline explanation)."""
    m = load()
    if not prediction or m is None:
        return None
    if prediction["condition_confidence"] >= m.get("condition_threshold", 0.55) and prediction["condition"] != "Unclassified complaint":
        return None if _denied(prediction, text, conditions) else prediction["condition"]
    return None


def understood_as(symptoms: str) -> Optional[Dict[str, Any]]:
    """What a complaint means, in English: the condition and department the model is confident about.
    Works offline, for Tamil and Tanglish too — it is how a Tamil complaint is explained when there is no
    internet translation."""
    p = predict(symptoms)
    c = confident_condition(p, symptoms)
    return {"condition": c, "department": p["department"], "confidence": p["condition_confidence"]} if c else None


def info() -> Dict[str, Any]:
    m = load()
    if m is None:
        return {"available": False}
    return {"available": True, "name": m["name"], "version": m["version"], "classes": m["priority"]["classes"],
            "conditions": m["condition"]["classes"], "features": m["n_text"] + len(m["numeric"]["mean"]),
            "upgrade_threshold": m.get("upgrade_threshold", 0.75), "condition_threshold": m.get("condition_threshold", 0.55),
            "metrics": m.get("metrics", {})}
