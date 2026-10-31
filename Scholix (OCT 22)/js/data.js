/* ============================================================
   Scholix — shared data layer
   Student store, built-in accounts, role rules, session helpers.
   Used by the dashboard and the sign-in page.
   ============================================================ */

export const STUDENTS_KEY = "scholix.students.v1";
export const SESSION_KEY = "scholix.session.v1";
export const PROFILES_KEY = "scholix.profiles.v1";
export const SECTIONS_KEY = "scholix.sections.v1";
const REQUIREMENT_FILES_DB = "scholix.requirement-files.v1";

export const GRADES = ["Grade 6", "Grade 7", "Grade 8", "Grade 9", "Grade 10", "Grade 11"];
export const SUBJECTS_BY_GRADE = {
  "Grade 6": ["English", "Mathematics", "Science", "Filipino", "Araling Panlipunan", "MAPEH"],
  "Grade 7": ["Mathematics", "English", "Science", "Filipino", "Araling Panlipunan", "Technology & Livelihood Education"],
  "Grade 8": ["Science", "Mathematics", "English", "Filipino", "Araling Panlipunan", "MAPEH"],
  "Grade 9": ["English", "Science", "Mathematics", "Filipino", "Araling Panlipunan", "Technology & Livelihood Education"],
  "Grade 10": ["Mathematics", "English", "Science", "Filipino", "Araling Panlipunan", "MAPEH"],
  "Grade 11": ["Oral Communication", "General Mathematics", "Earth Science", "Komunikasyon", "Personal Development", "Physical Education"]
};
export const FEE_ORDER = { Paid: 0, Partial: 1, Unpaid: 2 };
export const FEE_STATUSES = ["Paid", "Partial", "Unpaid"];
export const REQUIREMENT_STATUSES = ["Submitted", "Pending", "Missing"];
export const SCHOOL_REQUIREMENTS = [
  { key: "goodMoral", label: "Good Moral Certificate", office: "Guidance Office" },
  { key: "form137", label: "Form 137", office: "Registrar" },
  { key: "form138", label: "Form 138 report card", office: "Registrar" },
  { key: "psa", label: "PSA birth certificate", office: "Registrar" },
  { key: "medical", label: "Medical/dental clearance", office: "Clinic" },
  { key: "clearance", label: "Clearance form", office: "Registrar" }
];
export const AVATAR_TINTS = ["#E8EFFF", "#FFECE8", "#EAECFE", "#FDF3E2", "#E8F1FD", "#F3E9FB"];

