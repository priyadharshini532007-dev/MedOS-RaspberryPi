"""More Tamil, Tanglish and code-mixed phrasings for the training data (added after the first evaluation).

Different words for the same things — verbs (வலிக்குது / குத்துது / பிடிக்குது), body-part words, and the ways people
actually describe a symptom — so the model learns meaning, not exact sentences. These are merged into
phrases_ta.TA / TL when ml/generate_dataset.py runs.

Condition names match medos/triage.py DEFAULT_CONDITIONS exactly.
"""

TA_MORE = {
    "Chest pain / suspected heart attack": [
        ("நெஞ்சை பிடிக்குது", "chest gripping pain"), ("மார்புல இறுக்கமா இருக்கு", "tightness in the chest"),
        ("நெஞ்சு எரியுது, கை வலிக்குது", "burning chest and arm pain"), ("நெஞ்சு படபடக்குது, வேர்க்குது", "pounding chest and sweating"),
        ("நெஞ்சுல ஏதோ அழுத்துற மாதிரி இருக்கு", "something pressing on the chest"), ("இதயம் வலிக்குது", "my heart hurts")],
    "Breathing difficulty": [
        ("மூச்சு முட்டுது", "choking for breath"), ("மூச்சே வரல", "no breath coming"), ("மூச்சுத்திணறல் ஆகுது", "breathlessness"),
        ("உதடு நீல கலர்ல இருக்கு, மூச்சு வாங்குது", "blue lips and gasping"), ("பேசவே மூச்சு பத்தல", "not enough breath to talk")],
    "Stroke signs": [
        ("முகம் ஒரு பக்கம் இழுக்குது", "face pulling to one side"), ("கை கால் அசைக்க முடியல, பேச்சு தெளிவா இல்ல", "cannot move limbs, speech unclear"),
        ("திடீர்னு தள்ளாடுறாரு, பேச முடியல", "suddenly unsteady and cannot speak"), ("ஒரு பக்கம் கை கால் மரத்துப்போச்சு", "one side numb")],
    "Unconscious / collapsed": [
        ("மயக்கமா விழுந்துட்டாங்க", "collapsed in a faint"), ("கீழே சரிஞ்சுட்டாரு", "slumped to the ground"),
        ("கூப்பிட்டா பதிலே இல்ல", "does not answer when called"), ("ஆளே அசையல", "is not moving at all")],
    "Severe bleeding": [
        ("ரத்தம் ஒழுகிட்டே இருக்கு", "blood keeps flowing"), ("துணி வெச்சு அமுக்கியும் ரத்தம் நிக்கல", "blood not stopping even with pressure"),
        ("வெட்டு பட்டு ரத்தம் பாயுது", "a cut is spurting blood"), ("ரத்தம் துப்புறாரு", "spitting blood")],
    "Seizure": [
        ("வலிப்பு வந்து நுரை தள்ளுது", "seizure with foam"), ("கை கால் இழுத்துக்குது", "limbs jerking"),
        ("சுயநினைவில்லாம உதறுது", "shaking unconscious"), ("வலிப்பு வந்தது, இன்னும் தெளியல", "had a fit and not yet recovered")],
    "Severe allergic reaction": [
        ("தொண்டை அடைக்குது, முகம் வீங்கிடுச்சு", "throat closing, face swollen"), ("கண்ணு உதடு வீங்கி மூச்சு விட கஷ்டம்", "swollen eyes and lips, hard to breathe"),
        ("சாப்பிட்டதும் உடம்பெல்லாம் தடிச்சு மூச்சு திணறுது", "rash all over and breathless after eating")],
    "Major trauma": [
        ("வண்டில இருந்து விழுந்து தலை உடைஞ்சுடுச்சு", "fell from the vehicle and the head is cut open"),
        ("மேல இருந்து விழுந்துட்டான்", "fell from a height"), ("பஸ் மோதி தூக்கி வீசிடுச்சு", "thrown by a bus collision"),
        ("கார் ஆக்சிடென்ட், நினைவில்ல", "car accident, unaware")],
    "Poisoning / bite / overdose": [
        ("பினாயில் குடிச்சுட்டான்", "drank phenyl"), ("களைக்கொல்லி குடிச்சுட்டாரு", "drank weedkiller"), ("பாம்பு தீண்டிடுச்சு", "snake bite"),
        ("பாம்பு கொத்திடுச்சு", "bitten by a snake"), ("தூக்க மாத்திரை நிறைய முழுங்கிட்டாங்க", "swallowed many sleeping tablets")],
    "Severe burns / electric shock": [
        ("தீயில கை வெந்துடுச்சு", "hand burnt in a fire"), ("சுடு தண்ணி மேல கொட்டி கொப்பளம் வந்துடுச்சு", "scalded with blisters"),
        ("கரண்ட் தொட்டு தூக்கி வீசிடுச்சு", "thrown back by an electric shock")],
    "Severe abdominal pain": [
        ("வயிறு வலி தாங்க முடியல, வலது பக்கம்", "unbearable pain, right side"), ("அடி வயிறு கடுமையா வலிக்குது", "severe lower abdominal pain"),
        ("வயிறு வலியால நெளியுறேன்", "twisting with abdominal pain"), ("வயிறு கல்லு மாதிரி கனமா வலிக்குது", "hard heavy painful stomach")],
    "Fracture": [
        ("கை முறிஞ்சுடுச்சு", "arm is broken"), ("கால் வளைஞ்சு போயிடுச்சு, ஊன்ற முடியல", "leg bent, cannot put weight"),
        ("எலும்பு வெளிய தெரியுது", "bone is visible"), ("வீங்கி நிறம் மாறிடுச்சு, அசைக்க முடியல", "swollen and discoloured, cannot move")],
    "High fever (>102°F)": [
        ("காய்ச்சல் 104 இருக்கு", "fever is 104"), ("கடுமையான சுரம், நடுக்கம்", "high fever with shaking"), ("உடம்பு தீ மாதிரி கொதிக்குது", "body is burning like fire")],
    "Severe migraine/headache": [
        ("தலை பாதி வலிக்குது, வெளிச்சம் கண்ணு கூசுது", "half the head hurts, light hurts the eyes"), ("மைக்ரேன் வந்துடுச்சு", "a migraine has come"),
        ("தலையில சம்மட்டி அடிக்கிற மாதிரி வலி", "pain like a hammer on the head"), ("கண்ணு கூசுது, வாந்தி வர மாதிரி இருக்கு, தலை வலி", "light-sensitive, nauseous, headache")],
    "Persistent vomiting": [
        ("வாந்தி மேல வாந்தி", "vomiting again and again"), ("எது சாப்பிட்டாலும் கக்குது", "vomits whatever is eaten"), ("ஒரே வாந்தி, ஒண்ணும் தங்கல", "constant vomiting, nothing stays")],
    "Asthma attack (mild)": [
        ("ஆஸ்துமா தொல்லை இருக்கு", "asthma trouble"), ("வீசிங் சத்தம் கேட்குது, லேசா மூச்சு இரைக்குது", "wheezing and slightly breathless"),
        ("இன்ஹேலர் எடுத்தேன், இன்னும் கொஞ்சம் இழுக்குது", "used the inhaler, still a little wheezy")],
    "Chest infection": [
        ("சளி கட்டிக்கிச்சு நெஞ்சுல, காய்ச்சல்", "chest congested with fever"), ("இருமினா மஞ்சள் சளி வருது", "yellow phlegm when coughing"),
        ("நெஞ்சுல கபம், இருமல் வாரக்கணக்கா", "phlegm in the chest and a cough for weeks")],
    "Back pain": [
        ("முதுகு பிடிப்பு", "back spasm"), ("இடுப்பு பிடிச்சுக்கிச்சு", "lower back has seized up"), ("கீழ் முதுகு வலி", "lower back pain"), ("கழுத்து பிடிப்பு", "stiff neck")],
    "Stomach pain (mild)": [
        ("வயிறு கொஞ்சம் வலி", "slight stomach pain"), ("வயிறு மந்தமா இருக்கு", "sluggish stomach"), ("கேஸ் ப்ராப்ளம், வயிறு உப்புசம்", "gas and bloating"),
        ("பேதி மூணு தடவை ஆச்சு", "diarrhoea three times"), ("வயிறு கலக்குது", "stomach churning"), ("பேதி ஆகுது", "having loose stools")],
    "Ear pain": [("காது குத்துது", "ear stabbing pain"), ("காதுல வலி", "pain in the ear"), ("காது அடைச்சுக்கிச்சு, வலி", "ear blocked and painful")],
    "Sore throat": [("தொண்டை கட்டிக்கிச்சு, வலி", "throat blocked and painful"), ("தொண்டை புண்ணா இருக்கு", "throat feels raw"),
                    ("எச்சில் முழுங்க வலிக்குது", "painful to swallow saliva")],
    "Skin allergy/rash": [("தோலுல தடிப்பு", "rash on the skin"), ("அரிப்பு தாங்கல", "cannot bear the itching"),
                          ("சிவப்பா திட்டு திட்டா இருக்கு", "red patches"), ("படை மாதிரி இருக்கு", "looks like ringworm")],
    "Cold & cough": [("ஜலதோஷம்", "common cold"), ("மூக்கு சளி ஒழுகுது", "runny nose"), ("தும்மல் தும்மலா வருது", "sneezing a lot"),
                     ("லேசான இருமல்", "mild cough")],
    "Mild fever": [("லேசான ஜுரம்", "mild fever"), ("காய்ச்சல் கம்மியா இருக்கு", "low fever"), ("கொஞ்சம் சூடா இருக்கு, அசதி", "slightly warm and tired")],
    "Routine check-up": [
        ("மருந்து தீர்ந்துடுச்சு, வாங்கணும்", "medicine finished, need a refill"), ("சுகர் பிபி பாக்கணும்", "need sugar and BP checked"),
        ("ரிப்போர்ட் காட்ட வந்தேன்", "came to show the report"), ("ப்ளட் டெஸ்ட் எடுக்கணும்", "need a blood test"),
        ("ஃபாலோ அப் விசிட்", "follow-up visit"), ("சர்டிபிகேட் வாங்க வந்தேன்", "came for a certificate"), ("ஊசி போடணும்", "need an injection")],
}

