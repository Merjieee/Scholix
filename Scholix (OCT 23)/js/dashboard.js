/* ============================================================
   Scholix — role-based dashboard
   Three views (admin / teacher / student) driven by one
   permission set derived from the signed-in user's role.
   ============================================================ */

import {
  FEE_STATUSES,
  GRADES,
  BUILT_IN_USERS,
  REQUIREMENT_STATUSES,
  ROLES,
  SCHOOL_REQUIREMENTS,
  SUBJECTS_BY_GRADE,
  attendanceBar,
  avatarHtml,
  clearSession,
  escapeHtml,
  filterStudents,
  formatDate,
  initials,
  loadSections,
  loadRequirementFile,
  loadStudents,
  money,
  profileFor,
  requireUser,
  removeRequirementFile,
  resolvePermissions,
  saveRequirementFile,
  saveProfile,
  saveSections,
  saveStudents,
  seedSubjectScores,
  sortStudents,
  statusPill,
  summarize,
  tintFor
} from "./data.js";

const PAGE_SIZE = 8;
const REQUIREMENT_NOTE_OPTIONS = [
  "Please upload here or submit to the handling office.",
  "File is being reviewed by the handling office.",
  "Received by the office.",
  "Rejected by the office. Please upload a corrected document."
];
const CLASS_PERIODS = [
  ["08:00", "08:50"],
  ["09:00", "09:50"],
  ["10:10", "11:00"],
  ["11:10", "12:00"],
  ["13:00", "13:50"],
  ["14:00", "14:50"]
];
/* ---------------- Session & permissions ---------------- */
let user = requireUser("./login.html");
const RISKY_ACTIONS_STORAGE_KEY = `scholix.allow-risky-actions.${user?.id || "anonymous"}`;
const DASHBOARD_THEME_STORAGE_KEY = `scholix.dashboard.dark-mode.${user?.id || "anonymous"}`;
function loadDashboardDarkMode() {
  try { return localStorage.getItem(DASHBOARD_THEME_STORAGE_KEY) === "true"; }
  catch { return false; }
}
const role = user ? ROLES[user.role] : null;
const perms = user ? resolvePermissions(user) : null;

const state = {
  students: [],
  sections: [],
  navKey: "overview",
  query: "",
  grade: "all",
  attendanceGrade: "all",
  attendanceQuery: "",
  feeGrade: "all",
  feeStatus: "all",
  feeQuery: "",
  scheduleQuery: "",
  gradeReportQuery: "",
  gradeReportOpenIds: new Set(),
  selectedStudentId: null,
  status: "all",
  sortKey: "name",
  sortDir: "asc",
  page: 1,
  editingId: null,
  requirementStudentId: null,
  avatarDraft: null,
  allowRiskyActions: false,
  darkMode: loadDashboardDarkMode(),
  lastFocused: null
};

const viewRoot = document.querySelector("#viewRoot");
const toastStack = document.querySelector("#toastStack");
const liveRegion = document.querySelector("#liveRegion");

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* ---------------- Permission helpers ---------------- */
const can = (permission) => Boolean(perms && perms[permission]);

function loadRiskyActionsPreference() {
  try {
    return localStorage.getItem(RISKY_ACTIONS_STORAGE_KEY) === "true";
  } catch {
    toast("Risky-action preference could not be read. Section deletion remains disabled.", true);
    return false;
  }
}

/** Students the current role is allowed to see at all. */
function visibleStudents() {
  if (!perms) return [];
  if (perms.ownRecordOnly) return state.students.filter((s) => s.roll === user.studentRoll);
  if (user.role === "teacher") return state.students.filter((student) => canEditAttendance(student));
  if (perms.scopedRoster && perms.scopeGrades) {
    return state.students.filter((s) => perms.scopeGrades.includes(s.grade) && canEditAttendance(s));
  }
  return state.students;
}

function sectionCodeFor(student) {
  const number = student.grade.replace("Grade ", "");
  const match = String(student.roll).match(/^(\d+[A-Z])/i);
  return match ? match[1].toUpperCase() : `${number}A`;
}

function sectionStudents(section) {
  return state.students.filter((student) => student.grade === section.grade && sectionCodeFor(student) === section.code);
}

function teacherSections() {
  return state.sections.filter((section) => section.adviserId === user.id);
}

function canEditAttendance(student) {
  if (!can("editAttendance")) return false;
  if (!perms.scopedRoster) return true;
  return teacherSections().some((section) => sectionStudents(section).some((item) => item.id === student.id));
}

function adviserName(section) {
  const adviser = BUILT_IN_USERS.find((account) => account.id === section.adviserId);
  return adviser ? profileFor(adviser).name : "Unassigned";
}

function schoolDay() {
  const now = new Date();
  let dayIndex = now.getDay();
  let label = "Today's schedule";
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (dayIndex === 0 || dayIndex === 6) {
    date.setDate(date.getDate() + (dayIndex === 6 ? 2 : 1));
    dayIndex = 1;
    label = "Next school day";
  }
  return {
    dayIndex,
    label,
    date: new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date),
    name: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][dayIndex]
  };
}

function scheduleStatus(start, end) {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  const startMinutes = startHour * 60 + startMinute;
  const endMinutes = endHour * 60 + endMinute;
  if (currentMinutes >= startMinutes && currentMinutes < endMinutes) return "In progress";
  if (currentMinutes < startMinutes) return "Upcoming";
  return "Completed";
}

function clockTime() {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date());
}

function scheduleRows(section, dayIndex, teacherIndex = null) {
  const subjects = SUBJECTS_BY_GRADE[section.grade] || SUBJECTS_BY_GRADE["Grade 6"];
  const periods = teacherIndex === null
    ? CLASS_PERIODS
    : [CLASS_PERIODS[teacherIndex % CLASS_PERIODS.length]];
  return periods.map(([start, end], periodIndex) => ({
    start,
    end,
    subject: subjects[(dayIndex + (teacherIndex === null ? periodIndex : teacherIndex)) % subjects.length],
    room: section.room,
    section
  }));
}

function scheduleTable(rows, { showSection = false, showTeacher = false, showStudents = false, studentView = false, compactMobile = false } = {}) {
  if (!rows.length) return `<div class="empty-state schedule-empty"><p class="empty-state__title">No classes scheduled</p><p class="empty-state__text">There are no sections assigned for this school day.</p></div>`;
  return `<div class="table-wrap"><table class="records-table schedule-table${studentView ? " student-schedule-table" : ""}${compactMobile ? " compact-schedule-table" : ""}">
    <thead><tr><th scope="col">Time</th>${showSection ? '<th scope="col">Section</th>' : ""}<th scope="col">Subject</th><th scope="col">Room</th>${showTeacher ? '<th scope="col">Teacher</th>' : ""}${showStudents ? '<th scope="col">Students</th>' : ""}<th scope="col" class="schedule-status-column">Status</th></tr></thead>
    <tbody>${rows.map((row) => {
      const status = scheduleStatus(row.start, row.end);
      const students = showStudents ? sectionStudents(row.section).map((student) => student.name).join(", ") : "";
      return `<tr class="${status === "In progress" ? "schedule-row--active" : ""}">
        <td class="mono schedule-time">${row.start}–${row.end}</td>
        ${showSection ? `<td>${escapeHtml(row.section.code)} · ${escapeHtml(row.section.grade)}</td>` : ""}
        <td><strong>${escapeHtml(row.subject)}</strong></td>
        <td>${escapeHtml(row.room)}</td>
        ${showTeacher ? `<td>${escapeHtml(adviserName(row.section))}</td>` : ""}
        ${showStudents ? `<td>${escapeHtml(students || "No students enrolled")}</td>` : ""}
        <td class="schedule-status-column"><span class="schedule-status schedule-status--${status.toLowerCase().replace(" ", "-")}" data-schedule-status data-start="${row.start}" data-end="${row.end}">${status}</span></td>
      </tr>`;
    }).join("")}</tbody>
  </table></div>`;
}

function studentSection() {
  const student = visibleStudents()[0];
  return student ? state.sections.find((section) => section.grade === student.grade && section.code === sectionCodeFor(student)) : null;
}

function studentScheduleCard({ compact = false } = {}) {
  const section = studentSection();
  if (!section) return `<div class="side-card schedule-card"><div class="panel-head"><h3>Learning schedule</h3></div><p class="side-empty schedule-card__empty">Your section and room schedule have not been assigned yet. Please contact the school office.</p></div>`;
  const day = schoolDay();
  const rows = scheduleRows(section, day.dayIndex);
  const upcomingRows = rows.filter((row) => scheduleStatus(row.start, row.end) !== "Completed");
  const visibleRows = compact ? (upcomingRows.length ? upcomingRows : rows).slice(0, 3) : rows;
  return `<section class="records-main schedule-card">
    <div class="panel-head schedule-card__head">
      <div><h3>${compact ? "Today's learning" : "My class schedule"}</h3><span class="schedule-day">${day.label} · ${day.name}, ${day.date}</span></div>
      <div class="schedule-card__actions">
        <span class="schedule-live"><i></i><span class="schedule-clock">${clockTime()}</span> local time</span>
        ${compact ? `<button class="btn btn--ghost schedule-card__open" type="button" data-action-btn="open-schedule">View full schedule</button>` : ""}
      </div>
    </div>
    <div class="schedule-class-meta"><span>${escapeHtml(section.code)} · ${escapeHtml(section.grade)}</span><span>Adviser: ${escapeHtml(adviserName(section))}</span></div>
    ${scheduleTable(visibleRows, { studentView: true, compactMobile: true })}
  </section>`;
}

function teacherScheduleView() {
  const sections = teacherSections().sort((a, b) => a.grade.localeCompare(b.grade, undefined, { numeric: true }) || a.code.localeCompare(b.code));
  const day = schoolDay();
  const rows = sections.flatMap((section, index) => scheduleRows(section, day.dayIndex, index));
  return `<section class="records-main schedule-card">
    <div class="panel-head schedule-card__head">
      <div><h3>Today's classes</h3><span class="schedule-day">${day.label} · ${day.name}, ${day.date}</span></div>
      <span class="schedule-live"><i></i><span class="schedule-clock">${clockTime()}</span> local time</span>
    </div>
    ${scheduleTable(rows, { showSection: true, compactMobile: true })}
  </section>`;
}

function teacherOngoingScheduleCard() {
  const sections = teacherSections().sort((a, b) => a.grade.localeCompare(b.grade, undefined, { numeric: true }) || a.code.localeCompare(b.code));
  const day = schoolDay();
  const rows = sections.flatMap((section, index) => scheduleRows(section, day.dayIndex, index));
  const activeRows = rows.filter((row) => scheduleStatus(row.start, row.end) === "In progress");
  const upcomingRows = rows.filter((row) => scheduleStatus(row.start, row.end) === "Upcoming").slice(0, 2);
  const visibleRows = [...activeRows, ...upcomingRows];

  return `<section class="records-main schedule-card ongoing-schedule-card">
    <div class="panel-head schedule-card__head">
      <div><h3>Ongoing schedule</h3><span class="schedule-day">${day.label} · ${day.name}, ${day.date}</span></div>
      <span class="schedule-live"><i></i><span class="schedule-clock">${clockTime()}</span> local time</span>
    </div>
    ${visibleRows.length
      ? scheduleTable(visibleRows, { showSection: true, compactMobile: true })
      : `<div class="empty-state schedule-empty"><p class="empty-state__title">No classes in progress or coming up</p><p class="empty-state__text">Your next assigned class will appear here.</p></div>`}
  </section>`;
}

function viewSchedule() {
  const isAdmin = can("exportCsv");
  const day = schoolDay();
  const adminSections = isAdmin
    ? [...state.sections].sort((a, b) => a.grade.localeCompare(b.grade, undefined, { numeric: true }) || a.code.localeCompare(b.code))
    : [];
  const allAdminRows = adminSections.flatMap((section) => scheduleRows(section, day.dayIndex));
  const scheduleQuery = state.scheduleQuery.trim().toLocaleLowerCase();
  const adminRows = scheduleQuery
    ? allAdminRows.filter((row) => {
        const students = sectionStudents(row.section).map((student) => student.name);
        return [
          row.start,
          row.end,
          row.section.code,
          row.section.grade,
          row.subject,
          row.room,
          adviserName(row.section),
          ...students
        ].some((value) => String(value || "").toLocaleLowerCase().includes(scheduleQuery));
      })
    : allAdminRows;
  viewRoot.innerHTML = `
    <div class="view-head">
      <div class="view-head__text">
        <h2>${user.role === "student" ? "My schedule" : isAdmin ? "School schedule" : "Teaching schedule"}</h2>
        <p>${user.role === "student" ? "Your subjects, class times and assigned room for the school day." : isAdmin ? "All sections, students, class times, rooms and assigned teachers for the school day." : "Your assigned sections, subjects, class times and rooms for the school day."}</p>
      </div>
    </div>
    ${user.role === "student"
      ? studentScheduleCard()
      : isAdmin
        ? `<section class="records-main schedule-card">
            <div class="panel-head schedule-card__head">
              <div><h3>${day.label}</h3><span class="schedule-day">${day.name}, ${day.date}</span></div>
              <span class="schedule-live"><i></i><span class="schedule-clock">${clockTime()}</span> local time</span>
            </div>
            <div class="toolbar attendance-search-toolbar">
              <div class="search">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
                <label class="sr-only" for="scheduleSearchInput">Search school schedule</label>
                <input id="scheduleSearchInput" type="search" value="${escapeHtml(state.scheduleQuery)}" placeholder="Search section, subject, teacher or student…" autocomplete="off" />
              </div>
              <span class="panel-head__hint">${adminRows.length} ${adminRows.length === 1 ? "class" : "classes"}</span>
            </div>
            ${scheduleQuery && !adminRows.length && allAdminRows.length
              ? `<div class="empty-state"><p class="empty-state__title">No matching classes</p><p class="empty-state__text">Try another section, subject, room, teacher or student.</p></div>`
              : scheduleTable(adminRows, { showSection: true, showTeacher: true, showStudents: true })}
          </section>`
        : teacherScheduleView()}`;
}

function updateScheduleClocks() {
  $$(".schedule-clock").forEach((clock) => { clock.textContent = clockTime(); });
  $$("[data-schedule-status]").forEach((status) => {
    const value = scheduleStatus(status.dataset.start, status.dataset.end);
    status.textContent = value;
    status.className = `schedule-status schedule-status--${value.toLowerCase().replace(" ", "-")}`;
    status.closest("tr").classList.toggle("schedule-row--active", value === "In progress");
  });
}

function gradeOptions() {
  if (user && user.role === "teacher") {
    const assignedGrades = new Set(teacherSections().map((section) => section.grade));
    return GRADES.filter((grade) => assignedGrades.has(grade));
  }
  if (perms && perms.scopedRoster && perms.scopeGrades) {
    return GRADES.filter((g) => perms.scopeGrades.includes(g));
  }
  return [...GRADES];
}

/* ---------------- Navigation definition ---------------- */
function navItems() {
  if (!user) return [];
  const items = [
    {
      key: "overview",
      label: "Overview",
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>'
    },
    {
      key: "roster",
      label: can("ownRecordOnly") ? "My record" : "Student records",
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13A4 4 0 0 1 16 11"/></svg>'
    },
    {
      key: "attendance",
      label: "Attendance",
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>'
    },
    {
      key: "fees",
      label: "Fees",
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/><path d="M6 15h4"/></svg>'
    },
    {
      key: "schedule",
      label: user.role === "student" ? "My schedule" : "Schedule",
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 14h2M14 14h2M8 18h2"/></svg>'
    }
  ];
  if (user.role !== "admin") {
    items.push({
      key: "grades",
      label: user.role === "student" ? "My grades" : "Grade reports",
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M8 16v-3M12 16v-6M16 16v-2"/></svg>'
    });
  }
  if (can("exportCsv")) {
    items.push({
      key: "sections",
      label: "Sections",
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 21v-5h6v5"/></svg>'
    }, {
      key: "requirements",
      label: "Requirements",
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="m9 15 2 2 4-4"/></svg>'
    }, {
      key: "accounts",
      label: "Staff & accounts",
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 20 5v5c0 4.6-3.2 7.8-8 10-4.8-2.2-8-5.4-8-10V5l8-3Z"/><path d="m9 10 2 2 4-4"/><path d="M3 21v-1a3 3 0 0 1 3-3h1"/><path d="M21 21v-1a3 3 0 0 0-3-3h-1"/></svg>'
    });
    items.push({
      key: "reports",
      label: "Reports",
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M9 17v-4M13 17v-7M17 17v-2"/></svg>'
    });
  }
  if (user.role === "teacher") {
    items.push({
      key: "sections",
      label: "My sections",
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 21v-5h6v5"/></svg>'
    });
  }
  if (user.role === "student") {
    items.push({
      key: "requirements",
      label: "My requirements",
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="m9 15 2 2 4-4"/></svg>'
    });
  }
  items.push({
    key: "settings",
    label: "Settings",
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.1-3.1a6 6 0 0 1-7.9 7.9l-6.8 6.8a2.1 2.1 0 0 1-3-3l6.8-6.8a6 6 0 0 1 7.9-7.9z"/></svg>'
  });
  return items;
}