const SEED_ROWS = [
  ["Aarav Mehta", "6A-001", "Grade 6", "Neha Mehta", "+1 415 555 0134", 96.4, "Paid", 0, "aarav.mehta@example.com", "2024-06-12"],
  ["Zoya Khan", "6A-002", "Grade 6", "Imran Khan", "+1 415 555 0177", 91.2, "Partial", 120, "zoya.khan@example.com", "2024-06-14"],
  ["Leo Fernandes", "6A-003", "Grade 6", "Maria Fernandes", "+1 628 555 0119", 87.5, "Unpaid", 480, "leo.fernandes@example.com", "2024-06-19"],
  ["Hana Suzuki", "6B-004", "Grade 6", "Kenji Suzuki", "+1 510 555 0163", 98.1, "Paid", 0, "hana.suzuki@example.com", "2024-06-21"],
  ["Daniel Okoro", "7A-005", "Grade 7", "Ada Okoro", "+1 415 555 0142", 78.9, "Partial", 260, "daniel.okoro@example.com", "2023-06-08"],
  ["Isabella Rossi", "7A-006", "Grade 7", "Marco Rossi", "+1 650 555 0188", 94.6, "Paid", 0, "isabella.rossi@example.com", "2023-06-11"],
  ["Nikhil Rao", "7A-007", "Grade 7", "Deepa Rao", "+1 408 555 0125", 82.3, "Unpaid", 640, "nikhil.rao@example.com", "2023-06-12"],
  ["Amelia Novak", "7B-008", "Grade 7", "Petra Novak", "+1 415 555 0198", 96.9, "Paid", 0, "amelia.novak@example.com", "2023-06-15"],
  ["Tomas Alvarez", "7B-009", "Grade 7", "Rosa Alvarez", "+1 925 555 0104", 69.4, "Unpaid", 720, "tomas.alvarez@example.com", "2024-01-09"],
  ["Chloe Dubois", "8A-010", "Grade 8", "Alice Dubois", "+1 415 555 0156", 93.1, "Paid", 0, "chloe.dubois@example.com", "2022-06-10"],
  ["Rohan Iyer", "8A-011", "Grade 8", "Sunita Iyer", "+1 510 555 0132", 88.7, "Partial", 180, "rohan.iyer@example.com", "2022-06-13"],
  ["Grace Mwangi", "8A-012", "Grade 8", "Peter Mwangi", "+1 415 555 0171", 97.3, "Paid", 0, "grace.mwangi@example.com", "2022-06-17"],
  ["Elias Berg", "8B-013", "Grade 8", "Freja Berg", "+1 650 555 0149", 74.8, "Unpaid", 520, "elias.berg@example.com", "2023-01-16"],
  ["Maya Goldstein", "8B-014", "Grade 8", "Dana Goldstein", "+1 628 555 0121", 90.5, "Paid", 0, "maya.goldstein@example.com", "2022-06-20"],
  ["Yusuf Demir", "9A-015", "Grade 9", "Ayla Demir", "+1 415 555 0186", 85.2, "Partial", 300, "yusuf.demir@example.com", "2021-06-09"],
  ["Priya Sharma", "9A-016", "Grade 9", "Vikram Sharma", "+1 408 555 0113", 99.1, "Paid", 0, "priya.sharma@example.com", "2021-06-11"],
  ["Liam O'Connor", "9A-017", "Grade 9", "Sean O'Connor", "+1 925 555 0158", 66.2, "Unpaid", 840, "liam.oconnor@example.com", "2022-09-05"],
  ["Fatima Noor", "9B-018", "Grade 9", "Sara Noor", "+1 415 555 0192", 92.8, "Paid", 0, "fatima.noor@example.com", "2021-06-14"],
  ["Jonas Weber", "10A-019", "Grade 10", "Klara Weber", "+1 510 555 0145", 89.9, "Paid", 0, "jonas.weber@example.com", "2020-06-10"],
  ["Anika Patel", "10A-020", "Grade 10", "Raj Patel", "+1 650 555 0167", 95.7, "Partial", 220, "anika.patel@example.com", "2020-06-12"],
  ["Samuel Adeyemi", "10A-021", "Grade 10", "Bola Adeyemi", "+1 415 555 0107", 71.5, "Unpaid", 960, "samuel.adeyemi@example.com", "2021-08-23"],
  ["Elena Petrova", "10B-022", "Grade 10", "Irina Petrova", "+1 628 555 0139", 97.8, "Paid", 0, "elena.petrova@example.com", "2020-06-16"],
  ["Kai Nakamura", "11A-023", "Grade 11", "Yuki Nakamura", "+1 408 555 0175", 84.4, "Partial", 400, "kai.nakamura@example.com", "2019-06-11"],
  ["Sofia Marchetti", "11A-024", "Grade 11", "Luca Marchetti", "+1 415 555 0128", 98.6, "Paid", 0, "sofia.marchetti@example.com", "2019-06-13"],
  ["Ahmed Farouk", "11B-025", "Grade 11", "Layla Farouk", "+1 925 555 0161", 76.9, "Unpaid", 1100, "ahmed.farouk@example.com", "2020-01-20"],
  ["Rebecca Lindqvist", "11B-026", "Grade 11", "Erik Lindqvist", "+1 510 555 0194", 93.6, "Paid", 0, "rebecca.lindqvist@example.com", "2019-06-18"]
];

/* ---------------- Role definitions & constraints ---------------- */
export const ROLES = {
  admin: {
    key: "admin",
    label: "Administrator",
    tagline: "Full control of student and school records",
    capabilities: [
      "Create, edit and delete any student record",
      "Manage sections, requirements and fee status",
      "Export the filtered roster to CSV",
      "See staff accounts and every grade at once"
    ],
    can: {
      createStudent: true,
      editStudent: true,
      deleteStudent: true,
      editAttendance: true,
      exportCsv: true,
      viewFeeAmounts: true,
      scopedRoster: false,
      ownRecordOnly: false,
      scopeGrades: null
    }
  },
  teacher: {
    key: "teacher",
    label: "Teacher",
    tagline: "Your sections and attendance",
    capabilities: [
      "See students in your assigned sections only",
      "Update attendance only within your sections",
      "Records are read-only — no adding or deleting",
      "Fee amounts stay hidden; status only"
    ],
    can: {
      createStudent: false,
      editStudent: false,
      deleteStudent: false,
      editAttendance: true,
      exportCsv: false,
      viewFeeAmounts: false,
      scopedRoster: true,
      ownRecordOnly: false,
      scopeGrades: ["Grade 7", "Grade 8"]
    }
  },
  student: {
    key: "student",
    label: "Student",
    tagline: "Your record and school requirements",
    capabilities: [
      "View your profile and guardian contact details",
      "Track your attendance percentage",
      "Check your fee status and document progress",
      "No access to any other student's record"
    ],
    can: {
      createStudent: false,
      editStudent: false,
      deleteStudent: false,
      editAttendance: false,
      exportCsv: false,
      viewFeeAmounts: true,
      scopedRoster: false,
      ownRecordOnly: true,
      scopeGrades: null
    }
  }
};

