"""Turning what a patient says into form fields — English, Tamil and Tanglish.

Two ways in:

* parse_checkin(text)      one free sentence ("my name is Kavitha, 34, fever since two days")
* the guided check-in      three separate questions, one field each, so answers can't get mixed up:
      extract_name(answer)     "What is your name?"      / "உங்கள் பெயர் என்ன?"
      extract_age(answer)      "How old are you?"        / "உங்களுக்கு எத்தனை வயசு?"
      clean_symptoms(answer)   "What is the problem?"    / "என்ன பிரச்சனை?"

The website runs the same rules in JavaScript (website/js/triage.js); tests/test_checkin.py checks the two
give identical answers on tests/checkin_cases.json.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Any, Dict, List, Optional, Tuple

# ---------------------------------------------------------------- English number words
UNITS = {"zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
         "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13,
         "fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18,
         "nineteen": 19}
TENS = {"twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70,
        "eighty": 80, "ninety": 90}


def words_to_digits(text: str) -> str:
    """'forty five years' → '45 years'; 'one hundred and two' → '102'. Offline STT speaks in words."""
    tokens = re.findall(r"[a-zA-Z]+|\d+|[^\sa-zA-Z\d]+|\s+", text)
    out, i = [], 0

    def is_num(tok: str) -> bool:
        t = tok.lower()
        return t in UNITS or t in TENS or t == "hundred"

    while i < len(tokens):
        tok = tokens[i]
        if not is_num(tok):
            out.append(tok)
            i += 1
            continue
        total, current, j, last_j = 0, 0, i, i
        while j < len(tokens):
            t = tokens[j].lower()
            if t.isspace() or (t == "and" and current):
                j += 1
                continue
            if t in UNITS:
                current += UNITS[t]
            elif t in TENS:
                current += TENS[t]
            elif t == "hundred":
                current = max(current, 1) * 100
            else:
                break
            last_j = j
            j += 1
        total += current
        # Digit-by-digit phone numbers: "nine eight four ..." → keep concatenated
        seq = [tokens[k].lower() for k in range(i, last_j + 1) if tokens[k].strip() and tokens[k].lower() != "and"]
        if len(seq) >= 6 and all(s in UNITS for s in seq):
            out.append("".join(str(UNITS[s]) for s in seq))
        else:
            out.append(str(total))
        i = last_j + 1
    return "".join(out)


# ---------------------------------------------------------------- Tamil number words
# Spoken Tamil joins tens and units ("இருபத்தஞ்சு" = 25, "முப்பத்தி நாலு" = 34); the joined forms are
# generated from the parts so every combination 1–99 is recognised.
TA_TEEN = [("பத்தொன்பது|பத்தொம்பது", 19), ("பதினெட்டு", 18), ("பதினேழு", 17), ("பதினாறு", 16),
           ("பதினைந்து|பதினஞ்சு", 15), ("பதினான்கு|பதினாலு", 14), ("பதின்மூன்று|பதிமூணு|பதிமூனு", 13),
           ("பன்னிரண்டு|பன்னெண்டு|பன்னண்டு", 12), ("பதினொன்று|பதினொன்னு|பதினோரு", 11), ("பத்து", 10)]
TA_UNIT = [("ஒன்பது|ஒம்பது", 9), ("எட்டு", 8), ("ஏழு", 7), ("ஆறு", 6), ("ஐந்து|அஞ்சு", 5),
           ("நான்கு|நாலு", 4), ("மூன்று|மூணு|மூனு", 3), ("இரண்டு|ரெண்டு", 2), ("ஒன்று|ஒன்னு|ஒண்ணு|ஒரு", 1)]
# stem + "து" is the plain ten ("இருபது"); stem + "த்" starts a joined number ("இருபத்தி…", "இருபத்தஞ்சு")
TA_TENS = [("இருப", 20), ("இருவ", 20), ("முப்ப", 30), ("நாற்ப", 40), ("நாப்ப", 40), ("ஐம்ப", 50), ("அம்ப", 50),
           ("அறுப", 60), ("எழுப", 70), ("எண்ப", 80), ("தொண்ணூ", 90)]
_VOWEL_SIGN = {"அ": "", "ஆ": "ா", "இ": "ி", "ஈ": "ீ", "உ": "ு", "ஊ": "ூ", "எ": "ெ", "ஏ": "ே", "ஐ": "ை", "ஒ": "ொ", "ஓ": "ோ"}


def _unit_forms() -> List[Tuple[str, int, bool]]:
    """(form, value, joined) for every unit word, plain and in its joined "த…" form."""
    out = []
    for alts, n in TA_UNIT:
        for w in alts.split("|"):
            if w == "ஒரு":
                continue                      # "ஒரு" (a/one) is never part of a joined number
            out.append((w, n, False))
            if w[0] in _VOWEL_SIGN:
                out.append(("த" + _VOWEL_SIGN[w[0]] + w[1:], n, True))    # அஞ்சு → தஞ்சு, எட்டு → தெட்டு
    return out


_UNIT_FORMS = _unit_forms()
_UNIT_VALUE = {f: n for f, n, _ in _UNIT_FORMS}
_PLAIN_UNITS = "|".join(sorted({f for f, _, j in _UNIT_FORMS if not j} | {"ஒரு"}, key=len, reverse=True))
_JOINED_UNITS = "|".join(sorted({f for f, _, j in _UNIT_FORMS if j}, key=len, reverse=True))
_STEMS = "|".join(s for s, _ in TA_TENS)
_TEENS = "|".join(a for a, _ in TA_TEEN)
_TA_NUM_BODY = (
    "(?P<stem>" + _STEMS + ")(?:த்(?:தி|து)?\\s?(?P<unit>" + _PLAIN_UNITS + ")|த்(?P<joined>" + _JOINED_UNITS + ")|(?P<ten>து))"
    "|(?P<ninety>தொண்ணூறு)|(?P<teen>" + _TEENS + ")|(?P<single>" + _PLAIN_UNITS + ")")
_TA_BEFORE = "(?<![஀-௿])"
# A number word must end a word: followed by a space, punctuation, the end, or an age / time word.
_TA_AFTER = "(?=\\s|$|[,.!?]|வய|மாச|மாத|வருஷ|வருட)"
TA_NUMBER = re.compile(_TA_BEFORE + "(?:" + _TA_NUM_BODY + ")" + _TA_AFTER)


def _ta_value(m: re.Match) -> int:
    if m.group("stem"):
        tens = dict(TA_TENS)[m.group("stem")]
        if m.group("ten"):
            return tens
        return tens + _UNIT_VALUE[m.group("unit") or m.group("joined")]
    if m.group("ninety"):
        return 90
    if m.group("teen"):
        w = m.group("teen")
        return next(n for alts, n in TA_TEEN if w in alts.split("|"))
    return next(n for alts, n in TA_UNIT if m.group("single") in alts.split("|"))


def tamil_numbers_to_digits(text: str, only_before_age: bool = False) -> str:
    """"பதினெட்டு வயசு" → "18 வயசு". With only_before_age, only numbers followed by வயசு/வயது change."""
    def sub(m: re.Match) -> str:
        if only_before_age and not re.match(r"\s*வய", text[m.end():]):
            return m.group(0)
        return str(_ta_value(m))
    return TA_NUMBER.sub(sub, text)


# ---------------------------------------------------------------- shared patterns
NAME_STOP = {"having", "suffering", "feeling", "not", "very", "a", "an", "the", "sick", "in", "here",
             "with", "experiencing", "getting", "unable", "so", "really", "from", "coming", "bleeding",
             "pregnant", "male", "female", "okay", "fine", "going", "also", "age", "aged"}
NAME_STOP_EXTRA = {"and", "i", "my", "years", "year", "old", "speaking", "is", "am", "but", "because", "have", "has"}
TAMIL_NAME_STOP = {"தான்", "வயசு", "வயது", "எனக்கு", "ஆகுது", "வந்து", "இருக்கேன்", "பேசுறேன்", "ங்க", "சார்", "மேடம்",
                   "நான்", "என்", "பெயர்", "பேரு", "பேர்", "thaan", "than", "enakku", "vayasu"}

# Name: formal and spoken Tamil ("என் பெயர்", "என்னோட பேரு", "என்னுடைய பெயர்") and Tanglish ("ennoda peru").
TAMIL_NAME = (r"(?:(?:என்(?:னோட|னுடைய|னுட|து)?|எனது|எந்தன்)\s+(?:பெயர்|பேர்|பேரு|பெயரு)|(?:^|\s)(?:பெயர்|பேரு)"
              r"|\b(?:en|ennoda|enoda|ennudaya)\s+(?:peru|per|peyar))\s*[:,]?\s*([^\s,.\d]+)")
TAMIL_AGE = r"(\d{1,3})\s*(?:வயது|வயசு|வயதாகிறது|வயசாகுது|வயதான|vayasu|vayathu|vayadhu)"
TAMIL_AGE_BEFORE = r"(?:வயது|வயசு|vayasu|vayathu)\s*[:,]?\s*(\d{1,3})"
# The whole age phrase, with the words around it: "எனக்கு 18 வயசு ஆகுது", "வயசு 18".
TAMIL_AGE_STRIP = (r"(?:எனக்கு\s+)?(?:வந்து\s+)?(?:\d{1,3}\s*(?:வயது|வயசு|வயதாகிறது|வயசாகுது|vayasu|vayathu|vayadhu)\S*"
                   r"|(?:வயது|வயசு)\s*\d{1,3})(?:\s+(?:ஆகுது|ஆகிறது|ஆச்சு|ஆகுதுங்க|aaguthu|aachu))?\s*,?")
# An explicit English age phrase — never a bare duration like "back pain for 3 years".
AGE_PHRASE_EN = (r"(?i)(?:\b(?:i am|i'm|aged|age is|age)\s+\d{1,3}(?:\s*(?:years?|yrs?)(?:\s*old)?)?"
                 r"|\b\d{1,3}\s*(?:years?|yrs?)\s*old\b)\s*,?")
TAMIL_FEMALE = r"பெண்|அம்மா|மனைவி|மகள்|அக்கா|தங்கை|பாட்டி|அவள்|கர்ப்ப"
TAMIL_MALE = r"ஆண்|அப்பா|கணவர்|கணவன்|மகன்|அண்ணன்|அண்ணா|தம்பி|தாத்தா|அவன்"
TAMIL_PREGNANT = r"கர்ப்ப|garbam|karbam"
# Words that carry no symptom on their own; a clause made only of these is dropped ("எனக்கு வந்து ஆகுது").
FILLER = {"எனக்கு", "வந்து", "ஆகுது", "ஆகிறது", "ஆச்சு", "ஆகுதுங்க", "நான்", "நானு", "இருக்கேன்", "ங்க", "சார்", "மேடம்",
          "டாக்டர்", "ஹலோ", "வணக்கம்", "சரி", "அப்புறம்", "அது", "இது", "enakku", "vandhu", "aaguthu", "hello", "okay",
          "ok", "so", "and", "um", "uh", "then", "sir", "madam", "doctor"}
TAMIL = re.compile(r"[஀-௿]")


def nfc(text: str) -> str:
    return unicodedata.normalize("NFC", text or "")


def is_tamil(text: str) -> bool:
    return bool(TAMIL.search(text or ""))


def drop_filler_clauses(text: str) -> str:
    parts = re.split(r"([.,;!?\n]+)", text)
    out = ""
    for i in range(0, len(parts), 2):
        words = parts[i].split()
        if words and all(w.lower() in FILLER for w in words):
            continue
        out += parts[i] + (parts[i + 1] if i + 1 < len(parts) else "")
    return out


LEAD_FILLER_EN = {"um", "uh", "so", "okay", "ok", "well", "hello", "hi", "and", "then", "actually", "yeah", "yes"}


def _tidy(text: str) -> str:
    words = text.strip(" ,.").split(" ")
    while len(words) > 1 and words[0].strip(",.").lower() in LEAD_FILLER_EN:   # "um, so I have…" → "I have…"
        words.pop(0)
    text = " ".join(words)
    text = re.sub(r"\s{2,}", " ", text)
    text = re.sub(r"\s+([.,])", r"\1", text)
    text = text.strip(" ,.")
    return text[0].upper() + text[1:] if text else text


_DURATION_WORDS = {"for", "since", "past", "last", "from", "about", "over", "nearly", "almost"}


def _age_match(low: str) -> Tuple[Optional[re.Match], bool]:
    """(match, bare) for the age in a whole sentence. Explicit age phrases win ("34 years old", "I am 34",
    "34 வயசு"); a bare "N years" counts only when it isn't a duration ("back pain for 3 years" is not an age).
    bare=True means the age came from a bare "N years", which the phrase cleanup doesn't remove by itself."""
    m = (re.search(r"\b(\d{1,3})\s*(?:years?|yrs?)\s*old\b", low)
         or re.search(r"\b(?:i am|i'm|aged|age is|age)\s+(\d{1,3})\b", low)
         or re.search(TAMIL_AGE, low) or re.search(TAMIL_AGE_BEFORE, low))
    bare = False
    if not m:
        for b in re.finditer(r"\b(\d{1,3})\s*(?:years?|yrs?|yr)\b", low):
            before = low[:b.start()].split()
            if not before or before[-1] not in _DURATION_WORDS:
                m, bare = b, True
                break
    if m and 0 < int(m.group(1)) < 120:
        return m, bare
    return None, False