function renderChrome() {
  document.querySelector("#dashShell").hidden = false;

  const nav = document.querySelector("#dashNav");
  const items = navItems();
  const workspaceKeys = ["overview", "roster", "attendance", "fees", "schedule", ...(user.role === "admin" ? [] : ["grades"])];
  const groups = [
    { label: "Workspace", items: items.filter((item) => workspaceKeys.includes(item.key)) },
    ...(user.role === "admin"
      ? [{ label: "School management", items: items.filter((item) => ["sections", "requirements", "accounts", "reports"].includes(item.key)) }]
      : user.role === "teacher"
        ? [{ label: "Teaching", items: items.filter((item) => item.key === "sections") }]
        : [{ label: "Student services", items: items.filter((item) => item.key === "requirements") }]),
    { label: "Account", items: items.filter((item) => item.key === "settings") }
  ].filter((group) => group.items.length);
  nav.innerHTML = groups.map((group) => `
    <div class="dash__nav-group">
      <span class="dash__nav-label">${escapeHtml(group.label)}</span>
      ${group.items.map((item) => `
        <button class="dash__nav-item${item.key === state.navKey ? " is-active" : ""}" type="button" data-nav="${item.key}"${item.key === state.navKey ? ' aria-current="page"' : ""}>
          <span class="dash__nav-icon" aria-hidden="true">${item.icon}</span>
          <span>${escapeHtml(item.label)}</span>
        </button>`).join("")}
    </div>`).join("");

  const avatar = document.querySelector("#userAvatar");
  avatar.innerHTML = user.avatar ? `<img class="avatar__image" src="${escapeHtml(user.avatar)}" alt="" />` : initials(user.name);
  avatar.style.backgroundColor = tintFor(user.name);
  document.querySelector("#userName").textContent = user.name;
  document.querySelector("#userRole").textContent = role.label;
  const sideAccount = document.querySelector("#sidebarAccount");
  sideAccount.innerHTML = `${avatarHtml(user.name, "sidebar-account__avatar", user.avatar || "")}<span class="sidebar-account__details"><strong>${escapeHtml(user.name)}</strong><small>${escapeHtml(role.label)}</small></span><button class="sidebar-account__sign-out" id="sidebarSignOutBtn" type="button" aria-label="Sign out" title="Sign out"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/></svg></button>`;
}

function setView(key) {
  state.navKey = key;
  state.page = 1;
  $$(".dash__nav-item").forEach((btn) => btn.classList.toggle("is-active", btn.dataset.nav === key));
  closeSideNav();
  renderView();
  viewRoot.scrollIntoView({ block: "start" });
}

/* ---------------- Shared view pieces ---------------- */
function statCard(label, value, note) {
  return `
    <div class="stat">
      <span class="stat__label">${escapeHtml(label)}</span>
      <strong class="stat__value">${escapeHtml(value)}</strong>
      <span class="stat__note">${escapeHtml(note)}</span>
    </div>`;
}

