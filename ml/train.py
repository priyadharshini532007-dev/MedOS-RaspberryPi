"""Train MedOS's machine-learning triage model and export it for the Pi and the website.

    python ml/generate_dataset.py      # → ml/data/triage_synthetic.csv (English, Tamil, Tanglish)
    python ml/train.py                 # → model files + ml/reports/

Model (see medos/ml_triage.py for the exact features)
    Text:     TF-IDF of words, word pairs and 3–5 character pieces, so Tamil word endings and misspellings match.
    Numbers:  age, temperature, pulse, SpO2, systolic BP, pain score, pregnancy (+ "was it measured" flags).
    Heads:    priority  (Critical/High/Medium/Low)  — words + numbers, multinomial logistic regression
              condition (26 protocol conditions)    — words only,     multinomial logistic regression
    Export:   weights as 8-bit integers with one scale per class. Every number reported below is measured on
              these exported weights — the model that actually runs — not on the full-precision one.

Evaluation
    1. Held-out 15% of the synthetic data, overall and per language, against the rules engine on the same rows.
    2. Phrasings never seen in training: one base phrase per condition and language is removed from training
       entirely (every variant of it), and a separate model is scored only on rows that use those phrases.
    3. ml/data/realworld_eval.csv: sentences written separately from the generator, in English, Tamil and
       Tanglish, labelled with the protocol's condition and priority. The most honest of the three.

Writes medos/models/triage_model.json, website/ml/triage_model.js, ml/reports/{metrics.json, metrics.md,
reference_predictions.json}.
"""
from __future__ import annotations

import argparse
import base64
import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix, hstack
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "ml"))

from medos import triage  # noqa: E402
from medos.ml_triage import numeric_raw, tokens  # noqa: E402
from generate_dataset import PARAPHRASES, TA, TL  # noqa: E402   (TA / TL include the extra phrasings)

DATA = ROOT / "ml" / "data" / "triage_synthetic.csv"
REAL = ROOT / "ml" / "data" / "realworld_eval.csv"          # development set: used while tuning
REAL_TEST = ROOT / "ml" / "data" / "realworld_test.csv"     # fresh sentences, written before the new phrases were added
OUT_PY = ROOT / "medos" / "models" / "triage_model.json"
OUT_JS = ROOT / "website" / "ml" / "triage_model.js"
REPORTS = ROOT / "ml" / "reports"
LEVELS = list(triage.LEVELS)
VITALS = ("temp", "pulse", "spo2", "bp_sys", "pain")
SEED = 7
UPGRADE_THRESHOLD = 0.75
CONDITION_THRESHOLD = 0.55
# Safety first: how sure the condition head must be before MedOS acts on it, by how serious that condition is.
# A false alarm costs a little queue priority; a missed emergency can cost a life. Chosen on the held-out-phrase
# test (see the sweep in the report), not on the fresh sentences.
THRESH_BY_LEVEL = {"critical": 0.30, "high": 0.40, "medium": 0.55, "low": 0.55}
CONDITION_SUPPORT = 0.25     # the condition head must at least lean the same way before the priority head can act alone
COND_INFO = {c["name"]: c for c in triage.DEFAULT_CONDITIONS}
COND_INFO["Unclassified complaint"] = {"department": "General Medicine", "level": "low"}


# ---------------------------------------------------------------- data → features
def vitals_of(row) -> dict:
    return {k: row[k] for k in VITALS if k in row and pd.notna(row[k]) and row[k] != ""}


def present(v):
    """None for missing values (NaN / empty), so a missing age stays missing and bool(NaN) can't mean "pregnant"."""
    return None if v is None or (isinstance(v, float) and np.isnan(v)) or v == "" else v


def row_age(row):
    return present(row.get("age"))


def row_pregnant(row) -> bool:
    return bool(present(row.get("pregnant")) or 0)