/* Built-in role accounts for the browser-based workspace. */
export const BUILT_IN_USERS = [
  {
    id: "u-admin",
    name: "Rosa Alvarez",
    email: "admin@scholix.demo",
    password: "admin123",
    role: "admin",
    title: "Registrar · Riverton Campus",
    studentRoll: null,
    grades: null
  },
  {
    id: "u-teacher",
    name: "Marcus Bell",
    email: "teacher@scholix.demo",
    password: "teacher123",
    role: "teacher",
    title: "Class teacher · Grades 7 & 8",
    studentRoll: null,
    grades: ["Grade 7", "Grade 8"]
  },
  {
    id: "u-student",
    name: "Aarav Mehta",
    email: "student@scholix.demo",
    password: "student123",
    role: "student",
    title: "Student · Grade 6",
    studentRoll: "6A-001",
    grades: null
  }
];

/* ---------------- Student store ---------------- */
export function seedStudents() {
  return SEED_ROWS.map((row, i) => ({
    id: i + 1,
    name: row[0],
    roll: row[1],
    grade: row[2],
    guardian: row[3],
    phone: row[4],
    attendance: row[5],
    feeStatus: row[6],
    due: row[7],
    email: row[8],
    enrolled: row[9],
    absences: 0,
    lateArrivals: 0,
    subjectScores: seedSubjectScores(i + 1, row[2]),
    requirements: defaultRequirements(i + 1)
  }));
}

export function seedSubjectScores(studentId, grade, existingScores = {}) {
  const subjects = SUBJECTS_BY_GRADE[grade] || SUBJECTS_BY_GRADE["Grade 6"];
  const storedScores = existingScores && typeof existingScores === "object" ? existingScores : {};
  const id = Number.isFinite(Number(studentId)) ? Number(studentId) : 1;
  return Object.fromEntries(subjects.map((subject, index) => {
    const storedScore = storedScores[subject];
    const existingScore = storedScore == null || (typeof storedScore === "string" && !storedScore.trim())
      ? NaN
      : Number(storedScore);
    const score = Number.isInteger(existingScore) && existingScore >= 0 && existingScore <= 100
      ? existingScore
      : 78 + ((id * 7 + index * 11) % 23);
    return [subject, score];
  }));
}

function defaultRequirements(seed) {
  const statuses = ["Submitted", "Pending", "Missing"];
  return Object.fromEntries(SCHOOL_REQUIREMENTS.map((requirement, index) => {
    const status = statuses[(seed + index) % statuses.length];
    return [requirement.key, {
      status,
      note: status === "Submitted" ? "Received by the office." : "Please upload here or submit to the handling office."
    }];
  }));
}

export function loadStudents() {
  try {
    const raw = localStorage.getItem(STUDENTS_KEY);
    if (!raw) return seedStudents();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length) return seedStudents();
    let recordsUpdated = false;
    const students = parsed.map((student, index) => {
      const subjectScores = seedSubjectScores(student.id || index + 1, student.grade, student.subjectScores);
      if (JSON.stringify(subjectScores) !== JSON.stringify(student.subjectScores || {})) recordsUpdated = true;
      const defaults = defaultRequirements(student.id || index + 1);
      const existingRequirements = student.requirements || defaults;
      const requirements = Object.fromEntries(SCHOOL_REQUIREMENTS.map((requirement) => {
        const record = existingRequirements[requirement.key] || defaults[requirement.key];
        if (record.note === "Please submit to the handling office.") {
          recordsUpdated = true;
          return [requirement.key, { ...record, note: "Please upload here or submit to the handling office." }];
        }
        return [requirement.key, record];
      }));
      return {
        ...student,
        absences: Number.isInteger(student.absences) && student.absences >= 0 ? student.absences : 0,
        lateArrivals: Number.isInteger(student.lateArrivals) && student.lateArrivals >= 0 ? student.lateArrivals : 0,
        subjectScores,
        requirements
      };
    });
    if (recordsUpdated && !saveStudents(students)) {
      console.error("Existing student records could not be updated in browser storage.");
    }
    return students;
  } catch (err) {
    return seedStudents();
  }
}