function rosterTable(list, {
  editable,
  attendanceEditable,
  showAmounts,
  showActions = true,
  hideFees = false,
  showEmailColumn = false,
  showContactColumn = false,
  showGuardianPhoneColumn = false,
  hideAttendance = false,
  hideAmountNote = false,
  clickableRows = false
}) {
  if (!list.length) {
    return `<div class="empty-state"><p class="empty-state__title">No students match those filters</p><p class="empty-state__text">Adjust the search or grade filter to widen the result.</p></div>`;
  }
  const rows = list
    .map(
      (s) => `
    <tr${clickableRows ? ` class="student-record-row" data-student-row="${s.id}"` : ""}>
      <td>
        <div class="student-cell">
          ${avatarHtml(s.name)}
          <span>
            <span class="student-cell__name">${escapeHtml(s.name)}</span>
            ${showEmailColumn ? "" : `<span class="student-cell__meta">${escapeHtml(s.email || "No email on file")}</span>`}
          </span>
        </div>
      </td>
      ${showEmailColumn ? `<td>${escapeHtml(s.email || "No email on file")}</td>` : ""}
      <td class="mono">${escapeHtml(s.roll)}</td>
      <td>${escapeHtml(s.grade)}</td>
      <td>
        <span class="student-cell__name">${escapeHtml(s.guardian)}</span>
        ${showContactColumn || showGuardianPhoneColumn ? "" : `<span class="student-cell__meta guardian-phone">${escapeHtml(s.phone)}</span>`}
      </td>
      ${showContactColumn || showGuardianPhoneColumn
        ? `<td class="guardian-phone">${escapeHtml(s.phone)}</td>`
        : ""}
      ${showGuardianPhoneColumn || hideAttendance
          ? ""
          : `<td>${attendanceBar(s.attendance)}</td>`}
      ${hideFees ? "" : `<td>
        <span class="fee-status-inline">
          ${statusPill(s.feeStatus)}
          ${showAmounts
            ? `<span class="student-cell__meta fee-status-note">${s.due > 0 ? `${money(s.due)} due` : "Fully settled"}</span>`
            : hideAmountNote
              ? ""
              : '<span class="student-cell__meta fee-status-note">Amount hidden for your role</span>'}
        </span>
      </td>`}
      ${
        showActions
          ? `<td><div class="row-actions">
              ${
                attendanceEditable && canEditAttendance(s)
                  ? `<button class="icon-btn icon-btn--edit" type="button" data-action="attendance" data-id="${s.id}" aria-label="Update attendance for ${escapeHtml(s.name)}" title="Update attendance">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                    </button>`
                  : ""
              }
              ${
                editable
                  ? `<button class="icon-btn icon-btn--edit" type="button" data-action="edit" data-id="${s.id}" aria-label="Edit record for ${escapeHtml(s.name)}" title="Edit record">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                    </button>
                    <button class="icon-btn icon-btn--delete" type="button" data-action="delete" data-id="${s.id}" aria-label="Delete record for ${escapeHtml(s.name)}" title="Delete record">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
                    </button>`
                  : ""
              }
            </div></td>`
          : ""
      }
    </tr>`
    )
    .join("");

  return `<table class="records-table">
      <caption class="sr-only">Student records</caption>
      <thead>
        <tr>
          <th scope="col">Student</th>
          ${showEmailColumn ? '<th scope="col">Email</th>' : ""}
          <th scope="col">Roll</th>
          <th scope="col">Grade</th>
          <th scope="col">Guardian</th>
          ${showContactColumn || showGuardianPhoneColumn
            ? `<th scope="col">${showContactColumn ? "Contact no." : "Guardian contact"}</th>`
            : ""}
          ${showGuardianPhoneColumn || hideAttendance
              ? ""
              : '<th scope="col">Attendance</th>'}
          ${hideFees ? "" : '<th scope="col">Fees</th>'}
          ${showActions ? '<th scope="col"><span class="sr-only">Actions</span></th>' : ""}
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function gradeChartCard(list) {
  window.__chartData = gradeOptions().map((grade) => ({
    label: grade.replace("Grade ", "G"),
    fullLabel: grade,
    value: list.filter((s) => s.grade === grade).length
  }));
  const total = window.__chartData.reduce((sum, grade) => sum + grade.value, 0);
  return `
    <div class="side-card grade-chart-card">
      <div class="side-card__head"><div><h3>Students per grade</h3><span class="grade-chart-card__caption">Enrollment distribution</span></div><span class="side-card__hint">${total} students</span></div>
      <canvas id="gradeChart" width="640" height="360" role="img" aria-label="Bar chart of students per grade">${window.__chartData.map((grade) => `${escapeHtml(grade.fullLabel)}: ${grade.value}`).join(", ")}</canvas>
    </div>`;
}

function dueListCard(list, showAmounts) {
  const overdue = list.filter((s) => s.due > 0).sort((a, b) => b.due - a.due);
  const student = perms.ownRecordOnly ? list[0] : null;
  const missingRequirements = student
    ? SCHOOL_REQUIREMENTS.filter((requirement) => {
        const record = student.requirements && student.requirements[requirement.key];
        return !record || record.status === "Missing";
      })
    : [];
  const body = overdue.length
    ? `<ul class="due-list">${overdue
        .map(
          (s) => `
        <li class="due-item">
          ${avatarHtml(s.name)}
          <span class="due-item__body">
            <span class="due-item__name">${escapeHtml(s.name)}</span>
            <span class="due-item__grade">${escapeHtml(s.grade)} · ${escapeHtml(s.roll)}</span>
          </span>
          <span class="due-item__amt">${showAmounts ? money(s.due) : "Due"}</span>
        </li>`
        )
        .join("")}</ul>`
    : perms.ownRecordOnly
      ? `<p class="side-empty">No outstanding fee balance.</p>`
      : `<p class="side-empty">Every fee in scope is settled. Nothing to chase today.</p>`;
  const studentBody = student
    ? `<div class="student-follow-up">
        <div class="student-follow-up__section">
          <h4>Missing requirements <span>${missingRequirements.length}</span></h4>
          ${missingRequirements.length
            ? `<ul class="student-follow-up__list">${missingRequirements.map((requirement) => {
                const record = student.requirements && student.requirements[requirement.key];
                return `<li><strong>${escapeHtml(requirement.label)}</strong><small>${escapeHtml(requirement.office)} · ${escapeHtml(record && record.note ? record.note : "Please submit this document.")}</small></li>`;
              }).join("")}</ul>`
            : `<p class="side-empty">No requirements are marked missing.</p>`}
        </div>
        <div class="student-follow-up__section">
          <h4>Fee to follow-up</h4>
          ${body}
        </div>
      </div>`
    : body;

  return `<div class="side-card">
      <div class="side-card__head"><h3>${perms.ownRecordOnly ? "Requirement &amp; Fee to follow-up" : "Fee to follow-up"}</h3>${perms.ownRecordOnly ? "" : `<span class="side-card__hint">${overdue.length} student${overdue.length === 1 ? "" : "s"}</span>`}</div>
      ${studentBody}
    </div>`;
}

/* ---------------- Views ---------------- */
function viewOverview() {
  const list = visibleStudents();
  const scopeNote = user.role === "teacher"
    ? `in ${teacherSections().map((section) => section.code).join(", ") || "no assigned sections"}`
    : perms.scopedRoster
    ? `in ${perms.scopeGrades.join(" & ")}`
    : perms.ownRecordOnly
      ? "in your record"
      : "across all grades";

  const cards = [];
  if (!perms.ownRecordOnly) {
    const s = summarize(list);
    cards.push(
      statCard("Students", String(s.total), scopeNote),
      statCard("Avg. attendance", s.total ? `${s.average.toFixed(1)}%` : "—", s.low ? `${s.low} below 85%` : "all above 85%"),
      statCard("Fee status", `${s.paid}/${s.total}`, "fully paid"),
      can("viewFeeAmounts")
        ? statCard("Pending dues", s.duesTotal ? money(s.duesTotal) : "$0", `${s.duesCount} to follow up`)
        : statCard("Pending dues", `${s.duesCount}`, "students with a balance")
    );
  }

  const recent = perms.ownRecordOnly ? [] : sortStudents(list, "name", "asc").slice(0, 6);

  viewRoot.innerHTML = `
    <section class="dash__hero">
      <div>
        <p class="eyebrow">${escapeHtml(role.label)} overview</p>
        <h2 class="dash__hero-title">${escapeHtml(greeting())}, ${escapeHtml(user.name.split(" ")[0])}</h2>
        <p class="dash__hero-text">${escapeHtml(role.tagline)} — ${escapeHtml(
          perms.scopedRoster
            ? "your view is limited to students in your assigned sections."
            : perms.ownRecordOnly
              ? "this dashboard shows only your own record."
              : "you can see and manage the full roster."
        )}</p>
      </div>
      <ul class="dash__hero-caps">${role.capabilities.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ul>
    </section>

    ${cards.length ? `<div class="stat-strip">${cards.join("")}</div>` : ""}

    <div class="records-layout records-layout--overview">
      <div class="records-main">
        <div class="panel-head"><h3>${perms.ownRecordOnly ? "Your record" : "Students needing attention"}</h3>${perms.ownRecordOnly ? "" : `<span class="panel-head__hint">lowest attendance first</span>`}</div>
        <div class="table-wrap">${rosterTable(
          sortStudents(list, "attendance", "asc").slice(0, 5),
          { editable: false, attendanceEditable: false, showAmounts: can("viewFeeAmounts"), showActions: false, hideFees: user.role === "teacher" }
        )}</div>
      </div>
    </div>
    <aside class="records-side records-side--overview${perms.ownRecordOnly ? " records-side--overview--student" : user.role === "teacher" ? " records-side--overview--teacher" : ""}">
      ${perms.ownRecordOnly ? studentScheduleCard({ compact: true }) : gradeChartCard(list)}
      ${user.role === "teacher" ? teacherOngoingScheduleCard() : ""}
      ${user.role === "teacher" ? "" : dueListCard(list, can("viewFeeAmounts"))}
    </aside>

    ${perms.ownRecordOnly ? "" : `<div class="side-card">
      <div class="side-card__head"><h3>Recently added records</h3></div>
      <ul class="mini-feed">
        ${recent
          .map(
            (s2) => `<li class="mini-feed__item">
              ${avatarHtml(s2.name)}
              <span class="mini-feed__body">
                <span class="mini-feed__name">${escapeHtml(s2.name)}</span>
                <span class="mini-feed__meta">${escapeHtml(s2.grade)} · joined ${escapeHtml(formatDate(s2.enrolled))}</span>
              </span>
              ${statusPill(s2.feeStatus)}
            </li>`
          )
          .join("")}
      </ul>
    </div>`}`;

  renderChart();
}

function studentOwnRecordCard(record) {
  if (!record) return "";
  return `<section class="records-main student-own-record">
    <div class="panel-head"><h3>Your student record</h3><span class="panel-head__hint">read-only</span></div>
    <dl class="detail-list">
      <div><dt>Name</dt><dd>${escapeHtml(record.name)}</dd></div>
      <div><dt>Roll number</dt><dd>${escapeHtml(record.roll)}</dd></div>
      <div><dt>Grade</dt><dd>${escapeHtml(record.grade)}</dd></div>
      <div><dt>Attendance</dt><dd>${attendanceBar(record.attendance)}</dd></div>
      <div><dt>Fee status</dt><dd>${statusPill(record.feeStatus)}</dd></div>
      <div><dt>Outstanding balance</dt><dd>${record.due > 0 ? money(record.due) : "Fully settled"}</dd></div>
      <div><dt>Guardian</dt><dd>${escapeHtml(record.guardian)}<br /><small>${escapeHtml(record.phone)}</small></dd></div>
      <div><dt>Admitted</dt><dd>${escapeHtml(formatDate(record.enrolled))}</dd></div>
    </dl>
  </section>`;
}
function viewRoster() {
  const title = perms.ownRecordOnly ? "My record" : "Student records";
  if ((user.role === "admin" || user.role === "teacher") && state.selectedStudentId !== null) {
    viewStudentRecord(state.selectedStudentId);
    return;
  }
  const list = visibleStudents();
  const filtered = perms.ownRecordOnly ? list : sortStudents(filterStudents(list, state), state.sortKey, state.sortDir);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  state.page = Math.min(state.page, pageCount);
  const start = (state.page - 1) * PAGE_SIZE;
  const rows = filtered.slice(start, start + PAGE_SIZE);

  const actions = `
    ${can("exportCsv") ? `<button class="btn btn--ghost" type="button" data-action-btn="export"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>Export Excel</button>` : ""}
    ${can("createStudent") ? `<button class="btn btn--primary" type="button" data-action-btn="add"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>Add student</button>` : ""}`;

  const notice = !can("createStudent")
    ? `<p class="view-notice">${user.role === "teacher"
      ? "You can view student records and edit grades for students in your assigned sections, but cannot edit student profiles."
      : "Your role can view records but not add, edit or delete them."}</p>`
    : "";

  viewRoot.innerHTML = `
    <div class="view-head">
      <div class="view-head__text">
        <h2>${escapeHtml(title)}</h2>
        <p>${
          perms.ownRecordOnly
            ? "Only your own student record is shown here."
            : user.role === "teacher"
              ? `Showing students in ${escapeHtml(teacherSections().map((section) => section.code).join(", ") || "your assigned sections")}.`
              : perms.scopedRoster
                ? `Showing students in ${escapeHtml(perms.scopeGrades.join(", "))}.`
              : "Every student record your account is allowed to manage."
        }</p>
      </div>
      <div class="section__head-actions">${actions}</div>
    </div>
    ${notice}

    <div class="records-main records-main--roster">
      ${perms.ownRecordOnly ? "" : `<div class="toolbar">
          <div class="search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
            <label class="sr-only" for="searchInput">Search students</label>
            <input id="searchInput" type="search" value="${escapeHtml(state.query)}" placeholder="Search by name, roll no. or guardian…" autocomplete="off" />
          </div>
          ${filterDropdown("gradeFilter", "Grade", gradeFilterOptions(), state.grade)}
          ${user.role === "teacher" ? "" : filterDropdown("statusFilter", "Fee status", [
            { value: "all", label: "All fee statuses" },
            ...FEE_STATUSES.map((status) => ({ value: status, label: status }))
          ], state.status)}
        </div>`}

      <div class="table-wrap">
        ${perms.ownRecordOnly
          ? studentOwnRecordCard(rows[0])
          : rosterTable(rows, {
            editable: can("editStudent"),
            attendanceEditable: false,
            clickableRows: user.role === "admin" || user.role === "teacher",
            showAmounts: can("viewFeeAmounts"),
            hideFees: user.role === "teacher",
            showEmailColumn: user.role === "admin",
            showGuardianPhoneColumn: user.role === "teacher",
            showContactColumn: user.role === "admin",
            hideAttendance: user.role === "admin"
          })}
      </div>

      ${perms.ownRecordOnly ? "" : `<div class="table-foot">
        <p class="table-foot__count">${
          filtered.length
            ? `Showing ${start + 1}–${Math.min(start + PAGE_SIZE, filtered.length)} of ${filtered.length} student${filtered.length === 1 ? "" : "s"}`
            : "No matching students"
        }</p>
        <div class="pager">
          <button class="pager__btn" type="button" data-action-btn="prev" aria-label="Previous page"${state.page <= 1 ? " disabled" : ""}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
          </button>
          <span class="pager__label">Page ${state.page} of ${pageCount}</span>
          <button class="pager__btn" type="button" data-action-btn="next" aria-label="Next page"${state.page >= pageCount ? " disabled" : ""}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
          </button>
        </div>
      </div>`}
    </div>
    ${perms.ownRecordOnly ? studentSubjectsCard() : ""}`;
}

function viewStudentRecord(studentId) {
  if (user.role !== "admin" && user.role !== "teacher") {
    state.selectedStudentId = null;
    return;
  }
  const student = visibleStudents().find((item) => item.id === Number(studentId));
  if (!student) {
    state.selectedStudentId = null;
    toast("That student record is no longer available.", true);
    viewRoster();
    return;
  }
  const subjects = SUBJECTS_BY_GRADE[student.grade] || SUBJECTS_BY_GRADE["Grade 6"];
  const scores = subjects.map((subject) => ({
    subject,
    score: Number(student.subjectScores?.[subject]) || 0
  }));
  const average = scores.reduce((sum, item) => sum + item.score, 0) / (scores.length || 1);
  const requirements = SCHOOL_REQUIREMENTS.map((requirement) => {
    const record = student.requirements?.[requirement.key];
    const status = record?.status || "Missing";
    return `<li class="student-detail-requirement">
      <span><strong>${escapeHtml(requirement.label)}</strong><small>${escapeHtml(requirement.office)}</small></span>
      <span class="requirement-status ${requirementStatusClass(status)}">${escapeHtml(status)}</span>
    </li>`;
  }).join("");

  viewRoot.innerHTML = `
    <div class="view-head student-detail-head">
      <div class="view-head__text">
        <p class="eyebrow">Student record</p>
        <h2>${escapeHtml(student.name)}</h2>
        <p>${escapeHtml(student.grade)} · ${escapeHtml(student.roll)} · Enrolled ${escapeHtml(formatDate(student.enrolled))}</p>
      </div>
      <div class="section__head-actions">
        <button class="btn btn--ghost" type="button" data-action-btn="back-roster">Back to student records</button>
        ${user.role === "admin" ? `<button class="btn btn--primary" type="button" data-action="edit" data-id="${student.id}">Edit profile</button>` : ""}
      </div>
    </div>
    <div class="student-detail-overview">
      <div><small>Attendance</small><strong>${Number(student.attendance).toFixed(1)}%</strong></div>
      <div><small>Average grade</small><strong>${average.toFixed(1)}% · ${performanceLabel(average)}</strong></div>
      <div><small>Fees</small><strong>${escapeHtml(student.feeStatus)} · ${student.due > 0 ? `${money(student.due)} outstanding` : "Fully settled"}</strong></div>
    </div>
    <div class="student-detail-grid">
      <section class="records-main student-detail-card">
        <div class="panel-head"><h3>Student information</h3></div>
        <dl class="student-detail-fields">
          <div><dt>Full name</dt><dd>${escapeHtml(student.name)}</dd></div>
          <div><dt>Roll number</dt><dd>${escapeHtml(student.roll)}</dd></div>
          <div><dt>Grade</dt><dd>${escapeHtml(student.grade)}</dd></div>
          <div><dt>Guardian</dt><dd>${escapeHtml(student.guardian)}</dd></div>
          <div><dt>Guardian phone</dt><dd>${escapeHtml(student.phone)}</dd></div>
          <div><dt>Student email</dt><dd>${escapeHtml(student.email || "No email on file")}</dd></div>
          <div><dt>Enrollment date</dt><dd>${escapeHtml(formatDate(student.enrolled))}</dd></div>
          <div><dt>Attendance</dt><dd>${Number(student.attendance).toFixed(1)}%</dd></div>
          <div><dt>Absences</dt><dd>${Number(student.absences || 0)}</dd></div>
          <div><dt>Late arrivals</dt><dd>${Number(student.lateArrivals || 0)}</dd></div>
          <div><dt>Fee status</dt><dd>${statusPill(student.feeStatus)}</dd></div>
          <div><dt>Outstanding amount</dt><dd>${money(student.due)}</dd></div>
        </dl>
      </section>
      <section class="records-main student-detail-card">
        <div class="panel-head"><h3>School requirements</h3><span class="panel-head__hint">${SCHOOL_REQUIREMENTS.length} documents</span></div>
        <ul class="student-detail-requirements">${requirements}</ul>
      </section>
      <section class="records-main student-detail-card student-detail-grades">
        <div class="panel-head">
          <div><h3>Grade report</h3><span class="student-detail-grade-note">Term 1 · 2026–27</span></div>
          <span class="grade-report-performance grade-report-performance--${performanceLabel(average).toLowerCase().replaceAll(" ", "-")}">
            <small>Performance</small><strong>${performanceLabel(average)}</strong>
          </span>
        </div>
        <div class="table-wrap">
          <table class="records-table grade-report-table">
            <caption class="sr-only">Term 1 subject scores for ${escapeHtml(student.name)}</caption>
            <thead><tr><th scope="col">Subject</th><th scope="col">Score</th><th scope="col">Letter grade</th><th scope="col">Action</th></tr></thead>
            <tbody>${scores.map((item) => `<tr data-grade-row="${student.id}">
              <td><strong>${escapeHtml(item.subject)}</strong></td>
              <td><label class="sr-only" for="grade-score-${student.id}-${escapeHtml(item.subject.replace(/[^a-z0-9]+/gi, "-"))}">${escapeHtml(student.name)} ${escapeHtml(item.subject)} score</label><input class="grade-report-score-input" id="grade-score-${student.id}-${escapeHtml(item.subject.replace(/[^a-z0-9]+/gi, "-"))}" type="number" min="0" max="100" step="1" value="${item.score}" data-grade-score data-student-id="${student.id}" data-subject="${escapeHtml(item.subject)}" /></td>
              <td><span class="grade-report-mark grade-report-mark--${letterGrade(item.score).toLowerCase()}">${letterGrade(item.score)}</span></td>
              <td><button class="btn btn--ghost grade-report-save" type="button" data-save-grade data-student-id="${student.id}" data-subject="${escapeHtml(item.subject)}">Save</button></td>
              
            </tr>`).join("")}</tbody>
          </table>
        </div>
      </section>
    </div>`;
}

function studentSubjectsCard() {
  const student = visibleStudents()[0];
  if (!student) return "";
  const section = state.sections.find((item) => item.grade === student.grade && item.code === sectionCodeFor(student));
  const subjects = SUBJECTS_BY_GRADE[student.grade] || SUBJECTS_BY_GRADE["Grade 6"];
  const assignedTeacher = section ? adviserName(section) : "Not assigned";

  return `<section class="records-main student-subjects-card">
    <div class="panel-head"><h3>Currently taking</h3><span class="panel-head__hint">${escapeHtml(student.grade)} subjects</span></div>
    <div class="table-wrap">
      <table class="records-table student-subjects-table">
        <thead><tr><th scope="col">Subject</th><th scope="col">Assigned teacher</th></tr></thead>
        <tbody>${subjects.map((subject) => `<tr><td><strong>${escapeHtml(subject)}</strong></td><td>${escapeHtml(assignedTeacher)}</td></tr>`).join("")}</tbody>
      </table>
    </div>
  </section>`;
}

function gradeFilterOptions() {
  const options = gradeOptions();
  return [
    ...(options.length === 1 ? [] : [{ value: "all", label: "All grades" }]),
    ...options.map((grade) => ({ value: grade, label: grade }))
  ];
}

function filterDropdown(id, label, options, selectedValue) {
  const selected = options.find((option) => option.value === selectedValue) || options[0];
  const optionsId = `${id}Options`;
  return `<div class="filter-dropdown" data-filter-dropdown="${id}">
    <span class="sr-only" id="${id}Label">${label}</span>
    <button class="filter-dropdown__trigger" type="button" id="${id}" aria-labelledby="${id}Label ${id}Value" aria-haspopup="listbox" aria-expanded="false" aria-controls="${optionsId}" data-filter-trigger="${id}">
      <span class="filter-dropdown__value" id="${id}Value">${escapeHtml(selected.label)}</span>
      <svg class="filter-dropdown__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
    </button>
    <div class="filter-dropdown__menu" id="${optionsId}" role="listbox" aria-labelledby="${id}Label" hidden>
      ${options.map((option) => `<button class="filter-dropdown__option${option.value === selected.value ? " is-selected" : ""}" type="button" role="option" aria-selected="${option.value === selected.value}" tabindex="-1" data-filter-option="${id}" data-value="${escapeHtml(option.value)}">
        <span>${escapeHtml(option.label)}</span>${option.value === selected.value ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>' : ""}
      </button>`).join("")}
    </div>
  </div>`;
}

function sectionFormSelect(id, name, label, options, selectedValue, searchable = false, requirementStatusKey = "", requirementNoteKey = "", overlayMenu = false) {
  const selected = options.find((option) => option.value === selectedValue) || options[0];
  const menuId = `${id}-options`;
  const overlaySelectClass = requirementStatusKey || requirementNoteKey || overlayMenu ? " requirement-overlay-select" : "";
  return `<div class="section-select${requirementStatusKey ? " requirement-status-select" : ""}${requirementNoteKey ? " requirement-note-select" : ""}${overlayMenu ? " student-form-select" : ""}${overlaySelectClass}" data-section-select="${name}">
    <select class="section-select__native" id="${id}" name="${name}"${requirementStatusKey ? ` data-requirement-status="${requirementStatusKey}"` : ""}${requirementNoteKey ? ` data-requirement-note="${requirementNoteKey}"` : ""}${name === "grade" || name === "adviserId" || name === "feeStatus" ? " required" : ""} tabindex="-1" aria-hidden="true">
      ${options.map((option) => `<option value="${escapeHtml(option.value)}"${option.value === selected.value ? " selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
    </select>
    ${searchable
      ? `<div class="section-select__search-field">
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
           <label class="sr-only" for="${id}-search">Search ${escapeHtml(label.toLowerCase())}</label>
           <input class="section-select__search section-select__search--standalone" id="${id}-search" type="search" role="combobox" aria-label="Search ${escapeHtml(label.toLowerCase())}" aria-haspopup="listbox" aria-expanded="false" aria-controls="${menuId}" placeholder="Search by name or roll number…" autocomplete="off" data-section-select-search />
         </div>`
      : `<button class="section-select__trigger" type="button" id="${id}-trigger" aria-label="${escapeHtml(label)}" aria-haspopup="listbox" aria-expanded="false" aria-controls="${menuId}" data-section-select-trigger>
          <span>${escapeHtml(selected.label)}</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
        </button>`}
    <div class="section-select__menu" id="${menuId}" role="listbox" aria-label="${escapeHtml(label)}" hidden>
      ${options.map((option) => `<button class="section-select__option${requirementNoteKey ? " requirement-note-option" : ""}${option.value === selected.value ? " is-selected" : ""}" type="button" role="option" aria-selected="${option.value === selected.value}" data-section-select-option="${name}" data-search-text="${escapeHtml(option.label.toLocaleLowerCase())}" data-value="${escapeHtml(option.value)}">
        <span>${escapeHtml(option.label)}</span>${option.value === selected.value ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>' : ""}
      </button>`).join("")}
    </div>
  </div>`;
}

function viewAttendance() {
  const searchQuery = state.attendanceQuery.trim().toLocaleLowerCase();
  const gradeFilteredStudents = state.attendanceGrade === "all"
    ? visibleStudents()
    : visibleStudents().filter((student) => student.grade === state.attendanceGrade);
  const searchedStudents = perms.ownRecordOnly || !searchQuery
    ? gradeFilteredStudents
    : gradeFilteredStudents.filter((student) =>
        [student.name, student.roll, student.guardian, student.email]
          .some((value) => String(value || "").toLocaleLowerCase().includes(searchQuery))
      );
  const list = sortStudents(searchedStudents, "attendance", "asc");
  const s = summarize(list);
  const editable = can("editAttendance");
  const ownRecord = perms.ownRecordOnly ? list[0] : null;
  const attendanceGradeOptions = [
    { value: "all", label: "All grades" },
    ...gradeOptions().map((grade) => ({ value: grade, label: grade }))
  ];
  const attendanceCards = ownRecord
    ? [
        statCard("Attendance rate", `${Number(ownRecord.attendance).toFixed(1)}%`, "current recorded rate"),
        statCard("ABSENCES", String(Math.round((100 - Number(ownRecord.attendance)) * 1.8)), "based on attendance rate"),
        statCard("Late arrivals", String(ownRecord.lateArrivals || 0), "recorded late arrivals"),
        statCard("Standing", ownRecord.attendance >= 95 ? "Excellent" : ownRecord.attendance >= 85 ? "On track" : "Needs attention", "based on attendance rate")
      ]
    : [
        statCard("Average attendance", `${s.average.toFixed(1)}%`, "across students in scope"),
        statCard("Below 85%", String(s.low), "needing a conversation"),
        statCard("Above 95%", String(list.filter((x) => x.attendance >= 95).length), "excellent attendance"),
        statCard("Students tracked", String(s.total), "in your scope")
      ];

  viewRoot.innerHTML = `
    <div class="view-head">
      <div class="view-head__text">
        <h2>Attendance</h2>
        <p>${
          editable
            ? "Update a student's attendance percentage directly from this list."
            : perms.ownRecordOnly
              ? "Your personal attendance rate, absences and late arrivals recorded by the school."
              : "Attendance is read-only for your role."
        }</p>
      </div>
    </div>
    <div class="stat-strip">
      ${attendanceCards.join("")}
    </div>

    ${
      editable
        ? ""
        : perms.ownRecordOnly
          ? `<p class="view-notice">Absence and late-arrival totals reflect entries recorded by the school.</p>`
          : `<p class="view-notice">You do not have permission to change attendance. Only administrators and class teachers can.</p>`
    }

    <div class="records-main">
      ${perms.ownRecordOnly ? "" : `<div class="panel-head fees-panel-head">
        <h3>Lowest attendance first</h3>
        <div class="attendance-panel-actions">
          ${filterDropdown("attendanceGradeFilter", "Grade", attendanceGradeOptions, state.attendanceGrade)}
          <span class="panel-head__hint">${list.length} ${searchQuery || state.attendanceGrade !== "all" ? "shown" : "in scope"}</span>
        </div>
      </div>`}
      ${!perms.ownRecordOnly ? `<div class="toolbar attendance-search-toolbar">
        <div class="search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <label class="sr-only" for="attendanceSearchInput">Search attendance records</label>
          <input id="attendanceSearchInput" type="search" value="${escapeHtml(state.attendanceQuery)}" placeholder="Search by student, roll no., guardian or email…" autocomplete="off" />
        </div>
      </div>` : ""}
      <div class="table-wrap">
        ${rosterTable(list, {
          editable: false,
          attendanceEditable: editable,
          showAmounts: can("viewFeeAmounts"),
          showActions: editable,
          hideFees: true
        })}
      </div>
    </div>`;
}

function viewFees() {
  const feeQuery = state.feeQuery.trim().toLocaleLowerCase();
  const list = visibleStudents().filter((student) =>
    (state.feeGrade === "all" || student.grade === state.feeGrade) &&
    (state.feeStatus === "all" || student.feeStatus === state.feeStatus) &&
    (!feeQuery || [student.name, student.roll, student.guardian, student.email]
      .some((value) => String(value || "").toLocaleLowerCase().includes(feeQuery)))
  );
  const s = summarize(list);
  const rows = sortStudents(list, "due", "desc");
  const feeGradeOptions = [
    { value: "all", label: "All grades" },
    ...gradeOptions().map((grade) => ({ value: grade, label: grade }))
  ];
  const feeStatusOptions = [
    { value: "all", label: "All fee statuses" },
    ...FEE_STATUSES.map((status) => ({ value: status, label: status }))
  ];

  viewRoot.innerHTML = `
    <div class="view-head">
      <div class="view-head__text">
        <h2>Fees</h2>
        <p>${
          can("viewFeeAmounts")
            ? "Outstanding balances across the students in your scope."
            : "Your role can see fee status but not the outstanding amounts."
        }</p>
      </div>
    </div>

    <div class="stat-strip">
      ${statCard("Awaiting payment", String(s.duesCount), "students with a balance")}
      ${can("viewFeeAmounts")
        ? statCard("Total outstanding", money(s.duesTotal), "to be collected")
        : statCard("Total outstanding", "Hidden", "not visible to your role")}
      ${statCard("Paid", String(s.paid), "fully settled")}
      ${statCard("Partial", String(s.partial), "part-payments received")}
    </div>

    <div class="records-main">
      <div class="panel-head fees-records-head">
        <h3>${state.feeStatus === "all" ? "Fee records" : `${state.feeStatus} fee records`}</h3>
        <div class="fees-panel-actions">
          ${perms.ownRecordOnly ? "" : `<div class="search fees-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
            <label class="sr-only" for="feesSearchInput">Search fee records</label>
            <input id="feesSearchInput" type="search" value="${escapeHtml(state.feeQuery)}" placeholder="Search students…" autocomplete="off" />
          </div>
          ${filterDropdown("feeGradeFilter", "Grade", feeGradeOptions, state.feeGrade)}
          ${filterDropdown("feeStatusFilter", "Fee status", feeStatusOptions, state.feeStatus)}`}
          ${perms.ownRecordOnly ? "" : `<span class="panel-head__hint">${rows.length} record${rows.length === 1 ? "" : "s"}</span>`}
        </div>
      </div>
      ${
        rows.length
          ? `<div class="table-wrap">${rosterTable(rows, {
              editable: false,
              attendanceEditable: false,
              showAmounts: can("viewFeeAmounts"),
              showActions: false,
              showEmailColumn: true,
              hideAttendance: true,
              showContactColumn: true,
              hideAmountNote: user.role === "teacher"
            })}</div>`
          : `<div class="empty-state"><p class="empty-state__title">No matching fee records</p><p class="empty-state__text">Try changing the grade or fee-status filters.</p></div>`
      }
    </div>`;
}

function viewReports() {
  const list = visibleStudents();
  const s = summarize(list);
  const byGrade = gradeOptions().map((grade) => {
    const rows = list.filter((x) => x.grade === grade);
    const g = summarize(rows);
    return { grade, count: rows.length, average: g.average, dues: g.duesTotal };
  });

  viewRoot.innerHTML = `
    <div class="view-head">
      <div class="view-head__text">
        <h2>Reports</h2>
        <p>Export the roster or scan grade-level performance.</p>
      </div>
      <div class="section__head-actions">
        <button class="btn btn--primary" type="button" data-action-btn="export-report">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>
          Export Excel report
        </button>
      </div>
    </div>

    <div class="stat-strip">
      ${statCard("Records", String(s.total), "exportable rows")}
      ${statCard("Grades covered", String(s.grades), "in the export")}
      ${statCard("Average attendance", `${s.average.toFixed(1)}%`, "across the roster")}
      ${statCard("Outstanding", money(s.duesTotal), `${s.duesCount} students`)}
    </div>

    <div class="records-layout reports-layout">
      <div class="records-main">
        <div class="panel-head"><h3>Grade summary</h3><span class="panel-head__hint">attendance &amp; dues</span></div>
        <div class="table-wrap grade-summary-wrap">
          <table class="records-table grade-summary-table">
            <thead><tr><th scope="col">Grade</th><th scope="col">Students</th><th scope="col">Avg. attendance</th><th scope="col">Outstanding</th></tr></thead>
            <tbody>
              ${byGrade
                .map(
                  (row) => `<tr>
                    <td class="mono">${escapeHtml(row.grade.replace("Grade ", "G"))}</td>
                    <td>${row.count}</td>
                    <td>${row.average.toFixed(1)}%</td>
                    <td>${money(row.dues)}</td>
                  </tr>`
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </div>
      <aside class="records-side">${gradeChartCard(list)}</aside>
    </div>`;

  renderChart();
}

function letterGrade(score) {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

function performanceLabel(score) {
  if (score >= 90) return "Excellent";
  if (score >= 80) return "Good";
  if (score >= 70) return "Satisfactory";
  return "Needs improvement";
}

function canEditGradeReport(student) {
  return can("editStudent") || canEditAttendance(student);
}

function viewGradeReports() {
  const query = state.gradeReportQuery.trim().toLocaleLowerCase();
  const students = visibleStudents()
    .filter((student) => !query || [student.name, student.roll, student.grade]
      .some((value) => String(value || "").toLocaleLowerCase().includes(query)))
    .sort((a, b) => a.name.localeCompare(b.name));
  const isStudent = Boolean(perms.ownRecordOnly);
  const canEditScores = !isStudent && (can("editStudent") || can("editAttendance"));
  const scoreRows = students.flatMap((student) => {
    const subjects = SUBJECTS_BY_GRADE[student.grade] || SUBJECTS_BY_GRADE["Grade 6"];
    return subjects.map((subject) => Number(student.subjectScores?.[subject]) || 0);
  });
  const average = scoreRows.length
    ? scoreRows.reduce((sum, score) => sum + score, 0) / scoreRows.length
    : 0;
  const needsAttention = students.filter((student) => {
    const subjects = SUBJECTS_BY_GRADE[student.grade] || SUBJECTS_BY_GRADE["Grade 6"];
    const studentAverage = subjects.length
      ? subjects.reduce((sum, subject) => sum + (Number(student.subjectScores?.[subject]) || 0), 0) / subjects.length
      : 0;
    return studentAverage < 70;
  }).length;
  const reports = students.map((student) => {
    const subjects = SUBJECTS_BY_GRADE[student.grade] || SUBJECTS_BY_GRADE["Grade 6"];
    const scores = subjects.map((subject) => ({
      subject,
      score: Number(student.subjectScores?.[subject]) || 0
    }));
    const studentAverage = scores.length
      ? scores.reduce((sum, item) => sum + item.score, 0) / scores.length
      : 0;
    return `<details class="records-main grade-report-card"${isStudent || state.gradeReportOpenIds.has(student.id) ? " open" : ""}>
      <summary class="grade-report-card__summary">
        <span class="grade-report-card__student">
          <strong>${escapeHtml(student.name)}</strong>
          <small>${escapeHtml(student.grade)} · ${escapeHtml(student.roll)}</small>
        </span>
        <span class="grade-report-card__average">
          <strong>${studentAverage.toFixed(1)}%</strong>
          <small>Overall average</small>
        </span>
        <span class="grade-report-performance grade-report-performance--${performanceLabel(studentAverage).toLowerCase().replaceAll(" ", "-")}">
          <small>Performance</small>
          <strong>${performanceLabel(studentAverage)}</strong>
        </span>
        <span class="grade-report-card__term">Term 1 · 2026–27</span>
      </summary>
      <div class="table-wrap grade-report-card__table">
        <table class="records-table grade-report-table">
          <caption class="sr-only">Term 1 subject scores for ${escapeHtml(student.name)}</caption>
          <thead><tr><th scope="col">Subject</th><th scope="col">Score</th><th scope="col">Letter grade</th>${canEditScores ? '<th scope="col">Action</th>' : ""}</tr></thead>
          <tbody>${scores.map((item) => `<tr data-grade-row="${student.id}">
            <td><strong>${escapeHtml(item.subject)}</strong></td>
            <td>${canEditScores && canEditGradeReport(student)
              ? `<label class="sr-only" for="grade-score-${student.id}-${escapeHtml(item.subject.replace(/[^a-z0-9]+/gi, "-"))}">${escapeHtml(student.name)} ${escapeHtml(item.subject)} score</label>
                 <input class="grade-report-score-input" id="grade-score-${student.id}-${escapeHtml(item.subject.replace(/[^a-z0-9]+/gi, "-"))}" type="number" min="0" max="100" step="1" value="${item.score}" data-grade-score data-student-id="${student.id}" data-subject="${escapeHtml(item.subject)}" />`
              : `<span class="mono">${item.score}%</span>`}</td>
            <td><span class="grade-report-mark grade-report-mark--${letterGrade(item.score).toLowerCase()}">${letterGrade(item.score)}</span></td>
            ${canEditScores && canEditGradeReport(student)
              ? `<td><button class="btn btn--ghost grade-report-save" type="button" data-save-grade data-student-id="${student.id}" data-subject="${escapeHtml(item.subject)}">Save</button></td>`
              : ""}
          </tr>`).join("")}</tbody>
        </table>
      </div>
    </details>`;
  }).join("");

  viewRoot.innerHTML = `
    <div class="view-head">
      <div class="view-head__text">
        <h2>${isStudent ? "My grade report" : "Grade reports"}</h2>
        <p>${isStudent
          ? "Your Term 1 subject scores and overall average. Only your own report is shown here."
          : user.role === "teacher"
            ? "Term 1 subject scores for students in your assigned sections."
            : "Term 1 subject scores across all students in the school."}</p>
      </div>
    </div>
    <div class="stat-strip grade-report-stats">
      ${statCard(isStudent ? "Subjects" : "Student reports", isStudent ? String(scoreRows.length) : String(students.length), isStudent ? "in this report" : "matching search")}
      ${statCard("Average score", scoreRows.length ? `${average.toFixed(1)}%` : "—", isStudent ? "across your subjects" : "across visible reports")}
      ${!isStudent ? statCard("Students needing attention", String(needsAttention), "below 70%, including failing") : ""}
      ${statCard("Reporting period", "Term 1", "school year 2026–27")}
    </div>
    ${!isStudent ? `<div class="toolbar grade-report-toolbar">
      <div class="search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <label class="sr-only" for="gradeReportSearchInput">Search grade reports</label>
        <input id="gradeReportSearchInput" type="search" value="${escapeHtml(state.gradeReportQuery)}" placeholder="Search student name, roll number or grade…" autocomplete="off" />
      </div>
      <span class="panel-head__hint">${students.length} ${students.length === 1 ? "report" : "reports"}</span>
    </div>` : ""}
    ${reports
      ? `<div class="grade-report-list">${reports}</div>`
      : `<div class="empty-state"><p class="empty-state__title">${query ? "No matching grade reports" : "No grade reports available"}</p><p class="empty-state__text">${query ? "Try another student name, roll number or grade." : user.role === "teacher" ? "There are no students in your assigned sections yet." : "Your student record could not be found. Please contact the school office."}</p></div>`}`;
}

function viewProfile() {
  const isStudentRole = can("ownRecordOnly");
  const record = isStudentRole ? visibleStudents()[0] : null;

  const identityCard = `
    <div class="side-card profile-card">
      ${avatarHtml(user.name, "avatar--lg", user.avatar || "")}
      <h3>${escapeHtml(user.name)}</h3>
      <p class="profile-card__role">${escapeHtml(user.role === "teacher" ? "Teacher" : role.label)}</p>
      <p class="profile-card__meta">${escapeHtml(user.title)}</p>
      <p class="profile-card__meta">${escapeHtml(user.email ? user.email : "Add your school email in profile settings")}</p>
      <p class="profile-card__meta">${escapeHtml(user.phone || "No contact number added")}</p>
      <p class="profile-card__note">${
        isStudentRole
          ? "Signed in with a student account — your access is limited to your own record."
          : "Signed in with a staff account. Role permissions apply to every screen in this dashboard."
      }</p>
    </div>
    <section class="side-card risky-actions-card appearance-setting-card">
      <div class="side-card__head"><h3>Appearance</h3></div>
      <label class="risky-actions-toggle" for="dashboardDarkMode">
        <span class="risky-actions-toggle__copy"><strong>Dark mode</strong><span>Use a dark color theme for this account.</span></span>
        <input id="dashboardDarkMode" class="risky-actions-toggle__input" type="checkbox" role="switch" ${state.darkMode ? "checked" : ""} />
        <span class="risky-actions-toggle__track" aria-hidden="true"></span>
      </label>
    </section>`;

  viewRoot.innerHTML = `
    <div class="view-head">
      <div class="view-head__text">
        <h2>Settings</h2>
        <p>${user.role === "admin"
          ? "Manage your administrator profile and review the access available to your account."
          : user.role === "teacher"
            ? "Manage your teacher profile and review your classroom and attendance access."
            : "Manage your student profile and review the school information available to your account."}</p>
      </div>
      <div class="section__head-actions">
        <button class="btn btn--caution" type="button" data-action-btn="sign-out">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/></svg>
          Sign out
        </button>
      </div>
    </div>
    <div class="records-layout">
      <div class="records-main">
        <section class="side-card">
          <div class="side-card__head"><h3>Profile settings</h3><span class="side-card__hint">Account details</span></div>
          <form id="profileForm" class="profile-form">
            <div class="field-grid">
              <div class="field"><label for="profileName">Display name</label><input id="profileName" name="name" required value="${escapeHtml(user.name)}" /></div>
              <div class="field"><label for="profileTitle">Role title</label><input id="profileTitle" name="title" required value="${escapeHtml(user.title)}" /></div>
              <div class="field"><label for="profileEmail">Email</label><input id="profileEmail" name="email" type="email" required value="${escapeHtml(user.email || "")}" placeholder="name@school.org" /></div>
              <div class="field"><label for="profilePhone">Contact number</label><input id="profilePhone" name="phone" type="tel" value="${escapeHtml(user.phone || "")}" /></div>
              <div class="field field--wide">
                <label for="profileAvatar">Profile picture</label>
                <div class="profile-file-picker">
                  <input class="profile-file-picker__input" id="profileAvatar" name="avatar" type="file" accept="image/*" />
                  <label class="profile-file-picker__button" for="profileAvatar">Choose file</label>
                  <span class="profile-file-picker__name" id="profileAvatarFileName" aria-live="polite"></span>
                </div>
                <p class="field__hint">Choose an image up to 2 MB, or use the initial-based avatar.</p>
                <div class="profile-picture-preview" id="profileAvatarPreview">${avatarHtml(user.name, "avatar--lg", user.avatar || "")}<span>Picture preview</span></div>
                <button class="btn btn--ghost profile-reset" type="button" data-action-btn="reset-avatar">Use initial-based avatar</button>
              </div>
            </div>
            <div class="profile-form__foot"><button class="btn btn--primary" type="submit">Save profile</button></div>
          </form>
        </section>
        ${record ? "" : `<div class="records-main">
          <div class="panel-head"><h3>Capabilities of the ${escapeHtml(role.label)} role</h3></div>
          <ul class="cap-list">${role.capabilities.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ul>
          <div class="perm-table">${permissionRows()}</div>
        </div>`}
      </div>
      <aside class="records-side">
        ${identityCard}
        ${user.role === "admin" ? `
          <section class="side-card risky-actions-card">
            <div class="side-card__head"><h3>Risky actions</h3><span class="side-card__hint">Administrator only</span></div>
            <label class="risky-actions-toggle" for="allowRiskyActions">
              <span class="risky-actions-toggle__copy"><strong>Allow risky actions</strong><span>When enabled, you can delete sections, including sections with enrolled students. Student records remain in the roster.</span></span>
              <input id="allowRiskyActions" class="risky-actions-toggle__input" type="checkbox" role="switch" ${state.allowRiskyActions ? "checked" : ""} />
              <span class="risky-actions-toggle__track" aria-hidden="true"></span>
            </label>
          </section>` : ""}
      </aside>
    </div>`;

  renderChart();
}

function requirementProgress(student) {
  const items = SCHOOL_REQUIREMENTS.map((requirement) => ({
    ...requirement,
    ...(student.requirements && student.requirements[requirement.key] ? student.requirements[requirement.key] : { status: "Missing", note: "" })
  }));
  const received = items.filter((item) => item.status === "Submitted" || (item.status === "Pending" && item.file)).length;
  return { items, received, total: items.length, percent: Math.round((received / items.length) * 100) };
}

function requirementStatusClass(status) {
  return status === "Submitted" ? "requirement-status--submitted" : status === "Pending" ? "requirement-status--pending" : "requirement-status--missing";
}

function viewRequirements() {
  const isAdmin = can("exportCsv");
  const student = isAdmin
    ? state.students.find((item) => item.id === Number(state.requirementStudentId)) || state.students[0]
    : visibleStudents()[0];

  if (!student) {
    viewRoot.innerHTML = `<div class="empty-state"><p class="empty-state__title">No student record found</p></div>`;
    return;
  }
  state.requirementStudentId = student.id;
  const progress = requirementProgress(student);
  const selector = isAdmin
    ? `<div class="requirement-student-select">${sectionFormSelect("requirementStudent", "requirementStudent", "Select student", state.students.map((item) => ({ value: String(item.id), label: `${item.name} · ${item.roll}` })), String(student.id), true)}</div>`
    : "";

  const rows = progress.items.map((item) => `
    <tr data-requirement-row="${item.key}">
      <td><strong>${escapeHtml(item.label)}</strong></td>
      <td>${escapeHtml(item.office)}</td>
      <td>${isAdmin
        ? sectionFormSelect(
            `requirement-${item.key}`,
            "requirementStatus",
            `Status for ${item.label}`,
            REQUIREMENT_STATUSES.map((status) => ({ value: status, label: status })),
            item.status,
            false,
            item.key
          )
        : `<span class="requirement-status ${requirementStatusClass(item.status)}">${item.status === "Pending" ? "Reviewing" : escapeHtml(item.status)}</span>`}</td>
      <td>
        ${isAdmin
          ? `<div class="requirement-admin-note-cell">
               <div class="requirement-admin-file">
                 <span class="${item.file ? "has-file" : ""}"${item.file ? ` title="${escapeHtml(item.file.name)}"` : ""}>${item.file ? "File attached" : "No file attached"}</span>
                 ${isAdmin && item.status === "Pending" && item.file ? `<span class="requirement-review-actions">
                   <button class="btn btn--ghost requirement-view" type="button" data-view-requirement="${item.key}" data-student-id="${student.id}" aria-label="View ${escapeHtml(item.file.name)}">View</button>
                   <button class="btn btn--ghost requirement-accept" type="button" data-requirement-decision="accept" data-requirement-key="${item.key}">Accept</button>
                   <button class="btn btn--ghost requirement-reject" type="button" data-requirement-decision="reject" data-requirement-key="${item.key}">Reject</button>
                 </span>` : ""}
                 ${item.file && item.status !== "Pending" ? `<span class="requirement-reviewed-file-actions">
                   <button class="btn btn--ghost requirement-delete-file" type="button" data-delete-requirement-file="${item.key}" data-student-id="${student.id}">Delete file</button>
                   <button class="btn btn--ghost requirement-view" type="button" data-view-requirement="${item.key}" data-student-id="${student.id}" aria-label="View ${escapeHtml(item.file.name)}">View</button>
                 </span>` : ""}
               </div>
               <label class="sr-only" for="note-${item.key}">Note for ${escapeHtml(item.label)}</label>
               ${sectionFormSelect(
                 `note-${item.key}`,
                 "requirementNote",
                 `Note for ${item.label}`,
                 [...new Set([...(item.note ? [item.note] : []), ...REQUIREMENT_NOTE_OPTIONS])].map((note) => ({ value: note, label: note })),
                 item.note || REQUIREMENT_NOTE_OPTIONS[0],
                 false,
                 "",
                 item.key
               )}
             </div>`
          : `<div class="requirement-student-note-cell">
               <div class="requirement-student-note-copy">
                 ${item.file ? `<span class="requirement-file">${escapeHtml(item.file.name)}</span>` : ""}
                 <span class="requirement-student-note">${escapeHtml(item.note || "No note provided.")}</span>
                 ${item.file ? `<small class="requirement-file-meta">${(item.file.size / 1024).toFixed(0)} KB · uploaded ${escapeHtml(item.file.uploadedAt || "")}</small>` : ""}
               </div>
               ${item.status !== "Submitted" ? `<span class="requirement-upload-action"><input class="requirement-upload" id="upload-${item.key}" type="file" accept=".pdf,image/jpeg,image/png,image/webp" data-requirement-upload="${item.key}" aria-label="${item.status === "Pending" || item.file ? "Replace" : "Upload"} ${escapeHtml(item.label)}" />
               <label class="requirement-upload-label" for="upload-${item.key}">${item.status === "Pending" || item.file ? "Replace document" : "Upload document"}</label></span>` : ""}
             </div>`}
      </td>
    </tr>`).join("");

  viewRoot.innerHTML = `
    <div class="view-head">
      <div class="view-head__text">
        <h2>${isAdmin ? "School requirements" : "My requirements"}</h2>
        <p>${isAdmin ? "Verify each required school document and leave a note for the student." : "Upload each required document for the handling office to review. Uploaded documents show as Reviewing until verified."}</p>
      </div>
      ${selector}
    </div>
    <section class="side-card requirement-summary">
      <div class="requirement-summary__top">
        <div><span class="stat__label">${escapeHtml(student.name)} · ${escapeHtml(student.roll)}</span><strong class="requirement-summary__count">${progress.received} of ${progress.total} received</strong></div>
        <strong class="requirement-summary__percent">${progress.percent}%</strong>
      </div>
      <div class="track requirement-progress" role="progressbar" aria-label="Requirements received" aria-valuemin="0" aria-valuemax="${progress.total}" aria-valuenow="${progress.received}"><i class="track__fill track__fill--mint" style="--w:${progress.percent}%"></i></div>
    </section>
    <div class="records-main">
      <div class="panel-head"><h3>Required documents</h3><span class="panel-head__hint">${progress.total} items</span></div>
      <div class="table-wrap">
        <table class="records-table requirement-table">
          <thead><tr><th scope="col">Document</th><th scope="col">Handling office</th><th scope="col">Status</th><th scope="col">Note</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${isAdmin ? `<div class="requirement-save"><button class="btn btn--primary" type="button" data-action-btn="save-requirements">Save verification</button></div>` : ""}
    </div>`;
}

function viewSections() {
  if (user.role === "teacher") {
    const sections = teacherSections();
    viewRoot.innerHTML = `
      <div class="view-head"><div class="view-head__text"><h2>My sections</h2><p>Sections assigned to you, with their room, adviser, student roster and average attendance. You can update attendance only within these sections.</p></div></div>
      ${sections.length ? `<div class="section-cards">${sections.map((section) => {
        const students = sectionStudents(section).sort((a, b) => a.name.localeCompare(b.name));
        const average = students.length ? students.reduce((sum, student) => sum + Number(student.attendance || 0), 0) / students.length : 0;
        return `<section class="records-main section-card">
          <div class="panel-head"><div><h3>${escapeHtml(section.code)} · ${escapeHtml(section.grade)}</h3><span class="section-card__meta">${escapeHtml(section.room)} · Adviser: ${escapeHtml(adviserName(section))}</span></div><span class="side-card__hint">${students.length} students</span></div>
          <div class="section-card__average"><span>Average attendance</span><strong>${average.toFixed(1)}%</strong></div>
          <div class="table-wrap">${rosterTable(students, { editable: false, attendanceEditable: true, showAmounts: false, showActions: true, hideFees: true })}</div>
        </section>`;
      }).join("")}</div>` : `<div class="empty-state"><p class="empty-state__title">No sections assigned</p><p class="empty-state__text">Ask an administrator to assign sections to your account.</p></div>`}`;
    return;
  }

  if (!can("exportCsv")) return;
  const cards = state.sections.map((section) => {
    const students = sectionStudents(section);
    const deletionDisabled = !state.allowRiskyActions;
    const deleteTitle = state.allowRiskyActions
      ? "Delete this section. Enrolled student records will remain in the roster."
      : "Enable Allow risky actions in administrator Settings to delete sections.";
    return `<form class="records-main section-admin-form" data-section-id="${escapeHtml(section.id)}">
      <div class="panel-head"><div><h3>${escapeHtml(section.code)} · ${escapeHtml(section.grade)}</h3><span class="section-card__meta">${students.length} enrolled students</span></div></div>
      <div class="section-admin-form__fields">
        <label class="field"><span>Room</span><input name="room" required value="${escapeHtml(section.room)}" /></label>
        <div class="field"><span>Adviser</span>${sectionFormSelect(`section-${section.id}-adviser`, "adviserId", "Adviser", BUILT_IN_USERS.filter((account) => account.role !== "student").map((account) => ({ value: account.id, label: `${profileFor(account).name} · ${ROLES[account.role].label}` })), section.adviserId)}</div>
      </div>
      <div class="section-admin-form__foot"><button class="btn btn--ghost" type="button" data-action="delete-section" data-id="${escapeHtml(section.id)}" title="${deleteTitle}"${deletionDisabled ? " disabled" : ""}>Delete section</button><button class="btn btn--primary" type="submit">Save section</button></div>
    </form>`;
  }).join("");

  viewRoot.innerHTML = `
    <div class="view-head"><div class="view-head__text"><h2>Sections</h2><p>Create and maintain classes, room assignments and advisers. Student class membership follows the grade and section prefix of each roll number.</p></div></div>
    <form class="records-main add-section-form" id="addSectionForm">
      <div class="panel-head"><h3>Add a section</h3></div>
      <div class="section-admin-form__fields">
        <div class="field"><span>Grade</span>${sectionFormSelect("add-section-grade", "grade", "Grade", GRADES.map((grade) => ({ value: grade, label: grade })), GRADES[0])}</div>
        <label class="field"><span>Section letter</span><input name="letter" required maxlength="1" pattern="[A-Za-z]" placeholder="e.g. A" /></label>
        <label class="field"><span>Room</span><input name="room" required placeholder="e.g. Room 112" /></label>
        <div class="field"><span>Adviser</span>${sectionFormSelect("add-section-adviser", "adviserId", "Adviser", BUILT_IN_USERS.filter((account) => account.role !== "student").map((account) => ({ value: account.id, label: `${profileFor(account).name} · ${ROLES[account.role].label}` })), BUILT_IN_USERS.find((account) => account.role !== "student").id)}</div>
      </div>
      <div class="section-admin-form__foot"><button class="btn btn--primary" type="submit">Add section</button></div>
    </form>
    <div class="section-admin-grid">${cards || `<div class="empty-state"><p class="empty-state__title">No sections yet</p></div>`}</div>`;
}

function viewAccounts() {
  if (!can("exportCsv")) return;
  const accounts = BUILT_IN_USERS.map((account) => {
    const profile = profileFor(account);
    const email = profile.email || "Email not configured";
    return `<article class="side-card staff-card">
      ${avatarHtml(profile.name, "avatar--lg", profile.avatar || "")}
      <div class="staff-card__body"><h3>${escapeHtml(profile.name)}</h3><span class="role-badge">${escapeHtml(ROLES[account.role].label)}</span>
        <p>${escapeHtml(profile.title)}</p><p>${escapeHtml(email)}</p><p>${escapeHtml(profile.phone || "No contact number")}</p>
      </div>
    </article>`;
  }).join("");
  viewRoot.innerHTML = `<div class="view-head"><div class="view-head__text"><h2>Staff &amp; accounts</h2><p>Staff directory and account access by role.</p></div></div><div class="staff-grid">${accounts}</div>`;
}

function permissionRows() {
  const checks = [
    ["Create student records", can("createStudent")],
    ["Edit student records", can("editStudent")],
    ["Delete student records", can("deleteStudent")],
    ["Update attendance", can("editAttendance")],
    ["View outstanding amounts", can("viewFeeAmounts")],
    ["Export roster to CSV", can("exportCsv")],
    ["See all grades", !perms.scopedRoster && !perms.ownRecordOnly]
  ];
  return `<ul class="perm-list">${checks
    .map(
      ([label, allowed]) => `<li class="${allowed ? "is-allowed" : "is-denied"}">
        <span class="perm-list__mark" aria-hidden="true">${allowed ? "✓" : "✕"}</span>
        <span>${escapeHtml(label)}</span>
        <span class="sr-only">${allowed ? "allowed" : "not allowed"}</span>
      </li>`
    )
    .join("")}</ul>`;
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function labelResponsiveTables() {
  viewRoot.querySelectorAll(".records-table").forEach((table) => {
    const labels = Array.from(table.querySelectorAll("thead th"), (header) => header.textContent.trim());
    table.querySelectorAll("tbody tr").forEach((row) => {
      row.querySelectorAll("td").forEach((cell, index) => {
        cell.dataset.label = labels[index] || (table.classList.contains("grade-report-table") ? "" : "Details");
      });
    });
  });
}
function renderView() {
  if (!user) return;
  document.body.classList.toggle("is-dark", state.darkMode);
  switch (state.navKey) {
    case "roster":
      viewRoster();
      break;
    case "attendance":
      viewAttendance();
      break;
    case "fees":
      viewFees();
      break;
    case "schedule":
      viewSchedule();
      break;
    case "grades":
      viewGradeReports();
      break;
    case "reports":
      if (can("exportCsv")) viewReports();
      else viewOverview();
      break;
    case "sections":
      viewSections();
      break;
    case "requirements":
      viewRequirements();
      break;
    case "accounts":
      if (can("exportCsv")) viewAccounts();
      else viewOverview();
      break;
    case "settings":
      viewProfile();
      break;
    default:
      viewOverview();
  }
  labelResponsiveTables();
  renderChart();
}

/* ---------------- Canvas chart ---------------- */
function renderChart() {
  const canvas = $("#gradeChart");
  if (!canvas) return;
  const data = window.__chartData || [];
  const ctx = canvas.getContext("2d");
  const isDark = document.body.classList.contains("is-dark");
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 320;
  const card = canvas.closest(".grade-chart-card");
  const head = card && card.querySelector(".side-card__head");
  const isOverviewCard = card && card.parentElement.classList.contains("records-side--overview");
  const isReportsCard = card && Boolean(card.closest(".reports-layout"));
  const height = isOverviewCard || isReportsCard
    ? Math.max(176, card.clientHeight - (head ? head.offsetHeight : 42) - 76)
    : Math.min(240, Math.max(176, Math.round(width * 0.36)));
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (!data.length) return;

  const maxValue = Math.max(1, ...data.map((item) => item.value));
  const scaleMax = Math.max(4, Math.ceil(maxValue / 4) * 4);
  const chartWidth = Math.min(width - 20, 880);
  const chartLeft = (width - chartWidth) / 2;
  const plotLeft = chartLeft + 30;
  const plotRight = chartLeft + chartWidth - 10;
  const pad = { top: 24, bottom: 34 };
  const plotH = height - pad.top - pad.bottom;
  const plotW = plotRight - plotLeft;
  const slot = plotW / data.length;
  const barW = Math.min(46, slot * 0.46);
  const tickStep = scaleMax / 4;

  ctx.save();
  ctx.lineWidth = 1;
  ctx.font = '600 9px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= 4; i += 1) {
    const y = pad.top + (plotH / 4) * i + 0.5;
    ctx.strokeStyle = isDark
      ? (i === 4 ? "#52637b" : "#34465f")
      : (i === 4 ? "#DCE3EF" : "#EDF1F7");
    ctx.beginPath();
    ctx.moveTo(plotLeft, y);
    ctx.lineTo(plotRight, y);
    ctx.stroke();
    ctx.fillStyle = isDark ? "#9aabc2" : "#97A4B8";
    ctx.fillText(String(Math.round(scaleMax - tickStep * i)), plotLeft - 8, y);
  }

  data.forEach((item, i) => {
    const x = plotLeft + slot * i + (slot - barW) / 2;
    const baseY = pad.top + plotH;
    const barRadius = Math.min(4, barW / 2);
    const barH = item.value ? Math.max(8, (item.value / scaleMax) * plotH) : 0;
    const y = baseY - barH;

    if (item.value) {
      ctx.beginPath();
      ctx.roundRect(x, y, barW, barH, barRadius);
      ctx.fillStyle = isDark ? "#7899d6" : "#1D61F3";
      ctx.fill();
    }

    const countText = String(item.value);
    ctx.font = '700 10px "Plus Jakarta Sans", system-ui, sans-serif';
    const badgeWidth = Math.max(24, ctx.measureText(countText).width + 12);
    const badgeHeight = 20;
    const badgeX = x + (barW - badgeWidth) / 2;
    const badgeY = item.value ? Math.max(2, y - badgeHeight - 6) : baseY - badgeHeight - 6;
    ctx.beginPath();
    ctx.roundRect(badgeX, badgeY, badgeWidth, badgeHeight, 7);
    ctx.fillStyle = isDark
      ? (item.value ? "#2b3f5d" : "#24344b")
      : (item.value ? "#E8EFFF" : "#F1F4F9");
    ctx.fill();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = isDark
      ? (item.value ? "#c1d4f4" : "#a8b8cd")
      : (item.value ? "#174FC7" : "#8491A5");
    ctx.fillText(countText, x + barW / 2, badgeY + badgeHeight / 2 + 0.5);

    ctx.font = '700 9px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.fillStyle = isDark ? "#9aabc2" : "#62728B";
    ctx.fillText(item.label, x + barW / 2, height - 12);
  });
  ctx.restore();
}

/* ---------------- Feedback ---------------- */
function toast(message, isError = false) {
  const el = document.createElement("div");
  el.className = `toast${isError ? " toast--error" : ""}`;
  el.setAttribute("role", "status");
  el.textContent = message;
  toastStack.appendChild(el);
  window.setTimeout(() => {
    el.style.transition = "opacity 220ms ease, transform 220ms ease";
    el.style.opacity = "0";
    el.style.transform = "translateY(8px)";
    window.setTimeout(() => el.remove(), 240);
  }, 3200);
}

function announce(message) {
  liveRegion.textContent = message;
}

function persist() {
  if (!saveStudents(state.students)) {
    toast("Changes could not be saved in this browser.", true);
    return false;
  }
  return true;
}

/* ---------------- Dialogs ---------------- */
let confirmResolver = null;

function askConfirm(message, okLabel = "Delete") {
  const modal = document.querySelector("#confirmModal");
  document.querySelector("#confirmText").textContent = message;
  document.querySelector("#confirmOk").textContent = okLabel;
  modal.hidden = false;
  document.querySelector("#confirmOk").focus();
  return new Promise((resolve) => {
    confirmResolver = resolve;
  });
}

function closeConfirm(result) {
  document.querySelector("#confirmModal").hidden = true;
  if (confirmResolver) {
    confirmResolver(result);
    confirmResolver = null;
  }
}

function initializeStudentFormDropdowns() {
  $("#f-grade-select").innerHTML = sectionFormSelect(
    "f-grade",
    "grade",
    "Grade",
    gradeOptions().map((grade) => ({ value: grade, label: grade })),
    gradeOptions()[0],
    false,
    "",
    "",
    true
  );
  $("#f-feeStatus-select").innerHTML = sectionFormSelect(
    "f-feeStatus",
    "feeStatus",
    "Fee status",
    FEE_STATUSES.map((status) => ({ value: status, label: status })),
    FEE_STATUSES[0],
    false,
    "",
    "",
    true
  );
}

function syncSectionSelect(select) {
  const dropdown = select.closest("[data-section-select]");
  if (!dropdown) return;
  const selectedOption = [...dropdown.querySelectorAll("[data-section-select-option]")]
    .find((option) => option.dataset.value === select.value);
  if (!selectedOption) return;
  dropdown.querySelector("[data-section-select-trigger] span").textContent = selectedOption.textContent.trim();
  dropdown.querySelectorAll("[data-section-select-option]").forEach((option) => {
    const selected = option === selectedOption;
    option.classList.toggle("is-selected", selected);
    option.setAttribute("aria-selected", String(selected));
    option.querySelector("svg")?.remove();
    if (selected) option.insertAdjacentHTML("beforeend", '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>');
  });
}

function wireStudentFormDropdowns() {
  const form = $("#studentForm");
  form.addEventListener("click", (event) => {
    const option = event.target.closest("[data-section-select-option]");
    if (option) {
      const dropdown = option.closest("[data-section-select]");
      const select = dropdown.querySelector("select");
      select.value = option.dataset.value;
      syncSectionSelect(select);
      dropdown.classList.remove("is-open");
      dropdown.querySelector("[data-section-select-trigger]").setAttribute("aria-expanded", "false");
      dropdown.querySelector(".section-select__menu").hidden = true;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      dropdown.querySelector("[data-section-select-trigger]").focus();
      return;
    }

    const trigger = event.target.closest("[data-section-select-trigger]");
    $$(".student-form-select.is-open", form).forEach((dropdown) => {
      if (dropdown === trigger?.closest("[data-section-select]")) return;
      dropdown.classList.remove("is-open");
      dropdown.querySelector("[data-section-select-trigger]").setAttribute("aria-expanded", "false");
      dropdown.querySelector(".section-select__menu").hidden = true;
    });
    if (!trigger) return;
    const dropdown = trigger.closest("[data-section-select]");
    const menu = dropdown.querySelector(".section-select__menu");
    const wasOpen = trigger.getAttribute("aria-expanded") === "true";
    if (wasOpen) {
      dropdown.classList.remove("is-open");
      trigger.setAttribute("aria-expanded", "false");
      menu.hidden = true;
      return;
    }
    dropdown.classList.add("is-open");
    trigger.setAttribute("aria-expanded", "true");
    menu.hidden = false;
    const bounds = trigger.getBoundingClientRect();
    const menuHeight = Math.min(menu.scrollHeight, 240);
    const placeAbove = window.innerHeight - bounds.bottom < menuHeight && bounds.top > window.innerHeight - bounds.bottom;
    menu.style.left = `${Math.max(8, Math.min(bounds.left, window.innerWidth - bounds.width - 8))}px`;
    menu.style.top = `${placeAbove ? Math.max(8, bounds.top - menuHeight - 7) : bounds.bottom + 7}px`;
    menu.style.width = `${bounds.width}px`;
    menu.style.maxHeight = `${Math.max(120, Math.min(240, placeAbove ? bounds.top - 15 : window.innerHeight - bounds.bottom - 15))}px`;
    dropdown.querySelector(".section-select__option.is-selected")?.focus();
  });

  form.addEventListener("keydown", (event) => {
    const trigger = event.target.closest("[data-section-select-trigger]");
    const option = event.target.closest("[data-section-select-option]");
    if (trigger && ["ArrowDown", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      trigger.click();
      if (event.key === "ArrowDown") {
        trigger.closest("[data-section-select]").querySelector(".section-select__option.is-selected")?.focus();
      }
    } else if (option && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const options = [...option.parentElement.querySelectorAll("[data-section-select-option]")];
      const currentIndex = options.indexOf(option);
      const nextIndex = event.key === "Home"
        ? 0
        : event.key === "End"
          ? options.length - 1
          : (currentIndex + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
      options[nextIndex]?.focus();
    } else if (option && event.key === "Escape") {
      event.preventDefault();
      const dropdown = option.closest("[data-section-select]");
      dropdown.classList.remove("is-open");
      dropdown.querySelector(".section-select__menu").hidden = true;
      dropdown.querySelector("[data-section-select-trigger]").setAttribute("aria-expanded", "false");
      dropdown.querySelector("[data-section-select-trigger]").focus();
    }
  });
}

function clearFieldErrors() {
  $$(".field").forEach((f) => f.classList.remove("field--error"));
  $$(".field__error").forEach((e) => {
    e.hidden = true;
    e.textContent = "";
  });
}

function showFieldError(field, message) {
  const input = $(`#studentForm [name="${field}"]`);
  const wrapper = input ? input.closest(".field") : null;
  const error = $(`[data-error-for="${field}"]`);
  if (!wrapper || !error) return;
  wrapper.classList.add("field--error");
  error.hidden = false;
  error.textContent = message;
  input.setAttribute("aria-invalid", "true");
}

function openModal(student) {
  if (!can("editStudent")) {
    toast("Your role cannot edit student records.", true);
    return;
  }
  const modal = document.querySelector("#studentModal");
  const form = document.querySelector("#studentForm");
  form.reset();
  clearFieldErrors();
  $$(".student-form-select select", form).forEach(syncSectionSelect);
  state.editingId = student ? student.id : null;
  state.lastFocused = document.activeElement;

  document.querySelector("#modalEyebrow").textContent = student ? "Updating record" : "New record";
  document.querySelector("#modalTitle").textContent = student ? `Edit ${student.name}` : "Add a student";
  document.querySelector("#modalSubmit").textContent = student ? "Save changes" : "Save student";

  if (student) {
    Object.entries({
      name: student.name,
      roll: student.roll,
      grade: student.grade,
      guardian: student.guardian,
      phone: student.phone,
      attendance: student.attendance,
      feeStatus: student.feeStatus,
      due: student.due,
      email: student.email || ""
    }).forEach(([key, value]) => {
      if (form.elements[key]) form.elements[key].value = value;
    });
    $$(".student-form-select select", form).forEach(syncSectionSelect);
  }

  modal.hidden = false;
  document.body.style.overflow = "hidden";
  window.setTimeout(() => $("#f-name").focus(), 30);
}

function closeModal() {
  document.querySelector("#studentModal").hidden = true;
  document.body.style.overflow = "";
  state.editingId = null;
  if (state.lastFocused && state.lastFocused.focus) state.lastFocused.focus();
}

function validateForm(form) {
  clearFieldErrors();
  const data = {
    name: form.elements.name.value.trim(),
    roll: form.elements.roll.value.trim(),
    grade: form.elements.grade.value,
    guardian: form.elements.guardian.value.trim(),
    phone: form.elements.phone.value.trim(),
    attendance: form.elements.attendance.value,
    feeStatus: form.elements.feeStatus.value,
    due: form.elements.due.value,
    email: form.elements.email.value.trim()
  };

  let ok = true;
  if (data.name.length < 2) { showFieldError("name", "Enter the student's full name."); ok = false; }
  if (!data.roll) { showFieldError("roll", "A roll number is required."); ok = false; }
  else if (state.students.some((s) => s.roll.toLowerCase() === data.roll.toLowerCase() && s.id !== state.editingId)) {
    showFieldError("roll", "That roll number already exists."); ok = false;
  }
  if (!data.grade) { showFieldError("grade", "Pick a grade."); ok = false; }
  if (data.guardian.length < 2) { showFieldError("guardian", "Add the guardian's name."); ok = false; }
  const digits = data.phone.replace(/\D/g, "");
  if (!data.phone) { showFieldError("phone", "A contact number is required."); ok = false; }
  else if (digits.length < 7) { showFieldError("phone", "Enter at least 7 digits."); ok = false; }
  const attendance = Number(data.attendance);
  if (data.attendance === "" || Number.isNaN(attendance)) { showFieldError("attendance", "Add an attendance percentage."); ok = false; }
  else if (attendance < 0 || attendance > 100) { showFieldError("attendance", "Use a value between 0 and 100."); ok = false; }
  if (!data.feeStatus) { showFieldError("feeStatus", "Choose a fee status."); ok = false; }
  if (data.due !== "" && (Number.isNaN(Number(data.due)) || Number(data.due) < 0)) {
    showFieldError("due", "Outstanding amount cannot be negative."); ok = false;
  }
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email)) {
    showFieldError("email", "That email address looks incomplete."); ok = false;
  }
  if (!ok) {
    const first = $("#studentForm .field--error input, #studentForm .field--error select");
    if (first) first.focus();
    return null;
  }

  return {
    name: data.name,
    roll: data.roll,
    grade: data.grade,
    guardian: data.guardian,
    phone: data.phone,
    attendance: Math.round(attendance * 10) / 10,
    feeStatus: data.feeStatus,
    due: data.feeStatus === "Paid" ? 0 : Math.max(0, Math.round(Number(data.due) || 0)),
    email: data.email
  };
}

/* ---------------- Export ---------------- */
function xmlEscape(value) {
  return String(value ?? "").replace(/[<>&\"']/g, (char) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", "\"": "&quot;", "'": "&apos;"
  })[char]);
}

function concatBytes(chunks) {
  const output = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.length, 0));
  let offset = 0;
  chunks.forEach((chunk) => { output.set(chunk, offset); offset += chunk.length; });
  return output;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function storedZip(entries) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  entries.forEach(({ name, content }) => {
    const nameBytes = encoder.encode(name);
    const contentBytes = encoder.encode(content);
    const checksum = crc32(contentBytes);
    const localHeader = new Uint8Array(30);
    const local = new DataView(localHeader.buffer);
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true);
    local.setUint32(14, checksum, true);
    local.setUint32(18, contentBytes.length, true);
    local.setUint32(22, contentBytes.length, true);
    local.setUint16(26, nameBytes.length, true);
    const localEntry = concatBytes([localHeader, nameBytes, contentBytes]);
    localParts.push(localEntry);

    const centralHeader = new Uint8Array(46);
    const central = new DataView(centralHeader.buffer);
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, 0, true);
    central.setUint32(16, checksum, true);
    central.setUint32(20, contentBytes.length, true);
    central.setUint32(24, contentBytes.length, true);
    central.setUint16(28, nameBytes.length, true);
    central.setUint32(42, localOffset, true);
    const centralEntry = concatBytes([centralHeader, nameBytes]);
    centralParts.push(centralEntry);
    localOffset += localEntry.length;
  });

  const centralDirectory = concatBytes(centralParts);
  const endHeader = new Uint8Array(22);
  const end = new DataView(endHeader.buffer);
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralDirectory.length, true);
  end.setUint32(16, localOffset, true);
  return concatBytes([...localParts, centralDirectory, endHeader]);
}

