/* ============================================================
   Scholix — shared data layer
   Student store, built-in accounts, role rules, session helpers.
   Used by the dashboard and the sign-in page.
   ============================================================ */

export const STUDENTS_KEY = "scholix.students.v1";
export const SESSION_KEY = "scholix.session.v1";
export const PROFILES_KEY = "scholix.profiles.v1";
export const SECTIONS_KEY = "scholix.sections.v1";
function apiRequest(action, method = "GET", payload = null, query = "") {
  try {
    const request = new XMLHttpRequest();
    request.open(method, `../api.php?action=${encodeURIComponent(action)}${query}`, false);
    request.setRequestHeader("Accept", "application/json");
    if (payload !== null) request.setRequestHeader("Content-Type", "application/json");
    request.send(payload === null ? null : JSON.stringify(payload));
    const result = JSON.parse(request.responseText || "{}");
    return request.status >= 200 && request.status < 300 ? result : null;
  } catch (error) {
    console.error("Scholix server request failed.", error);
    return null;
  }
}

function normalizeSampleEmail(email) {
  if (typeof email !== "string") return email;
  return email.replace(/@(example\.com|scholix\.demo)$/i, "@scholix.com");
}

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
  ["Aarav Mehta", "6A-001", "Grade 6", "Neha Mehta", "+1 415 555 0134", 96.4, "Paid", 0, "aarav.mehta@scholix.com", "2024-06-12"],
  ["Zoya Khan", "6A-002", "Grade 6", "Imran Khan", "+1 415 555 0177", 91.2, "Partial", 120, "zoya.khan@scholix.com", "2024-06-14"],
  ["Leo Fernandes", "6A-003", "Grade 6", "Maria Fernandes", "+1 628 555 0119", 87.5, "Unpaid", 480, "leo.fernandes@scholix.com", "2024-06-19"],
  ["Hana Suzuki", "6B-004", "Grade 6", "Kenji Suzuki", "+1 510 555 0163", 98.1, "Paid", 0, "hana.suzuki@scholix.com", "2024-06-21"],
  ["Daniel Okoro", "7A-005", "Grade 7", "Ada Okoro", "+1 415 555 0142", 78.9, "Partial", 260, "daniel.okoro@scholix.com", "2023-06-08"],
  ["Isabella Rossi", "7A-006", "Grade 7", "Marco Rossi", "+1 650 555 0188", 94.6, "Paid", 0, "isabella.rossi@scholix.com", "2023-06-11"],
  ["Nikhil Rao", "7A-007", "Grade 7", "Deepa Rao", "+1 408 555 0125", 82.3, "Unpaid", 640, "nikhil.rao@scholix.com", "2023-06-12"],
  ["Amelia Novak", "7B-008", "Grade 7", "Petra Novak", "+1 415 555 0198", 96.9, "Paid", 0, "amelia.novak@scholix.com", "2023-06-15"],
  ["Tomas Alvarez", "7B-009", "Grade 7", "Rosa Alvarez", "+1 925 555 0104", 69.4, "Unpaid", 720, "tomas.alvarez@scholix.com", "2024-01-09"],
  ["Chloe Dubois", "8A-010", "Grade 8", "Alice Dubois", "+1 415 555 0156", 93.1, "Paid", 0, "chloe.dubois@scholix.com", "2022-06-10"],
  ["Rohan Iyer", "8A-011", "Grade 8", "Sunita Iyer", "+1 510 555 0132", 88.7, "Partial", 180, "rohan.iyer@scholix.com", "2022-06-13"],
  ["Grace Mwangi", "8A-012", "Grade 8", "Peter Mwangi", "+1 415 555 0171", 97.3, "Paid", 0, "grace.mwangi@scholix.com", "2022-06-17"],
  ["Elias Berg", "8B-013", "Grade 8", "Freja Berg", "+1 650 555 0149", 74.8, "Unpaid", 520, "elias.berg@scholix.com", "2023-01-16"],
  ["Maya Goldstein", "8B-014", "Grade 8", "Dana Goldstein", "+1 628 555 0121", 90.5, "Paid", 0, "maya.goldstein@scholix.com", "2022-06-20"],
  ["Yusuf Demir", "9A-015", "Grade 9", "Ayla Demir", "+1 415 555 0186", 85.2, "Partial", 300, "yusuf.demir@scholix.com", "2021-06-09"],
  ["Priya Sharma", "9A-016", "Grade 9", "Vikram Sharma", "+1 408 555 0113", 99.1, "Paid", 0, "priya.sharma@scholix.com", "2021-06-11"],
  ["Liam O'Connor", "9A-017", "Grade 9", "Sean O'Connor", "+1 925 555 0158", 66.2, "Unpaid", 840, "liam.oconnor@scholix.com", "2022-09-05"],
  ["Fatima Noor", "9B-018", "Grade 9", "Sara Noor", "+1 415 555 0192", 92.8, "Paid", 0, "fatima.noor@scholix.com", "2021-06-14"],
  ["Jonas Weber", "10A-019", "Grade 10", "Klara Weber", "+1 510 555 0145", 89.9, "Paid", 0, "jonas.weber@scholix.com", "2020-06-10"],
  ["Anika Patel", "10A-020", "Grade 10", "Raj Patel", "+1 650 555 0167", 95.7, "Partial", 220, "anika.patel@scholix.com", "2020-06-12"],
  ["Samuel Adeyemi", "10A-021", "Grade 10", "Bola Adeyemi", "+1 415 555 0107", 71.5, "Unpaid", 960, "samuel.adeyemi@scholix.com", "2021-08-23"],
  ["Elena Petrova", "10B-022", "Grade 10", "Irina Petrova", "+1 628 555 0139", 97.8, "Paid", 0, "elena.petrova@scholix.com", "2020-06-16"],
  ["Kai Nakamura", "11A-023", "Grade 11", "Yuki Nakamura", "+1 408 555 0175", 84.4, "Partial", 400, "kai.nakamura@scholix.com", "2019-06-11"],
  ["Sofia Marchetti", "11A-024", "Grade 11", "Luca Marchetti", "+1 415 555 0128", 98.6, "Paid", 0, "sofia.marchetti@scholix.com", "2019-06-13"],
  ["Ahmed Farouk", "11B-025", "Grade 11", "Layla Farouk", "+1 925 555 0161", 76.9, "Unpaid", 1100, "ahmed.farouk@scholix.com", "2020-01-20"],
  ["Rebecca Lindqvist", "11B-026", "Grade 11", "Erik Lindqvist", "+1 510 555 0194", 93.6, "Paid", 0, "rebecca.lindqvist@scholix.com", "2019-06-18"]
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
    email: "admin@scholix.com",
    role: "admin",
    title: "Registrar · Riverton Campus",
    studentRoll: null,
    grades: null
  },
  {
    id: "u-teacher",
    name: "Marcus Bell",
    email: "teacher@scholix.com",
    role: "teacher",
    title: "Class teacher · Grades 7 & 8",
    studentRoll: null,
    grades: ["Grade 7", "Grade 8"]
  },
  {
    id: "u-student",
    name: "Aarav Mehta",
    email: "student@scholix.com",
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
  const result = apiRequest("get", "GET", null, "&key=students");
  let students = Array.isArray(result?.value) ? result.value : seedStudents();
  const account = currentUser();
  if (account?.role === "teacher") students = students.filter((student) => (account.grades || []).includes(student.grade));
  if (account?.role === "student") students = students.filter((student) => student.roll === account.studentRoll);
  return students.map((student, index) => {
    const subjectScores = seedSubjectScores(student.id || index + 1, student.grade, student.subjectScores);
    const defaults = defaultRequirements(student.id || index + 1);
    const existingRequirements = student.requirements || defaults;
    const requirements = Object.fromEntries(SCHOOL_REQUIREMENTS.map((requirement) => [
      requirement.key,
      existingRequirements[requirement.key] || defaults[requirement.key]
    ]));
    return {
      ...student,
      email: normalizeSampleEmail(student.email),
      absences: Number.isInteger(student.absences) && student.absences >= 0 ? student.absences : 0,
      lateArrivals: Number.isInteger(student.lateArrivals) && student.lateArrivals >= 0 ? student.lateArrivals : 0,
      subjectScores,
      requirements
    };
  });
}

