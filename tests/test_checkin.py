"""Check-in parsing: the guided three-question answers and the free sentence, in English, Tamil and Tanglish.
The same cases run through the website's JavaScript (tests/js_checkin_runner.js) must give identical answers."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

from medos.checkin import clean_symptoms, extract_age, extract_name, parse_checkin

HERE = Path(__file__).resolve().parent
CASES = json.loads((HERE / "checkin_cases.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("answer,want", CASES["name"])
def test_name(answer, want):
    assert extract_name(answer) == want


@pytest.mark.parametrize("answer,want", CASES["age"])
def test_age(answer, want):
    assert extract_age(answer) == want


@pytest.mark.parametrize("answer,want", CASES["symptoms"])
def test_symptoms(answer, want):
    assert clean_symptoms(answer) == want


@pytest.mark.parametrize("sentence,want", CASES["parse"])
def test_free_sentence(sentence, want):
    got = parse_checkin(sentence)
    for k, v in want.items():
        assert got[k] == v, (k, got)


@pytest.mark.skipif(not shutil.which("node"), reason="Node.js not installed")
def test_website_parser_gives_identical_answers():
    run = subprocess.run(["node", str(HERE / "js_checkin_runner.js")], capture_output=True, timeout=60)
    assert run.returncode == 0, run.stderr.decode("utf-8", "replace")
    js = json.loads(run.stdout.decode("utf-8"))
    assert js["name"] == [extract_name(a) for a, _ in CASES["name"]]
    assert js["age"] == [extract_age(a) for a, _ in CASES["age"]]
    assert js["symptoms"] == [clean_symptoms(a) for a, _ in CASES["symptoms"]]
    assert js["parse"] == [parse_checkin(a) for a, _ in CASES["parse"]]


@pytest.mark.parametrize("text,condition,expected", CASES["denied"])
def test_symptom_the_patient_denies(text, condition, expected):
    """"No chest pain" / "நெஞ்சு வலி இல்லை" must be recognised as a denial — the ML model never acts on one."""
    from medos import triage
    assert triage.condition_denied(text, condition) is expected


@pytest.mark.skipif(not shutil.which("node"), reason="Node.js not installed")
def test_website_denial_gives_identical_answers():
    run = subprocess.run(["node", str(HERE / "js_checkin_runner.js")], capture_output=True, timeout=60)
    assert run.returncode == 0, run.stderr.decode("utf-8", "replace")
    assert json.loads(run.stdout.decode("utf-8"))["denied"] == [e for _, _, e in CASES["denied"]]


@pytest.mark.parametrize("text,level", CASES["triage"])
def test_triage_english_tamil_tanglish(text, level):
    from medos import triage
    assert triage.analyse(text)["level"] == level


@pytest.mark.skipif(not shutil.which("node"), reason="Node.js not installed")
def test_website_triage_gives_identical_answers():
    from medos import triage
    run = subprocess.run(["node", str(HERE / "js_checkin_runner.js")], capture_output=True, timeout=60)
    assert run.returncode == 0, run.stderr.decode("utf-8", "replace")
    js = json.loads(run.stdout.decode("utf-8"))["triage"]
    py = [[triage.analyse(t)["level"], triage.analyse(t)["primary_condition"]] for t, _ in CASES["triage"]]
    assert js == py