# ---------------------------------------------------------------- one free sentence
def parse_checkin(text: str) -> Dict[str, Any]:
    """Best-effort field extraction from one sentence, without a model."""
    raw = tamil_numbers_to_digits(words_to_digits(nfc(text)), only_before_age=True)
    low = raw.lower()
    out: Dict[str, Any] = {"name": None, "age": None, "sex": None, "phone": None, "symptoms": raw.strip(),
                           "pregnant": False}

    name_span = None
    m = re.search(r"\b(?:my name is|name is|this is|i am|i'm|im|call me)\s+([a-z][a-z.]*(?:\s+[a-z][a-z.]*){0,2})", low)
    if m:
        kept = []
        end = m.start(1)
        for w in re.finditer(r"[a-z.]+", m.group(1)):
            if w.group(0) in NAME_STOP or w.group(0) in ("and", "i", "my", "years", "year"):
                break
            kept.append(w.group(0))
            end = m.start(1) + w.end()
        if kept:
            out["name"] = " ".join(w.capitalize() for w in kept)
            name_span = (m.start(), end)

    # Tamil / Tanglish: "என் பெயர் கவிதா", "என்னோட பேரு கிருத்திகா", "ennoda peru Kavitha"
    if not out["name"]:
        m = re.search(TAMIL_NAME, raw, re.I)
        if m:
            n = re.sub(r"ங்க$", "", m.group(1).strip(" .,"))     # "கிருத்திகாங்க" → "கிருத்திகா"
            if n:
                out["name"] = n[0].upper() + n[1:]
                name_span = (m.start(), m.end())

    age_m, age_bare = _age_match(low)
    if age_m:
        out["age"] = int(age_m.group(1))

    if re.search(r"\b(female|woman|lady|girl|she|her|mother|wife|daughter|pregnant)\b", low) or re.search(TAMIL_FEMALE, low):
        out["sex"] = "female"
    elif re.search(r"\b(male|man|boy|he|his|father|husband|son)\b", low) or re.search(TAMIL_MALE, low):
        out["sex"] = "male"
    if re.search(r"\bpregnan", low) or re.search(TAMIL_PREGNANT, low):
        out["pregnant"] = True

    m = re.search(r"(\+?\d[\d\s-]{8,14}\d)", raw)
    if m:
        digits = re.sub(r"\D", "", m.group(1))
        if 10 <= len(digits) <= 13:
            out["phone"] = digits

    # Symptoms: drop the identity clauses so the complaint reads cleanly.
    sym = raw
    # Cut the name, and a bare "N years" age (raw and low have the same length); the phrase rules below remove
    # "I am 34 years old" and "34 வயசு" whole.
    spans: List[Tuple[int, int]] = []
    for a, b in sorted(s for s in (name_span, age_m.span() if age_m and age_bare else None) if s):
        if spans and a <= spans[-1][1]:
            spans[-1] = (spans[-1][0], max(b, spans[-1][1]))     # overlapping: merge
        else:
            spans.append((a, b))
    for a, b in reversed(spans):
        sym = sym[:a] + " " + sym[b:]
    sym = re.sub(AGE_PHRASE_EN, "", sym)
    sym = re.sub(TAMIL_AGE_STRIP, "", sym, flags=re.I)
    sym = re.sub(r"(?i)\b(?:my )?(?:phone|mobile|number)\s*(?:number)?\s*(?:is)?\s*\+?[\d\s-]{8,16}", "", sym)
    sym = _tidy(drop_filler_clauses(sym))
    if sym:
        out["symptoms"] = sym
    return out