export function saveStudents(students) {
  return Boolean(apiRequest("save", "POST", { key: "students", value: students }));
}

export function loadSections() {
  const result = apiRequest("get", "GET", null, "&key=sections");
  return Array.isArray(result?.value) ? result.value : seedSections();
}

export function saveSections(sections) {
  return Boolean(apiRequest("save", "POST", { key: "sections", value: sections }));
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

function requestRequirementFile(action, method, { roll, requirementKey, file } = {}) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(method, `../api.php?action=${action}`, true);
    if (action.startsWith("file")) {
      request.responseType = "blob";
      request.onload = () => {
        if (request.status < 200 || request.status >= 300) return reject(new Error("The uploaded document could not be found."));
        const blob = request.response;
        const encodedName = request.getResponseHeader("X-File-Name") || "document";
        resolve({ blob, name: decodeURIComponent(encodedName), type: blob.type });
      };
      request.onerror = () => reject(new Error("The document could not be downloaded."));
      request.send();
      return;
    }
    request.onload = () => {
      let result = {};
      try { result = JSON.parse(request.responseText || "{}"); } catch { /* keep the generic response below */ }
      if (request.status < 200 || request.status >= 300) return reject(new Error(result.error || "The document request failed."));
      resolve(result);
    };
    request.onerror = () => reject(new Error("The document request could not reach the server."));
    if (action === "upload") {
      const form = new FormData();
      form.append("roll", roll);
      form.append("requirement", requirementKey);
      form.append("file", file, file.name);
      request.send(form);
    } else {
      request.setRequestHeader("Content-Type", "application/json");
      request.send(JSON.stringify({ roll, requirement: requirementKey }));
    }
  });
}