function downloadExcelWorkbook(sheetName, rows, widths) {
  const encoder = new TextEncoder();
  const columnNames = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const worksheetRows = rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => {
      const ref = `${columnNames[columnIndex]}${rowIndex + 1}`;
      if (typeof value === "number" && Number.isFinite(value)) {
        return `<c r="${ref}"><v>${value}</v></c>`;
      }
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  const columns = widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("");
  const entries = [
    { name: "[Content_Types].xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>` },
    { name: "_rels/.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>` },
    { name: "xl/worksheets/sheet1.xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${columns}</cols><sheetData>${worksheetRows}</sheetData></worksheet>` }
  ];
  return new Blob([storedZip(entries)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

function exportCsv() {
  if (!can("exportCsv")) {
    toast("Your role cannot export the roster.", true);
    return;
  }
  const list = sortStudents(filterStudents(visibleStudents(), state), state.sortKey, state.sortDir);
  if (!list.length) {
    toast("Nothing to export with these filters.", true);
    return;
  }
  const header = ["Name", "Roll", "Grade", "Guardian", "Phone", "Attendance %", "Fee status", "Outstanding", "Email", "Enrolled"];
  const rows = list.map((s) => {
    const enrolled = /^\d{4}-\d{2}-\d{2}$/.test(s.enrolled || "")
      ? `${s.enrolled.slice(5, 7)}/${s.enrolled.slice(8, 10)}/${s.enrolled.slice(2, 4)}`
      : s.enrolled;
    return [s.name, s.roll, s.grade, s.guardian, s.phone, Number(s.attendance), s.feeStatus, Number(s.due), s.email, enrolled];
  });
  const blob = downloadExcelWorkbook("Student Records", [header, ...rows], [34, 18, 16, 30, 22, 18, 18, 20, 36, 16]);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "scholix-student-records-2026-27.xlsx";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast(`Exported ${list.length} student record${list.length === 1 ? "" : "s"} to Excel.`);
  announce(`Exported ${list.length} records to an Excel workbook.`);
}

function exportReportCsv() {
  if (!can("exportCsv")) {
    toast("Your role cannot export reports.", true);
    return;
  }
  const list = visibleStudents();
  if (!list.length) {
    toast("There is no report data to export.", true);
    return;
  }

  const summary = summarize(list);
  const byGrade = gradeOptions().map((grade) => {
    const rows = list.filter((student) => student.grade === grade);
    const gradeSummary = summarize(rows);
    return [grade, rows.length, Number(gradeSummary.average.toFixed(1)), gradeSummary.duesTotal];
  });
  const rows = [
    ["Scholix School Summary Report"],
    ["Reporting period", "Term 1", "School year", "2026–27"],
    [],
    ["Overall summary"],
    ["Metric", "Value"],
    ["Student records", summary.total],
    ["Grades covered", summary.grades],
    ["Average attendance (%)", Number(summary.average.toFixed(1))],
    ["Outstanding amount", summary.duesTotal],
    ["Students with outstanding balances", summary.duesCount],
    [],
    ["Grade summary"],
    ["Grade", "Students", "Average attendance (%)", "Outstanding amount"],
    ...byGrade,
    [],
    ["Enrollment distribution"],
    ["Grade", "Students"],
    ...byGrade.map(([grade, count]) => [grade, count])
  ];
  const blob = downloadExcelWorkbook("School Summary", rows, [34, 24, 30, 22]);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "scholix-school-summary-report-2026-27.xlsx";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast("Exported the school summary report to Excel.");
  announce("Exported school summary report as an Excel workbook.");
}

/* ---------------- Sidebar (mobile) ---------------- */
function openSideNav() {
  document.querySelector("#dashSide").classList.add("is-open");
  document.querySelector("#sideOpen").setAttribute("aria-expanded", "true");
}

function closeSideNav() {
  document.querySelector("#dashSide").classList.remove("is-open");
  document.querySelector("#sideOpen").setAttribute("aria-expanded", "false");
}

async function saveRequirements(successMessage = "") {
  if (!can("exportCsv")) {
    toast("Your role cannot verify school requirements.", true);
    return;
  }
  const student = state.students.find((item) => item.id === Number(state.requirementStudentId));
  if (!student) {
    toast("Select a valid student record before saving requirements.", true);
    return;
  }
  const requirements = { ...student.requirements };
  const filesToDelete = [];
  SCHOOL_REQUIREMENTS.forEach((item) => {
    const status = $(`[data-requirement-status="${item.key}"]`);
    const note = $(`[data-requirement-note="${item.key}"]`);
    if (!status || !note || !REQUIREMENT_STATUSES.includes(status.value)) return;
    const row = $(`[data-requirement-row="${item.key}"]`);
    const current = requirements[item.key] || {};
    const next = { ...current, status: status.value, note: note.value };
    if (row && row.dataset.deleteFile === "true") {
      if (current.file) filesToDelete.push({ key: item.key, file: current.file });
      delete next.file;
    }
    requirements[item.key] = next;
  });

  const removedFiles = [];
  try {
    for (const entry of filesToDelete) {
      const stored = await loadRequirementFile(student.roll, entry.key);
      if (!stored || !stored.blob) throw new Error(`The uploaded file for ${entry.key} could not be found in this browser.`);
      await removeRequirementFile(student.roll, entry.key);
      removedFiles.push({ ...entry, stored });
    }
  } catch (error) {
    await restoreRequirementFiles(student, removedFiles);
    toast(error instanceof Error ? error.message : "Requirement file changes could not be saved.", true);
    return;
  }

  const previousStudents = state.students;
  state.students = state.students.map((item) => item.id === student.id ? { ...item, requirements } : item);
  if (!persist()) {
    state.students = previousStudents;
    await restoreRequirementFiles(student, removedFiles);
    renderView();
    return;
  }
  renderView();
  toast(successMessage || `Requirements updated for ${student.name}.`);
}

async function restoreRequirementFiles(student, entries) {
  for (const entry of entries) {
    try {
      await saveRequirementFile(student.roll, entry.key, new File(
        [entry.stored.blob],
        entry.stored.name || entry.file.name,
        { type: entry.stored.type || entry.file.type || "application/octet-stream" }
      ));
    } catch (error) {
      toast(error instanceof Error ? `Could not restore ${entry.file.name}: ${error.message}` : `Could not restore ${entry.file.name}.`, true);
    }
  }
}

async function submitRequirementFile(input) {
  const requirementKey = input.dataset.requirementUpload;
  const file = input.files && input.files[0];
  if (!file) return;
  const student = visibleStudents().find((item) => item.roll === user.studentRoll);
  if (user.role !== "student" || !student || !SCHOOL_REQUIREMENTS.some((item) => item.key === requirementKey)) {
    toast("You cannot submit a document for this student record.", true);
    input.value = "";
    return;
  }
  if (!["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    toast("Upload a PDF, JPG, PNG or WebP document.", true);
    input.value = "";
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    toast("Documents must be 10 MB or smaller.", true);
    input.value = "";
    return;
  }

  const requirement = SCHOOL_REQUIREMENTS.find((item) => item.key === requirementKey);
  const current = (student.requirements && student.requirements[requirementKey]) || {};
  const isReplacement = current.status === "Pending";
  if (current.status !== "Missing" && !isReplacement) {
    toast("This requirement has already been submitted and cannot be changed.", true);
    input.value = "";
    return;
  }
  const previous = { ...current };
  let previousStoredFile = null;
  const uploadButton = input.parentElement.querySelector(".requirement-upload-label");
  if (uploadButton) uploadButton.textContent = "Uploading…";
  input.disabled = true;
  try {
    previousStoredFile = current.file ? await loadRequirementFile(student.roll, requirementKey) : null;
    await saveRequirementFile(student.roll, requirementKey, file);
    const uploadedAt = new Date().toISOString().slice(0, 10);
    const requirements = {
      ...student.requirements,
      [requirementKey]: {
        ...current,
        status: "Pending",
        note: `Uploaded on ${uploadedAt}; awaiting ${requirement.office} verification.`,
        file: { name: file.name, type: file.type, size: file.size, uploadedAt }
      }
    };
    state.students = state.students.map((item) => item.id === student.id ? { ...item, requirements } : item);
    if (!persist()) {
      state.students = state.students.map((item) => item.id === student.id ? { ...item, requirements: { ...item.requirements, [requirementKey]: previous } } : item);
      if (previousStoredFile) {
        await saveRequirementFile(student.roll, requirementKey, new File(
          [previousStoredFile.blob],
          previousStoredFile.name,
          { type: previousStoredFile.type }
        ));
      } else {
        await removeRequirementFile(student.roll, requirementKey);
      }
      return;
    }
    renderView();
    toast(isReplacement
      ? `${requirement.label} replaced and sent for office verification.`
      : `${requirement.label} uploaded and sent for office verification.`);
  } catch (error) {
    toast(error instanceof Error ? error.message : "The document could not be uploaded.", true);
  } finally {
    input.disabled = false;
  }
}

async function viewRequirementFile(button) {
  if (!can("exportCsv")) {
    toast("Your role cannot access another student's submitted documents.", true);
    return;
  }
  const student = state.students.find((item) => item.id === Number(button.dataset.studentId));
  const requirementKey = button.dataset.viewRequirement;
  const requirement = student && student.requirements && student.requirements[requirementKey];
  if (!student || !requirement || !requirement.file) {
    toast("The uploaded document is no longer available.", true);
    return;
  }
  const viewWindow = window.open("about:blank", "_blank");
  if (!viewWindow) {
    toast("Allow pop-ups to view the uploaded document in a new tab.", true);
    return;
  }
  viewWindow.opener = null;
  viewWindow.document.title = "Loading document…";
  viewWindow.document.body.textContent = "Loading document…";
  try {
    const stored = await loadRequirementFile(student.roll, requirementKey);
    if (!stored || !stored.blob) {
      viewWindow.close();
      toast("The uploaded document could not be found in this browser.", true);
      return;
    }
    const contentType = stored.type || stored.blob.type || requirement.file.type || "application/octet-stream";
    const url = URL.createObjectURL(new Blob([stored.blob], {
      type: contentType
    }));
    viewWindow.addEventListener("pagehide", () => URL.revokeObjectURL(url), { once: true });
    viewWindow.location.replace(url);
  } catch (error) {
    viewWindow.close();
    toast(error instanceof Error ? error.message : "The uploaded document could not be viewed.", true);
  }
}

async function deleteRequirementFile(button) {
  if (!can("exportCsv")) {
    toast("Your role cannot delete another student's submitted documents.", true);
    return;
  }
  const student = state.students.find((item) => item.id === Number(button.dataset.studentId));
  const requirementKey = button.dataset.deleteRequirementFile;
  const requirement = student && student.requirements && student.requirements[requirementKey];
  const status = $(`[data-requirement-status="${requirementKey}"]`);
  if (!student || !requirement || !requirement.file || !status || status.value === "Pending") {
    toast("Only reviewed requirement files can be deleted.", true);
    return;
  }
  const confirmed = await askConfirm(
    `Mark the uploaded file for ${SCHOOL_REQUIREMENTS.find((item) => item.key === requirementKey)?.label || "this requirement"} for deletion when you save verification?`,
    "Delete file"
  );
  if (!confirmed) return;

  const row = button.closest("[data-requirement-row]");
  if (!row) return;
  row.dataset.deleteFile = "true";
  const fileLabel = row.querySelector(".requirement-admin-file > span");
  if (fileLabel) {
    fileLabel.textContent = "File will be deleted on save";
    fileLabel.removeAttribute("title");
    fileLabel.classList.remove("has-file");
  }
  row.querySelector(".requirement-admin-file .requirement-reviewed-file-actions")?.remove();
  toast("File deletion is pending. Click Save verification to apply it.");
}

function saveUserProfile(form) {
  const name = form.elements.name.value.trim();
  const title = form.elements.title.value.trim();
  const email = form.elements.email.value.trim();
  const phone = form.elements.phone.value.trim();
  if (name.length < 2 || !title || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    toast("Enter a name, role title and valid email address.", true);
    return;
  }
  if (phone && phone.replace(/\D/g, "").length < 7) {
    toast("Enter at least 7 digits for the contact number.", true);
    return;
  }
  const duplicate = BUILT_IN_USERS.some((account) => account.id !== user.id && profileFor(account).email.toLowerCase() === email.toLowerCase());
  if (duplicate) {
    toast("That email address is already used by another account.", true);
    return;
  }
  const profile = {
    name,
    title,
    email,
    phone,
    avatar: state.avatarDraft === null ? (user.avatar || "") : state.avatarDraft
  };
  if (!saveProfile(user.id, profile)) {
    toast("Profile changes could not be saved in this browser.", true);
    return;
  }
  user = { ...user, ...profile };
  state.avatarDraft = null;
  renderChrome();
  renderView();
  toast("Profile updated.");
}

function addSection(form) {
  if (!can("exportCsv")) {
    toast("Your role cannot manage sections.", true);
    return;
  }
  const grade = form.elements.grade.value;
  const letter = form.elements.letter.value.trim().toUpperCase();
  const room = form.elements.room.value.trim();
  const adviserId = form.elements.adviserId.value;
  if (!GRADES.includes(grade) || !/^[A-Z]$/.test(letter) || !room || !BUILT_IN_USERS.some((account) => account.id === adviserId && account.role !== "student")) {
    toast("Enter a valid grade, section letter, room and adviser.", true);
    return;
  }
  const code = `${grade.replace("Grade ", "")}${letter}`;
  if (state.sections.some((section) => section.code === code)) {
    toast(`${code} already exists.`, true);
    return;
  }
  state.sections.push({ id: code, code, grade, room, adviserId });
  if (!saveSections(state.sections)) {
    state.sections.pop();
    toast("Section changes could not be saved in this browser.", true);
    return;
  }
  renderView();
  toast(`${code} was added.`);
}

function updateSection(form) {
  if (!can("exportCsv")) {
    toast("Your role cannot manage sections.", true);
    return;
  }
  const section = state.sections.find((item) => item.id === form.dataset.sectionId);
  const room = form.elements.room.value.trim();
  const adviserId = form.elements.adviserId.value;
  if (!section || !room || !BUILT_IN_USERS.some((account) => account.id === adviserId && account.role !== "student")) {
    toast("Enter a valid room and adviser.", true);
    return;
  }
  const previous = { ...section };
  Object.assign(section, { room, adviserId });
  if (!saveSections(state.sections)) {
    Object.assign(section, previous);
    toast("Section changes could not be saved in this browser.", true);
    return;
  }
  renderView();
  toast(`${section.code} was updated.`);
}

/* ---------------- Events ---------------- */
function wire() {
  viewRoot.addEventListener("toggle", (event) => {
    if (!event.target.matches(".grade-report-card")) return;
    const studentId = Number(event.target.querySelector("[data-grade-row]")?.dataset.gradeRow);
    if (!studentId) return;
    if (event.target.open) state.gradeReportOpenIds.add(studentId);
    else state.gradeReportOpenIds.delete(studentId);
  }, true);

  document.querySelector("#dashNav").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-nav]");
    if (btn) setView(btn.dataset.nav);
  });

  document.querySelector("#sideOpen").addEventListener("click", openSideNav);
  document.querySelector("#sideClose").addEventListener("click", closeSideNav);
  document.querySelector("#sidebarAccount").addEventListener("click", (event) => {
    if (!event.target.closest("#sidebarSignOutBtn")) return;
    clearSession();
    window.location.href = "./login.html";
  });

  // Delegated view interactions
  viewRoot.addEventListener("click", async (event) => {
    const saveGradeButton = event.target.closest("[data-save-grade]");
    if (saveGradeButton) {
      const student = state.students.find((item) => item.id === Number(saveGradeButton.dataset.studentId));
      const subject = saveGradeButton.dataset.subject;
      const row = saveGradeButton.closest("[data-grade-row]");
      const input = row && row.querySelector("[data-grade-score]");
      const score = input ? Number(input.value) : NaN;
      if (!student || !subject || !canEditGradeReport(student) ||
          !SUBJECTS_BY_GRADE[student.grade]?.includes(subject)) {
        toast("You do not have permission to edit this grade.", true);
        renderView();
        return;
      }
      if (!input || !Number.isInteger(score) || score < 0 || score > 100) {
        toast("Enter a whole-number score from 0 to 100.", true);
        input?.focus();
        return;
      }
      const previousScores = student.subjectScores || {};
      const previousScore = previousScores[subject];
      state.students = state.students.map((item) => item.id === student.id
        ? { ...item, subjectScores: { ...previousScores, [subject]: score } }
        : item);
      if (!persist()) {
        state.students = state.students.map((item) => item.id === student.id
          ? { ...item, subjectScores: { ...previousScores, [subject]: previousScore } }
          : item);
        renderView();
        return;
      }
      renderView();
      toast(`${subject} grade for ${student.name} saved.`);
      return;
    }

    const studentRow = event.target.closest("[data-student-row]");
    if (studentRow && !event.target.closest("button, a, input, select, textarea")) {
      if (user.role !== "admin" && user.role !== "teacher") return;
      const student = visibleStudents().find((item) => item.id === Number(studentRow.dataset.studentRow));
      if (!student) {
        toast("Your role cannot open this student record.", true);
        return;
      }
      state.selectedStudentId = student.id;
      renderView();
      viewRoot.scrollIntoView({ block: "start" });
      return;
    }

    const sectionSearch = event.target.closest("[data-section-select-search]");
    if (sectionSearch) {
      const dropdown = sectionSearch.closest("[data-section-select]");
      $$(".section-select").forEach((item) => {
        item.classList.remove("is-open");
        item.querySelector("[data-section-select-trigger]")?.setAttribute("aria-expanded", "false");
        item.querySelector("[data-section-select-search]")?.setAttribute("aria-expanded", "false");
        item.querySelector(".section-select__menu").hidden = true;
      });
      dropdown.classList.add("is-open");
      sectionSearch.setAttribute("aria-expanded", "true");
      dropdown.querySelector(".section-select__menu").hidden = false;
      const query = sectionSearch.value.trim().toLocaleLowerCase();
      dropdown.querySelectorAll("[data-section-select-option]").forEach((option) => {
        option.hidden = !option.dataset.searchText.includes(query);
      });
      return;
    }

    const sectionOption = event.target.closest("[data-section-select-option]");
    if (sectionOption) {
      const dropdown = sectionOption.closest("[data-section-select]");
      const select = dropdown.querySelector("select");
      select.value = sectionOption.dataset.value;
      const trigger = dropdown.querySelector("[data-section-select-trigger]");
      if (trigger) trigger.querySelector("span").textContent = sectionOption.textContent.trim();
      const search = dropdown.querySelector("[data-section-select-search]");
      if (search) search.value = "";
      dropdown.querySelectorAll("[data-section-select-option]").forEach((option) => {
        const selected = option === sectionOption;
        option.classList.toggle("is-selected", selected);
        option.setAttribute("aria-selected", String(selected));
        option.querySelector("svg")?.remove();
        if (selected) option.insertAdjacentHTML("beforeend", '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>');
      });
      dropdown.classList.remove("is-open");
      trigger?.setAttribute("aria-expanded", "false");
      search?.setAttribute("aria-expanded", "false");
      dropdown.querySelector(".section-select__menu").hidden = true;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      trigger?.focus();
      return;
    }

    const sectionTrigger = event.target.closest("[data-section-select-trigger]");
    if (sectionTrigger) {
      const dropdown = sectionTrigger.closest("[data-section-select]");
      const wasOpen = sectionTrigger.getAttribute("aria-expanded") === "true";
      $$(".section-select").forEach((item) => {
        item.classList.remove("is-open");
        item.querySelector("[data-section-select-trigger]")?.setAttribute("aria-expanded", "false");
        item.querySelector("[data-section-select-search]")?.setAttribute("aria-expanded", "false");
        item.querySelector(".section-select__menu").hidden = true;
      });
      if (!wasOpen) {
        dropdown.classList.add("is-open");
        sectionTrigger.setAttribute("aria-expanded", "true");
        const menu = dropdown.querySelector(".section-select__menu");
        menu.hidden = false;
        if (dropdown.classList.contains("requirement-overlay-select")) {
          const bounds = sectionTrigger.getBoundingClientRect();
          const estimatedHeight = Math.min(menu.scrollHeight, 260);
          const placeAbove = window.innerHeight - bounds.bottom < estimatedHeight && bounds.top > window.innerHeight - bounds.bottom;
          const top = placeAbove
            ? Math.max(8, bounds.top - estimatedHeight - 7)
            : bounds.bottom + 7;
          menu.style.left = `${Math.max(8, Math.min(bounds.left, window.innerWidth - bounds.width - 8))}px`;
          menu.style.top = `${top}px`;
          menu.style.width = `${bounds.width}px`;
          menu.style.maxHeight = `${Math.max(120, Math.min(260, placeAbove ? bounds.top - 15 : window.innerHeight - bounds.bottom - 15))}px`;
        }
        const search = dropdown.querySelector("[data-section-select-search]");
        if (search) {
          search.value = "";
          dropdown.querySelectorAll("[data-section-select-option]").forEach((option) => { option.hidden = false; });
          search.focus();
        } else {
          dropdown.querySelector(".section-select__option.is-selected")?.focus();
        }
      }
      return;
    }

    $$(".section-select.is-open").forEach((item) => {
      item.classList.remove("is-open");
      item.querySelector("[data-section-select-trigger]")?.setAttribute("aria-expanded", "false");
      item.querySelector("[data-section-select-search]")?.setAttribute("aria-expanded", "false");
      item.querySelector(".section-select__menu").hidden = true;
    });
    const filterOption = event.target.closest("[data-filter-option]");
    if (filterOption) {
      const filter = filterOption.dataset.filterOption;
      if (filter === "gradeFilter") state.grade = filterOption.dataset.value;
      else if (filter === "statusFilter") state.status = filterOption.dataset.value;
      else if (filter === "attendanceGradeFilter") state.attendanceGrade = filterOption.dataset.value;
      else if (filter === "feeGradeFilter") state.feeGrade = filterOption.dataset.value;
      else if (filter === "feeStatusFilter") state.feeStatus = filterOption.dataset.value;
      else return;
      state.page = 1;
      renderView();
      $(`#${filter}`)?.focus();
      return;
    }

    const filterTrigger = event.target.closest("[data-filter-trigger]");
    if (filterTrigger) {
      const dropdown = filterTrigger.closest("[data-filter-dropdown]");
      const isOpen = filterTrigger.getAttribute("aria-expanded") === "true";
      $$(".filter-dropdown").forEach((item) => {
        item.classList.remove("is-open");
        item.querySelector("[data-filter-trigger]").setAttribute("aria-expanded", "false");
        item.querySelector(".filter-dropdown__menu").hidden = true;
      });
      if (!isOpen) {
        dropdown.classList.add("is-open");
        filterTrigger.setAttribute("aria-expanded", "true");
        dropdown.querySelector(".filter-dropdown__menu").hidden = false;
      }
      return;
    }

    const viewButton = event.target.closest("[data-view-requirement]");
    if (viewButton) {
      await viewRequirementFile(viewButton);
      return;
    }

    const deleteRequirementButton = event.target.closest("[data-delete-requirement-file]");
    if (deleteRequirementButton) {
      await deleteRequirementFile(deleteRequirementButton);
      return;
    }

    const decisionButton = event.target.closest("[data-requirement-decision]");
    if (decisionButton) {
      if (!can("exportCsv")) {
        toast("Your role cannot verify school requirements.", true);
        return;
      }
      const requirementKey = decisionButton.dataset.requirementKey;
      const status = $(`[data-requirement-status="${requirementKey}"]`);
      const note = $(`[data-requirement-note="${requirementKey}"]`);
      const requirement = SCHOOL_REQUIREMENTS.find((item) => item.key === requirementKey);
      if (!status || !note || !requirement || status.value !== "Pending") {
        toast("This requirement is no longer awaiting review.", true);
        renderView();
        return;
      }
      const accepted = decisionButton.dataset.requirementDecision === "accept";
      const nextStatus = accepted ? "Submitted" : "Missing";
      status.value = nextStatus;
      const dropdown = status.closest("[data-section-select]");
      const selectedOption = dropdown && dropdown.querySelector(`[data-value="${nextStatus}"]`);
      if (dropdown && selectedOption) {
        dropdown.querySelector("[data-section-select-trigger] span").textContent = nextStatus;
        dropdown.querySelectorAll("[data-section-select-option]").forEach((option) => {
          const selected = option === selectedOption;
          option.classList.toggle("is-selected", selected);
          option.setAttribute("aria-selected", String(selected));
          option.querySelector("svg")?.remove();
          if (selected) option.insertAdjacentHTML("beforeend", '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>');
        });
      }
      note.value = accepted
        ? "Received by the office."
        : "Rejected by the office. Please upload a corrected document.";
      const noteDropdown = note.closest("[data-section-select]");
      if (noteDropdown) {
        const selectedNote = [...noteDropdown.querySelectorAll("[data-section-select-option]")].find((option) => option.dataset.value === note.value);
        if (selectedNote) {
          noteDropdown.querySelector("[data-section-select-trigger] span").textContent = selectedNote.textContent.trim();
          noteDropdown.querySelectorAll("[data-section-select-option]").forEach((option) => {
            const selected = option === selectedNote;
            option.classList.toggle("is-selected", selected);
            option.setAttribute("aria-selected", String(selected));
            option.querySelector("svg")?.remove();
            if (selected) option.insertAdjacentHTML("beforeend", '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>');
          });
        }
      }
      const row = decisionButton.closest("[data-requirement-row]");
      const fileActions = row && row.querySelector(".requirement-review-actions");
      const currentStudent = state.students.find((item) => item.id === Number(state.requirementStudentId));
      const currentFile = currentStudent && currentStudent.requirements && currentStudent.requirements[requirementKey]?.file;
      if (fileActions && currentFile && currentStudent) {
        fileActions.className = "requirement-reviewed-file-actions";
        fileActions.innerHTML = `
          <button class="btn btn--ghost requirement-delete-file" type="button" data-delete-requirement-file="${requirementKey}" data-student-id="${currentStudent.id}">Delete file</button>
          <button class="btn btn--ghost requirement-view" type="button" data-view-requirement="${requirementKey}" data-student-id="${currentStudent.id}" aria-label="View ${escapeHtml(currentFile.name)}">View</button>`;
      }
      toast(`${requirement.label} ${accepted ? "accepted" : "rejected"} as a draft. Click Save verification to apply it.`);
      return;
    }

    const actionBtn = event.target.closest("[data-action-btn]");
    if (actionBtn) {
      const kind = actionBtn.dataset.actionBtn;
      if (kind === "add") openModal(null);
      else if (kind === "export") exportCsv();
      else if (kind === "export-report") exportReportCsv();
      else if (kind === "back-roster") {
        state.selectedStudentId = null;
        renderView();
      }
      else if (kind === "sign-out") {
        clearSession();
        window.location.href = "./login.html";
      }
      else if (kind === "reset-avatar") {
        state.avatarDraft = "";
        $("#profileAvatarPreview").innerHTML = `${avatarHtml(user.name, "avatar--lg")}<span>Initial-based avatar</span>`;
        $("#profileAvatar").value = "";
        $("#profileAvatarFileName").textContent = "";
      } else if (kind === "save-requirements") {
        saveRequirements();
      } else if (kind === "open-schedule") {
        setView("schedule");
      } else if (kind === "prev" && state.page > 1) { state.page -= 1; renderView(); }
      else if (kind === "next") {
        state.page += 1;
        renderView();
      } else if (kind === "reset") {
        state.query = "";
        state.grade = "all";
        state.status = "all";
        state.page = 1;
        renderView();
        toast("Filters cleared.");
      }
      return;
    }

    const rowBtn = event.target.closest("[data-action]");
    if (rowBtn) {
      if (rowBtn.dataset.action === "delete-section") {
        if (!can("exportCsv")) {
          toast("Your role cannot manage sections.", true);
          return;
        }
        if (!state.allowRiskyActions) {
          toast("Enable Allow risky actions in administrator Settings before deleting a section.", true);
          return;
        }
        const section = state.sections.find((item) => item.id === rowBtn.dataset.id);
        if (!section) return;
        const enrolledCount = sectionStudents(section).length;
        const enrollmentWarning = enrolledCount
          ? ` This will detach ${enrolledCount} enrolled student${enrolledCount === 1 ? "" : "s"} from the section, but their student records will remain in the roster.`
          : "";
        const confirmed = await askConfirm(`Delete section ${section.code} (${section.grade})?${enrollmentWarning}`, "Delete section");
        if (!confirmed) return;
        state.sections = state.sections.filter((item) => item.id !== section.id);
        if (!saveSections(state.sections)) {
          state.sections.push(section);
          toast("Section changes could not be saved in this browser.", true);
          return;
        }
        renderView();
        toast(`${section.code} was deleted.`);
        return;
      }
      const id = Number(rowBtn.dataset.id);
      const student = state.students.find((s) => s.id === id);
      if (!student) return;
      const kind = rowBtn.dataset.action;

      if (kind === "view-student") {
        if ((user.role !== "admin" && user.role !== "teacher") ||
            (user.role === "admin" && !can("editStudent")) ||
            !visibleStudents().some((item) => item.id === student.id)) {
          toast("Your role cannot open this student record.", true);
          return;
        }
        state.selectedStudentId = student.id;
        renderView();
        viewRoot.scrollIntoView({ block: "start" });
      } else if (kind === "edit") {
        openModal(student);
      } else if (kind === "attendance") {
        openAttendancePrompt(student);
      } else if (kind === "delete") {
        const confirmed = await askConfirm(
          `${student.name} (${student.roll}) will be removed from the roster. This cannot be undone.`
        );
        if (!confirmed) return;
        state.students = state.students.filter((s) => s.id !== id);
        persist();
        renderView();
        toast(`${student.name} was removed.`);
        announce(`${student.name} deleted from the roster.`);
      }
    }
  });

  viewRoot.addEventListener("keydown", (event) => {
    const trigger = event.target.closest("[data-section-select-trigger]");
    const option = event.target.closest("[data-section-select-option]");
    const search = event.target.closest("[data-section-select-search]");
    if (trigger && event.key === "ArrowDown") {
      event.preventDefault();
      trigger.click();
    } else if (search && event.key === "Escape") {
      event.preventDefault();
      const dropdown = search.closest("[data-section-select]");
      dropdown.classList.remove("is-open");
      dropdown.querySelector(".section-select__menu").hidden = true;
      search.setAttribute("aria-expanded", "false");
      search.focus();
    } else if (search && event.key === "Enter") {
      const firstMatch = search.closest("[data-section-select]").querySelector("[data-section-select-option]:not([hidden])");
      if (firstMatch) {
        event.preventDefault();
        firstMatch.click();
      }
    } else if (option && event.key === "Escape") {
      event.preventDefault();
      const dropdown = option.closest("[data-section-select]");
      dropdown.querySelector("[data-section-select-trigger]").click();
      dropdown.querySelector("[data-section-select-trigger]").focus();
    } else if (option && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      const options = [...option.parentElement.querySelectorAll("[data-section-select-option]")];
      const nextIndex = (options.indexOf(option) + (event.key === "ArrowDown" ? 1 : options.length - 1)) % options.length;
      options[nextIndex].focus();
    }
  });

  viewRoot.addEventListener("input", (event) => {
    if (event.target.matches("[data-section-select-search]")) {
      const query = event.target.value.trim().toLocaleLowerCase();
      const dropdown = event.target.closest("[data-section-select]");
      dropdown.classList.add("is-open");
      event.target.setAttribute("aria-expanded", "true");
      dropdown.querySelector(".section-select__menu").hidden = false;
      dropdown.querySelectorAll("[data-section-select-option]").forEach((option) => {
        option.hidden = !option.dataset.searchText.includes(query);
      });
      return;
    }

    if (event.target.id === "searchInput" || event.target.id === "attendanceSearchInput" || event.target.id === "scheduleSearchInput" || event.target.id === "feesSearchInput" || event.target.id === "gradeReportSearchInput") {
      const isAttendanceSearch = event.target.id === "attendanceSearchInput";
      const isScheduleSearch = event.target.id === "scheduleSearchInput";
      const isFeesSearch = event.target.id === "feesSearchInput";
      const isGradeReportSearch = event.target.id === "gradeReportSearchInput";
      if (isAttendanceSearch) state.attendanceQuery = event.target.value;
      else if (isScheduleSearch) state.scheduleQuery = event.target.value;
      else if (isFeesSearch) state.feeQuery = event.target.value;
      else if (isGradeReportSearch) state.gradeReportQuery = event.target.value;
      else state.query = event.target.value;
      state.page = 1;
      const caret = event.target.selectionStart;
      renderView();
      const next = isAttendanceSearch ? $("#attendanceSearchInput") : isScheduleSearch ? $("#scheduleSearchInput") : isFeesSearch ? $("#feesSearchInput") : isGradeReportSearch ? $("#gradeReportSearchInput") : $("#searchInput");
      if (next) {
        next.focus();
        next.setSelectionRange(caret, caret);
      }
    }
  });

  viewRoot.addEventListener("change", async (event) => {
    if (event.target.id === "dashboardDarkMode") {
      const enabled = event.target.checked;
      try {
        localStorage.setItem(DASHBOARD_THEME_STORAGE_KEY, String(enabled));
      } catch {
        event.target.checked = state.darkMode;
        toast("Dark-mode preference could not be saved. The setting was not changed.", true);
        return;
      }
      state.darkMode = enabled;
      document.body.classList.toggle("is-dark", enabled);
      renderChart();
      toast(enabled ? "Dark mode enabled for this dashboard." : "Light mode enabled for this dashboard.");
    } else if (event.target.id === "allowRiskyActions") {
      if (user.role !== "admin") {
        toast("Only administrators can change risky-action settings.", true);
        renderView();
        return;
      }
      try {
        localStorage.setItem(RISKY_ACTIONS_STORAGE_KEY, String(event.target.checked));
      } catch {
        toast("Risky-action preference could not be saved. The setting was not changed.", true);
        renderView();
        return;
      }
      state.allowRiskyActions = event.target.checked;
      // Keep the current switch in the DOM until its CSS transition finishes.
      window.setTimeout(renderView, 300);
      toast(state.allowRiskyActions
        ? "Risky actions enabled. Sections can now be deleted after confirmation."
        : "Risky actions disabled. Section deletion is locked.");
    } else if (event.target.id === "requirementStudent") {
      state.requirementStudentId = Number(event.target.value);
      renderView();
    } else if (event.target.id === "profileAvatar") {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) {
        toast("Choose a JPG, PNG, WebP or GIF image.", true);
        event.target.value = "";
        $("#profileAvatarFileName").textContent = "";
        return;
      }
      if (file.size > 2 * 1024 * 1024) {
        toast("Profile pictures must be 2 MB or smaller.", true);
        event.target.value = "";
        $("#profileAvatarFileName").textContent = "";
        return;
      }
      $("#profileAvatarFileName").textContent = file.name;
      const reader = new FileReader();
      reader.addEventListener("load", () => {
        if (typeof reader.result !== "string") {
          toast("The selected profile picture could not be read.", true);
          return;
        }
        state.avatarDraft = reader.result;
        const preview = $("#profileAvatarPreview");
        if (preview) preview.innerHTML = `${avatarHtml(user.name, "avatar--lg", reader.result)}<span>Picture preview</span>`;
      });
      reader.addEventListener("error", () => toast("The selected profile picture could not be read.", true));
      reader.readAsDataURL(file);
    } else if (event.target.matches("[data-requirement-upload]")) {
      await submitRequirementFile(event.target);
    }
  });

  viewRoot.addEventListener("keydown", (event) => {
    const trigger = event.target.closest("[data-filter-trigger]");
    const option = event.target.closest("[data-filter-option]");
    if (trigger && ["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      const dropdown = trigger.closest("[data-filter-dropdown]");
      const menu = dropdown.querySelector(".filter-dropdown__menu");
      if (menu.hidden) {
        $$(".filter-dropdown").forEach((item) => {
          item.classList.remove("is-open");
          item.querySelector("[data-filter-trigger]").setAttribute("aria-expanded", "false");
          item.querySelector(".filter-dropdown__menu").hidden = true;
        });
        menu.hidden = false;
        dropdown.classList.add("is-open");
        trigger.setAttribute("aria-expanded", "true");
      }
      const options = $$("[data-filter-option]", menu);
      const selected = options.find((item) => item.getAttribute("aria-selected") === "true") || options[0];
      const target = event.key === "ArrowUp" ? options[options.length - 1] : selected;
      if (target) target.focus();
    } else if (option && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const options = $$("[data-filter-option]", option.closest(".filter-dropdown__menu"));
      const currentIndex = options.indexOf(option);
      const nextIndex = event.key === "Home"
        ? 0
        : event.key === "End"
          ? options.length - 1
          : (currentIndex + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
      options[nextIndex]?.focus();
    } else if (event.key === "Escape" && (trigger || option)) {
      const dropdown = event.target.closest("[data-filter-dropdown]");
      const button = dropdown.querySelector("[data-filter-trigger]");
      dropdown.classList.remove("is-open");
      button.setAttribute("aria-expanded", "false");
      dropdown.querySelector(".filter-dropdown__menu").hidden = true;
      button.focus();
    }
  });

  document.addEventListener("click", (event) => {
    if (event.target.closest(".filter-dropdown")) return;
    $$(".filter-dropdown.is-open").forEach((dropdown) => {
      dropdown.classList.remove("is-open");
      dropdown.querySelector("[data-filter-trigger]").setAttribute("aria-expanded", "false");
      dropdown.querySelector(".filter-dropdown__menu").hidden = true;
    });
  });

  viewRoot.addEventListener("submit", (event) => {
    const form = event.target;
    if (form.id === "profileForm") {
      event.preventDefault();
      saveUserProfile(form);
    } else if (form.id === "addSectionForm") {
      event.preventDefault();
      addSection(form);
    } else if (form.matches("form[data-section-id]")) {
      event.preventDefault();
      updateSection(form);
    }
  });

  // Attendance quick edit dialog
  document.querySelector("#attendanceModal").addEventListener("submit", (event) => {
    event.preventDefault();
    const modal = document.querySelector("#attendanceModal");
    const id = Number(modal.dataset.studentId);
    const attendanceInput = document.querySelector("#a-value");
    const absencesInput = document.querySelector("#a-absences");
    const lateInput = document.querySelector("#a-late");
    const value = Number(attendanceInput.value);
    const absences = Number(absencesInput.value);
    const lateArrivals = Number(lateInput.value);
    const error = document.querySelector("#attendanceError");
    if (!attendanceInput.value.trim() || Number.isNaN(value) || value < 0 || value > 100) {
      error.hidden = false;
      error.textContent = "Use an attendance percentage between 0 and 100.";
      return;
    }
    if (!absencesInput.value.trim() || !Number.isInteger(absences) || absences < 0 ||
        !lateInput.value.trim() || !Number.isInteger(lateArrivals) || lateArrivals < 0) {
      error.hidden = false;
      error.textContent = "Absences and late arrivals must be whole numbers of 0 or more.";
      return;
    }
    error.hidden = true;
    const index = state.students.findIndex((s) => s.id === id);
    if (index === -1) {
      modal.hidden = true;
      document.body.style.overflow = "";
      toast("That student record no longer exists.", true);
      return;
    }
    if (!canEditAttendance(state.students[index])) {
      modal.hidden = true;
      document.body.style.overflow = "";
      toast("Your role cannot change attendance for this student.", true);
      return;
    }
    const name = state.students[index].name;
    const previous = state.students[index];
    state.students[index] = {
      ...previous,
      attendance: Math.round(value * 10) / 10,
      absences,
      lateArrivals
    };
    if (!persist()) {
      state.students[index] = previous;
      return;
    }
    modal.hidden = true;
    document.body.style.overflow = "";
    renderView();
    toast(`Attendance updated for ${name}.`);
    announce(`Attendance for ${name} set to ${value} percent, with ${absences} absences and ${lateArrivals} late arrivals.`);
  });

  document.querySelectorAll("[data-close-attendance]").forEach((el) =>
    el.addEventListener("click", () => {
      document.querySelector("#attendanceModal").hidden = true;
      document.body.style.overflow = "";
    })
  );

  // Student modal
  document.querySelector("#modalClose").addEventListener("click", closeModal);
  document.querySelectorAll("[data-close-modal]").forEach((el) => el.addEventListener("click", closeModal));

  document.querySelector("#studentForm").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!can("editStudent")) {
      toast("Your role cannot edit student records.", true);
      return;
    }
    const payload = validateForm(event.target);
    if (!payload) {
      toast("Please fix the highlighted fields.", true);
      return;
    }
    if (state.editingId) {
      const index = state.students.findIndex((s) => s.id === state.editingId);
      const existing = state.students[index];
      state.students[index] = {
        ...existing,
        ...payload,
        subjectScores: seedSubjectScores(existing.id, payload.grade, existing.subjectScores)
      };
      persist();
      closeModal();
      renderView();
      toast(`${payload.name}'s record was updated.`);
      announce(`${payload.name} updated.`);
    } else {
      const nextId = state.students.reduce((max, s) => Math.max(max, s.id), 0) + 1;
      const requirements = Object.fromEntries(SCHOOL_REQUIREMENTS.map((item) => [item.key, { status: "Missing", note: "Please upload here or submit to the handling office." }]));
      const newStudent = {
        id: nextId,
        enrolled: new Date().toISOString().slice(0, 10),
        absences: 0,
        lateArrivals: 0,
        requirements,
        ...payload,
        subjectScores: seedSubjectScores(nextId, payload.grade)
      };
      state.students.unshift(newStudent);
      if (!persist()) {
        state.students.shift();
        return;
      }
      closeModal();
      renderView();
      toast(`${payload.name} was added to the roster.`);
      announce(`${payload.name} added to the roster.`);
    }
  });
  wireStudentFormDropdowns();

  // Confirmation dialog
  document.querySelector("#confirmModal").addEventListener("click", (event) => {
    if (event.target.closest("[data-confirm-cancel]")) closeConfirm(false);
    else if (event.target.closest("[data-confirm-ok]")) closeConfirm(true);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!document.querySelector("#confirmModal").hidden) closeConfirm(false);
    else if (!document.querySelector("#studentModal").hidden) closeModal();
    else if (!document.querySelector("#attendanceModal").hidden) {
      document.querySelector("#attendanceModal").hidden = true;
      document.body.style.overflow = "";
    } else closeSideNav();
  });

  let resizeTimer;
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(renderChart, 140);
  });
}

