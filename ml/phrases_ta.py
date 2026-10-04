"""Tamil and Tanglish ways of describing each triage condition, for the synthetic training data.

TA: (spoken Tamil, English meaning) pairs. Everyday spoken Tamil as patients actually say it ("வலிக்குது",
"முடியல"), not formal written Tamil. The English halves let the model and the reports show what a Tamil
complaint means.
TL: Tanglish — Tamil written in English letters, as typed on phones or heard by an English recogniser.

Condition names match medos/triage.py DEFAULT_CONDITIONS exactly.
"""

TA = {
    "Chest pain / suspected heart attack": [
        ("நெஞ்சு வலிக்குது", "my chest is hurting"),
        ("நெஞ்சு ரொம்ப வலிக்குது, வியர்க்குது", "severe chest pain and sweating"),
        ("நெஞ்சுல பாரமா இருக்கு", "heaviness in the chest"),
        ("நெஞ்சு அடைக்குது", "chest feels tight and blocked"),
        ("இடது கை வலிக்குது, நெஞ்சு வலியும் இருக்கு", "left arm pain with chest pain"),
        ("நெஞ்சுல அழுத்தமா இருக்கு", "pressure in the chest"),
        ("மார்பு வலி தாங்க முடியல", "unbearable chest pain"),
        ("நெஞ்சு வலி தாடை வரைக்கும் பரவுது", "chest pain spreading to the jaw"),
        ("திடீர்னு நெஞ்சு வலி வந்துச்சு", "sudden chest pain"),
    ],
    "Breathing difficulty": [
        ("மூச்சு விட முடியல", "cannot breathe"),
        ("மூச்சு திணறுது", "gasping for breath"),
        ("மூச்சு வாங்குது, பேச முடியல", "breathless, cannot talk"),
        ("மூச்சு விட ரொம்ப கஷ்டமா இருக்கு", "very hard to breathe"),
        ("உதடு நீலமா ஆகுது, மூச்சு முடியல", "lips turning blue, cannot breathe"),
        ("மூச்சு இரைக்குது, நிக்கவே இல்லை", "breathlessness not stopping"),
        ("படுத்தா மூச்சு விட முடியல", "cannot breathe when lying down"),
    ],
    "Stroke signs": [
        ("ஒரு பக்கம் கை கால் செயலிழந்துடுச்சு", "one side arm and leg paralysed"),
        ("வாய் கோணிடுச்சு", "mouth has twisted to one side"),
        ("திடீர்னு பேச்சு குழறுது", "speech suddenly slurred"),
        ("வலது கை தூக்க முடியல, வாய் ஒரு பக்கம் சாஞ்சிருக்கு", "cannot lift right arm, mouth drooping"),
        ("பக்கவாதம் மாதிரி இருக்கு", "looks like a stroke"),
        ("திடீர்னு ஒரு பக்கம் உணர்ச்சியே இல்லை", "sudden numbness on one side"),
    ],
    "Unconscious / collapsed": [
        ("மயங்கி விழுந்துட்டாங்க", "fainted and fell down"),
        ("எழுப்புனாலும் எழுந்திருக்கல", "not waking up even when woken"),
        ("பேச்சு மூச்சு இல்லாம கிடக்கிறாரு", "lying unresponsive"),
        ("நினைவு இழந்துட்டாரு", "lost consciousness"),
        ("திடீர்னு மயக்கம் அடைஞ்சாங்க", "suddenly collapsed unconscious"),
        ("சுயநினைவு இல்லை", "unconscious"),
    ],
    "Severe bleeding": [
        ("ரத்தம் நிற்கவே இல்லை", "bleeding will not stop"),
        ("நிறைய ரத்தம் போகுது", "losing a lot of blood"),
        ("வெட்டுக்காயத்துல இருந்து ரத்தம் கொட்டுது", "blood pouring from the cut"),
        ("ரத்த வாந்தி எடுத்தாங்க", "vomited blood"),
        ("ரத்தம் நிக்கல", "bleeding not stopping"),
        ("அதிக ரத்தப்போக்கு, தலை சுத்துது", "heavy bleeding with dizziness"),
    ],
    "Seizure": [
        ("வலிப்பு வந்துச்சு", "had a seizure"),
        ("கை கால் இழுத்துக்கிட்டு வாயில நுரை வந்துச்சு", "limbs jerking with foam from the mouth"),
        ("ஜன்னி வந்துடுச்சு", "had convulsions"),
        ("பிட்ஸ் வந்து விழுந்துட்டான்", "had fits and fell"),
        ("குழந்தைக்கு வலிப்பு வருது", "the child is having fits"),
    ],
    "Severe allergic reaction": [
        ("இறால் சாப்பிட்டதும் தொண்டை வீங்கிடுச்சு", "throat swelled after eating prawns"),
        ("ஊசி போட்டதும் முகம் வீங்கி மூச்சு முடியல", "face swelled after an injection, cannot breathe"),
        ("தேனீ கொட்டி நாக்கு வீங்கிடுச்சு", "tongue swelled after a bee sting"),
        ("உடம்பு முழுக்க தடிப்பு, தொண்டை அடைக்குது", "rash all over and throat closing"),
        ("மாத்திரை போட்டதும் உதடு வீங்கி மூச்சு திணறுது", "lips swelled after a tablet, breathless"),
    ],
    "Major trauma": [
        ("ரோடு ஆக்சிடென்ட் ஆயிடுச்சு", "road accident"),
        ("பைக்ல இருந்து விழுந்து தலையில அடிபட்டுச்சு", "fell from the bike and hit the head"),
        ("மாடியில இருந்து விழுந்துட்டாரு", "fell from the terrace"),
        ("கத்தியால குத்திட்டாங்க", "stabbed with a knife"),
        ("லாரி மோதிடுச்சு", "hit by a lorry"),
        ("மரத்துல இருந்து விழுந்து முதுகுல அடி", "fell from a tree and hurt the back"),
    ],
    "Poisoning / bite / overdose": [
        ("பாம்பு கடிச்சுடுச்சு", "bitten by a snake"),
        ("பூச்சி மருந்து குடிச்சுட்டாரு", "drank pesticide"),
        ("நிறைய தூக்க மாத்திரை சாப்பிட்டுட்டாங்க", "took many sleeping pills"),
        ("தேள் கொட்டிடுச்சு", "stung by a scorpion"),
        ("குழந்தை மண்ணெண்ணெய் குடிச்சுடுச்சு", "the child drank kerosene"),
        ("எலி மருந்து சாப்பிட்டுட்டாரு", "ate rat poison"),
    ],
    "Severe burns / electric shock": [
        ("சூடு எண்ணெய் கொட்டி கை வெந்துடுச்சு", "hot oil spilled and burnt the hand"),
        ("கரண்ட் அடிச்சுடுச்சு", "got an electric shock"),
        ("தீக்காயம் பட்டுருச்சு, தோல் உரிஞ்சிடுச்சு", "burn injury, skin peeled off"),
        ("கேஸ் சிலிண்டர் வெடிச்சு முகம் வெந்துடுச்சு", "gas cylinder burst and burnt the face"),
        ("சுடு தண்ணி கொட்டி கால் வெந்துடுச்சு", "boiling water spilled and burnt the leg"),
    ],
    "Severe abdominal pain": [
        ("வயிறு தாங்க முடியாத அளவுக்கு வலிக்குது", "unbearable stomach pain"),
        ("வலது பக்கம் அடிவயிறு பயங்கரமா வலிக்குது", "terrible pain in the lower right abdomen"),
        ("வயிறு கல்லு மாதிரி இறுகி வலிக்குது", "stomach is rock hard and painful"),
        ("வயிற்று வலியால துடிக்கிறேன்", "writhing with stomach pain"),
        ("எனக்கு இப்போ ரொம்ப வயிறு வலிக்குது", "I have a lot of stomach pain now"),
        ("வயிறு ரொம்ப வலிக்குது, நிக்கவே இல்லை", "severe stomach pain that will not stop"),
    ],
    "Fracture": [
        ("கீழே விழுந்து கை எலும்பு உடைஞ்சிருச்சு போல", "fell and the arm bone seems broken"),
        ("கால் உடைஞ்சிருச்சு, நடக்க முடியல", "leg is broken, cannot walk"),
        ("மணிக்கட்டு வீங்கி திருப்ப முடியல", "wrist swollen, cannot turn it"),
        ("தோள்பட்டை விலகிடுச்சு", "shoulder dislocated"),
        ("விழுந்ததுல கணுக்கால் முறிஞ்சிருச்சு", "ankle broken in the fall"),
    ],
    "High fever (>102°F)": [
        ("ரொம்ப காய்ச்சல், உடம்பு நடுங்குது", "high fever with shivering"),
        ("103 டிகிரி காய்ச்சல்", "fever of 103 degrees"),
        ("குளிர் காய்ச்சல் ரெண்டு நாளா", "fever with chills for two days"),
        ("உடம்பு அனலா கொதிக்குது", "body is burning hot"),
        ("அதிக காய்ச்சல், உதறல் எடுக்குது", "high fever with rigors"),
    ],
    "Severe migraine/headache": [
        ("தலை வெடிக்கிற மாதிரி வலிக்குது", "head hurting as if it will burst"),
        ("ஒத்த தலைவலி, வெளிச்சம் பார்க்க முடியல", "migraine, cannot look at light"),
        ("தலைவலியோட வாந்தி வருது", "headache with vomiting"),
        ("தாங்க முடியாத தலைவலி", "unbearable headache"),
        ("ஒரு பக்கம் தலை துடிக்குது", "throbbing pain on one side of the head"),
    ],
    "Persistent vomiting": [
        ("நிக்காம வாந்தி வருது", "vomiting non-stop"),
        ("சாப்பிட்ட எல்லாம் வாந்தி ஆகுது", "vomiting everything I eat"),
        ("தண்ணி குடிச்சாலும் வாந்தி வருது", "vomiting even water"),
        ("காலையில இருந்து பத்து தடவை வாந்தி", "vomited ten times since morning"),
        ("வாந்தி நிற்கவே இல்லை", "vomiting will not stop"),
    ],
    "Asthma attack (mild)": [
        ("ஆஸ்துமா இழுப்பு கொஞ்சம் இருக்கு", "mild asthma wheeze"),
        ("மூச்சு விடும்போது விசில் சத்தம் வருது", "whistling sound while breathing"),
        ("இன்ஹேலர் போட்டும் கொஞ்சம் இழுக்குது", "a little wheezy even after the inhaler"),
        ("நெஞ்சு கொஞ்சம் இறுக்கமா, இழுப்பு இருக்கு", "slight chest tightness with wheezing"),
    ],
    "Chest infection": [
        ("சளியோட இருமல், மஞ்சள் கலர் கபம் வருது", "cough with yellow phlegm"),
        ("நெஞ்சு சளி கட்டிருக்கு, காய்ச்சலும் இருக்கு", "chest congestion with fever"),
        ("ஒரு வாரமா இருமல், பச்சை சளி வருது", "cough for a week with green mucus"),
        ("இருமும்போது நெஞ்சு சளி கரகரக்குது", "rattling chest phlegm when coughing"),
    ],
    "Back pain": [
        ("முதுகு வலிக்குது", "back pain"),
        ("பாரம் தூக்குனதுல இருந்து இடுப்பு வலி", "lower back pain since lifting a weight"),
        ("கழுத்து வலி, திருப்ப முடியல", "neck pain, cannot turn"),
        ("குனிஞ்சா முதுகு பிடிக்குது", "back catches when bending"),
    ],
    "Stomach pain (mild)": [
        ("லேசா வயிறு வலிக்குது", "mild stomach ache"),
        ("சாப்பிட்டதும் வயிறு உப்புசமா இருக்கு", "bloated after eating"),
        ("வயிறு எரியுது, அசிடிட்டி", "burning stomach, acidity"),
        ("லூஸ் மோஷன் போகுது", "loose motions"),
        ("வயித்து போக்கு ரெண்டு தடவை", "diarrhoea twice"),
        ("கொஞ்சம் வாந்தி வந்துச்சு", "vomited a little"),
    ],
    "Ear pain": [
        ("காது வலிக்குது", "ear pain"),
        ("காதுல இருந்து சீழ் வருது", "pus coming from the ear"),
        ("குழந்தை காதை பிடிச்சு அழுது", "child holding the ear and crying"),
        ("காது அடைச்ச மாதிரி வலிக்குது", "blocked, painful ear"),
    ],
    "Sore throat": [
        ("தொண்டை வலிக்குது, முழுங்க முடியல", "sore throat, painful to swallow"),
        ("தொண்டை கரகரப்பா இருக்கு", "scratchy throat"),
        ("டான்சில் வீக்கமா இருக்கு", "swollen tonsils"),
        ("சாப்பிடும்போது தொண்டை வலி", "throat pain when eating"),
    ],
    "Skin allergy/rash": [
        ("உடம்பு முழுக்க அரிக்குது", "itching all over the body"),
        ("கையில சிவப்பா தடிப்பு வந்திருக்கு", "red rash on the hand"),
        ("புது சோப்பு போட்டதும் அரிப்பு", "itching after a new soap"),
        ("முதுகுல சொறி வந்திருக்கு", "rash on the back"),
    ],
    "Cold & cough": [
        ("சளி பிடிச்சிருக்கு, இருமல் இருக்கு", "caught a cold with cough"),
        ("மூக்கு ஒழுகுது, தும்மல் வருது", "runny nose and sneezing"),
        ("லேசான இருமல், சளி", "mild cough and cold"),
        ("மூக்கடைப்பு, தொண்டை கட்டு", "blocked nose and hoarse throat"),
    ],
    "Mild fever": [
        ("லேசான காய்ச்சல்", "mild fever"),
        ("உடம்பு அசதியா இருக்கு, கொஞ்சம் காய்ச்சல்", "tired with slight fever"),
        ("உடம்பு வலி, காய்ச்சல் மாதிரி இருக்கு", "body ache, feels feverish"),
        ("ராத்திரி கொஞ்சம் சுரம் அடிச்சுது", "slight fever at night"),
    ],
    "Routine check-up": [
        ("சுகர் செக் பண்ணனும்", "need a sugar check"),
        ("பிபி செக்கப்புக்கு வந்தேன்", "came for a BP check-up"),
        ("மாசம் மருந்து வாங்க வந்தேன்", "came for monthly medicines"),
        ("ஃபிட்னஸ் சர்டிபிகேட் வேணும்", "need a fitness certificate"),
        ("தடுப்பூசி போடணும்", "need a vaccination"),
    ],
}