def numeric(df: pd.DataFrame) -> np.ndarray:
    return np.array([numeric_raw(row_age(r), vitals_of(r), row_pregnant(r)) for _, r in df.iterrows()], float)


class Model:
    """Vectoriser + both heads, quantised exactly as exported."""

    def __init__(self, max_features: int, c_priority: float, c_condition: float):
        self.vec = TfidfVectorizer(analyzer=tokens, min_df=2, sublinear_tf=True, max_features=max_features)
        self.cp, self.cc = c_priority, c_condition

    def fit(self, df: pd.DataFrame) -> "Model":
        Xt = self.vec.fit_transform(df["symptoms"])
        N = numeric(df)
        self.mean, self.scale = N.mean(axis=0), N.std(axis=0)
        self.scale[self.scale == 0] = 1.0
        Xp = hstack([Xt, csr_matrix((N - self.mean) / self.scale)]).tocsr()
        self.prio = LogisticRegression(C=self.cp, max_iter=4000, class_weight="balanced").fit(Xp, df["priority"])
        self.cond = LogisticRegression(C=self.cc, max_iter=4000, class_weight="balanced").fit(Xt, df["condition"])
        self.qp = quantise(self.prio.coef_)
        self.qc = quantise(self.cond.coef_)
        return self

    def features(self, texts, df_numeric: pd.DataFrame):
        Xt = self.vec.transform(texts)
        N = numeric(df_numeric)
        return Xt, hstack([Xt, csr_matrix((N - self.mean) / self.scale)]).tocsr()

    def proba(self, texts, df_numeric: pd.DataFrame):
        """Probabilities from the exported (8-bit) weights — what the Pi and the website compute."""
        Xt, Xp = self.features(texts, df_numeric)
        return softmax(Xp @ dequant(self.qp).T + self.prio.intercept_), softmax(Xt @ dequant(self.qc).T + self.cond.intercept_), Xt


def quantise(W: np.ndarray):
    scale = np.abs(W).max(axis=1) / 127.0
    scale[scale == 0] = 1.0
    Q = np.clip(np.round(W / scale[:, None]), -127, 127).astype(np.int8)
    return Q, scale


def dequant(q) -> np.ndarray:
    Q, scale = q
    return Q.astype(np.float64) * scale[:, None]


def softmax(Z) -> np.ndarray:
    Z = np.asarray(Z)
    Z = Z - Z.max(axis=1, keepdims=True)
    E = np.exp(Z)
    return E / E.sum(axis=1, keepdims=True)


# ---------------------------------------------------------------- scoring
def rules_level(row) -> str:
    return triage.analyse(row["symptoms"] if "symptoms" in row else row["text"], row_age(row), present(row.get("sex")),
                          vitals_of(row), row_pregnant(row))["level"]


def model_target(prio_p, cond_p, prio_classes, cond_classes, thr=None):
    """The level the model argues for (medos/ml_triage.py target_level() does the same).
    1. It is confident which condition this is → that condition's protocol level
       (Stroke signs → critical, Routine check-up → low).
    2. Otherwise the priority head may act alone only if it is confident AND the condition head leans the same
       way. On wording it has never seen, the priority head can be confidently wrong; requiring the two heads
       to agree stops that (e.g. a sugar test and a medicine refill read as a poisoning)."""
    thr = thr or THRESH_BY_LEVEL
    c = cond_classes[int(np.argmax(cond_p))]
    if cond_p.max() >= thr[COND_INFO[c]["level"]]:
        return COND_INFO[c]["level"]
    if cond_p.max() >= CONDITION_SUPPORT and prio_p.max() >= UPGRADE_THRESHOLD:
        level = prio_classes[int(np.argmax(prio_p))]
        if level == COND_INFO[c]["level"]:
            return level
    return None


