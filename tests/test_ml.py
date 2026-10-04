"""The machine-learning triage model: the exported weights reproduce the trained model exactly (in Python and in
the website's JavaScript), it understands English / Tamil / Tanglish, it is measured on sentences written
separately from the training data, and the scheduler only ever uses it to RAISE a priority."""
import csv
import json
import shutil
import subprocess
from pathlib import Path

import pytest

from medos import db, ml_triage, triage

ROOT = Path(__file__).resolve().parent.parent
HERE = Path(__file__).resolve().parent
REF = json.loads((ROOT / "ml" / "reports" / "reference_predictions.json").read_text(encoding="utf-8"))


def test_model_is_installed():
    assert ml_triage.available(), "train it with: python ml/train.py"
    info = ml_triage.info()
    assert set(info["classes"]) == {"critical", "high", "medium", "low"}
    assert len(info["conditions"]) >= 25
    assert info["metrics"]["synthetic_data"] is True
    assert info["metrics"]["languages"] == ["English", "Tamil", "Tanglish"]


def test_python_matches_the_trained_model():
    """Every reference sentence (synthetic test rows and all real-world sentences) gives the probabilities
    scikit-learn computed from the exported weights."""
    for r in REF["rows"]:
        p = ml_triage.predict(r["text"], r["age"], r["vitals"], bool(r["pregnant"]))
        assert p is not None, r["text"]
        for c, want in zip(REF["priority_classes"], r["priority"]):
            assert p["probabilities"][c] == pytest.approx(want, abs=2e-3), (r["text"], c)
        top = max(range(len(r["condition"])), key=r["condition"].__getitem__)
        assert p["condition"] == REF["condition_classes"][top], r["text"]
        assert p["condition_confidence"] == pytest.approx(r["condition"][top], abs=2e-3)


@pytest.mark.skipif(not shutil.which("node"), reason="Node.js not installed")
def test_website_javascript_matches_python():
    run = subprocess.run(["node", str(HERE / "js_ml_runner.js")], capture_output=True, timeout=120)
    assert run.returncode == 0, run.stderr.decode("utf-8", "replace")
    js = json.loads(run.stdout.decode("utf-8"))
    assert len(js) == len(REF["rows"])
    for r, j in zip(REF["rows"], js):
        p = ml_triage.predict(r["text"], r["age"], r["vitals"], bool(r["pregnant"]))
        assert j["level"] == p["level"] and j["condition"] == p["condition"], r["text"]
        assert j["confidence"] == pytest.approx(p["confidence"], abs=2e-3)
        assert j["conditionConfidence"] == pytest.approx(p["condition_confidence"], abs=2e-3)
        assert j["department"] == p["department"]


@pytest.mark.parametrize("text,condition,department", [
    ("my chest feels heavy and I am sweating", "Chest pain / suspected heart attack", "Emergency"),
    ("drank floor cleaner", "Poisoning / bite / overdose", "Emergency"),
    ("unbearable pain in the lower right side of the tummy", "Severe abdominal pain", "General Surgery"),
    ("எனக்கு இப்போ ரொம்ப வயிறு வலிக்குது", "Severe abdominal pain", "General Surgery"),
    ("நெஞ்சு பிடிச்சு வலிக்குது, உடம்பெல்லாம் வியர்க்குது", "Chest pain / suspected heart attack", "Emergency"),
    ("காது வலி நேத்து ராத்திரியில இருந்து", "Ear pain", "ENT"),
    ("kaai elumbu odanchiruku pola", "Fracture", "Orthopaedics"),
    ("moochu vida mudiyala", "Breathing difficulty", "Emergency"),
])
def test_understands_english_tamil_and_tanglish(text, condition, department):
    p = ml_triage.predict(text, 40)
    assert p["condition"] == condition and p["department"] == department
    assert ml_triage.confident_condition(p) == condition


def test_understood_as_explains_a_tamil_complaint_in_english():
    u = ml_triage.understood_as("அம்மாவுக்கு திடீர்னு வாய் ஒரு பக்கம் கோணிருச்சு, பேச முடியல")
    assert u and u["condition"] == "Stroke signs" and u["department"] == "Emergency"     # a stroke goes to the emergency department
    assert ml_triage.understood_as("qwxzv") is None            # nothing it recognises: no opinion


def test_upgrade_is_upgrade_only():
    base = {"condition": "Seizure", "condition_level": "critical"}
    # the priority head alone is not enough: the condition head has to lean the same way
    assert ml_triage.upgrade("low", {**base, "level": "critical", "confidence": 0.95, "condition_confidence": 0.1}) is None
    assert ml_triage.upgrade("low", {**base, "level": "critical", "confidence": 0.95, "condition_confidence": 0.3}) == "critical"
    assert ml_triage.upgrade("low", {**base, "level": "critical", "confidence": 0.5, "condition_confidence": 0.27}) is None, "priority head not confident"
    assert ml_triage.upgrade("critical", {"condition": "Ear pain", "condition_level": "low", "level": "low", "confidence": 0.99, "condition_confidence": 0.9}) is None, "never lowers"
    # a confident condition brings its protocol level — and the more serious, the less sure it needs to be
    stroke = {"condition": "Stroke signs", "condition_level": "critical", "level": "high", "confidence": 0.4, "condition_confidence": 0.9}
    assert ml_triage.upgrade("low", stroke) == "critical"
    assert ml_triage.upgrade("low", {**stroke, "condition_confidence": 0.32}) == "critical", "critical conditions need only ~30%"
    assert ml_triage.upgrade("low", {**stroke, "condition_confidence": 0.2}) is None