# ---------------------------------------------------------------- guided check-in: one answer, one field
_NAME_LEAD = [
    r"(?:hi|hello|hey|ok|okay|yes|yeah|sir|madam|doctor|um|uh|so|well|good morning|good evening)\b[\s,]*",
    r"(?:my name is|my name's|my name|name is|the name is|this is|i am|i'm|im|it is|it's|its|call me|myself|me)\b\s*",
    r"(?:(?:என்(?:னோட|னுடைய|னுட|து)?|எனது|எந்தன்)\s+(?:பெயர்|பேர்|பேரு|பெயரு))\s*[:,]?\s*",
    r"(?:பெயர்|பேரு|பேர்)\s*[:,]?\s*",
    r"(?:நான்|வணக்கம்|ஹலோ|சார்|மேடம்|டாக்டர்)(?=\s|$|,)[\s,]*",
    r"(?:en|ennoda|enoda|ennudaya)\s+(?:peru|per|peyar)\b\s*",
    r"(?:naan|vanakkam)\b[\s,]*",
]


def extract_name(answer: str) -> Optional[str]:
    """The name in an answer to "What is your name?" — "Kavitha", "My name is Ravi Kumar",
    "என்னோட பேரு கிருத்திகா", "நான் கிருத்திகா தான்", "ennoda peru Krithika"."""
    t = nfc(answer).strip().replace("’", "'")
    # keep letters (Latin, accented, Tamil), digits, spaces, dots and apostrophes — an explicit list, so the
    # website's JavaScript (whose \w is ASCII-only) behaves exactly the same
    t = re.sub(r"[^A-Za-z0-9_\s.'À-ɏ஀-௿]", " ", t)
    changed = True
    while changed:                                        # peel off greetings and lead-ins, in any order
        changed = False
        for lead in _NAME_LEAD:
            m = re.match(lead, t, re.I)
            if m and m.end() > 0:
                t = t[m.end():].lstrip(" ,.")
                changed = True
    words = []
    for w in t.split():
        w = w.strip(".'")
        lw = w.lower()
        if not w or lw in NAME_STOP or lw in NAME_STOP_EXTRA or lw in TAMIL_NAME_STOP or re.search(r"\d", w):
            break
        w = re.sub(r"(?:ங்க|தான்)$", "", w) if len(w) > 4 else w   # "கிருத்திகாங்க", "ரவிதான்"
        words.append(w)
        if len(words) == 3:
            break
    if not words:
        return None
    return " ".join(w if is_tamil(w) else w[:1].upper() + w[1:].lower() for w in words)