export async function saveRequirementFile(roll, requirementKey, file) {
  await requestRequirementFile("upload", "POST", { roll, requirementKey, file });
}

export async function loadRequirementFile(roll, requirementKey) {
  return requestRequirementFile(`file&roll=${encodeURIComponent(roll)}&requirement=${encodeURIComponent(requirementKey)}`, "GET");
}

export async function removeRequirementFile(roll, requirementKey) {
  await requestRequirementFile("delete_file", "POST", { roll, requirementKey });
}
function loadProfiles() {
  const result = apiRequest("get", "GET", null, "&key=profiles");
  return result?.value && typeof result.value === "object" ? result.value : {};
}

export function profileFor(user) {
  const savedProfile = loadProfiles()[user.id] || {};
  return { ...user, ...savedProfile, id: user.id, role: user.role, studentRoll: user.studentRoll, grades: user.grades };
}

export function saveProfile(userId, profile) {
  return Boolean(apiRequest("save", "POST", { key: "profiles", value: {}, profile }));
}

/* ---------------- Session ---------------- */
export function writeSession(user, remember) {
  // PHP has already established the authenticated session in authenticate().
}

export function readSession() {
  return apiRequest("session")?.user || null;
}

export function clearSession() {
  apiRequest("logout", "POST", {});
}

export function currentUser() {
  const account = readSession();
  return account ? profileFor(account) : null;
}
/** Redirects away from protected pages when there is no valid session. */
export function requireUser(redirect = "./login.php") {
  const user = currentUser();
  if (!user) {
    window.location.replace(redirect);
    return null;
  }
  return user;
}

export async function authenticate(email, password, remember = false) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch("../api.php?action=login", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ email, password, remember }),
      signal: controller.signal
    });
    let result = {};
    try { result = await response.json(); } catch { /* handled below */ }
    if (response.status === 401) return null;
    if (!response.ok) throw new Error(result.error || "The server could not complete the sign-in request.");
    return result?.user || null;
  } finally {
    window.clearTimeout(timeout);
  }
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






