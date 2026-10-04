"""Tamil and Tanglish check-ins: triage keywords, Tamil negation, and the spoken-form parser."""
import pytest

from medos import db, triage
from medos.voice import parse_checkin


@pytest.mark.parametrize("text,level", [
    ("எனக்கு நெஞ்சு வலிக்குது, வியர்க்குது", "critical"),        # chest pain, sweating
    ("அப்பாவுக்கு மூச்சு விட முடியல", "critical"),               # can't breathe
    ("பாம்பு கடிச்சுடுச்சு", "critical"),                         # snake bite
    ("ரோடு ஆக்சிடென்ட், தலையில அடிபட்டுச்சு", "critical"),        # road accident
    ("எலும்பு முறிஞ்சிருச்சு போல", "high"),                       # fracture
    ("தொடர்ந்து வாந்தி வருது", "medium"),                         # persistent vomiting
    ("காது வலி நேத்து ராத்திரியில இருந்து", "low"),               # ear pain
    ("ரெண்டு நாளா காய்ச்சல்", "low"),                            # mild fever
    ("en peru Ravi, nenju vali", "critical"),                    # Tanglish
])
def test_tamil_triage(text, level):
    assert triage.analyse(text)["level"] == level


def test_tamil_negation():
    # "no chest pain, a little cough" must not be Critical
    assert triage.analyse("நெஞ்சு வலி இல்லை, லேசான இருமல்")["level"] == "low"
    assert triage.analyse("nenju vali illa, irumal")["level"] == "low"


def test_dizzy_is_not_collapse():
    # "மயக்கமா இருக்கு" = "I feel dizzy", not "unconscious"
    assert triage.analyse("மயக்கமா இருக்கு")["level"] != "critical"


def test_keyword_must_start_a_word():
    # "வலி" (pain) inside "தலைவலி" (headache) must not trigger other "...வலி" conditions
    assert triage.analyse("தலைவலி இருக்கு")["primary_condition"] != "Ear pain"


def test_tamil_parser():
    f = parse_checkin("என் பெயர் கவிதா, 34 வயசு, ரெண்டு நாளா காய்ச்சல்")
    assert f["name"] == "கவிதா" and f["age"] == 34 and "காய்ச்சல்" in f["symptoms"] and "வயசு" not in f["symptoms"]
    f = parse_checkin("en peru Ravi, 45 vayasu, nenju vali")
    assert f["name"] == "Ravi" and f["age"] == 45
    f = parse_checkin("அப்பாவுக்கு 72 வயசு, மூச்சு விட முடியல")
    assert f["age"] == 72 and f["sex"] == "male"
    assert parse_checkin("நான் கர்ப்பமா இருக்கேன், வயிறு வலி")["pregnant"] is True


def test_english_age_removed_from_symptoms():
    f = parse_checkin("My name is Ravi Kumar, 58 years old, sudden chest pain")
    assert f["symptoms"] == "Sudden chest pain"


def test_existing_protocol_gets_tamil_words(fresh_db):
    # a protocol saved before Tamil support: the startup migration appends the Tamil words
    row = db.row("SELECT id, keywords FROM conditions WHERE name='Ear pain'")
    db.update("conditions", row["id"], {"keywords": "ear pain, earache"})
    db.add_tamil_keywords()
    kws = db.row("SELECT keywords FROM conditions WHERE id=?", (row["id"],))["keywords"]
    assert kws.startswith("ear pain, earache") and "காது வலி*" in kws


def test_ml_model_reads_tamil_and_gives_no_opinion_on_nonsense():
    # The model is trained on English, Tamil and Tanglish. Words it has never seen give no opinion at all.
    from medos import ml_triage
    p = ml_triage.predict("எனக்கு நெஞ்சு வலிக்குது", 58)
    assert p and p["condition"] == "Chest pain / suspected heart attack"
    assert ml_triage.predict("qwxzv", 58) is None
