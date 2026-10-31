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

const systemConfig = apiRequest("config")?.value || {};

function normalizeSampleEmail(email) {
  if (typeof email !== "string") return email;
  return email.replace(/@(example\.com|scholix\.demo)$/i, "@scholix.com");
}

export const GRADES = Array.isArray(systemConfig.grades) ? systemConfig.grades : [];
export const SUBJECTS_BY_GRADE = systemConfig.subjectsByGrade && typeof systemConfig.subjectsByGrade === "object" ? systemConfig.subjectsByGrade : {};
export const FEE_STATUSES = Array.isArray(systemConfig.feeStatuses) ? systemConfig.feeStatuses : [];
export const FEE_ORDER = Object.fromEntries(FEE_STATUSES.map((status, index) => [status, index]));
export const REQUIREMENT_STATUSES = Array.isArray(systemConfig.requirementStatuses) ? systemConfig.requirementStatuses : [];
export const SCHOOL_REQUIREMENTS = Array.isArray(systemConfig.schoolRequirements) ? systemConfig.schoolRequirements : [];
export const AVATAR_TINTS = Array.isArray(systemConfig.avatarTints) ? systemConfig.avatarTints : [];
export const REQUIREMENT_NOTE_OPTIONS = Array.isArray(systemConfig.requirementNoteOptions) ? systemConfig.requirementNoteOptions : [];
export const CLASS_PERIODS = Array.isArray(systemConfig.classPeriods) ? systemConfig.classPeriods : [];
export const FEE_CATEGORIES = Array.isArray(systemConfig.feeCategories) ? systemConfig.feeCategories : [];
export const FEE_SCHEDULE = systemConfig.feeSchedule && typeof systemConfig.feeSchedule === "object" ? systemConfig.feeSchedule : {};
export const ATTENDANCE_WEEKDAYS = Array.isArray(systemConfig.attendanceWeekdays) ? systemConfig.attendanceWeekdays : [];
export const ATTENDANCE_WEEKDAYS_SHORT = Array.isArray(systemConfig.attendanceWeekdaysShort) ? systemConfig.attendanceWeekdaysShort : [];
export const ATTENDANCE_STATUSES = Array.isArray(systemConfig.attendanceStatuses) ? systemConfig.attendanceStatuses : [];
export const SCHOOL_DAYS_PER_YEAR = Number(systemConfig.schoolDaysPerYear) || 0;
export const DEFAULT_SUBMITTED_NOTE = String(systemConfig.defaultSubmittedNote || "");
export const DEFAULT_REQUIREMENT_NOTE = String(systemConfig.defaultRequirementNote || "");

// Student records are loaded from SQL through the PHP API; there is no browser-side roster seed.

/* Permission checks remain application logic; role labels and descriptions come from SQL. */
const rolePermissions = {
  admin: { createStudent: true, editStudent: true, deleteStudent: true, editAttendance: true, exportCsv: true, viewFeeAmounts: true, scopedRoster: false, ownRecordOnly: false, scopeGrades: null },
  teacher: { createStudent: false, editStudent: false, deleteStudent: false, editAttendance: true, exportCsv: false, viewFeeAmounts: false, scopedRoster: true, ownRecordOnly: false, scopeGrades: Array.isArray(systemConfig.teacherScopeGrades) ? systemConfig.teacherScopeGrades : [] },
  student: { createStudent: false, editStudent: false, deleteStudent: false, editAttendance: false, exportCsv: false, viewFeeAmounts: true, scopedRoster: false, ownRecordOnly: true, scopeGrades: null }
};
export const ROLES = Object.fromEntries(Object.entries(rolePermissions).map(([key, permissions]) => [
  key,
  { key, ...(systemConfig.roles?.[key] || {}), can: permissions }
]));

/* Account details are loaded from SQL's users table. */
export const BUILT_IN_USERS = apiRequest("accounts")?.value || [];

/* ---------------- Student store ---------------- */
export function seedStudents() {
  return [];
}

export function seedSubjectScores(studentId, grade, existingScores = {}) {
  const subjects = SUBJECTS_BY_GRADE[grade] || Object.values(SUBJECTS_BY_GRADE)[0] || [];
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
  const statuses = REQUIREMENT_STATUSES;
  return Object.fromEntries(SCHOOL_REQUIREMENTS.map((requirement, index) => {
    const status = statuses[(seed + index) % statuses.length];
    return [requirement.key, {
      status,
      note: status === "Submitted" ? DEFAULT_SUBMITTED_NOTE : DEFAULT_REQUIREMENT_NOTE
    }];
  }));
}

export function loadStudents() {
  const result = apiRequest("get", "GET", null, "&key=students");
  let students = Array.isArray(result?.value) ? result.value : [];
  const account = currentUser();
  if (account?.role === "teacher") {
    const assignedSections = loadSections().filter((section) => String(section.adviserId) === String(account.id));
    students = students.filter((student) => {
      const match = String(student.roll || "").match(/^(\d+[A-Z])/i);
      return Boolean(match && assignedSections.some((section) => section.code === match[1].toUpperCase() && section.grade === student.grade));
    });
  }
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

export function assignStudentsToSection(sectionCode, studentIds) {
  return apiRequest("assign_students", "POST", { sectionCode, studentIds });
}

export function saveStudents(students) {
  return Boolean(apiRequest("save", "POST", { key: "students", value: students }));
}

export function loadSections() {
  const result = apiRequest("get", "GET", null, "&key=sections");
  return Array.isArray(result?.value) ? result.value : seedAppData().sections;
}

export function saveSections(sections) {
  return Boolean(apiRequest("save", "POST", { key: "sections", value: sections }));
}
export function seedSections() {
  return [];
}

// Keep non-student browser defaults aligned with the SQL app_data rows.
export function seedAppData() {
  return {
    students: [],
    sections: [],
    profiles: {}
  };
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
  return result?.value && typeof result.value === "object" ? result.value : seedAppData().profiles;
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

export function authenticate(email, password, remember = false) {
  const result = apiRequest("login", "POST", { email, password, remember });
  return result?.user || null;
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
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(Number(value || 0));
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
  const rate = Number(value) || 0;
  const fill = rate >= 85
    ? "track__fill--attendance-good"
    : rate >= 75
      ? "track__fill--attendance-mid"
      : rate >= 60
        ? "track__fill--attendance-warning"
        : "track__fill--attendance-low";
  return `<div class="attend">
      <span class="attend__val">${rate.toFixed(1)}%</span>
      <span class="track" style="flex:1"><i class="track__fill ${fill}" style="--w:${Math.max(0, Math.min(100, rate))}%"></i></span>
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