TA_UNCLASSIFIED = [("உடம்பு சரியில்லை", "not feeling well"), ("ரொம்ப சோர்வா இருக்கு", "feeling very tired"),
                   ("பசியே இல்லை", "no appetite"), ("தலை சுத்துது", "feeling dizzy"), ("மயக்கமா இருக்கு", "feeling faint"),
                   ("கால் குடைச்சல்", "aching legs"), ("தூக்கமே வரல", "cannot sleep")]

TL = {
    "Chest pain / suspected heart attack": ["nenju valikuthu", "nenju vali, viyarkuthu", "nenjula baarama irukku", "chest vali romba",
                                            "nenju adaikuthu"],
    "Breathing difficulty": ["moochu vida mudiyala", "moochu thinaruthu", "moochu vaanguthu", "moochu vida kashtama irukku"],
    "Stroke signs": ["vaai koniduchu", "pechu kuzharuthu", "oru pakkam kai kaal mudiyala", "pakkavatham maathiri irukku"],
    "Unconscious / collapsed": ["mayangi vizhunthutaanga", "ezhupunaalum ezhunthirukkala", "suyaninaivu illa"],
    "Severe bleeding": ["ratham nikkala", "niraya ratham poguthu", "ratha vaanthi eduthaanga"],
    "Seizure": ["valippu vanthuchu", "fits vanthuchu", "janni vanthuduchu"],
    "Severe allergic reaction": ["thondai veengiduchu", "mugam veengi moochu mudiyala", "naakku veengiduchu"],
    "Major trauma": ["accident aayiduchu", "thalaila adipattuchu", "maadila irunthu vizhunthutaaru", "kaththiyala kuthitaanga"],
    "Poisoning / bite / overdose": ["paambu kadichuduchu", "poochi marunthu kudichutaaru", "thel kottiduchu", "niraya maathirai saapitaanga"],
    "Severe burns / electric shock": ["current adichuduchu", "kai venthuduchu", "theekkaayam pattuchu"],
    "Severe abdominal pain": ["vayiru thaanga mudiyala", "adivayiru bayangarama valikuthu", "romba vayiru valikuthu"],
    "Fracture": ["kaal odanjiruchu", "elumbu odanjiruchu pola", "kai elumbu murinjiruchu"],
    "High fever (>102°F)": ["romba kaichal, udambu nadunguthu", "kulir kaichal", "udambu analaa kothikuthu"],
    "Severe migraine/headache": ["thala vedikkura maathiri valikuthu", "otha thalaivali", "thalaivali oda vaanthi"],
    "Persistent vomiting": ["nikkama vaanthi varuthu", "thanni kudichaalum vaanthi", "saapta ellaam vaanthi aaguthu"],
    "Asthma attack (mild)": ["izhuppu irukku", "inhaler pottum izhukuthu", "asthma konjam irukku"],
    "Chest infection": ["nenju sali kattiruku", "irumal oda kabam varuthu", "pachai sali varuthu"],
    "Back pain": ["muthugu valikuthu", "idupu vali", "kazhuththu vali"],
    "Stomach pain (mild)": ["lesa vayiru valikuthu", "vayiru eriyuthu", "loose motion poguthu"],
    "Ear pain": ["kaathu valikuthu", "kaathula seezh varuthu"],
    "Sore throat": ["thondai valikuthu", "thondai karakarappa irukku"],
    "Skin allergy/rash": ["udambu fulla arikuthu", "thadippu vanthiruku", "arippu"],
    "Cold & cough": ["sali pidichiruku", "mookku ozhuguthu", "irumal irukku"],
    "Mild fever": ["lesa kaichal", "udambu vali, kaichal maathiri", "konjam juram"],
    "Routine check-up": ["sugar check pannanum", "bp checkup", "maasa marunthu vaanga vanthen"],
}
TL_UNCLASSIFIED = ["udambu sariyilla", "romba sorva irukku", "pasiye illa", "thala suthuthu"]

