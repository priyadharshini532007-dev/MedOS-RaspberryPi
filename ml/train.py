"""Train MedOS's machine-learning priority model and export it for the Pi and the website.

Model
    Text:    TF-IDF of the symptom description (words and word pairs, so "no chest" differs from "chest").
    Numbers: age, temperature, pulse, SpO2, systolic BP, pain score, pregnancy, plus "was this measured"
             flags, standardised.
    Classifier: multinomial logistic regression → probability for Critical / High / Medium / Low.

Logistic regression is deliberate: it is small, fast on a Raspberry Pi, and every prediction can be
explained (each word and vital sign has a weight per level). The exported model is plain numbers, so the
Pi (medos/ml_triage.py) and the browser (website/js/ml.js) run it without scikit-learn.

Evaluation
    Stratified 80/20 split of the synthetic dataset. The rules engine (medos/triage.py) is scored on the
    same test rows, overall and on everyday paraphrases it has no keywords for, so the report shows
    exactly what the model adds.

Run:  python ml/train.py
Writes:
    medos/models/triage_model.json      model for the Flask app
    website/ml/triage_model.js          same model for the website
    ml/reports/metrics.json, metrics.md evaluation report
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix, hstack
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
from sklearn.model_selection import train_test_split

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from medos import triage  # noqa: E402

DATA = ROOT / "ml" / "data" / "triage_synthetic.csv"
OUT_PY = ROOT / "medos" / "models" / "triage_model.json"
OUT_JS = ROOT / "website" / "ml" / "triage_model.js"
REPORTS = ROOT / "ml" / "reports"
LEVELS = list(triage.LEVELS)            # critical, high, medium, low
NUMERIC = ["age", "temp", "pulse", "spo2", "bp_sys", "pain"]
SEED = 7


def numeric_features(df: pd.DataFrame) -> np.ndarray:
    """Raw numeric block: each vital (missing → 0) + a 'measured' flag, pregnancy, age bands."""
    cols = []
    for c in NUMERIC:
        v = pd.to_numeric(df[c], errors="coerce")
        cols.append(v.fillna(0).to_numpy(float))
        cols.append(v.notna().to_numpy(float))
    age = pd.to_numeric(df["age"], errors="coerce")
    cols.append(df["pregnant"].astype(float).to_numpy())
    cols.append(((age >= 65) | (age <= 5)).fillna(False).to_numpy(float))
    return np.vstack(cols).T


NUMERIC_NAMES = [n for c in NUMERIC for n in (c, c + "_measured")] + ["pregnant", "age_extreme"]


def rules_level(row) -> str:
    vitals = {k: row[k] for k in ("temp", "pulse", "spo2", "bp_sys", "pain") if pd.notna(row[k]) and row[k] != ""}
    return triage.analyse(row["symptoms"], row["age"], row["sex"], vitals, bool(row["pregnant"]))["level"]


def main() -> None:
    df = pd.read_csv(DATA)
    train, test = train_test_split(df, test_size=0.2, random_state=SEED, stratify=df["priority"])

    tfidf = TfidfVectorizer(lowercase=True, ngram_range=(1, 2), min_df=2, sublinear_tf=True)
    Xt_train = tfidf.fit_transform(train["symptoms"])
    Xt_test = tfidf.transform(test["symptoms"])
    N_train, N_test = numeric_features(train), numeric_features(test)
    mean, scale = N_train.mean(axis=0), N_train.std(axis=0)
    scale[scale == 0] = 1.0
    X_train = hstack([Xt_train, csr_matrix((N_train - mean) / scale)]).tocsr()
    X_test = hstack([Xt_test, csr_matrix((N_test - mean) / scale)]).tocsr()

    t0 = time.time()
    clf = LogisticRegression(C=4.0, max_iter=3000, class_weight="balanced")
    clf.fit(X_train, train["priority"])
    train_s = time.time() - t0

    pred = clf.predict(X_test)
    y = test["priority"].to_numpy()
    rules = test.apply(rules_level, axis=1).to_numpy()
    para = (test["phrasing"] == "paraphrase").to_numpy()

    def scores(p, mask=None):
        yy, pp = (y, p) if mask is None else (y[mask], p[mask])
        crit = yy == "critical"
        return {"accuracy": round(float(accuracy_score(yy, pp)), 4),
                "macro_f1": round(float(f1_score(yy, pp, average="macro")), 4),
                "critical_recall": round(float((pp[crit] == "critical").mean()), 4) if crit.any() else None,
                "under_triage_rate": round(float(np.mean([LEVELS.index(a) > LEVELS.index(b) for a, b in zip(pp, yy)])), 4)}

    # The way MedOS combines them: rules first, the model may only RAISE the level when confident.
    proba = clf.predict_proba(X_test)
    classes = list(clf.classes_)
    combined = []
    for r, pr in zip(rules, proba):
        m = classes[int(np.argmax(pr))]
        combined.append(m if LEVELS.index(m) < LEVELS.index(r) and pr.max() >= 0.75 else r)
    combined = np.array(combined)

    metrics = {
        "dataset": {"file": str(DATA.relative_to(ROOT)).replace("\\", "/"), "rows": int(len(df)), "train": int(len(train)), "test": int(len(test)),
                    "synthetic": True, "class_counts": {k: int(v) for k, v in df["priority"].value_counts().items()}},
        "model": {"type": "TF-IDF (1-2 grams) + standardised vitals → multinomial logistic regression",
                  "vocabulary": len(tfidf.vocabulary_), "features": int(X_train.shape[1]), "train_seconds": round(train_s, 2)},
        "test": {"ml_model": scores(pred), "rules_engine": scores(rules), "rules_plus_ml_upgrade": scores(combined)},
        "test_paraphrases_only": {"rows": int(para.sum()), "ml_model": scores(pred, para), "rules_engine": scores(rules, para),
                                  "rules_plus_ml_upgrade": scores(combined, para)},
        "confusion_matrix": {"labels": LEVELS, "ml_model": confusion_matrix(y, pred, labels=LEVELS).tolist(),
                             "rules_plus_ml_upgrade": confusion_matrix(y, combined, labels=LEVELS).tolist()},
        "per_class": classification_report(y, pred, labels=LEVELS, output_dict=True, zero_division=0),
        "trained_at": time.strftime("%Y-%m-%d %H:%M"),
    }

    # ---- stricter check: phrasings the model has NEVER seen. One paraphrase per condition is removed from
    # training entirely; a separate model is trained without it and scored only on rows that use it.
    metrics["unseen_phrasings"] = unseen_phrasing_check(df, tfidf.get_params())

    # ---- export: plain numbers, reproduced exactly by medos/ml_triage.py and website/js/ml.js
    vocab = {term: int(i) for term, i in tfidf.vocabulary_.items()}
    model = {
        "name": "MedOS priority model", "version": 1, "classes": classes,
        "tfidf": {"vocabulary": vocab, "idf": [round(float(x), 6) for x in tfidf.idf_], "ngram_range": [1, 2],
                  "token_pattern": r"(?u)\b\w\w+\b", "sublinear_tf": True, "norm": "l2"},
        "numeric": {"names": NUMERIC_NAMES, "mean": [round(float(x), 6) for x in mean], "scale": [round(float(x), 6) for x in scale]},
        "coef": [[round(float(x), 6) for x in row] for row in clf.coef_],
        "intercept": [round(float(x), 6) for x in clf.intercept_],
        "upgrade_threshold": 0.75,
        "metrics": {"accuracy": metrics["test"]["ml_model"]["accuracy"], "macro_f1": metrics["test"]["ml_model"]["macro_f1"],
                    "critical_recall": metrics["test"]["ml_model"]["critical_recall"],
                    "rules_accuracy": metrics["test"]["rules_engine"]["accuracy"],
                    "combined_accuracy": metrics["test"]["rules_plus_ml_upgrade"]["accuracy"],
                    "paraphrase_ml_accuracy": metrics["test_paraphrases_only"]["ml_model"]["accuracy"],
                    "paraphrase_rules_accuracy": metrics["test_paraphrases_only"]["rules_engine"]["accuracy"],
                    "unseen_phrasing_ml_accuracy": metrics["unseen_phrasings"]["ml_model"],
                    "unseen_phrasing_rules_accuracy": metrics["unseen_phrasings"]["rules_engine"],
                    "unseen_phrasing_combined_accuracy": metrics["unseen_phrasings"]["rules_plus_ml_upgrade"],
                    "test_rows": metrics["dataset"]["test"], "train_rows": metrics["dataset"]["train"], "synthetic_data": True},
    }
    OUT_PY.parent.mkdir(parents=True, exist_ok=True)
    OUT_PY.write_text(json.dumps(model, separators=(",", ":")), encoding="utf-8")
    OUT_JS.parent.mkdir(parents=True, exist_ok=True)
    OUT_JS.write_text("// Generated by ml/train.py — do not edit. MedOS priority model (trained on synthetic data).\n"
                      "window.MEDOS_ML_MODEL = " + json.dumps(model, separators=(",", ":")) + ";\n", encoding="utf-8")

    # Reference predictions so the Python and JavaScript re-implementations can be checked against sklearn.
    sample = test.head(200)
    Xs = hstack([tfidf.transform(sample["symptoms"]), csr_matrix((numeric_features(sample) - mean) / scale)]).tocsr()
    ref = [{"symptoms": r["symptoms"], "age": None if pd.isna(r["age"]) else int(r["age"]), "pregnant": int(r["pregnant"]),
            "vitals": {k: float(r[k]) for k in ("temp", "pulse", "spo2", "bp_sys", "pain") if pd.notna(r[k])},
            "proba": [round(float(x), 6) for x in p]} for (_, r), p in zip(sample.iterrows(), clf.predict_proba(Xs))]
    REPORTS.mkdir(parents=True, exist_ok=True)
    (REPORTS / "reference_predictions.json").write_text(json.dumps({"classes": classes, "rows": ref}, indent=0), encoding="utf-8")
    (REPORTS / "metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    (REPORTS / "metrics.md").write_text(report_md(metrics), encoding="utf-8")

    t = metrics["test"]
    print("Trained on %d rows, tested on %d (synthetic)." % (len(train), len(test)))
    for k in ("ml_model", "rules_engine", "rules_plus_ml_upgrade"):
        print("  %-22s accuracy %.3f  macro-F1 %.3f  critical recall %.3f" % (k, t[k]["accuracy"], t[k]["macro_f1"], t[k]["critical_recall"]))
    tp = metrics["test_paraphrases_only"]
    print("  paraphrases only: ML %.3f vs rules %.3f" % (tp["ml_model"]["accuracy"], tp["rules_engine"]["accuracy"]))
    u = metrics["unseen_phrasings"]
    print("  never-seen phrasings (%d rows): ML %.3f, rules %.3f, rules+ML %.3f" % (u["rows"], u["ml_model"], u["rules_engine"], u["rules_plus_ml_upgrade"]))
    print("Model written to %s and %s" % (OUT_PY.relative_to(ROOT), OUT_JS.relative_to(ROOT)))


def unseen_phrasing_check(df: pd.DataFrame, tfidf_params: dict) -> dict:
    sys.path.insert(0, str(ROOT / "ml"))
    from generate_dataset import PARAPHRASES  # noqa: E402
    held = [ps[-1].lower() for ps in PARAPHRASES.values() if len(ps) > 1]
    is_held = df["symptoms"].str.lower().apply(lambda s: any(h in s for h in held)).to_numpy()
    tr, te = df[~is_held], df[is_held]
    vec = TfidfVectorizer(**tfidf_params)
    Xt_tr, Xt_te = vec.fit_transform(tr["symptoms"]), vec.transform(te["symptoms"])
    Ntr, Nte = numeric_features(tr), numeric_features(te)
    mu, sd = Ntr.mean(axis=0), Ntr.std(axis=0)
    sd[sd == 0] = 1.0
    clf = LogisticRegression(C=4.0, max_iter=3000, class_weight="balanced")
    clf.fit(hstack([Xt_tr, csr_matrix((Ntr - mu) / sd)]).tocsr(), tr["priority"])
    Xte = hstack([Xt_te, csr_matrix((Nte - mu) / sd)]).tocsr()
    pred, proba = clf.predict(Xte), clf.predict_proba(Xte)
    y = te["priority"].to_numpy()
    rules = te.apply(rules_level, axis=1).to_numpy()
    classes = list(clf.classes_)
    comb = np.array([classes[int(np.argmax(p))] if LEVELS.index(classes[int(np.argmax(p))]) < LEVELS.index(r) and p.max() >= 0.75 else r
                     for r, p in zip(rules, proba)])
    acc = lambda p: round(float(accuracy_score(y, p)), 4)  # noqa: E731
    crit = y == "critical"
    return {"held_out_phrasings": len(held), "rows": int(len(te)), "ml_model": acc(pred), "rules_engine": acc(rules),
            "rules_plus_ml_upgrade": acc(comb),
            "critical_recall": {"ml_model": round(float((pred[crit] == "critical").mean()), 4),
                                "rules_engine": round(float((rules[crit] == "critical").mean()), 4),
                                "rules_plus_ml_upgrade": round(float((comb[crit] == "critical").mean()), 4)}}


def report_md(m: dict) -> str:
    def row(name, s):
        return "| %s | %.1f%% | %.3f | %.1f%% | %.1f%% |" % (name, s["accuracy"] * 100, s["macro_f1"], s["critical_recall"] * 100, s["under_triage_rate"] * 100)
    t, tp = m["test"], m["test_paraphrases_only"]
    cm = m["confusion_matrix"]["ml_model"]
    lines = [
        "# MedOS priority model — evaluation report",
        "",
        "> **Synthetic data.** The model is trained and tested on `%s`, generated by `ml/generate_dataset.py` "
        "from the MedOS triage protocol. It is not real patient data, so these numbers show the method works; "
        "they are not clinical validation." % m["dataset"]["file"],
        "",
        "- Rows: %d (train %d, test %d, stratified split)" % (m["dataset"]["rows"], m["dataset"]["train"], m["dataset"]["test"]),
        "- Model: %s" % m["model"]["type"],
        "- Features: %d (%d text terms + vitals); training time %.2f s" % (m["model"]["features"], m["model"]["vocabulary"], m["model"]["train_seconds"]),
        "- Trained: %s" % m["trained_at"],
        "",
        "## Test set (all %d rows)" % m["dataset"]["test"],
        "",
        "| Method | Accuracy | Macro F1 | Critical recall | Under-triage |",
        "|---|---|---|---|---|",
        row("ML model alone", t["ml_model"]),
        row("Rules engine alone", t["rules_engine"]),
        row("**Rules + ML upgrade (used in MedOS)**", t["rules_plus_ml_upgrade"]),
        "",
        "## Everyday phrasings the keyword rules don't contain (%d rows)" % tp["rows"],
        "",
        "| Method | Accuracy | Macro F1 | Critical recall | Under-triage |",
        "|---|---|---|---|---|",
        row("ML model alone", tp["ml_model"]),
        row("Rules engine alone", tp["rules_engine"]),
        row("**Rules + ML upgrade (used in MedOS)**", tp["rules_plus_ml_upgrade"]),
        "",
        "*Under-triage* = predicted less urgent than the true level (the dangerous error).",
        "",
        "## Phrasings the model has never seen (stricter test)",
        "",
        "The tables above test on new patients, but those patients reuse phrasings that also appear in training. "
        "Here one phrasing per condition (%d in total) was removed from training completely, a separate model was "
        "trained without them, and it was scored only on the %d rows that use them." % (
            m["unseen_phrasings"]["held_out_phrasings"], m["unseen_phrasings"]["rows"]),
        "",
        "| Method | Accuracy | Critical recall |",
        "|---|---|---|",
        "| ML model alone | %.1f%% | %.1f%% |" % (m["unseen_phrasings"]["ml_model"] * 100, m["unseen_phrasings"]["critical_recall"]["ml_model"] * 100),
        "| Rules engine alone | %.1f%% | %.1f%% |" % (m["unseen_phrasings"]["rules_engine"] * 100, m["unseen_phrasings"]["critical_recall"]["rules_engine"] * 100),
        "| **Rules + ML upgrade** | %.1f%% | %.1f%% |" % (m["unseen_phrasings"]["rules_plus_ml_upgrade"] * 100, m["unseen_phrasings"]["critical_recall"]["rules_plus_ml_upgrade"] * 100),
        "",
        "This is the honest measure of how well the model handles wording it was not trained on.",
        "",
        "## Confusion matrix — ML model (rows = true, columns = predicted)",
        "",
        "| | " + " | ".join(l.capitalize() for l in LEVELS) + " |",
        "|---|" + "---|" * len(LEVELS),
    ]
    for lbl, r in zip(LEVELS, cm):
        lines.append("| **%s** | " % lbl.capitalize() + " | ".join(str(x) for x in r) + " |")
    lines += ["", "## How MedOS uses the model", "",
              "The rules engine sets the priority first. The model gives a second opinion and may only **raise** the level, "
              "and only when it is at least 75% confident. It can never lower a priority, so a model mistake cannot "
              "push a sick patient down the queue.", ""]
    return "\n".join(lines)


if __name__ == "__main__":
    main()
