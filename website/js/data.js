// MedOS Web — reference data: hospitals (the five from medos/ambulance.py plus three more so the
// patient dashboard has a real choice), their doctors and ambulances, pickup areas and the demo queue.
// Hospital names are fictional; the coordinates are real places in Chennai.
"use strict";

const AREAS = {
  "T. Nagar": { lat: 13.0418, lng: 80.2341 },
  "Anna Nagar": { lat: 13.0850, lng: 80.2101 },
  "Guindy": { lat: 13.0067, lng: 80.2206 },
  "Adyar": { lat: 13.0012, lng: 80.2565 },
  "Velachery": { lat: 12.9791, lng: 80.2209 },
  "Porur": { lat: 13.0382, lng: 80.1565 },
  "Tambaram": { lat: 12.9249, lng: 80.1000 },
  "Perambur": { lat: 13.1143, lng: 80.2329 },
};

// er_wait: the waiting time each hospital reports for a walk-in (minutes). beds: free beds.
const HOSPITALS = [
  { id: 1, self: true, name: "City General Hospital", short: "City General", lat: 13.0358, lng: 80.2120, area: "Ashok Nagar",
    specialties: ["Emergency", "General Medicine", "Paediatrics", "Orthopaedics", "General Surgery"], beds: 8, er_wait: 25, ambulances: 2, phone: "044 2400 1000" },
  { id: 2, name: "Lakeview Heart & Neuro Institute", short: "Lakeview", lat: 13.0569, lng: 80.2425, area: "Nungambakkam",
    specialties: ["Emergency", "Cardiology", "Neurology", "General Medicine"], beds: 4, er_wait: 35, ambulances: 1, phone: "044 2400 2000" },
  { id: 3, name: "Riverside Trauma Centre", short: "Riverside", lat: 13.0732, lng: 80.1953, area: "Arumbakkam",
    specialties: ["Emergency", "Orthopaedics", "Burns", "General Surgery"], beds: 6, er_wait: 15, ambulances: 2, phone: "044 2400 3000" },
  { id: 4, name: "Green Park Clinic", short: "Green Park", lat: 13.0108, lng: 80.2390, area: "Kotturpuram",
    specialties: ["General Medicine", "ENT", "Dermatology", "Gastroenterology"], beds: 10, er_wait: 10, ambulances: 0, phone: "044 2400 4000" },
  { id: 5, name: "Sunrise Women & Children Hospital", short: "Sunrise", lat: 13.0215, lng: 80.1830, area: "Valasaravakkam",
    specialties: ["Emergency", "Paediatrics", "Obstetrics", "General Medicine"], beds: 5, er_wait: 30, ambulances: 1, phone: "044 2400 5000" },
  { id: 6, name: "Bayview Multispeciality Hospital", short: "Bayview", lat: 12.9905, lng: 80.2555, area: "Thiruvanmiyur",
    specialties: ["Emergency", "Cardiology", "Gastroenterology", "Pulmonology", "General Medicine"], beds: 7, er_wait: 20, ambulances: 1, phone: "044 2400 6000" },
  { id: 7, name: "Northgate Government Hospital", short: "Northgate", lat: 13.1080, lng: 80.2400, area: "Perambur",
    specialties: ["Emergency", "General Medicine", "General Surgery", "Orthopaedics", "Pulmonology"], beds: 12, er_wait: 40, ambulances: 2, phone: "044 2400 7000" },
  { id: 8, name: "Hilltop Community Hospital", short: "Hilltop", lat: 12.9480, lng: 80.1420, area: "Pallavaram",
    specialties: ["Emergency", "General Medicine", "ENT", "Dermatology", "Paediatrics"], beds: 9, er_wait: 18, ambulances: 1, phone: "044 2400 8000" },
];

// Doctors at the other hospitals (City General's doctors live in the scheduler state, as on the Pi).
const OTHER_DOCTORS = {
  2: [["Dr. Rohan Mehta", "Cardiology"], ["Dr. Sneha Pillai", "Cardiology"], ["Dr. Vikram Nair", "Neurology"], ["Dr. Aisha Khan", "Neurology"], ["Dr. Harini Gopal", "General Medicine"], ["Dr. Sanjay Rao", "Emergency Medicine"]],
  3: [["Dr. Imran Sheikh", "Orthopaedics"], ["Dr. Deepa Krishnan", "Orthopaedics"], ["Dr. Manoj Kumar", "General Surgery"], ["Dr. Leela Thomas", "Burns"], ["Dr. Naveen Raj", "Emergency Medicine"]],
  4: [["Dr. Kavitha Sundar", "General Medicine"], ["Dr. Ramesh Babu", "General Medicine"], ["Dr. Swathi Menon", "ENT"], ["Dr. Faizal Ahmed", "Dermatology"], ["Dr. Revathi Shankar", "Gastroenterology"]],
  5: [["Dr. Meera Venkat", "Obstetrics"], ["Dr. Lakshmi Prasad", "Obstetrics"], ["Dr. Nithya Ram", "Paediatrics"], ["Dr. Arvind Suresh", "Paediatrics"], ["Dr. Janani Bala", "General Medicine"], ["Dr. Kiran Joseph", "Emergency Medicine"]],
  6: [["Dr. Prakash Iyengar", "Cardiology"], ["Dr. Shalini Das", "Gastroenterology"], ["Dr. Ashok Varma", "Pulmonology"], ["Dr. Divya Raman", "General Medicine"], ["Dr. Gautham Selvan", "General Medicine"], ["Dr. Ritu Agarwal", "Emergency Medicine"]],
  7: [["Dr. Murugan Pandian", "General Medicine"], ["Dr. Selvi Arumugam", "General Medicine"], ["Dr. Ganesh Babu", "General Surgery"], ["Dr. Usha Rani", "Orthopaedics"], ["Dr. Bala Subramani", "Pulmonology"], ["Dr. Kumaravel S", "Emergency Medicine"], ["Dr. Anitha Jose", "General Medicine"]],
  8: [["Dr. Vasanth Kumar", "General Medicine"], ["Dr. Preethi Mohan", "ENT"], ["Dr. Saravanan R", "Dermatology"], ["Dr. Keerthana V", "Paediatrics"], ["Dr. Dinesh Karthik", "Emergency Medicine"]],
};