export function saveStudents(students) {
  try {
    localStorage.setItem(STUDENTS_KEY, JSON.stringify(students));
    return true;
  } catch (err) {
    return false;
  }
}

export function loadSections() {
  try {
    const raw = localStorage.getItem(SECTIONS_KEY);
    if (!raw) return seedSections();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("Stored sections must be an array.");
    return parsed;
  } catch (err) {
    return seedSections();
  }
}

export function saveSections(sections) {
  try {
    localStorage.setItem(SECTIONS_KEY, JSON.stringify(sections));
    return true;
  } catch (err) {
    return false;
  }
}

export function seedSections() {
  return GRADES.flatMap((grade, index) => {
    const number = grade.replace("Grade ", "");
    return ["A", "B"].map((code, sectionIndex) => ({
      id: `${number}${code}`,
      code: `${number}${code}`,
      grade,
      room: `Room ${101 + index * 2 + sectionIndex}`,
      adviserId: number === "7" || number === "8" ? "u-teacher" : "u-admin"
    }));
  });
}

function openRequirementFilesDb() {
  if (!("indexedDB" in window)) {
    return Promise.reject(new Error("Document storage is unavailable in this browser."));
  }
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(REQUIREMENT_FILES_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("files")) db.createObjectStore("files", { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open document storage."));
  });
}

function requirementFileKey(roll, requirementKey) {
  return `${roll}:${requirementKey}`;
}

export async function saveRequirementFile(roll, requirementKey, file) {
  const db = await openRequirementFilesDb();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction("files", "readwrite");
      transaction.objectStore("files").put({
        key: requirementFileKey(roll, requirementKey),
        blob: file,
        name: file.name,
        type: file.type
      });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("Could not save the uploaded document."));
      transaction.onabort = () => reject(transaction.error || new Error("Document storage cancelled the upload."));
    });
  } finally {
    db.close();
  }
}

export async function loadRequirementFile(roll, requirementKey) {
  const db = await openRequirementFilesDb();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction("files", "readonly");
      const request = transaction.objectStore("files").get(requirementFileKey(roll, requirementKey));
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error("Could not read the uploaded document."));
    });
  } finally {
    db.close();
  }
}

export async function removeRequirementFile(roll, requirementKey) {
  const db = await openRequirementFilesDb();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction("files", "readwrite");
      transaction.objectStore("files").delete(requirementFileKey(roll, requirementKey));
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("Could not remove the uploaded document."));
      transaction.onabort = () => reject(transaction.error || new Error("Document storage cancelled the removal."));
    });
  } finally {
    db.close();
  }
}

function loadProfiles() {
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    if (!raw) return {};
    const profiles = JSON.parse(raw);
    return profiles && typeof profiles === "object" && !Array.isArray(profiles) ? profiles : {};
  } catch (err) {
    return {};
  }
}

export function profileFor(user) {
  const savedProfile = loadProfiles()[user.id] || {};
  const profile = { ...user, ...savedProfile };
  const savedEmail = typeof savedProfile.email === "string" ? savedProfile.email.trim() : "";
  const email = !savedEmail || savedEmail.toLowerCase().endsWith(".demo") ? user.email : savedEmail;
  return { ...profile, email, id: user.id, role: user.role, password: user.password, studentRoll: user.studentRoll, grades: user.grades };
}

export function saveProfile(userId, profile) {
  try {
    const profiles = loadProfiles();
    profiles[userId] = profile;
    localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
    return true;
  } catch (err) {
    return false;
  }
}

/* ---------------- Session ---------------- */
export function writeSession(user, remember) {
  const payload = JSON.stringify({ userId: user.id, role: user.role, at: Date.now() });
  clearSession();
  try {
    if (remember) localStorage.setItem(SESSION_KEY, payload);
    else sessionStorage.setItem(SESSION_KEY, payload);
  } catch (err) {
    /* storage unavailable — session simply won't persist */
  }
}

