"""Machine-learning priority model: exported model reproduces scikit-learn, and the scheduler only ever
uses it to RAISE a priority."""
import json
from pathlib import Path

import pytest

from medos import db, ml_triage

ROOT = Path(__file__).resolve().parent.parent


def test_model_is_installed():
    assert ml_triage.available(), "train it with: python ml/train.py"
    info = ml_triage.info()
    assert info["classes"] and set(info["classes"]) == {"critical", "high", "medium", "low"}
    assert info["metrics"]["synthetic_data"] is True


def test_pure_python_matches_scikit_learn():
    ref = json.loads((ROOT / "ml" / "reports" / "reference_predictions.json").read_text(encoding="utf-8"))
    for r in ref["rows"]:
        p = ml_triage.predict(r["symptoms"], r["age"], r["vitals"], bool(r["pregnant"]))
        for c, want in zip(ref["classes"], r["proba"]):
            assert p["probabilities"][c] == pytest.approx(want, abs=1e-3)


@pytest.mark.parametrize("text,level", [
    ("fell down and is not waking", "critical"),               # not in the keyword list
    ("drank floor cleaner", "critical"),
    ("unbearable pain in the lower right side of the tummy", "high"),
    ("routine check-up", "low"),
])
def test_predicts_everyday_phrasings(text, level):
    assert ml_triage.predict(text, 45)["level"] == level


def test_reported_quality():
    m = ml_triage.info()["metrics"]
    assert m["combined_accuracy"] >= m["rules_accuracy"], "rules + model must not do worse than rules alone"
    assert m["critical_recall"] >= 0.8


def test_upgrade_only():
    assert ml_triage.upgrade("low", {"level": "critical", "confidence": 0.95}) == "critical"
    assert ml_triage.upgrade("low", {"level": "critical", "confidence": 0.5}) is None, "not confident enough"
    assert ml_triage.upgrade("critical", {"level": "low", "confidence": 0.99}) is None, "never lowers"


def test_scheduler_raises_level_for_phrasing_rules_miss(fresh_db):
    from medos.scheduler import scheduler
    db.set_setting("ml_triage", True)
    p = scheduler.register({"symptoms": "Fell down and is not waking", "age": 70}, dispatch=False)
    assert p["rules_level"] != "critical", "the keyword rules don't recognise this phrasing"
    assert p["level"] == "critical" and p["level_source"] == "ml" and p["ml_level"] == "critical"


def test_scheduler_ignores_model_when_switched_off(fresh_db):
    from medos.scheduler import scheduler
    db.set_setting("ml_triage", False)
    p = scheduler.register({"symptoms": "Fell down and is not waking", "age": 70}, dispatch=False)
    assert p["level"] == p["rules_level"] and p["ml_level"] is None
    db.set_setting("ml_triage", True)


def test_staff_override_wins(fresh_db):
    from medos.scheduler import scheduler
    p = scheduler.register({"symptoms": "my chest feels heavy and I am sweating", "level_override": "medium"}, dispatch=False)
    assert p["level"] == "medium" and p["level_source"] == "manual"