// Which doctor specialties can see a patient routed to a department.
const DEPT_SPECIALTIES = {
  "Emergency": ["Emergency Medicine", "General Medicine"],
  "General Medicine": ["General Medicine", "Emergency Medicine"],
  "General Surgery": ["General Surgery"],
  "Orthopaedics": ["Orthopaedics"],
  "Neurology": ["Neurology"],
  "Pulmonology": ["Pulmonology"],
  "Gastroenterology": ["Gastroenterology"],
  "ENT": ["ENT"],
  "Dermatology": ["Dermatology"],
  "Cardiology": ["Cardiology"],
  "Paediatrics": ["Paediatrics"],
  "Obstetrics": ["Obstetrics"],
  "Burns": ["Burns"],
};

const DEPARTMENTS = Object.keys(DEPT_SPECIALTIES);

// City General's staff and rooms, as seeded by medos/db.py.
const SEED_ROOMS = [["ER Bay 1", "emergency"], ["Room 1", "consultation"], ["Room 2", "consultation"], ["Room 3", "consultation"], ["Procedure Room", "procedure"]];
const SEED_DOCTORS = [["Dr. Ananya Rao", "Emergency Medicine", "ER Bay 1"], ["Dr. Karthik Menon", "General Medicine", "Room 1"],
  ["Dr. Priya Sharma", "Paediatrics", "Room 2"], ["Dr. Arjun Iyer", "Orthopaedics", "Room 3"]];

// Demo queue from medos/demo.py: name, age, sex, symptoms, vitals, minutes ago.
const DEMO_WAITING = [
  ["Lakshmi Narayanan", 67, "female", "Severe abdominal pain since morning, vomited twice", {}, 38],
  ["Rahul Verma", 24, "male", "Fell from bike, swelling and suspected fracture in left wrist", { pain: 7 }, 25],
  ["Fathima Begum", 34, "female", "Fever with chills for two days, feels very weak", { temp: 103.1 }, 31],
  ["Suresh Kumar", 45, "male", "Lower back pain after lifting a heavy box", {}, 52],
  ["Meena Iyer", 29, "female", "Sore throat and slight fever since yesterday", { temp: 99.8 }, 47],
  ["Arun Prakash", 8, "male", "Ear pain since last night, crying a lot", {}, 20],
  ["Divya Subramanian", 31, "female", "Itchy skin rash on both arms", {}, 58],
  ["Mohammed Irfan", 52, "male", "Routine check-up, blood pressure review", {}, 44],
  ["Kavya Reddy", 19, "female", "Mild asthma, wheezing since evening, inhaler helped a little", { spo2: 95 }, 12],
  ["Gopal Krishnan", 71, "male", "Cold and cough for four days", {}, 35],
  ["Priyanka Das", 27, "female", "Persistent vomiting since yesterday, feeling dizzy", {}, 9],
  ["Venkatesh Raman", 40, "male", "Migraine with nausea and light sensitivity", {}, 15],
];
const DEMO_EARLIER = [
  ["Chest pain radiating to left arm with sweating", { pulse: 118 }, "Admitted"], ["Cold and cough", {}, "Prescribed"],
  ["Stomach ache after food", {}, "Prescribed"], ["Fracture of right ankle after a fall", { pain: 8 }, "Referred"],
  ["Routine check-up", {}, "Discharged"], ["Sore throat", {}, "Prescribed"], ["High fever 102.8 for three days", { temp: 102.8 }, "Prescribed"],
  ["Back pain", {}, "Discharged"], ["Skin allergy after new soap", {}, "Prescribed"], ["Mild fever and body ache", { temp: 100.2 }, "Prescribed"],
  ["Severe headache since morning", {}, "Prescribed"], ["Ear pain", {}, "Prescribed"], ["Shortness of breath while walking", { spo2: 91 }, "Admitted"],
  ["Persistent vomiting and loose motion", {}, "Follow-up"], ["Follow up visit for diabetes", {}, "Discharged"], ["Cough with phlegm, suspected chest infection", { temp: 100.9 }, "Prescribed"],
];
const DEMO_NAMES = ["Anitha", "Balaji", "Charulatha", "Deepak", "Esther", "Farhan", "Geetha", "Harish", "Indira", "Jagan", "Kamala", "Lokesh", "Malini", "Naveen", "Oviya", "Pradeep", "Revathi", "Sanjay"];
const DEMO_MEDS = ["Paracetamol 500 mg, 1 tablet 3 times a day for 3 days", "Cetirizine 10 mg at night for 5 days",
  "ORS sachets, 1 after every loose motion; Ondansetron 4 mg if vomiting", "Amoxicillin 500 mg 3 times a day for 5 days",
  "Pantoprazole 40 mg before breakfast for 7 days", "Ibuprofen 400 mg twice a day after food for 3 days"];

// Example sentences for the voice and symptom boxes.
const SAMPLE_PHRASES = [
  "My name is Kavitha, I am 34 years old, high fever since two days",
  "This is Ravi Kumar, 58 years old, sudden chest pain and sweating",
  "I am Meena, 8 years old girl, ear pain since last night",
  "My name is Arjun, 45, lower back pain after lifting a box",
  "My father is 72 and he has difficulty breathing, lips turning blue",
];