export function readSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
  } catch (err) {
    /* ignore */
  }
}

export function currentUser() {
  const session = readSession();
  if (!session) return null;
  const user = BUILT_IN_USERS.find((u) => u.id === session.userId);
  return user ? profileFor(user) : null;
}

/** Redirects away from protected pages when there is no valid session. */
export function requireUser(redirect = "./login.html") {
  const user = currentUser();
  if (!user) {
    window.location.replace(redirect);
    return null;
  }
  return user;
}

export function authenticate(email, password) {
  const clean = String(email || "").trim().toLowerCase();
  const user = BUILT_IN_USERS.find((item) => profileFor(item).email.toLowerCase() === clean && item.password === password);
  return user ? profileFor(user) : null;
}

/** Resolves the effective permission set: role rules, narrowed by the user's own scope. */
export function resolvePermissions(user) {
  const role = ROLES[user.role];
  const scopeGrades = user.grades && user.grades.length ? user.grades : role.can.scopeGrades;
  return { ...role.can, scopeGrades: scopeGrades || null };
}

/* ---------------- Pure helpers ---------------- */
export function initials(name) {
  return String(name)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

export function tintFor(name) {
  let hash = 0;
  const text = String(name);
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) % 997;
  return AVATAR_TINTS[hash % AVATAR_TINTS.length];
}

export function avatarHtml(name, extraClass = "", image = "") {
  return `<span class="avatar ${extraClass}" aria-hidden="true" style="background-color:${tintFor(name)}">${image ? `<img class="avatar__image" src="${escapeHtml(image)}" alt="" />` : initials(name)}</span>`;
}

export function money(value) {
  return `$${Number(value || 0).toLocaleString("en-US")}`;
}

export function formatDate(iso) {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[ch]);
}

export function statusPill(status) {
  const cls = status === "Paid" ? "pill--paid" : status === "Partial" ? "pill--partial" : "pill--unpaid";
  return `<span class="pill ${cls}">${escapeHtml(status)}</span>`;
}

export function attendanceBar(value) {
  const fill = value >= 85 ? "track__fill--attendance-good" : value >= 75 ? "track__fill--attendance-mid" : "track__fill--coral";
  return `<div class="attend">
      <span class="attend__val">${Number(value).toFixed(1)}%</span>
      <span class="track" style="flex:1"><i class="track__fill ${fill}" style="--w:${value}%"></i></span>
    </div>`;
}

export function filterStudents(list, { query = "", grade = "all", status = "all" } = {}) {
  const q = String(query).trim().toLowerCase();
  return list.filter((s) => {
    if (grade !== "all" && s.grade !== grade) return false;
    if (status !== "all" && s.feeStatus !== status) return false;
    if (!q) return true;
    return [s.name, s.roll, s.guardian, s.email, s.grade, s.phone]
      .join(" ")
      .toLowerCase()
      .includes(q);
  });
}

export function sortStudents(list, key, dir) {
  const factor = dir === "asc" ? 1 : -1;
  return [...list].sort((a, b) => {
    switch (key) {
      case "roll":
        return a.roll.localeCompare(b.roll, undefined, { numeric: true }) * factor;
      case "grade":
        return (GRADES.indexOf(a.grade) - GRADES.indexOf(b.grade)) * factor;
      case "attendance":
        return (a.attendance - b.attendance) * factor;
      case "feeStatus":
        return (FEE_ORDER[a.feeStatus] - FEE_ORDER[b.feeStatus]) * factor;
      case "due":
        return (a.due - b.due) * factor;
      default:
        return a.name.localeCompare(b.name) * factor;
    }
  });
}

export function summarize(list) {
  const total = list.length;
  const average = total ? list.reduce((sum, s) => sum + s.attendance, 0) / total : 0;
  const withDues = list.filter((s) => s.due > 0);
  return {
    total,
    average,
    grades: new Set(list.map((s) => s.grade)).size,
    duesCount: withDues.length,
    duesTotal: withDues.reduce((sum, s) => sum + s.due, 0),
    paid: list.filter((s) => s.feeStatus === "Paid").length,
    partial: list.filter((s) => s.feeStatus === "Partial").length,
    unpaid: list.filter((s) => s.feeStatus === "Unpaid").length,
    low: list.filter((s) => s.attendance < 85).length
  };
}

export function escapeCsv(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}