TL_MORE = {
    "Chest pain / suspected heart attack": ["nenju pidikuthu", "maarbula irukkama irukku", "nenju eriyuthu, kai valikuthu", "nenju padapadakkuthu"],
    "Breathing difficulty": ["moochu muttuthu", "moochu varala", "moochu thinaral", "udhadu neela kalar la irukku"],
    "Stroke signs": ["mugam oru pakkam izhukkuthu", "kai kaal asaikka mudiyala", "pechu thelivaa illa", "thalladi pesa mudiyala"],
    "Unconscious / collapsed": ["mayakkama vizhunthutaanga", "keezhe sarinjitaaru", "koopta badhil illa", "aale asaiyala"],
    "Severe bleeding": ["ratham ozhugite irukku", "thuni vachu amukkiyum ratham nikkala", "vettu pattu ratham paayuthu", "ratham thuppuraaru"],
    "Seizure": ["valippu vanthu nurai thallu", "kai kaal izhuthukkuthu", "suyaninaivu illama udharuthu"],
    "Severe allergic reaction": ["thondai adaikuthu mugam veengiduchu", "kannu udhadu veengi moochu kashtam"],
    "Major trauma": ["vandi la irunthu vizhunthu thalai udainjiduchu", "mela irunthu vizhunthutaan", "bus mothi thookki veesiduchu"],
    "Poisoning / bite / overdose": ["phenyl kudichutaan", "kalaikolli kudichutaaru", "paambu theenditchu", "paambu kothiduchu",
                                    "thookka maathirai niraya mulunkitaanga"],
    "Severe burns / electric shock": ["theeyila kai venthuduchu", "sudu thanni mela kottiduchu", "current thottu thookki veesiduchu"],
    "Severe abdominal pain": ["vayiru vali thaanga mudiyala right side", "adi vayiru kadumaiya valikuthu", "vayiru valiyaala neliyuren"],
    "Fracture": ["kai murinjiduchu", "kaal valanju poiduchu oonra mudiyala", "elumbu veliya theriyuthu"],
    "High fever (>102°F)": ["kaichal 104 irukku", "kadumaiyana suram nadukkam", "udambu thee maathiri kothikkuthu"],
    "Severe migraine/headache": ["thalai paadhi valikuthu velicham kannu koosuthu", "migraine vanthuduchu", "thalaila sammatti adikkura maathiri vali"],
    "Persistent vomiting": ["vaanthi mela vaanthi", "edhu saapittaalum kakkuthu", "ore vaanthi onnum thangala"],
    "Asthma attack (mild)": ["asthma tholla irukku", "wheezing sattham ketkuthu lesa moochu irakkuthu"],
    "Chest infection": ["sali kattikkichu nenjula kaichal", "irumina manjal sali varuthu", "nenjula kabam irumal vaarakkanakka"],
    "Back pain": ["muthugu pidippu", "idupu pidichukkichu", "keezh muthugu vali", "kazhuththu pidippu"],
    "Stomach pain (mild)": ["vayiru konjam vali", "vayiru mandhama irukku", "gas problem vayiru uppusam", "bedhi moonu thadava aachu", "vayiru kalakkuthu"],
    "Ear pain": ["kaathu kuthuthu", "kaathula vali", "kaathu adaichukkichu vali"],
    "Sore throat": ["thondai kattikkichu vali", "thondai punnaa irukku", "echil mizhunga valikkuthu"],
    "Skin allergy/rash": ["tholula thadippu", "arippu thaangala", "sivappaa thittu thittaa irukku", "padai maathiri irukku"],
    "Cold & cough": ["jalatosham", "mookku sali ozhuguthu", "thummal thummalaa varuthu", "lesaana irumal"],
    "Mild fever": ["lesaana juram", "kaichal kammiyaa irukku", "konjam soodaa irukku asathi"],
    "Routine check-up": ["marunthu theernthuduchu vaanganum", "sugar bp paakkanum", "report kaatta vanthen", "blood test edukkanum",
                         "follow up visit", "certificate vaanga vanthen"],
}

# Code-mixed: Tamil frames around the English medical words people say in the middle of a Tamil sentence
# ("எனக்கு chest pain இருக்கு"). The English part comes from the protocol's own short keywords.
MIX_FRAMES = ["எனக்கு {e} இருக்கு", "{e} வருது", "{e} ரொம்ப இருக்கு", "{who} {e}", "{e}, ரெண்டு நாளா", "டாக்டர், {e} இருக்கு",
              "{e} இருக்கு, தாங்க முடியல", "நேத்துல இருந்து {e}", "{e} ஆயிடுச்சு", "கொஞ்சம் {e} மாதிரி இருக்கு"]