# Sentence frames. {s} = the complaint, {d} = how long, {who} = who it's about.
TA_DURATIONS = ["ரெண்டு நாளா", "நேத்து ராத்திரியில இருந்து", "காலையில இருந்து", "ஒரு வாரமா", "ஒரு மணி நேரமா", "திடீர்னு",
                "இன்னைக்கு காலையில", "மூணு நாளா", ""]
TA_TEMPLATES = ["{s}", "{d} {s}", "எனக்கு {d} {s}", "{who} {d} {s}", "டாக்டர், {s}", "{s}, {extra}", "{d} {s}, {extra}"]
TA_WHO = ["அப்பாவுக்கு", "அம்மாவுக்கு", "என் பையனுக்கு", "என் பொண்ணுக்கு", "தாத்தாவுக்கு", "பாட்டிக்கு", "என் வீட்டுக்காரருக்கு"]
TA_EXTRAS = ["கொஞ்சம் இருமலும் இருக்கு", "உடம்பு சோர்வா இருக்கு", "சாப்பிட முடியல", "தூக்கம் வரல", "தலையும் லேசா வலிக்குது"]
TA_NEGATIONS = ["நெஞ்சு வலி இல்லை", "காய்ச்சல் இல்லை", "வாந்தி இல்லை", "மூச்சு திணறல் இல்லை", "ரத்தம் வரல"]

TL_DURATIONS = ["rendu naala", "nethu raathiri irunthu", "kaalaila irunthu", "oru vaarama", "thideernu", ""]
TL_TEMPLATES = ["{s}", "{d} {s}", "enakku {d} {s}", "{who} {d} {s}", "doctor, {s}"]
TL_WHO = ["appa ku", "amma ku", "en paiyanukku", "thaathaavukku", "paatti ku"]