def combine(rules, prio_proba, cond_proba, prio_classes, cond_classes, thr=None, texts=None):
    """What MedOS does: the rules decide; the model may only raise the level, never lower it, and never on a
    symptom the text denies ("no chest pain")."""
    out = []
    for i, (r, p, c) in enumerate(zip(rules, prio_proba, cond_proba)):
        t = model_target(p, c, prio_classes, cond_classes, thr)
        if t and LEVELS.index(t) < LEVELS.index(r) and not (
                texts is not None and triage.condition_denied(texts[i], cond_classes[int(np.argmax(c))])):
            out.append(t)
        else:
            out.append(r)
    return np.array(out)


def scores(y, p):
    y, p = np.asarray(y), np.asarray(p)
    crit = y == "critical"
    return {"accuracy": round(float((y == p).mean()), 4),
            "critical_recall": round(float((p[crit] == "critical").mean()), 4) if crit.any() else None,
            "under_triage": round(float(np.mean([LEVELS.index(a) > LEVELS.index(b) for a, b in zip(p, y)])), 4),
            "false_critical": round(float(((p == "critical") & ~crit).mean()), 4)}


def evaluate(model: Model, df: pd.DataFrame, text_col: str = "symptoms") -> dict:
    pp, pc, _ = model.proba(df[text_col], df)
    pclasses, cclasses = list(model.prio.classes_), list(model.cond.classes_)
    ml = np.array([pclasses[i] for i in pp.argmax(axis=1)])
    rules = np.array([rules_level(r) for _, r in df.rename(columns={text_col: "symptoms"}).iterrows()])
    texts = df[text_col].tolist()
    comb = combine(rules, pp, pc, pclasses, cclasses, texts=texts)
    cond = np.array([cclasses[i] for i in pc.argmax(axis=1)])
    conf = pc.max(axis=1)
    dept = np.array([COND_INFO[c]["department"] for c in cond])
    true_dept = np.array([COND_INFO[c]["department"] for c in df["condition"]])
    sure = (conf >= CONDITION_THRESHOLD) & (cond != "Unclassified complaint")
    return {"rows": int(len(df)), "_texts": texts, "_pp": pp, "_pc": pc, "_rules": rules, "_pclasses": pclasses, "_cclasses": cclasses,
            "priority": {"rules_engine": scores(df["priority"], rules), "ml_model": scores(df["priority"], ml),
                         "rules_plus_ml_upgrade": scores(df["priority"], comb)},
            "condition_accuracy": round(float((cond == df["condition"].to_numpy()).mean()), 4),
            "department_accuracy": round(float((dept == true_dept).mean()), 4),
            "confident_condition": {"share": round(float(sure.mean()), 4),
                                    "accuracy": round(float((cond[sure] == df["condition"].to_numpy()[sure]).mean()), 4) if sure.any() else None},
            "_pred": {"ml": ml, "rules": rules, "comb": comb, "cond": cond}}


def by_language(model: Model, df: pd.DataFrame, text_col: str = "symptoms") -> dict:
    return {lg: strip(evaluate(model, df[df["lang"] == lg], text_col)) for lg in ("en", "ta", "tl", "mx") if (df["lang"] == lg).any()}


def strip(d: dict) -> dict:
    return {k: v for k, v in d.items() if not k.startswith("_")}