def extract_age(answer: str) -> Optional[int]:
    """The age in an answer to "How old are you?" — "34", "thirty-four", "I'm 34 years old",
    "பதினெட்டு", "முப்பத்தி நாலு வயசு", "இருபத்தஞ்சு". A baby's "ஆறு மாசம்" / "6 months" gives 0."""
    t = nfc(answer)
    t = re.sub(r"(?<=[A-Za-z])-(?=[A-Za-z])", " ", t)     # "thirty-four" → "thirty four"
    t = tamil_numbers_to_digits(words_to_digits(t))
    low = t.lower()
    months = re.search(r"மாச|மாத|\bmonths?\b|\bmnths?\b", low)
    m = (re.search(r"\b(\d{1,3})\s*(?:years?|yrs?|yr)\b", low) or re.search(r"(\d{1,3})\s*(?:வய|வருஷ|வருட)", low)
         or re.search(r"(?<!\d)(\d{1,3})(?!\d)", low))
    if not m:
        return None
    n = int(m.group(1))
    if months and not re.search(r"\b\d{1,3}\s*(?:years?|yrs?)\b|\d{1,3}\s*(?:வய|வருஷ|வருட)", low):
        return 0 if n <= 24 else None                   # an infant: under one year
    return n if 0 < n < 120 else None


def clean_symptoms(answer: str) -> str:
    """The complaint in an answer to "What is the problem?". Only an explicit name or age phrase and empty
    filler are removed, so "I am diabetic and have fever" keeps every word."""
    t = tamil_numbers_to_digits(words_to_digits(nfc(answer)), only_before_age=True)
    t = re.sub(r"(?i)\b(?:my name is|my name's|name is)\s+[a-z]+\b[\s,.]*", "", t)
    m = re.search(TAMIL_NAME, t, re.I)
    if m:
        t = t[:m.start()] + " " + t[m.end():]
    t = re.sub(AGE_PHRASE_EN, "", t)
    t = re.sub(TAMIL_AGE_STRIP, "", t, flags=re.I)
    return _tidy(drop_filler_clauses(t))