/* ---------------- Attendance dialog (built once) ---------------- */
function openAttendancePrompt(student) {
  if (!canEditAttendance(student)) {
    toast("Your role cannot change attendance.", true);
    return;
  }
  const modal = document.querySelector("#attendanceModal");
  modal.dataset.studentId = String(student.id);
  modal.querySelector("#attendanceStudent").textContent = `${student.name} · ${student.roll} · ${student.grade}`;
  modal.querySelector("#a-value").value = String(student.attendance);
  modal.querySelector("#a-absences").value = String(student.absences || 0);
  modal.querySelector("#a-late").value = String(student.lateArrivals || 0);
  modal.querySelector("#attendanceError").hidden = true;
  modal.hidden = false;
  document.body.style.overflow = "hidden";
  window.setTimeout(() => modal.querySelector("#a-value").focus(), 30);
}

function buildAttendanceModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal";
  wrap.id = "attendanceModal";
  wrap.hidden = true;
  wrap.innerHTML = `
    <div class="modal__backdrop" data-close-attendance></div>
    <div class="modal__dialog modal__dialog--attendance" role="dialog" aria-modal="true" aria-labelledby="attendanceTitle">
      <div class="modal__head">
        <div>
          <p class="eyebrow">Update attendance</p>
          <h2 id="attendanceTitle">Attendance percentage</h2>
        </div>
        <button class="icon-btn" type="button" data-close-attendance aria-label="Close dialog">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </div>
      <form class="modal__form" id="attendanceForm">
        <p class="form-subject" id="attendanceStudent">—</p>
        <div class="field-grid field-grid--attendance">
          <div class="field">
            <label for="a-value">Attendance % <span aria-hidden="true">*</span></label>
            <input id="a-value" name="attendance" type="number" min="0" max="100" step="0.1" required />
          </div>
          <div class="field">
            <label for="a-absences">Absences recorded</label>
            <input id="a-absences" name="absences" type="number" min="0" step="1" required />
          </div>
          <div class="field">
            <label for="a-late">Late arrivals recorded</label>
            <input id="a-late" name="lateArrivals" type="number" min="0" step="1" required />
          </div>
        </div>
        <div class="field">
          <p class="field__error" id="attendanceError" hidden></p>
        </div>
        <div class="modal__foot">
          <button class="btn btn--ghost" type="button" data-close-attendance>Cancel</button>
          <button class="btn btn--primary" type="submit">Save attendance</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(wrap);
}

/* ---------------- Boot ---------------- */
function init() {
  if (!user) return;
  document.body.classList.toggle("is-dark", state.darkMode);
  if (user.role === "admin") state.allowRiskyActions = loadRiskyActionsPreference();
  state.students = loadStudents();
  state.sections = loadSections();
  buildAttendanceModal();
  initializeStudentFormDropdowns();
  document.querySelector("#year") && (document.querySelector("#year").textContent = String(new Date().getFullYear()));
  renderChrome();
  wire();
  renderView();
  window.setInterval(updateScheduleClocks, 30000);
}

init();