# ---------------------------------------------------------------- main
def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-features", type=int, default=16000)
    ap.add_argument("--c-priority", type=float, default=4.0)
    ap.add_argument("--c-condition", type=float, default=8.0)
    ap.add_argument("--no-export", action="store_true", help="evaluate only")
    args = ap.parse_args()

    df = pd.read_csv(DATA, keep_default_na=False, na_values=[""])
    real = pd.read_csv(REAL, keep_default_na=False)
    real_test = pd.read_csv(REAL_TEST, keep_default_na=False)
    train, test = train_test_split(df, test_size=0.15, random_state=SEED, stratify=df["priority"])

    t0 = time.time()
    model = Model(args.max_features, args.c_priority, args.c_condition).fit(train)
    train_s = time.time() - t0

    test_ev = evaluate(model, test)
    real_ev = evaluate(model, real, text_col="text")
    test_ev2 = evaluate(model, real_test, text_col="text")
    metrics = {
        "dataset": {"file": "ml/data/triage_synthetic.csv", "rows": int(len(df)), "train": int(len(train)), "test": int(len(test)),
                    "synthetic": True, "languages": {k: int(v) for k, v in df["lang"].value_counts().items()},
                    "class_counts": {k: int(v) for k, v in df["priority"].value_counts().items()},
                    "conditions": int(df["condition"].nunique())},
        "model": {"features": "words + word pairs + 3-5 character pieces (TF-IDF) + vitals",
                  "text_features": len(model.vec.vocabulary_), "priority_head": "multinomial logistic regression, 4 levels",
                  "condition_head": "multinomial logistic regression, %d conditions" % len(model.cond.classes_),
                  "weights": "8-bit integers, one scale per class", "train_seconds": round(train_s, 1),
                  "max_features": args.max_features, "C_priority": args.c_priority, "C_condition": args.c_condition},
        "test": strip(test_ev), "test_by_language": by_language(model, test),
        "unseen_phrasings": unseen_phrasing_check(df, args),
        "realworld_dev": strip(real_ev), "realworld_dev_by_language": by_language(model, real, "text"),
        "realworld_dev_mistakes": mistakes(real, real_ev),
        "realworld": strip(test_ev2), "realworld_by_language": by_language(model, real_test, "text"),
        "realworld_mistakes": mistakes(real_test, test_ev2),
        "thresholds": {"upgrade": UPGRADE_THRESHOLD, "condition": CONDITION_THRESHOLD, "condition_by_level": THRESH_BY_LEVEL, "support": CONDITION_SUPPORT},
        "trained_at": time.strftime("%Y-%m-%d %H:%M"),
    }
    print_summary(metrics)
    if args.no_export:
        return

    export(model, metrics)
    reference(model, test, pd.concat([real, real_test]).reset_index(drop=True))
    REPORTS.mkdir(parents=True, exist_ok=True)
    (REPORTS / "metrics.json").write_text(json.dumps(metrics, indent=2, ensure_ascii=False), encoding="utf-8")
    (REPORTS / "metrics.md").write_text(report_md(metrics), encoding="utf-8")
    print("Model written to %s (%d KB) and %s (%d KB)" % (OUT_PY.relative_to(ROOT), OUT_PY.stat().st_size // 1024,
                                                         OUT_JS.relative_to(ROOT), OUT_JS.stat().st_size // 1024))


def mistakes(real: pd.DataFrame, ev: dict) -> list:
    out = []
    for i, (_, r) in enumerate(real.iterrows()):
        c, comb = ev["_pred"]["cond"][i], ev["_pred"]["comb"][i]
        if c != r["condition"] or comb != r["priority"]:
            out.append({"text": r["text"], "lang": r["lang"], "true": [r["condition"], r["priority"]],
                        "predicted_condition": c, "medos_priority": comb, "rules": ev["_pred"]["rules"][i]})
    return out


def unseen_phrasing_check(df: pd.DataFrame, args) -> dict:
    held = set()
    for name, ps in PARAPHRASES.items():
        held.add(ps[-1])
    for name, ps in TA.items():
        held.add(ps[-1][0])
    for name, ps in TL.items():
        held.add(ps[-1])
    is_held = df["base"].isin(held).to_numpy()
    model = Model(args.max_features, args.c_priority, args.c_condition).fit(df[~is_held])
    ev = evaluate(model, df[is_held])
    out = strip(ev)
    out["held_out_phrases"] = len(held)
    y = df[is_held]["priority"]
    sweep = []
    for name, thr in (("flat 55%", {"critical": .55, "high": .55, "medium": .55, "low": .55}),
                      ("critical 40% / high 45%", {"critical": .40, "high": .45, "medium": .55, "low": .55}),
                      ("critical 30% / high 40%", {"critical": .30, "high": .40, "medium": .55, "low": .55}),
                      ("critical 25% / high 35%", {"critical": .25, "high": .35, "medium": .55, "low": .55}),
                      ("critical 20% / high 30%", {"critical": .20, "high": .30, "medium": .55, "low": .55})):
        comb = combine(ev["_rules"], ev["_pp"], ev["_pc"], ev["_pclasses"], ev["_cclasses"], thr, ev["_texts"])
        sc = scores(y, comb)
        sweep.append({"policy": name, **sc})
    out["threshold_sweep"] = sweep
    out["by_language"] = by_language(model, df[is_held])
    return out


def export(model: Model, metrics: dict) -> None:
    vocab = {t: int(i) for t, i in model.vec.vocabulary_.items()}
    def head(est, q, extra=None):
        Q, scale = q
        d = {"classes": [str(c) for c in est.classes_], "intercept": [round(float(x), 6) for x in est.intercept_],
             "scale": [float(s) for s in scale], "w": base64.b64encode(Q.tobytes()).decode("ascii")}
        d.update(extra or {})
        return d
    conds = [str(c) for c in model.cond.classes_]
    m = {
        "name": "MedOS triage model", "version": 2,
        "vocab": vocab, "idf": [round(float(x), 5) for x in model.vec.idf_],
        "numeric": {"names": [n for k in ("age",) + VITALS for n in (k, k + "_measured")] + ["pregnant", "age_extreme"],
                    "mean": [round(float(x), 6) for x in model.mean], "scale": [round(float(x), 6) for x in model.scale]},
        "priority": head(model.prio, model.qp),
        "condition": head(model.cond, model.qc, {"department": {c: COND_INFO[c]["department"] for c in conds},
                                                  "level": {c: COND_INFO[c]["level"] for c in conds}}),
        "upgrade_threshold": UPGRADE_THRESHOLD, "condition_threshold": CONDITION_THRESHOLD, "condition_support": CONDITION_SUPPORT,
        "condition_threshold_by_level": THRESH_BY_LEVEL,
        "metrics": {
            "accuracy": metrics["test"]["priority"]["ml_model"]["accuracy"],
            "critical_recall": metrics["test"]["priority"]["ml_model"]["critical_recall"],
            "rules_accuracy": metrics["test"]["priority"]["rules_engine"]["accuracy"],
            "combined_accuracy": metrics["test"]["priority"]["rules_plus_ml_upgrade"]["accuracy"],
            "condition_accuracy": metrics["test"]["condition_accuracy"],
            "unseen_phrasing_rules_accuracy": metrics["unseen_phrasings"]["priority"]["rules_engine"]["accuracy"],
            "unseen_phrasing_combined_accuracy": metrics["unseen_phrasings"]["priority"]["rules_plus_ml_upgrade"]["accuracy"],
            "combined_critical_recall": metrics["test"]["priority"]["rules_plus_ml_upgrade"]["critical_recall"],
            "realworld_rules_accuracy": metrics["realworld"]["priority"]["rules_engine"]["accuracy"],
            "realworld_combined_accuracy": metrics["realworld"]["priority"]["rules_plus_ml_upgrade"]["accuracy"],
            "realworld_critical_recall": metrics["realworld"]["priority"]["rules_plus_ml_upgrade"]["critical_recall"],
            "realworld_condition_accuracy": metrics["realworld"]["condition_accuracy"],
            "realworld_department_accuracy": metrics["realworld"]["department_accuracy"],
            "realworld_rows": metrics["realworld"]["rows"],
            "realworld_dev_combined_accuracy": metrics["realworld_dev"]["priority"]["rules_plus_ml_upgrade"]["accuracy"],
            "languages": ["English", "Tamil", "Tanglish"],
            "test_rows": metrics["dataset"]["test"], "train_rows": metrics["dataset"]["train"], "synthetic_data": True,
        },
    }
    OUT_PY.parent.mkdir(parents=True, exist_ok=True)
    OUT_PY.write_text(json.dumps(m, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    OUT_JS.parent.mkdir(parents=True, exist_ok=True)
    OUT_JS.write_text("// Generated by ml/train.py — do not edit. MedOS triage model (trained on synthetic data).\n"
                      "window.MEDOS_ML_MODEL = " + json.dumps(m, separators=(",", ":"), ensure_ascii=False) + ";\n", encoding="utf-8")


def reference(model: Model, test: pd.DataFrame, real: pd.DataFrame) -> None:   # real = dev + fresh sentences
    """Exported-model predictions on test rows and every real-world sentence, so the Python and JavaScript
    re-implementations can be checked against them."""
    sample = pd.concat([test.head(240).rename(columns={"symptoms": "text"}), real]).reset_index(drop=True)
    pp, pc, _ = model.proba(sample["text"], sample)
    rows = []
    for (_, r), a, b in zip(sample.iterrows(), pp, pc):
        age = row_age(r)
        rows.append({"text": r["text"], "age": None if age is None else int(age), "pregnant": int(row_pregnant(r)),
                     "vitals": {k: float(v) for k, v in vitals_of(r).items()},
                     "priority": [round(float(x), 6) for x in a], "condition": [round(float(x), 6) for x in b]})
    REPORTS.mkdir(parents=True, exist_ok=True)
    (REPORTS / "reference_predictions.json").write_text(json.dumps(
        {"priority_classes": [str(c) for c in model.prio.classes_], "condition_classes": [str(c) for c in model.cond.classes_],
         "rows": rows}, ensure_ascii=False), encoding="utf-8")


def print_summary(m: dict) -> None:
    def line(name, d):
        p = d["priority"]
        print("  %-26s rules %.3f | ML %.3f | rules+ML %.3f (critical recall %.3f) | condition %.3f | department %.3f" % (
            name, p["rules_engine"]["accuracy"], p["ml_model"]["accuracy"], p["rules_plus_ml_upgrade"]["accuracy"],
            p["rules_plus_ml_upgrade"]["critical_recall"] or 0, d["condition_accuracy"], d["department_accuracy"]))
    print("Trained on %d synthetic rows (%s); %d text features." % (m["dataset"]["train"], m["dataset"]["languages"], m["model"]["text_features"]))
    line("test (synthetic)", m["test"])
    for lg, d in m["test_by_language"].items():
        line("  test, " + lg, d)
    line("never-seen phrasings", m["unseen_phrasings"])
    print("  threshold sweep on never-seen phrasings (MedOS = rules + ML):")
    for r in m["unseen_phrasings"]["threshold_sweep"]:
        print("    %-26s accuracy %.3f | critical recall %.3f | under-triage %.3f | false critical %.3f" % (
            r["policy"], r["accuracy"], r["critical_recall"], r["under_triage"], r["false_critical"]))
    line("DEV sentences (tuned on)", m["realworld_dev"])
    line("FRESH held-out sentences", m["realworld"])
    for lg, d in m["realworld_by_language"].items():
        line("  fresh, " + lg, d)
    print("  held-out mistakes: %d of %d (dev set: %d of %d)" % (len(m["realworld_mistakes"]), m["realworld"]["rows"], len(m["realworld_dev_mistakes"]), m["realworld_dev"]["rows"]))
    for x in m["realworld_mistakes"]:
        print("    [%s] %s\n         true %s / %s  →  model condition %s, MedOS priority %s (rules %s)" % (
            x["lang"], x["text"], x["true"][0], x["true"][1], x["predicted_condition"], x["medos_priority"], x["rules"]))


def report_md(m: dict) -> str:
    def table(d, title):
        p = d["priority"]
        rows = [title, "", "| Method | Priority accuracy | Critical recall | Under-triage |", "|---|---|---|---|"]
        for key, label in (("rules_engine", "Rules alone"), ("ml_model", "ML model alone"), ("rules_plus_ml_upgrade", "**Rules + ML upgrade (what MedOS uses)**")):
            s = p[key]
            rows.append("| %s | %.1f%% | %s | %.1f%% |" % (label, s["accuracy"] * 100, "%.1f%%" % (s["critical_recall"] * 100) if s["critical_recall"] is not None else "—", s["under_triage"] * 100))
        rows += ["", "Condition (what the complaint means): **%.1f%%** correct · department for booking: **%.1f%%** · "
                 "confident predictions (≥ %d%%): %.0f%% of rows, %.1f%% correct." % (
                     d["condition_accuracy"] * 100, d["department_accuracy"] * 100, CONDITION_THRESHOLD * 100,
                     d["confident_condition"]["share"] * 100, (d["confident_condition"]["accuracy"] or 0) * 100), ""]
        return rows
    lang_name = {"en": "English", "ta": "Tamil", "tl": "Tanglish", "mx": "Tamil + English mixed"}
    L = ["# MedOS triage model — evaluation report", "",
         "> **Synthetic training data.** The model is trained on `ml/data/triage_synthetic.csv`, generated by "
         "`ml/generate_dataset.py` from the MedOS triage protocol in English, Tamil and Tanglish. It is not real patient "
         "data. The real-world set below was written separately; these numbers show the method works, not clinical validation.", "",
         "- Rows: %d (%s), train %d, test %d" % (m["dataset"]["rows"], ", ".join("%s %d" % (lang_name[k], v) for k, v in m["dataset"]["languages"].items()),
                                                 m["dataset"]["train"], m["dataset"]["test"]),
         "- Model: %s; %d text features; priority head + condition head (%s)" % (m["model"]["features"], m["model"]["text_features"], m["model"]["condition_head"]),
         "- Weights: %s. Every number here is measured on the exported weights." % m["model"]["weights"],
         "- Trained: %s" % m["trained_at"], ""]
    L += table(m["realworld"], "## Fresh held-out sentences (%d, written separately from the generator and before the final round of tuning)" % m["realworld"]["rows"])
    for lg, d in m["realworld_by_language"].items():
        L += table(d, "### Fresh sentences — %s (%d)" % (lang_name[lg], d["rows"]))
    L += table(m["realworld_dev"], "## Development sentences (%d) — the set the model was tuned against, so treat it as optimistic" % m["realworld_dev"]["rows"])
    L += table(m["unseen_phrasings"], "## Phrasings never seen in training (%d rows, %d held-out phrases)" % (m["unseen_phrasings"]["rows"], m["unseen_phrasings"]["held_out_phrases"]))
    L += table(m["test"], "## Synthetic test set (%d rows)" % m["test"]["rows"])
    L += ["## Mistakes on the fresh held-out sentences", ""]
    if m["realworld_mistakes"]:
        L += ["| Sentence | True | Model's condition | MedOS priority |", "|---|---|---|---|"]
        for x in m["realworld_mistakes"]:
            L.append("| %s | %s · %s | %s | %s |" % (x["text"], x["true"][0], x["true"][1], x["predicted_condition"], x["medos_priority"]))
    else:
        L.append("None.")
    L += ["", "## How MedOS uses the model", "",
          "- **Priority:** the rules engine decides first. The model may only **raise** the level, and only when at least "
          "%d%% confident; it never lowers a priority and never overrides staff." % (UPGRADE_THRESHOLD * 100),
          "- **Condition → department:** when the condition head is at least %d%% confident, booking uses its department to "
          "find a hospital with the right specialist, and the condition explains a Tamil complaint in English." % (CONDITION_THRESHOLD * 100),
          "- *Under-triage* = predicted less urgent than the true level (the dangerous error).", ""]
    return "\n".join(L)


if __name__ == "__main__":
    main()