def test_a_denied_symptom_never_raises_a_priority():
    chest = {"condition": "Chest pain / suspected heart attack", "condition_level": "critical", "level": "critical",
             "confidence": 0.9, "condition_confidence": 0.9}
    assert ml_triage.upgrade("low", chest) == "critical"
    assert ml_triage.upgrade("low", chest, "chest pain since morning") == "critical"
    for denial in ("no chest pain, just a cough", "நெஞ்சு வலி இல்ல, ஆனா இருமல் இருக்கு", "nenju vali illa, irumal"):
        assert ml_triage.upgrade("low", chest, denial) is None, denial
    bleeding = {"condition": "Severe bleeding", "condition_level": "critical", "level": "critical", "confidence": 0.9, "condition_confidence": 0.9}
    assert ml_triage.upgrade("low", bleeding, "no bleeding, a small scratch") is None
    assert ml_triage.upgrade("low", bleeding, "ரத்தம் நிற்கவே இல்லை") == "critical", "'won't stop' is not a denial"
    faint = {"condition": "Unconscious / collapsed", "condition_level": "critical", "level": "critical", "confidence": 0.9, "condition_confidence": 0.9}
    for denial in ("மயக்கம் இல்லை, தலை லேசா வலிக்குது", "no dizziness, my head hurts a little", "mayakkam illa, thalai vali"):
        assert ml_triage.upgrade("low", faint, denial) is None, denial
    for emergency in ("அவங்க சுயநினைவு இல்லாம கிடக்காங்க", "மயக்கம் இல்லை, ஆனா மயங்கி விழுந்துட்டாங்க", "he is not waking up", "மயக்கமா இருக்கு எழுந்திருக்கவே இல்ல"):
        assert ml_triage.upgrade("low", faint, emergency) == "critical", emergency


def _real_world(name):
    with (ROOT / "ml" / "data" / name).open(encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


@pytest.mark.parametrize("name,minimum", [("realworld_test.csv", 0.95), ("realworld_eval.csv", 0.93)])
def test_real_world_sentences(name, minimum):
    """Sentences written separately from the generator (English, Tamil, Tanglish, code-mixed): the fresh held-out
    set and the development set. Rules alone vs MedOS (rules, raised by the model): MedOS must be clearly better,
    must never miss a critical case, and must not raise a case to critical by mistake."""
    rows = _real_world(name)
    order = triage.LEVEL_ORDER
    rules_ok = medos_ok = crit = crit_ok = under = false_crit = 0
    for r in rows:
        rules = triage.analyse(r["text"])["level"]
        up = ml_triage.upgrade(rules, ml_triage.predict(r["text"]), r["text"])
        medos = up or rules
        false_crit += medos == "critical" and r["priority"] != "critical"
        rules_ok += rules == r["priority"]
        medos_ok += medos == r["priority"]
        under += order[medos] > order[r["priority"]]
        if r["priority"] == "critical":
            crit += 1
            crit_ok += medos == "critical"
    n = len(rows)
    assert medos_ok / n >= minimum, (medos_ok, n)
    assert medos_ok > rules_ok + 0.1 * n
    assert crit_ok == crit, "a critical case was missed"
    assert under / n <= 0.03
    assert false_crit <= 1, "a case was wrongly raised to critical"


def test_reported_quality():
    m = ml_triage.info()["metrics"]
    assert m["combined_accuracy"] >= m["rules_accuracy"] + 0.1
    assert m["realworld_combined_accuracy"] >= 0.95
    assert m["realworld_critical_recall"] == 1.0
    assert m["combined_critical_recall"] >= 0.95


def test_scheduler_raises_level_for_phrasing_rules_miss(fresh_db):
    from medos.scheduler import scheduler
    db.set_setting("ml_triage", True)
    p = scheduler.register({"symptoms": "Fell down and is not waking", "age": 70}, dispatch=False)
    assert p["rules_level"] != "critical", "the keyword rules don't recognise this phrasing"
    assert p["level"] == "critical" and p["level_source"] == "ml" and p["ml_level"] == "critical"


def test_scheduler_understands_tamil_the_rules_miss(fresh_db):
    from medos.scheduler import scheduler
    db.set_setting("ml_triage", True)
    # "mouth has twisted to one side, can't speak" — stroke signs, in an everyday Tamil phrasing
    p = scheduler.register({"symptoms": "அம்மாவுக்கு திடீர்னு வாய் ஒரு பக்கம் கோணிருச்சு, பேச முடியல", "age": 66}, dispatch=False)
    assert p["level"] == "critical" and p["primary_condition"] != "Unclassified complaint"


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
