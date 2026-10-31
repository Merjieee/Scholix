import {
  FEE_STATUSES,
  GRADES,
  BUILT_IN_USERS,
  CLASS_PERIODS,
  FEE_CATEGORIES,
  FEE_SCHEDULE,
  ATTENDANCE_WEEKDAYS,
  ATTENDANCE_WEEKDAYS_SHORT,
  ATTENDANCE_STATUSES,
  REQUIREMENT_STATUSES,
  REQUIREMENT_NOTE_OPTIONS,
  ROLES,
  SCHOOL_REQUIREMENTS,
  SCHOOL_DAYS_PER_YEAR,
  SUBJECTS_BY_GRADE,
  attendanceBar,
  avatarHtml,
  assignStudentsToSection,
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
/* ---------------- Session & permissions ---------------- */
let user = requireUser("./login.php");
const RISKY_MODE_STORAGE_KEY = "scholix.risky-mode";
const DASHBOARD_THEME_STORAGE_KEY = `scholix.dashboard.dark-mode.${user?.id || "anonymous"}`;
function loadDashboardDarkMode() {
  try {
    const adminLightDefaultKey = `scholix.dashboard.admin-light-default.v3.${user?.id || "anonymous"}`;
    if (user?.role === "admin" && localStorage.getItem(adminLightDefaultKey) !== "true") {
      localStorage.setItem(DASHBOARD_THEME_STORAGE_KEY, "false");
      localStorage.setItem(adminLightDefaultKey, "true");
      return false;
    }
    return localStorage.getItem(DASHBOARD_THEME_STORAGE_KEY) === "true";
  } catch { return false; }
}
const role = user ? ROLES[user.role] : null;
const perms = user ? resolvePermissions(user) : null;

const state = {
  students: [],
  sections: [],
  weeklyUsage: {},
  navKey: "overview",
  query: "",
  grade: "all",
  attendanceGrade: "all",
  attendanceQuery: "",
  attendancePage: 1,
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
  riskyMode: false,
  darkMode: loadDashboardDarkMode(),
  lastFocused: null,
  assigningSectionId: null,
  notifications: [],
  unreadNotifications: 0,
  attendanceCalendarMonth: null
};

const viewRoot = document.querySelector("#viewRoot");
const toastStack = document.querySelector("#toastStack");
const liveRegion = document.querySelector("#liveRegion");
let sidebarIntroPlayed = false;
let animateViewOnNextRender = false;

// Keep modern View Transition pseudo-element styling out of the main CSS file so older CSS validators do not flag it.
const themeTransitionStyle = document.createElement("style");
themeTransitionStyle.textContent = `
  ::view-transition,
  ::view-transition-old(root),
  ::view-transition-new(root) { pointer-events: none; }
  ::view-transition-old(root),
  ::view-transition-new(root) {
    animation: none;
    mix-blend-mode: normal;
  }
  ::view-transition-new(root) {
    z-index: 1;
    clip-path: circle(0 at var(--theme-origin-x, 50%) var(--theme-origin-y, 50%));
    animation: dashboard-theme-spread 3500ms cubic-bezier(0.2, 0.72, 0.2, 1) forwards;
  }
  ::view-transition-old(root) { z-index: 0; }
  @keyframes dashboard-theme-spread {
    to { clip-path: circle(160vmax at var(--theme-origin-x, 50%) var(--theme-origin-y, 50%)); }
  }
  @media (prefers-reduced-motion: reduce) {
    ::view-transition-new(root) { animation-duration: 1ms !important; }
  }
`;
document.head.append(themeTransitionStyle);

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* ---------------- Permission helpers ---------------- */
const can = (permission) => Boolean(perms && perms[permission]);

function overviewEmptyIcon() {
  return `<span class="overview-empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="m5 19 7-7M4 8l1.5 1.5M11 3v2M19 8h2M17.5 4.5 19 3M8 14l2 2 7-7-2-2-7 7Z"/><path d="m13 19 1 2 1-2 2-1-2-1-1-2-1 2-2 1 2 1Z"/></svg></span>`;
}

function loadRiskyModePreference() {
  try {
    return localStorage.getItem(RISKY_MODE_STORAGE_KEY) === "true";
  } catch {
    toast("Safe-mode preference could not be read. Delete protection remains off.", true);
    return false;
  }
}

function deletionLocked() {
  return state.riskyMode;
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
    name: ATTENDANCE_WEEKDAYS[dayIndex] || ""
  };
}

function isSchoolDayToday() {
  const weekday = new Date().getDay();
  return weekday >= 1 && weekday <= 5;
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
  return "Finished";
}

function clockTime() {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date());
}

function scheduleRows(section, dayIndex, teacherIndex = null) {
  const subjects = SUBJECTS_BY_GRADE[section.grade] || Object.values(SUBJECTS_BY_GRADE)[0] || [];
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

function scheduleTable(rows, { showSection = false, showTeacher = false, showStudents = false, studentView = false, compactMobile = false, tabletDesktop = false, assumeUpcoming = false } = {}) {
  if (!rows.length) return `<div class="empty-state schedule-empty"><p class="empty-state__title">No classes scheduled</p><p class="empty-state__text">There are no sections assigned for this school day.</p></div>`;
  return `<div class="table-wrap${tabletDesktop ? " tablet-schedule-wrap" : ""}"><table class="records-table schedule-table${studentView ? " student-schedule-table" : ""}${compactMobile ? " compact-schedule-table" : ""}${tabletDesktop ? " tablet-desktop-schedule-table" : ""}">
    <thead><tr><th scope="col">Time</th>${showSection ? '<th scope="col">Section</th>' : ""}<th scope="col">Subject</th><th scope="col">Room</th>${showTeacher ? '<th scope="col">Teacher</th>' : ""}${showStudents ? '<th scope="col">No. of Students</th>' : ""}<th scope="col" class="schedule-status-column">Status</th></tr></thead>
    <tbody>${rows.map((row) => {
      const status = assumeUpcoming ? "Upcoming" : scheduleStatus(row.start, row.end);
      const students = showStudents ? String(sectionStudents(row.section).length) : "";
      return `<tr class="${status === "In progress" ? "schedule-row--active" : ""}">
        <td class="mono schedule-time">${row.start}–${row.end}</td>
        ${showSection ? `<td>${escapeHtml(row.section.code)} · ${escapeHtml(row.section.grade)}</td>` : ""}
        <td><strong>${escapeHtml(row.subject)}</strong></td>
        <td>${escapeHtml(row.room)}</td>
        ${showTeacher ? `<td>${escapeHtml(adviserName(row.section))}</td>` : ""}
        ${showStudents ? `<td>${escapeHtml(students)}</td>` : ""}
        <td class="schedule-status-column"><span class="schedule-status schedule-status--${status.toLowerCase().replace(" ", "-")}" data-schedule-status${assumeUpcoming ? ' data-schedule-preview="true"' : ""} data-start="${row.start}" data-end="${row.end}">${status}</span></td>
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
  if (!section) return `<div class="side-card schedule-card"><div class="panel-head"><h3>Learning schedule</h3></div><div class="overview-empty-block schedule-card__empty">${overviewEmptyIcon()}<p class="side-empty">Your section and room schedule have not been assigned yet. Please contact the school office.</p></div></div>`;
  const day = schoolDay();
  const previewNextSchoolDay = !isSchoolDayToday();
  const rows = scheduleRows(section, day.dayIndex);
  const upcomingRows = (previewNextSchoolDay ? rows.slice(0, 3) : rows.filter((row) => ["Upcoming", "In progress"].includes(scheduleStatus(row.start, row.end))).slice(0, 3));
  const visibleRows = compact ? upcomingRows : rows;
  const scheduleDateLabel = previewNextSchoolDay ? `${day.name}, ${day.date}` : `${day.label} · ${day.name}, ${day.date}`;
  return `<section class="records-main schedule-card${compact ? " schedule-card--today" : ""}">
    <div class="panel-head schedule-card__head">
      <div><h3>${previewNextSchoolDay ? "Next school day" : compact ? "Today's learning" : "My class schedule"}</h3><span class="schedule-day">${scheduleDateLabel}</span></div>
      <div class="schedule-card__actions">
        <span class="schedule-live"><i></i><span class="schedule-clock">${clockTime()}</span> local time</span>
        ${compact ? `<button class="btn btn--ghost schedule-card__open" type="button" data-action-btn="open-schedule">View full schedule</button>` : ""}
      </div>
    </div>
    <div class="schedule-class-meta"><span>${escapeHtml(section.code)} · ${escapeHtml(section.grade)}</span><span>Adviser: ${escapeHtml(adviserName(section))}</span></div>
    ${compact
      ? `${visibleRows.length ? scheduleTable(visibleRows, { studentView: true, compactMobile: true, assumeUpcoming: previewNextSchoolDay }) : '<div class="table-wrap" hidden></div>'}<div class="schedule-today-empty overview-empty-block"${visibleRows.length ? " hidden" : ""}>${overviewEmptyIcon()}<p>${previewNextSchoolDay ? "No classes scheduled for the next school day." : "No upcoming classes today."}</p></div>`
      : scheduleTable(visibleRows, { studentView: true, compactMobile: true, assumeUpcoming: previewNextSchoolDay })}
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
  const previewNextSchoolDay = !isSchoolDayToday();
  const rows = sections.flatMap((section, index) => scheduleRows(section, day.dayIndex, index));
  const activeRows = previewNextSchoolDay ? [] : rows.filter((row) => scheduleStatus(row.start, row.end) === "In progress");
  const upcomingRows = previewNextSchoolDay ? rows.slice(0, 3) : rows.filter((row) => scheduleStatus(row.start, row.end) === "Upcoming").slice(0, 2);
  const visibleRows = [...activeRows, ...upcomingRows];

  return `<section class="records-main schedule-card ongoing-schedule-card">
    <div class="panel-head schedule-card__head">
      <div><h3>${previewNextSchoolDay ? "Next school day" : "Ongoing schedule"}</h3><span class="schedule-day">${previewNextSchoolDay ? `${day.name}, ${day.date}` : `${day.label} · ${day.name}, ${day.date}`}</span></div>
      <span class="schedule-live"><i></i><span class="schedule-clock">${clockTime()}</span> local time</span>
    </div>
    ${visibleRows.length
      ? scheduleTable(visibleRows, { showSection: true, compactMobile: true, assumeUpcoming: previewNextSchoolDay })
      : `<div class="empty-state schedule-empty overview-empty-state">${overviewEmptyIcon()}<p class="empty-state__title">No classes in progress or coming up</p><p class="empty-state__text">Your next assigned class will appear here.</p></div>`}
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
              : scheduleTable(adminRows, { showSection: true, showTeacher: true, showStudents: true, tabletDesktop: true })}
          </section>`
        : teacherScheduleView()}`;
}

function updateScheduleClocks() {
  let advanceOverviewSchedule = false;
  $$(".schedule-clock").forEach((clock) => { clock.textContent = clockTime(); });
  $$("[data-schedule-status]").forEach((status) => {
    if (status.dataset.schedulePreview === "true") {
      status.textContent = "Upcoming";
      status.className = "schedule-status schedule-status--upcoming";
      status.closest("tr")?.classList.remove("schedule-row--active");
      return;
    }
    const value = scheduleStatus(status.dataset.start, status.dataset.end);
    const previousValue = status.textContent.trim();
    if (value === "Finished" && previousValue !== "Finished" && state.navKey === "overview" && ["student", "teacher"].includes(user?.role)) {
      advanceOverviewSchedule = true;
    }
    status.textContent = value;
    status.className = `schedule-status schedule-status--${value.toLowerCase().replace(" ", "-")}`;
    status.closest("tr").classList.toggle("schedule-row--active", value === "In progress");
  });
  $$(".schedule-card--today").forEach((card) => {
    const rows = $$("tbody tr", card);
    rows.forEach((row) => {
      row.hidden = row.querySelector("[data-schedule-status]")?.textContent.trim() === "Finished";
    });
    const hasUpcomingClasses = rows.some((row) => !row.hidden);
    const tableWrap = card.querySelector(".table-wrap");
    const emptyMessage = card.querySelector(".schedule-today-empty");
    if (tableWrap) tableWrap.hidden = !hasUpcomingClasses;
    if (emptyMessage) emptyMessage.hidden = hasUpcomingClasses;
  });
  if (advanceOverviewSchedule) renderView();
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
      label: user.role === "student" || user.role === "teacher" ? "My schedule" : "Schedule",
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
        <button class="dash__nav-item${item.key === state.navKey ? " is-active" : ""}" type="button" data-nav="${item.key}"${item.key === state.navKey ? ' aria-current="page" disabled' : ""}>
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

let notificationCloseTimer = null;

function installDashboardMotionStyles() {
  if (document.querySelector("#scholixMotionStyles")) return;
  const style = document.createElement("style");
  style.id = "scholixMotionStyles";
  style.textContent = `
    .notification-panel { border-radius: 8px !important; opacity: 0; transform: translateY(-7px) scale(.985); transition: opacity 170ms ease, transform 170ms cubic-bezier(.2,.7,.25,1); transform-origin: top right; }
    .notification-entry { position: relative; min-width: 0; }
    .notification-entry .notification-item { width: 100%; border-radius: 5px !important; text-align: left; padding-right: 38px !important; }
    .notification-delete { position: absolute; top: 5px; right: 6px; display: inline-grid; place-items: center; width: 25px; height: 25px; padding: 0; border: 0; border-radius: 4px; color: var(--muted, #718096); background: transparent; font: inherit; font-size: 20px; line-height: 1; cursor: pointer; transition: color 140ms ease, background 140ms ease; }
    .notification-delete:hover, .notification-delete:focus-visible { color: #d64545; background: #ffe7e7; outline: none; }
    .notification-delete svg { display: block; width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 2.6; stroke-linecap: round; }
    .notification-panel.is-open { opacity: 1; transform: translateY(0) scale(1); }
    .notification-panel.is-closing { opacity: 0; transform: translateY(-5px) scale(.99); pointer-events: none; }
    .dash__nav-item:disabled { cursor: default; opacity: 1; }
    .dash__side-head .brand { overflow: clip; }
    .dashboard-brand-slide { animation: scholix-dashboard-brand-slide 1600ms cubic-bezier(.2,.72,.2,1) both; }
    .dashboard-stagger-enter { animation: scholix-dashboard-stagger-in 620ms cubic-bezier(.2,.72,.2,1) backwards; }
    .dashboard-control-enter { animation: scholix-dashboard-control-in 420ms cubic-bezier(.2,.72,.2,1) backwards; }
    .dashboard-button-enter { animation: scholix-dashboard-button-in 380ms cubic-bezier(.2,.72,.2,1) backwards; }
    @keyframes scholix-dashboard-brand-slide {
      from { opacity: 0; transform: translateX(-26px); }
      to { opacity: 1; transform: translateX(0); }
    }
    @keyframes scholix-dashboard-stagger-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes scholix-dashboard-control-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes scholix-dashboard-button-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @media (prefers-reduced-motion: reduce) {
      .dashboard-brand-slide, .dashboard-stagger-enter, .dashboard-control-enter, .dashboard-button-enter { animation: none !important; }
    }
    @media screen and (min-width: 701px) and (max-width: 1080px) {
      .staff-grid { grid-template-columns: minmax(0, 1fr); gap: 8px; }
      .staff-card { min-height: 68px; align-items: center; gap: 12px; padding: 9px 14px; border-radius: 9px; }
      .staff-card .avatar--lg { width: 34px; height: 34px; flex: none; }
      .staff-card__body { flex: 1; display: grid; grid-template-columns: minmax(125px, 1fr) minmax(100px, .8fr) minmax(140px, 1.2fr) minmax(95px, .8fr); grid-template-rows: auto auto; align-items: center; column-gap: 12px; row-gap: 2px; }
      .staff-card__body h3 { grid-column: 1; grid-row: 1; font-size: 13px; line-height: 1.25; }
      .staff-card__body .role-badge { grid-column: 1; grid-row: 2; justify-self: start; width: max-content; padding: 2px 7px; font-size: 10px; }
      .staff-card__body p:nth-of-type(1) { grid-column: 2; grid-row: 1 / span 2; margin: 0; }
      .staff-card__body p:nth-of-type(2) { grid-column: 3; grid-row: 1 / span 2; margin: 0; }
      .staff-card__body p:nth-of-type(3) { grid-column: 4; grid-row: 1 / span 2; margin: 0; }
    }
  `;
  document.head.appendChild(style);
}

function setNotificationPanelOpen(open) {
  const trigger = $("#notificationTrigger");
  const panel = $("#notificationPanel");
  if (notificationCloseTimer) {
    window.clearTimeout(notificationCloseTimer);
    notificationCloseTimer = null;
  }
  trigger.setAttribute("aria-expanded", String(open));
  if (open) {
    panel.hidden = false;
    panel.classList.remove("is-closing");
    window.requestAnimationFrame(() => panel.classList.add("is-open"));
    return;
  }
  panel.classList.remove("is-open");
  panel.classList.add("is-closing");
  notificationCloseTimer = window.setTimeout(() => {
    panel.hidden = true;
    panel.classList.remove("is-closing");
    notificationCloseTimer = null;
  }, 180);
}


function staggerEntrance(elements, totalDuration = 3000, animationDuration = 620) {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const step = elements.length > 1 ? (totalDuration - animationDuration) / (elements.length - 1) : 0;
  elements.forEach((element, index) => {
    element.style.animationDuration = `${animationDuration}ms`;
    element.style.animationDelay = `${Math.round(index * step)}ms`;
    element.classList.add("dashboard-stagger-enter");
  });
}

function staggerButtons(elements, startDelay = 1300, sequenceDuration = 1700, animationDuration = 400) {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const step = elements.length > 1 ? (sequenceDuration - animationDuration) / (elements.length - 1) : 0;
  elements.forEach((element, index) => {
    element.style.animationDuration = `${animationDuration}ms`;
    element.style.animationDelay = `${Math.round(startDelay + index * step)}ms`;
    element.classList.add("dashboard-button-enter");
  });
}

function animateBrandEntrance() {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const mark = document.querySelector(".dash__side-head .brand__mark");
  const text = document.querySelector(".dash__side-head .brand__text");
  if (mark) {
    mark.style.animationDuration = "1600ms";
    mark.style.animationDelay = "0ms";
    mark.classList.add("dashboard-brand-slide");
  }
  if (text) {
    text.style.animationDuration = "1800ms";
    text.style.animationDelay = "1200ms";
    text.classList.add("dashboard-brand-slide");
  }
}
function animateAppChromeEntrance() {
  if (sidebarIntroPlayed) return;
  const items = Array.from(document.querySelectorAll(
    ".dash__side-close, #dashNav .dash__nav-label, #dashNav .dash__nav-item, #sidebarAccount, .dashbar .brand, .dashbar button, #notificationTrigger, .notification-trigger, .dashbar__notification, .dashbar__user"
  ));
  staggerEntrance(items, 2000, 500);
  sidebarIntroPlayed = true;
}

function animateDashboardContent() {
  const selector = ".dash__hero, .view-head, .view-notice, .stat-strip > .stat, .records-main, .side-card, .section-card, .staff-card, .grade-report-card, .empty-state, .student-detail-card, .student-own-record, .student-subjects-card, .student-follow-up, .student-card, .schedule-card, .mini-feed__item, .profile-form > .field-grid > .field__hint, .panel-head, .toolbar, .search, .filter-dropdown, .section-select, .select, .field, .records-table thead, .records-table tbody tr, .table-foot, .form-actions, .attendance-panel-actions, button";
  const items = Array.from(viewRoot.querySelectorAll(selector))
    .filter((element) => element.getClientRects().length > 0);
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const isStudentFeeView = state.navKey === "fees" && perms.ownRecordOnly;
  const animationDuration = isStudentFeeView ? 350 : 500;
  const sequenceDuration = isStudentFeeView ? 800 : 2000;
  const delayStep = items.length > 1 ? (sequenceDuration - animationDuration) / (items.length - 1) : 0;
  items.forEach((element, index) => {
    const isButton = element.matches("button");
    const isControl = element.matches(".toolbar, .search, .filter-dropdown, .section-select, .select, .field");
    element.style.animationDelay = `${Math.round(index * delayStep)}ms`;
    element.style.animationDuration = `${animationDuration}ms`;
    element.classList.add(isButton ? "dashboard-button-enter" : isControl ? "dashboard-control-enter" : "dashboard-stagger-enter");
  });
}
function setView(key) {
  if (key === state.navKey) return;
  state.navKey = key;
  state.page = 1;
  animateViewOnNextRender = true;
  $$(".dash__nav-item").forEach((btn) => {
    const isActive = btn.dataset.nav === key;
    btn.classList.toggle("is-active", isActive);
    btn.disabled = isActive;
    if (isActive) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  });
  closeSideNav();
  renderView();
}

/* ---------------- Shared view pieces ---------------- */
function statPresentation(label, value = "") {
  const key = String(label).toLocaleLowerCase();
  const status = String(value).toLocaleLowerCase();
  if (/average attendance/.test(key)) return { tone: "blue", icon: '<path d="M3 3v18h18M7 14l4-4 4 3 6-7"/>' };
  if (/recognition/.test(key)) {
    if (/highest honor/.test(status)) return { tone: "purple", icon: '<path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>' };
    if (/high honor/.test(status)) return { tone: "teal", icon: '<path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>' };
    if (/^honor$/.test(status)) return { tone: "amber", icon: '<path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>' };
    if (/achiever/.test(status)) return { tone: "blue", icon: '<path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>' };
    return { tone: "amber", icon: '<path d="M12 3 22 21H2L12 3z"/><path d="M12 9v5m0 3h.01"/>' };
  }
  if (/average grade/.test(key)) return { tone: "purple", icon: '<path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>' };
  if (/fee status/.test(key)) {
    if ((user && user.role === "admin") || /^\d+\s*\/\s*\d+$/.test(status)) return { tone: "amber", icon: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M3 10h18M7 15h3"/>' };
    if (status === "paid") return { tone: "green", icon: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M3 10h18m-11 4 2 2 4-4"/>' };
    if (status === "partial") return { tone: "amber", icon: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M3 10h18m-6 4h2"/>' };
    return { tone: "coral", icon: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M3 10h18m4 4h2"/>' };
  }
  if (/missing documents/.test(key)) return Number(value) === 0
    ? { tone: "green", icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6m-11 5 2 2 4-4"/>' }
    : { tone: "amber", icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M12 11v4m0 3h.01"/>' };
  if (/\bstanding\b/.test(key)) {
    if (/excellent/.test(status)) return { tone: "green", icon: '<circle cx="12" cy="8" r="5"/><path d="m8.5 12-1 9 4.5-3 4.5 3-1-9"/>' };
    if (/needs attention/.test(status)) return { tone: "coral", icon: '<path d="M12 3 22 21H2L12 3z"/><path d="M12 9v5m0 3h.01"/>' };
    if (/on track/.test(status)) return { tone: "teal", icon: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/><path d="M22 2 12 12m0-5v5h5" stroke-width="2.4"/>' };
    return { tone: "blue", icon: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/><path d="M22 2 12 12m0-5v5h5" stroke-width="2.4"/>' };
  }
  if (/subject/.test(key)) return { tone: "teal", icon: '<path d="M12 7v14m0-14C10 5 7 4 3 4v14c4 0 7 1 9 3m0-14c2-2 5-3 9-3v14c-4 0-7 1-9 3"/>' };
  if (/period/.test(key)) return { tone: "slate", icon: '<path d="m2 10 10-5 10 5-10 5z"/><path d="M6 12v5c4 3 8 3 12 0v-5M22 10v6"/>' };
  if (/needs? attention|needing attention|failing|unpaid/.test(key)) return { tone: "coral", icon: '<path d="M12 3 22 21H2L12 3z"/><path d="M12 9v5m0 3h.01"/>' };
  if (/absence/.test(key)) return { tone: "coral", icon: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M12 13v3M12 18h.01"/>' };
  if (/below 85/.test(key)) return { tone: "coral", icon: '<path d="M4 5v14h16"/><path d="m7 8 4 3 4-1 4 5m-4 0h4v-4"/>' };
  if (/late/.test(key)) {
    if (user && user.role === "student") return { tone: "amber", icon: '<circle cx="12" cy="12" r="8"/><path d="M12 6.5V12l4 2.5"/><path d="M2.4 7.5c-1 2.5-1 6.5 0 9M21.6 7.5c1 2.5 1 6.5 0 9"/>' };
    return { tone: "amber", icon: '<path d="M14 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9"/><path d="M14 7v10M9 12h12m-4-4 4 4-4 4"/>' };
  }
  if (/pending|awaiting|follow up|conversation/.test(key)) return { tone: "amber", icon: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>' };
  if (/above 95/.test(key)) return { tone: "green", icon: '<path d="M7 4h10v5a5 5 0 0 1-10 0V4zM7 6H4v2a4 4 0 0 0 4 4m9-6h3v2a4 4 0 0 1-4 4M12 14v4m-4 2h8m-6-2h4"/>' };
  if (/school performance/.test(key)) return { tone: "green", icon: '<path d="M3 20h18M5 16l5-5 4 3 6-8M16 6h4v4"/>' };
  if (/paid|excellent|settled|received|complete/.test(key)) return { tone: "green", icon: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>' };
  if (/partial/.test(key)) return { tone: "amber", icon: '<path d="M11 3a9 9 0 1 0 10 10H11z"/><path d="M13 3v8h8a9 9 0 0 0-8-8z"/>' };
  if (/outstanding|balance/.test(key)) return { tone: "purple", icon: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M7 9a2 2 0 0 0-2 2m12 4a2 2 0 0 0 2-2M12 8v8m2-6h-3a1.5 1.5 0 0 0 0 3h2a1.5 1.5 0 0 1 0 3h-3"/>' };
  if (/fee|dues|outstanding|balance|payment/.test(key)) return { tone: "purple", icon: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M3 10h18M7 15h3"/>' };
  if (/attendance/.test(key)) return { tone: "blue", icon: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/><path d="m8 15 2.5 2.5L16 12"/>' };
  if (/average/.test(key)) return { tone: "blue", icon: '<path d="M3 3v18h18M7 14l4-4 4 3 6-7"/>' };
  if (/student reports/.test(key)) return { tone: "teal", icon: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>' };
  if (/report/.test(key)) return { tone: "indigo", icon: '<path d="M4 19V5M4 19h17M8 16v-4M13 16V8M18 16v-7"/>' };
  if (/recently added/.test(key)) return { tone: "cyan", icon: '<circle cx="9" cy="7" r="4"/><path d="M3 21v-2a6 6 0 0 1 12 0v2M19 8v6m-3-3h6"/>' };
  if (/student|record|tracked|roster/.test(key)) return { tone: "teal", icon: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>' };
  if (/grade|score|term/.test(key)) return { tone: "indigo", icon: '<path d="M4 19V5M4 19h17M8 16v-4M13 16V8M18 16v-7"/>' };
  if (/section|schedule|class/.test(key)) return { tone: "amber", icon: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 14h2M14 14h2"/>' };
  if (/requirement|document/.test(key)) return { tone: "teal", icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6m-11 5 2 2 4-4"/>' };
  return { tone: "blue", icon: '<path d="M4 19V5M4 19h17M8 16v-4M13 16V8M18 16v-6"/>' };
}

function statCard(label, value, note) {
  const presentation = statPresentation(label, value);
  if (String(label).toLocaleLowerCase() === "students") presentation.tone = "teal";
  if (String(label).toLocaleLowerCase() === "records") presentation.tone = "amber";
  return '<div class="stat stat--' + presentation.tone + '">' +
    '<span class="stat__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + presentation.icon + '</svg></span>' +
    '<div class="stat__content"><span class="stat__label">' + escapeHtml(label) + '</span>' +
    '<strong class="stat__value">' + escapeHtml(value) + '</strong>' +
    '<span class="stat__note">' + escapeHtml(note) + '</span></div></div>';
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
          ${avatarHtml(s.name, "", s.avatar || "")}
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
        ${showContactColumn || showGuardianPhoneColumn ? "" : `<span class="student-cell__meta guardian-phone">${escapeHtml(s.guardianPhone ?? s.phone ?? "")}</span>`}
      </td>
      ${showContactColumn || showGuardianPhoneColumn
        ? `<td class="guardian-phone">${escapeHtml(s.guardianPhone ?? s.phone ?? "")}</td>`
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
                    <button class="icon-btn icon-btn--delete" type="button" data-action="delete" data-id="${s.id}" aria-label="Delete record for ${escapeHtml(s.name)}" title="${deletionLocked() ? "Safe mode is on; deletion is disabled." : "Delete record"}"${deletionLocked() ? " disabled" : ""}>
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

function studentSubjectChartCard(student) {
  const scores = Object.entries(student?.subjectScores || {})
    .map(([subject, score]) => ({ subject, score: Number(score) }))
    .filter((item) => Number.isFinite(item.score) && item.score >= 0 && item.score <= 100);
  return `<section class="side-card student-subject-chart">
    <div class="side-card__head student-subject-chart__head"><h3>Grades by subject</h3></div>
    ${scores.length
      ? `<div class="student-subject-chart__list" role="list">${scores.map(({ subject, score }) => `<div class="student-subject-chart__row" role="listitem">
          <div class="student-subject-chart__label"><span>${escapeHtml(subject)}</span><strong>${score.toFixed(1)}%</strong></div>
          <div class="student-subject-chart__track" role="progressbar" aria-label="${escapeHtml(subject)} score" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${score}"><span style="width:${score}%"></span></div>
        </div>`).join("")}</div>`
      : `<div class="overview-empty-block student-subject-chart__empty">${overviewEmptyIcon()}<p class="side-empty">No subject scores recorded yet.</p></div>`}
  </section>`;
}

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function currentWeekStart() {
  const monday = new Date();
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday;
}

function formatUsageTime(seconds) {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return hours ? `${hours}h ${remainingMinutes}m` : `${remainingMinutes}m`;
}

function weeklyUsageCard() {
  const monday = currentWeekStart();
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    const key = localDateKey(date);
    return {
      key,
      day: new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date),
      date: new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date),
      seconds: Number(state.weeklyUsage[key] || 0)
    };
  });
  const totalSeconds = days.reduce((total, day) => total + day.seconds, 0);
  return `<section class="side-card weekly-hour-log" aria-label="Weekly active system usage">
    <div class="side-card__head"><div><h3>Weekly hour log</h3><span class="grade-chart-card__caption weekly-hour-log__total">${formatUsageTime(totalSeconds)} active this week</span></div></div>
    <canvas class="weekly-hour-log__chart" id="weeklyUsageChart" role="img" aria-label="Bar graph of active Scholix usage for each day this week">${days.map((day) => `${day.day}: ${formatUsageTime(day.seconds)}`).join(", ")}</canvas>
  </section>`;
}

function renderWeeklyUsageCard() {
  const total = $(".weekly-hour-log__total");
  if (total) {
    const monday = currentWeekStart();
    const seconds = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + index);
      return Number(state.weeklyUsage[localDateKey(date)] || 0);
    }).reduce((sum, value) => sum + value, 0);
    total.textContent = `${formatUsageTime(seconds)} active this week`;
  }
  renderWeeklyUsageChart();
}

let weeklyUsageChartAnimated = false;
function renderWeeklyUsageChart() {
  const canvas = $("#weeklyUsageChart");
  if (!canvas) return;
  const monday = currentWeekStart();
  const data = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    return {
      label: new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date),
      seconds: Number(state.weeklyUsage[localDateKey(date)] || 0)
    };
  });
  const width = canvas.clientWidth || 320;
  const height = Math.max(150, canvas.clientHeight || 190);
  const dpr = window.devicePixelRatio || 1;
  const isDark = document.body.classList.contains("is-dark");
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const maxSeconds = Math.max(3600, ...data.map((item) => item.seconds));
  const scaleMax = Math.ceil(maxSeconds / 3600);
  const pad = { top: 24, right: 8, bottom: 25, left: 30 };
  const plotHeight = height - pad.top - pad.bottom;
  const plotWidth = width - pad.left - pad.right;
  const slot = plotWidth / data.length;
  const barWidth = Math.min(54, slot * 0.8);
  const shouldAnimate = !weeklyUsageChartAnimated && data.some((item) => item.seconds > 0);
  if (shouldAnimate) weeklyUsageChartAnimated = true;

  const draw = (progress) => {
    ctx.clearRect(0, 0, width, height);
    ctx.font = '600 9px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let tick = 0; tick <= 4; tick += 1) {
      const y = pad.top + (plotHeight / 4) * tick + 0.5;
      ctx.strokeStyle = isDark ? (tick === 4 ? "#52637b" : "#34465f") : (tick === 4 ? "#DCE3EF" : "#EDF1F7");
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y); ctx.stroke();
      ctx.fillStyle = isDark ? "#9aabc2" : "#97A4B8";
      ctx.fillText(`${(scaleMax * (4 - tick) / 4).toFixed(scaleMax < 2 ? 1 : 0)}h`, pad.left - 5, y);
    }
    data.forEach((item, index) => {
      const x = pad.left + slot * index + (slot - barWidth) / 2;
      const baseY = pad.top + plotHeight;
      const barHeight = item.seconds ? Math.max(5, (item.seconds / (scaleMax * 3600)) * plotHeight * progress) : 0;
      if (barHeight) {
        ctx.beginPath(); ctx.roundRect(x, baseY - barHeight, barWidth, barHeight, Math.min(4, barWidth / 2));
        ctx.fillStyle = isDark ? "#7899d6" : "#1D61F3"; ctx.fill();
      }
      const value = formatUsageTime(item.seconds);
      ctx.font = '700 8px "Plus Jakarta Sans", system-ui, sans-serif';
      const badgeWidth = Math.max(25, ctx.measureText(value).width + 10);
      const badgeX = x + (barWidth - badgeWidth) / 2;
      const badgeY = item.seconds ? Math.max(1, baseY - barHeight - 22) : baseY - 22;
      ctx.beginPath(); ctx.roundRect(badgeX, badgeY, badgeWidth, 17, 6);
      ctx.fillStyle = isDark ? (item.seconds ? "#2b3f5d" : "#24344b") : (item.seconds ? "#E8EFFF" : "#F1F4F9"); ctx.fill();
      ctx.fillStyle = isDark ? (item.seconds ? "#c1d4f4" : "#a8b8cd") : (item.seconds ? "#174FC7" : "#8491A5");
      ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(value, x + barWidth / 2, badgeY + 9);
      ctx.font = '700 11px "Plus Jakarta Sans", system-ui, sans-serif';
      ctx.fillStyle = isDark ? "#9aabc2" : "#62728B"; ctx.fillText(item.label, x + barWidth / 2, height - 9);
    });
  };

  if (!shouldAnimate || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { draw(1); return; }
  const startTime = performance.now();
  const animate = (time) => {
    const progress = Math.min(1, (time - startTime) / 700);
    const eased = 1 - Math.pow(1 - progress, 3);
    draw(eased);
    if (progress < 1) requestAnimationFrame(animate);
  };
  requestAnimationFrame(animate);
}

async function loadWeeklyUsage() {
  const weekStart = localDateKey(currentWeekStart());
  try {
    const response = await fetch(`../api.php?action=usage_time&weekStart=${encodeURIComponent(weekStart)}`, { credentials: "same-origin", headers: { Accept: "application/json" } });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Usage log could not be loaded.");
    state.weeklyUsage = payload.value?.days && typeof payload.value.days === "object" ? payload.value.days : {};
    renderWeeklyUsageCard();
  } catch { /* Keep the dashboard available if the usage summary cannot load. */ }
}

function startUsageTracking() {
  if (!user) return;
  let lastActivity = 0;
  let lastTick = Date.now();
  let pendingSeconds = 0;
  let flushInProgress = false;
  const markActive = () => { lastActivity = Date.now(); };
  ["pointerdown", "keydown", "scroll", "touchstart"].forEach((eventName) => document.addEventListener(eventName, markActive, { passive: true }));

  const flush = (keepalive = false) => {
    if (pendingSeconds < 1 || flushInProgress) return;
    const seconds = Math.min(90, pendingSeconds);
    pendingSeconds -= seconds;
    flushInProgress = true;
    const body = JSON.stringify({ date: localDateKey(), seconds });
    fetch("../api.php?action=usage_time_add", {
      method: "POST", credentials: "same-origin", keepalive,
      headers: { "Content-Type": "application/json", Accept: "application/json" }, body
    }).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Usage could not be saved.");
      const date = payload.date || localDateKey();
      state.weeklyUsage[date] = Number(payload.seconds || 0);
      renderWeeklyUsageCard();
    }).catch(() => { pendingSeconds = Math.min(90, pendingSeconds + seconds); }).finally(() => { flushInProgress = false; });
  };

  window.setInterval(() => {
    const now = Date.now();
    const elapsed = Math.min(30, Math.max(0, Math.floor((now - lastTick) / 1000)));
    lastTick = now;
    if (document.visibilityState === "visible" && lastActivity && now - lastActivity < 5 * 60 * 1000) {
      pendingSeconds = Math.min(90, pendingSeconds + elapsed);
      const today = localDateKey();
      state.weeklyUsage[today] = Number(state.weeklyUsage[today] || 0) + elapsed;
      renderWeeklyUsageCard();
      if (pendingSeconds >= 60) flush();
    }
  }, 15000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(true); });
  window.addEventListener("pagehide", () => flush(true));
  loadWeeklyUsage();
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
          ${avatarHtml(s.name, "", s.avatar || "")}
          <span class="due-item__body">
            <span class="due-item__name">${escapeHtml(s.name)}</span>
            <span class="due-item__grade">${escapeHtml(s.grade)} · ${escapeHtml(s.roll)}</span>
          </span>
          <span class="due-item__amt">${showAmounts ? money(s.due) : "Due"}</span>
        </li>`
        )
        .join("")}</ul>`
    : perms.ownRecordOnly
      ? `<div class="overview-empty-block">${overviewEmptyIcon()}<p class="side-empty">No outstanding fee balance.</p></div>`
      : `<div class="overview-empty-block">${overviewEmptyIcon()}<p class="side-empty">Every fee in scope is settled. Nothing to chase today.</p></div>`;
  const studentBody = student
    ? `<div class="student-follow-up">
        <div class="student-follow-up__section">
          ${missingRequirements.length
            ? `<ul class="student-follow-up__list">${missingRequirements.map((requirement) => {
                return `<li><strong>${escapeHtml(requirement.label)}</strong></li>`;
              }).join("")}</ul>`
            : `<div class="overview-empty-block">${overviewEmptyIcon()}<p class="side-empty">No requirements are marked missing.</p></div>`}
        </div>
      </div>`
    : body;

  return `<div class="side-card">
      <div class="side-card__head"><h3>${perms.ownRecordOnly ? "Missing requirements" : "Fee to follow-up"}</h3>${perms.ownRecordOnly ? "" : `<span class="side-card__hint">${overdue.length} student${overdue.length === 1 ? "" : "s"}</span>`}</div>
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


  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const currentMonthLabel = new Intl.DateTimeFormat(undefined, { month: "long" }).format(now);
  const wasAddedThisMonth = (student) => {
    if (user.role === "teacher" && student.sectionAssignedAt) {
      const assigned = String(student.sectionAssignedAt);
      if (/^\d{4}-\d{2}-\d{2}/.test(assigned)) return assigned.slice(0, 7) === currentMonthKey;
    }
    const enrollment = String(student.enrolled || "");
    if (/^\d{4}-\d{2}-\d{2}/.test(enrollment)) return enrollment.slice(0, 7) === currentMonthKey;
    const enrolledDate = new Date(enrollment);
    return !Number.isNaN(enrolledDate.getTime()) && enrolledDate.getFullYear() === now.getFullYear() && enrolledDate.getMonth() === now.getMonth();
  };
  const recent = perms.ownRecordOnly ? [] : [...list].filter(wasAddedThisMonth).sort((a, b) => {
    const dateA = Date.parse(a.enrolled || "") || 0;
    const dateB = Date.parse(b.enrolled || "") || 0;
    return dateB - dateA || Number(b.id || 0) - Number(a.id || 0);
  });
  const studentsNeedingAttention = sortStudents(
    list.filter((student) => Number(student.attendance) < 75),
    "attendance",
    "asc"
  ).slice(0, 5);

  const cards = [];
  if (perms.ownRecordOnly && list[0]) {
    const student = list[0];
    const subjectScores = Object.values(student.subjectScores || {}).map(Number).filter((score) => Number.isFinite(score) && score >= 0 && score <= 100);
    const averageGrade = subjectScores.length ? subjectScores.reduce((sum, score) => sum + score, 0) / subjectScores.length : null;
    const missingDocuments = Object.values(student.requirements || {}).filter((requirement) => requirement?.status === "Missing").length;
    const feeNote = Number(student.due || 0) > 0 ? `${money(student.due)} remaining` : "fully settled";
    cards.push(
      statCard("Average attendance", `${Number(student.attendance || 0).toFixed(1)}%`, "your recorded attendance"),
      statCard("Fee status", student.feeStatus || "Unpaid", feeNote),
      statCard("Average grade", averageGrade === null ? "—" : `${averageGrade.toFixed(1)}%`, `across ${subjectScores.length} subjects`),
      statCard("Missing documents", String(missingDocuments), missingDocuments ? "still to submit" : "all requirements submitted")
    );
  }
  if (!perms.ownRecordOnly) {
    const s = summarize(list);
    cards.push(
      statCard("Students", String(s.total), scopeNote),
      statCard("Avg. attendance", s.total ? `${s.average.toFixed(1)}%` : "—", s.low ? `${s.low} below 85%` : "all above 85%"),
      statCard("Fee status", `${s.paid}/${s.total}`, "fully paid"),
      statCard("Recently added", String(recent.length), user.role === "teacher" ? "students in class" : "this month")
    );
  }


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

    </section>

    ${cards.length ? `<div class="stat-strip">${cards.join("")}</div>` : ""}

    ${perms.ownRecordOnly ? "" : `<div class="records-layout records-layout--overview">
      <div class="records-main">
        <div class="panel-head"><h3>Students needing attention</h3></div>
        <div class="table-wrap">${studentsNeedingAttention.length
          ? rosterTable(
              studentsNeedingAttention,
              { editable: false, attendanceEditable: false, showAmounts: can("viewFeeAmounts"), showActions: false, hideFees: user.role === "teacher" }
            )
          : `<div class="empty-state overview-empty-state overview-empty-state--attendance"><span class="overview-empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z"/><path d="m7.5 12.2 3 3L16.8 9"/></svg></span><p class="empty-state__text">All students in your scope are at or above 75% attendance.</p></div>`}</div>
      </div>
    </div>`}
    <aside class="records-side records-side--overview${perms.ownRecordOnly ? " records-side--overview--student" : user.role === "teacher" ? " records-side--overview--teacher" : ""}">
      ${perms.ownRecordOnly
        ? `<div class="student-overview-main-row">${studentScheduleCard({ compact: true })}${studentSubjectChartCard(list[0])}</div>`
        : gradeChartCard(list)}
      ${user.role === "teacher" ? teacherOngoingScheduleCard() : ""}
      ${user.role === "student" && list[0]
        ? `<div class="overview-followup-row">${dueListCard(list, false)}${weeklyUsageCard()}</div>`
        : user.role === "teacher" ? "" : dueListCard(list, can("viewFeeAmounts"))}
    </aside>

    ${perms.ownRecordOnly ? "" : `<div class="overview-followup-row">
    <div class="side-card overview-recent-card">
      <div class="side-card__head"><div><h3>Recently added records</h3></div></div>
      <ul class="mini-feed">
        ${recent.length ? recent
          .map(
            (s2) => `<li class="mini-feed__item">
              ${avatarHtml(s2.name, "", s2.avatar || "")}
              <span class="mini-feed__body">
                <span class="mini-feed__name">${escapeHtml(s2.name)}</span>
                <span class="mini-feed__meta">${escapeHtml(s2.grade)} · joined ${escapeHtml(formatDate(s2.enrolled))}</span>
              </span>
            </li>`
          )
          .join("") : `<li class="mini-feed__empty"><span class="overview-empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M16 20v-1.5a4.5 4.5 0 0 0-4.5-4.5h-3A4.5 4.5 0 0 0 4 18.5V20M10 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM19 8v6M16 11h6"/></svg></span><span>${user.role === "teacher" ? "No students were added in your class yet." : "No students were added this month yet."}</span></li>`}
      </ul>
    </div>
    ${weeklyUsageCard()}
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
      <div><dt>Attendance</dt><dd>${Number(record.attendance || 0).toFixed(1)}%</dd></div>
      <div><dt>Fee status</dt><dd>${statusPill(record.feeStatus)}</dd></div>
      <div><dt>Outstanding balance</dt><dd>${record.due > 0 ? money(record.due) : "Fully settled"}</dd></div>
      <div><dt>Guardian</dt><dd>${escapeHtml(record.guardian)}<br /><small>${escapeHtml(record.guardianPhone ?? record.phone ?? "")}</small></dd></div>
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
  const subjects = SUBJECTS_BY_GRADE[student.grade] || Object.values(SUBJECTS_BY_GRADE)[0] || [];
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
          <div><dt>Guardian phone</dt><dd>${escapeHtml(student.guardianPhone ?? student.phone ?? "")}</dd></div>
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
  const subjects = SUBJECTS_BY_GRADE[student.grade] || Object.values(SUBJECTS_BY_GRADE)[0] || [];
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
  const attendancePageCount = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  state.attendancePage = Math.min(state.attendancePage, attendancePageCount);
  const attendanceStart = (state.attendancePage - 1) * PAGE_SIZE;
  const attendanceRows = list.slice(attendanceStart, attendanceStart + PAGE_SIZE);
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
        statCard("ABSENCES", String(absencesForAttendance(ownRecord)), "recorded school days missed"),
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

    ${ownRecord ? studentAttendanceCalendar(ownRecord) : ""}

    ${perms.ownRecordOnly ? "" : `<div class="records-main">
      <div class="panel-head fees-panel-head">
        <h3>Lowest attendance first</h3>
        <div class="attendance-panel-actions">
          ${filterDropdown("attendanceGradeFilter", "Grade", attendanceGradeOptions, state.attendanceGrade)}
          <span class="panel-head__hint">${list.length} ${searchQuery || state.attendanceGrade !== "all" ? "shown" : "in scope"}</span>
        </div>
      </div>
      <div class="toolbar attendance-search-toolbar">
        <div class="search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <label class="sr-only" for="attendanceSearchInput">Search attendance records</label>
          <input id="attendanceSearchInput" type="search" value="${escapeHtml(state.attendanceQuery)}" placeholder="Search by student, roll no., guardian or email…" autocomplete="off" />
        </div>
      </div>
      <div class="table-wrap">
        ${rosterTable(attendanceRows, {
          editable: false,
          attendanceEditable: editable,
          showAmounts: can("viewFeeAmounts"),
          showActions: editable,
          hideFees: true
        })}
      </div>
      <div class="table-foot">
        <p class="table-foot__count">${list.length
          ? `Showing ${attendanceStart + 1}–${Math.min(attendanceStart + PAGE_SIZE, list.length)} of ${list.length} student${list.length === 1 ? "" : "s"}`
          : "No matching students"}</p>
        <div class="pager">
          <button class="pager__btn" type="button" data-action-btn="attendance-prev" aria-label="Previous attendance page"${state.attendancePage <= 1 ? " disabled" : ""}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
          </button>
          <span class="pager__label">Page ${state.attendancePage} of ${attendancePageCount}</span>
          <button class="pager__btn" type="button" data-action-btn="attendance-next" aria-label="Next attendance page"${state.attendancePage >= attendancePageCount ? " disabled" : ""}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
          </button>
        </div>
      </div>
    </div>`}
  `;
}

function studentAttendanceCalendar(student) {
  const entries = Array.isArray(student.attendanceEntries) ? student.attendanceEntries : [];
  const today = new Date();
  const displayedMonth = state.attendanceCalendarMonth || today;
  const year = displayedMonth.getFullYear();
  const month = displayedMonth.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const byDate = new Map();
  entries.forEach((entry) => {
    if (!entry || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date || "")) return;
    const previous = byDate.get(entry.date);
    const currentStatus = String(entry.status || "").toLowerCase() === "tardy" ? "late" : String(entry.status || "").toLowerCase();
    const previousRawStatus = String(previous?.status || "").toLowerCase();
    const previousStatus = previousRawStatus === "tardy" ? "late" : previousRawStatus;
    const priority = { absent: 3, tardy: 2, late: 2, present: 1 };
    if (!previous || (priority[currentStatus] || 0) > (priority[previousStatus] || 0)) byDate.set(entry.date, entry);
  });
  const cells = Array.from({ length: firstDay }, () => '<span class="attendance-calendar__blank" aria-hidden="true"></span>');
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const dayEntry = byDate.get(date);
    const rawStatus = String(dayEntry?.status || "").toLowerCase();
    const dateObject = new Date(year, month, day);
    const isWeekday = dateObject.getDay() >= 1 && dateObject.getDay() <= 5;
    const assumedPresent = !dayEntry && isWeekday && date <= todayKey;
    const status = dayEntry ? (rawStatus === "tardy" ? "late" : rawStatus) : assumedPresent ? "present" : "unrecorded";
    const label = dayEntry ? status[0].toUpperCase() + status.slice(1) : assumedPresent ? "Assumed present · no record" : "No record";
    const isToday = date === todayKey;
    cells.push(`<span class="attendance-calendar__day attendance-calendar__day--${status}${isToday ? " attendance-calendar__day--today" : ""}"${dayEntry || assumedPresent ? ` title="${label}${isToday ? ", Today" : ""}" aria-label="${day}, ${label}${isToday ? ", today" : ""}"` : ` aria-label="${day}, no attendance record${isToday ? ", today" : ""}"`}><span class="attendance-calendar__number">${day}</span></span>`);
  }
  return `<section class="records-main attendance-calendar-card">
    <div class="panel-head attendance-calendar-card__head"><div><h3>Daily attendance</h3><span class="panel-head__hint">${new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(displayedMonth)}</span></div><div class="attendance-calendar-nav"><button type="button" class="attendance-calendar-nav__button" data-attendance-month="-1" aria-label="Previous month"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></button><button type="button" class="attendance-calendar-nav__button" data-attendance-month="1" aria-label="Next month"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></button></div></div>
    <div class="attendance-calendar-layout">
      <div class="attendance-calendar" role="grid" aria-label="${escapeHtml(new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(displayedMonth))} attendance calendar">
        ${ATTENDANCE_WEEKDAYS_SHORT.map((name) => `<span class="attendance-calendar__weekday" role="columnheader">${name}</span>`).join("")}${cells.join("")}
      </div>
      <div class="attendance-calendar__legend" aria-label="Attendance status legend"><span><i class="attendance-dot attendance-dot--present"></i>Present</span><span><i class="attendance-dot attendance-dot--absent"></i>Absent</span><span><i class="attendance-dot attendance-dot--late"></i>Late</span><span><i class="attendance-dot attendance-dot--unrecorded"></i>No record</span></div>
    </div>
  </section>`;
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
  const ownStudentFeeRecord = perms.ownRecordOnly ? (rows[0] || null) : null;
  const studentFeeSchedule = FEE_SCHEDULE[ownStudentFeeRecord?.grade] || null;
  const studentFeeCategories = FEE_CATEGORIES;
  const itemizedFeeTotal = studentFeeSchedule
    ? studentFeeCategories.reduce((total, [, key]) => total + studentFeeSchedule[key], 0)
    : null;
  const peso = (amount) => `₱${new Intl.NumberFormat("en-PH", { maximumFractionDigits: 2 }).format(Number(amount) || 0)}`;
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
          perms.ownRecordOnly
            ? "A receipt-style view of your school fees and current balance."
            : can("viewFeeAmounts")
              ? "Outstanding balances across the students in your scope."
              : "Your role can see fee status but not the outstanding amounts."
        }</p>
      </div>
    </div>

    ${perms.ownRecordOnly ? "" : `<div class="stat-strip">
      ${statCard("Partial payment", String(s.partial), `student${s.partial === 1 ? "" : "s"} with balance`)}
      ${statCard("Unpaid", String(s.unpaid), "students with no payment")}
      ${statCard("Paid", String(s.paid), "fully settled")}
      ${can("viewFeeAmounts")
        ? statCard("Total outstanding", money(s.duesTotal), "to be collected")
        : statCard("Total outstanding", "Hidden", "not visible to your role")}
    </div>`}

    ${ownStudentFeeRecord ? `<section class="records-main student-fee-receipt">
      <div class="fee-receipt__title"><div><p class="fee-receipt__eyebrow">FEE STATEMENT</p><h3>Fee breakdown</h3></div><span class="fee-receipt__mark" aria-hidden="true">₱</span></div>
      <div class="fee-receipt__student"><span>STUDENT</span><strong>${escapeHtml(ownStudentFeeRecord.name)}</strong><span>ROLL NO.</span><strong>${escapeHtml(ownStudentFeeRecord.roll)}</strong></div>
      <div class="fee-receipt__table-head"><span>DESCRIPTION</span><span>PRICE</span></div>
      <ul class="fee-receipt__items">
        ${studentFeeCategories.map(([category, key]) => `<li><span>${escapeHtml(category)}</span><strong>${studentFeeSchedule ? peso(studentFeeSchedule[key]) : "Ask school"}</strong></li>`).join("")}
      </ul>
      <div class="fee-receipt__total"><span>ANNUAL FEE TOTAL</span><strong>${itemizedFeeTotal === null ? "Ask school" : peso(itemizedFeeTotal)}</strong></div>
      <div class="fee-receipt__total fee-receipt__total--balance"><span>OUTSTANDING BALANCE</span><strong>${peso(ownStudentFeeRecord.due)}</strong></div>
    </section>` : ""}

    ${perms.ownRecordOnly ? "" : `<div class="records-main">
      <div class="panel-head fees-records-head">
        <h3>${state.feeStatus === "all" ? "Fee records" : `${state.feeStatus} fee records`}</h3>
        <div class="fees-panel-actions">
          <div class="search fees-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
            <label class="sr-only" for="feesSearchInput">Search fee records</label>
            <input id="feesSearchInput" type="search" value="${escapeHtml(state.feeQuery)}" placeholder="Search students…" autocomplete="off" />
          </div>
          ${filterDropdown("feeGradeFilter", "Grade", feeGradeOptions, state.feeGrade)}
          ${filterDropdown("feeStatusFilter", "Fee status", feeStatusOptions, state.feeStatus)}
          <span class="panel-head__hint">${rows.length} record${rows.length === 1 ? "" : "s"}</span>
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
    </div>`}
  `;
}
function viewReports() {
  const list = visibleStudents();
  const s = summarize(list);
  const schoolGradeScores = list.flatMap((student) =>
    Object.values(student.subjectScores || {})
      .map(Number)
      .filter((score) => Number.isFinite(score) && score >= 0 && score <= 100)
  );
  const schoolAverageGrade = schoolGradeScores.length
    ? schoolGradeScores.reduce((total, score) => total + score, 0) / schoolGradeScores.length
    : null;
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
      ${statCard("Grades covered", String(byGrade.length), "in the export")}
      ${statCard("Average attendance", `${s.average.toFixed(1)}%`, "across the roster")}
      ${statCard("School performance", schoolAverageGrade === null ? "—" : `${schoolAverageGrade.toFixed(1)}%`, user.role === "admin" ? "All-student average" : "Scoped student average")}
    </div>

    <div class="records-layout reports-layout">
      <div class="records-main">
        <div class="panel-head"><h3>Grade summary</h3><span class="panel-head__hint">attendance &amp; dues</span></div>
        <div class="table-wrap grade-summary-wrap">
          <table class="records-table grade-summary-table">
            <thead><tr><th scope="col">Grade</th><th scope="col">No. of Students</th><th scope="col">Avg. attendance</th><th scope="col">Outstanding</th></tr></thead>
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

function recognitionLevel(score) {
  if (score >= 98) return "Highest Honor";
  if (score >= 95) return "High Honor";
  if (score >= 90) return "Honor";
  if (score >= 85) return "Achiever";
  return "Below achiever level";
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
    const subjects = SUBJECTS_BY_GRADE[student.grade] || Object.values(SUBJECTS_BY_GRADE)[0] || [];
    return subjects.map((subject) => Number(student.subjectScores?.[subject]) || 0);
  });
  const average = scoreRows.length
    ? scoreRows.reduce((sum, score) => sum + score, 0) / scoreRows.length
    : 0;
  const needsAttention = students.filter((student) => {
    const subjects = SUBJECTS_BY_GRADE[student.grade] || Object.values(SUBJECTS_BY_GRADE)[0] || [];
    const studentAverage = subjects.length
      ? subjects.reduce((sum, subject) => sum + (Number(student.subjectScores?.[subject]) || 0), 0) / subjects.length
      : 0;
    return studentAverage < 75;
  }).length;
  const reports = students.map((student) => {
    const subjects = SUBJECTS_BY_GRADE[student.grade] || Object.values(SUBJECTS_BY_GRADE)[0] || [];
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
      ${!isStudent ? statCard("Needs attention", String(needsAttention), "below 75%") : ""}
      ${isStudent ? statCard("Recognition", recognitionLevel(average), `${average.toFixed(1)}% average`) : ""}
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
          <form id="profileForm" class="profile-form" autocomplete="on">
            <div class="field-grid">
              <div class="field"><label for="profileName">Display name</label><input id="profileName" name="name" required value="${escapeHtml(user.name)}" /></div>
              <div class="field"><label for="profileTitle">Role title</label><input id="profileTitle" name="title" required value="${escapeHtml(user.title)}" /></div>
              <div class="field"><label for="profileEmail">Email</label><input id="profileEmail" name="email" type="email" required value="${escapeHtml(user.email || "")}" placeholder="name@school.org" /></div>
              <div class="field"><label for="profilePhone">Contact number</label><input id="profilePhone" name="phone" type="tel" value="${escapeHtml(user.phone || "")}" /></div>
              <div class="field field--wide"><label for="currentPassword">Current password</label><input id="currentPassword" name="currentPassword" type="password" autocomplete="current-password" /></div>
              <div class="field"><label for="newPassword">New password</label><input id="newPassword" name="newPassword" type="password" autocomplete="new-password" minlength="8" /></div>
              <div class="field"><label for="confirmPassword">Confirm new password</label><input id="confirmPassword" name="confirmPassword" type="password" autocomplete="new-password" minlength="8" /></div>
              <p class="field__hint field--wide">Leave password fields blank to keep your current password. New passwords must be at least 8 characters.</p>

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
      </div>
      <aside class="records-side">
        ${identityCard}
        ${user.role === "admin" ? `
          <section class="side-card risky-actions-card">
            <div class="side-card__head"><h3>Data protection</h3></div>
            <label class="risky-actions-toggle" for="riskyMode">
              <span class="risky-actions-toggle__copy"><strong>Safe mode</strong><span>When enabled, student records, sections, uploaded files and notifications are protected from deletion.</span></span>
              <input id="riskyMode" class="risky-actions-toggle__input" type="checkbox" role="switch" ${state.riskyMode ? "checked" : ""} />
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
                   <button class="btn btn--ghost requirement-delete-file" type="button" data-delete-requirement-file="${item.key}" data-student-id="${student.id}"${deletionLocked() ? ' disabled title="Safe mode is on; deletion is disabled."' : ""}>Delete file</button>
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
          <div class="panel-head"><div><h3>${escapeHtml(section.code)} · ${escapeHtml(section.grade)}</h3><span class="section-card__meta">${escapeHtml(section.room)}</span></div><span class="side-card__hint">${students.length} students</span></div>
          <div class="section-card__average"><span>Average attendance</span><strong>${average.toFixed(1)}%</strong></div>
          <div class="table-wrap">${rosterTable(students, { editable: false, attendanceEditable: true, showAmounts: false, showActions: true, hideFees: true })}</div>
        </section>`;
      }).join("")}</div>` : `<div class="empty-state"><p class="empty-state__title">No sections assigned</p><p class="empty-state__text">Ask an administrator to assign sections to your account.</p></div>`}`;
    return;
  }

  if (!can("exportCsv")) return;
  const cards = state.sections.map((section) => {
    const students = sectionStudents(section);
    const adviser = BUILT_IN_USERS.find((account) => account.id === section.adviserId);
    const adviserLabel = adviser ? `${profileFor(adviser).name} · ${ROLES[adviser.role].label}` : "Unassigned";
    const deletionDisabled = deletionLocked();
    const deleteTitle = deletionDisabled
      ? "Safe mode is on; deletion is disabled."
      : "Delete this section. Enrolled student records will remain in the roster.";
    return `<article class="records-main section-admin-form" data-section-id="${escapeHtml(section.id)}">
      <div class="panel-head"><div><h3>${escapeHtml(section.code)} · ${escapeHtml(section.grade)}</h3><button class="section-card__meta section-enrollment-link" type="button" data-action-btn="view-section-students" data-section-id="${escapeHtml(section.id)}">${students.length} enrolled students</button></div></div>
      <div class="section-admin-form__fields">
        <label class="field"><span>Room</span><input value="${escapeHtml(section.room)}" readonly aria-readonly="true" /></label>
        <label class="field"><span>Adviser</span><input value="${escapeHtml(adviserLabel)}" readonly aria-readonly="true" /></label>
      </div>
      <div class="section-admin-form__foot"><button class="btn btn--ghost" type="button" data-action="delete-section" data-id="${escapeHtml(section.id)}" title="${deleteTitle}"${deletionDisabled ? " disabled" : ""}>Delete section</button><button class="btn btn--primary" type="button" data-action-btn="assign-students-to-section" data-section-id="${escapeHtml(section.id)}">Assign student</button></div>
    </article>`;
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
    <div class="view-head section-admin-saved-head"><div class="view-head__text"><h2>Saved sections</h2><p>Existing classes and enrolled students. Section membership follows each student's roll number.</p></div></div>
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
  renderWeeklyUsageChart();
  if (animateViewOnNextRender) {
    animateViewOnNextRender = false;
    animateDashboardContent();
  }
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
    toast("Changes could not be saved to the database.", true);
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

function openModal(student, targetSection = null) {
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
      phone: student.guardianPhone ?? student.phone ?? "",
      attendance: student.attendance,
      feeStatus: student.feeStatus,
      due: student.due,
      email: student.email || ""
    }).forEach(([key, value]) => {
      if (form.elements[key]) form.elements[key].value = value;
    });
    $$(".student-form-select select", form).forEach(syncSectionSelect);
  } else if (targetSection) {
    form.elements.grade.value = targetSection.grade;
    syncSectionSelect(form.elements.grade);
    form.elements.roll.placeholder = `${targetSection.code}-001`;
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
    guardianPhone: data.phone,
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
    return [s.name, s.roll, s.grade, s.guardian, (s.guardianPhone ?? s.phone ?? ""), Number(s.attendance), s.feeStatus, Number(s.due), s.email, enrolled];
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
  const schoolGradeScores = list.flatMap((student) =>
    Object.values(student.subjectScores || {})
      .map(Number)
      .filter((score) => Number.isFinite(score) && score >= 0 && score <= 100)
  );
  const schoolAverageGrade = schoolGradeScores.length
    ? schoolGradeScores.reduce((total, score) => total + score, 0) / schoolGradeScores.length
    : null;
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
    ["Grades covered", byGrade.length],
    ["Average attendance (%)", Number(summary.average.toFixed(1))],
    ["School performance — average grade (%)", schoolAverageGrade === null ? "No grades recorded" : Number(schoolAverageGrade.toFixed(1))],
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

  if (deletionLocked() && SCHOOL_REQUIREMENTS.some((item) => $(`[data-requirement-row="${item.key}"]`)?.dataset.deleteFile === "true")) {
    toast("Safe mode is on. Turn it off before deleting an uploaded file.", true);
    return;
  }

  const removedFiles = [];
  try {
    for (const entry of filesToDelete) {
      const stored = await loadRequirementFile(student.roll, entry.key);
      if (!stored || !stored.blob) throw new Error(`The uploaded file for ${entry.key} could not be found on the server.`);
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
      toast("The uploaded document could not be found on the server.", true);
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
  if (deletionLocked()) {
    toast("Safe mode is on. File deletion is disabled.", true);
    return;
  }
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

async function updateAccountPassword(currentPassword, newPassword, confirmPassword) {
  if (!currentPassword || !newPassword || !confirmPassword) throw new Error("Enter your current password, new password and confirmation.");
  if (newPassword.length < 8) throw new Error("Use at least 8 characters for the new password.");
  if (newPassword !== confirmPassword) throw new Error("The new password and confirmation do not match.");
  const response = await fetch("../api.php?action=change_password", {
    method: "POST", credentials: "same-origin",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ currentPassword, newPassword, confirmPassword })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "The password could not be updated.");
}

async function saveProfileWithPassword(form) {
  const currentPassword = form.elements.currentPassword.value;
  const newPassword = form.elements.newPassword.value;
  const confirmPassword = form.elements.confirmPassword.value;
  const wantsPasswordChange = Boolean(currentPassword || newPassword || confirmPassword);
  if (wantsPasswordChange) {
    try {
      await updateAccountPassword(currentPassword, newPassword, confirmPassword);
    } catch (error) {
      toast(`Password update failed: ${error.message} Your profile was not saved.`, true);
      return;
    }
  }
  const saved = saveUserProfile(form, false);
  if (!saved) {
    if (wantsPasswordChange) toast("Password updated, but profile changes could not be saved. Please check the profile error and save again.", true);
    return;
  }
  if (wantsPasswordChange) toast("Profile and password updated. Use the new password next time you sign in.");
  else toast("Profile updated.");
}

function saveUserProfile(form, showErrors = true) {
  const name = form.elements.name.value.trim();
  const title = form.elements.title.value.trim();
  const email = form.elements.email.value.trim();
  const phone = form.elements.phone.value.trim();
  if (name.length < 2 || !title || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    toast("Enter a name, role title and valid email address.", true);
    return false;
  }
  if (phone && phone.replace(/\D/g, "").length < 7) {
    toast("Enter at least 7 digits for the contact number.", true);
    return false;
  }
  const duplicate = BUILT_IN_USERS.some((account) => account.id !== user.id && profileFor(account).email.toLowerCase() === email.toLowerCase());
  if (duplicate) {
    toast("That email address is already used by another account.", true);
    return false;
  }
  const profile = {
    name,
    title,
    email,
    phone,
    avatar: state.avatarDraft === null ? (user.avatar || "") : state.avatarDraft
  };
  if (!saveProfile(user.id, profile)) {
    toast("Profile changes could not be saved to the database.", true);
    return false;
  }
  user = { ...user, ...profile };
  if (user.role === "student") state.students = loadStudents();
  state.avatarDraft = null;
  renderChrome();
  renderView();
  return true;
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

function assignExistingStudentToSection(button) {
  if (!can("editStudent")) {
    toast("Your role cannot assign student records to sections.", true);
    return;
  }
  const section = state.sections.find((item) => item.id === button.dataset.sectionId);
  const modal = document.querySelector("#assignStudentModal");
  const selectedIds = [...modal.querySelectorAll("[data-assign-student-option]:checked")].map((input) => Number(input.value));
  if (!section || !selectedIds.length) {
    toast("Select at least one available student to assign.", true);
    return;
  }
  const result = assignStudentsToSection(section.code, selectedIds);
  if (!result?.ok) {
    toast(result?.error || "The selected students could not be assigned. Check the database connection and try again.", true);
    return;
  }
  state.students = loadStudents();
  state.sections = loadSections();
  closeAssignStudentsModal();
  renderView();
  toast(`${Number(result.assigned || selectedIds.length)} student${Number(result.assigned || selectedIds.length) === 1 ? "" : "s"} assigned to ${section.code}.`);
}
function openAssignStudentsModal(section) {
  if (!can("editStudent")) {
    toast("Your role cannot assign students to sections.", true);
    return;
  }
  state.assigningSectionId = section.id;
  state.lastFocused = document.activeElement;
  const options = state.students
    .filter((student) => student.grade === section.grade && sectionCodeFor(student) !== section.code)
    .sort((a, b) => a.name.localeCompare(b.name));
  document.querySelector("#assignStudentEyebrow").textContent = `${section.code} · ${section.grade}`;
  document.querySelector("#assignStudentTitle").textContent = `Assign students to ${section.code}`;
  document.querySelector("#assignStudentDescription").textContent = options.length
    ? `Select one or more existing ${section.grade} records. Their roll numbers will be updated to the ${section.code} section prefix.`
    : `There are no other existing ${section.grade} students available to assign.`;
  document.querySelector("#assignStudentOptions").innerHTML = options.length
    ? options.map((student) => `<label class="assign-student-option"><input type="checkbox" value="${student.id}" data-assign-student-option aria-label="Select ${escapeHtml(student.name)}"><span class="assign-student-option__avatar assign-student-option__avatar--${Math.abs(Number(student.id) || 0) % 6}">${escapeHtml(initials(student.name))}</span><span class="assign-student-option__details"><strong>${escapeHtml(student.name)}</strong><small>${escapeHtml(student.roll)} · ${escapeHtml(student.grade)}</small></span></label>`).join("")
    : `<div class="empty-state assign-student-empty"><p class="empty-state__title">No students available</p><p class="empty-state__text">All existing ${escapeHtml(section.grade)} students already belong to ${escapeHtml(section.code)}.</p></div>`;
  const selectAll = document.querySelector("#assignStudentSelectAll");
  selectAll.checked = false;
  selectAll.disabled = options.length === 0;
  document.querySelector("#assignStudentSubmit").disabled = options.length === 0;
  updateAssignStudentCount();
  const modal = document.querySelector("#assignStudentModal");
  modal.hidden = false;
  document.body.style.overflow = "hidden";
  window.setTimeout(() => document.querySelector("[data-assign-student-option]")?.focus(), 30);
}

function updateAssignStudentCount() {
  const selected = document.querySelectorAll("[data-assign-student-option]:checked").length;
  document.querySelector("#assignStudentSelectionCount").textContent = `${selected} selected`;
  document.querySelector("#assignStudentSubmit").textContent = selected ? `Assign ${selected} student${selected === 1 ? "" : "s"}` : "Assign students";
  document.querySelector("#assignStudentSubmit").disabled = selected === 0;
}

function closeAssignStudentsModal() {
  document.querySelector("#assignStudentModal").hidden = true;
  document.body.style.overflow = "";
  state.assigningSectionId = null;
  if (state.lastFocused?.focus) state.lastFocused.focus();
}

function openSectionStudentsModal(section) {
  const students = sectionStudents(section).sort((a, b) => a.name.localeCompare(b.name));
  state.lastFocused = document.activeElement;
  document.querySelector("#sectionStudentsEyebrow").textContent = `${section.code} · ${section.grade}`;
  document.querySelector("#sectionStudentsTitle").textContent = `Students in ${section.code}`;
  document.querySelector("#sectionStudentsDescription").textContent = `${students.length} enrolled student${students.length === 1 ? "" : "s"}. The list is based on each student's grade and roll number.`;
  document.querySelector("#sectionStudentsList").innerHTML = students.length
    ? students.map((student) => `<article class="section-student-row">${avatarHtml(student.name, "", student.avatar || "")}<span class="section-student-row__details"><strong>${escapeHtml(student.name)}</strong><small>${escapeHtml(student.roll)} · ${escapeHtml(student.grade)}</small></span></article>`).join("")
    : `<div class="empty-state section-students-empty"><p class="empty-state__title">No students enrolled</p><p class="empty-state__text">Assign existing students to this section to see them listed here.</p></div>`;
  document.querySelector("#sectionStudentsModal").hidden = false;
  document.body.style.overflow = "hidden";
}

function closeSectionStudentsModal() {
  document.querySelector("#sectionStudentsModal").hidden = true;
  document.body.style.overflow = "";
  if (state.lastFocused?.focus) state.lastFocused.focus();
}

/* ---------------- Notifications ---------------- */
function renderNotifications(items, unread) {
  state.notifications = Array.isArray(items) ? items : [];
  state.unreadNotifications = Number(unread) || 0;
  const dot = $(".notification-dot");
  const trigger = $("#notificationTrigger");
  const list = $("#notificationList");
  const markAll = $("#notificationMarkAll");
  dot.hidden = state.unreadNotifications === 0;
  trigger.setAttribute("aria-label", state.unreadNotifications ? `Notifications, ${state.unreadNotifications} unread` : "Notifications");
  markAll.hidden = state.unreadNotifications === 0;
  if (!state.notifications.length) {
    list.innerHTML = '<p class="notification-empty">You’re all caught up. There are no notifications.</p>';
    return;
  }
  list.innerHTML = state.notifications.map((item) => {
    const when = new Date(item.createdAt);
    const whenText = Number.isNaN(when.getTime()) ? "" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(when);
    const deleteControl = `<button class="notification-delete" type="button" data-notification-delete-id="${escapeHtml(item.id)}" aria-label="Remove notification" title="Remove notification"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
    return `<article class="notification-entry">
      <button class="notification-item${item.read ? "" : " is-unread"}" type="button" data-notification-id="${escapeHtml(item.id)}" data-notification-nav="${escapeHtml(item.navKey || "overview")}">
        <strong>${escapeHtml(item.title || "Scholix update")}</strong><span>${escapeHtml(item.message || "There is an update to your account.")}</span>${whenText ? `<time>${escapeHtml(whenText)}</time>` : ""}
      </button>
      ${deleteControl}
    </article>`;
  }).join("");
}

async function refreshNotifications() {
  try {
    const response = await fetch("../api.php?action=notifications", { credentials: "same-origin", headers: { Accept: "application/json" } });
    if (!response.ok) return;
    const data = await response.json();
    renderNotifications(data.items, data.unread);
  } catch {
    // Keep the last successfully loaded notifications visible while offline.
  }
}

async function setNotificationRead(id = "") {
  try {
    await fetch("../api.php?action=notifications_read", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(id ? { id } : {})
    });
    await refreshNotifications();
  } catch { /* The next poll will refresh the unread state. */ }
}
async function deleteNotification(id) {
  try {
    const response = await fetch("../api.php?action=notifications_delete", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ id })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The notification could not be deleted.");
    await refreshNotifications();
  } catch (error) {
    toast(error.message || "The notification could not be deleted.");
  }
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

  const notificationTrigger = document.querySelector("#notificationTrigger");
  const notificationPanel = document.querySelector("#notificationPanel");
  const notificationList = document.querySelector("#notificationList");
  notificationTrigger.addEventListener("click", () => {
    const willOpen = notificationTrigger.getAttribute("aria-expanded") !== "true";
    setNotificationPanelOpen(willOpen);
    if (willOpen) refreshNotifications();
  });
  notificationList.addEventListener("click", async (event) => {
    const deleteButton = event.target.closest("[data-notification-delete-id]");
    if (deleteButton) {
      event.preventDefault();
      event.stopPropagation();
      await deleteNotification(deleteButton.dataset.notificationDeleteId);
      return;
    }
    const itemButton = event.target.closest("[data-notification-id]");
    if (!itemButton) return;
    const navKey = itemButton.dataset.notificationNav;
    await setNotificationRead(itemButton.dataset.notificationId);
    setNotificationPanelOpen(false);
    const availableNav = navItems().some((item) => item.key === navKey) ? navKey : (navKey === "requirements" ? "roster" : "overview");
    setView(availableNav);
  });
  document.querySelector("#notificationMarkAll").addEventListener("click", () => setNotificationRead());
  document.addEventListener("click", (event) => {
    if (event.target.closest(".notification-wrap")) return;
    setNotificationPanelOpen(false);
  });
  document.querySelector("#sideOpen").addEventListener("click", openSideNav);
  document.querySelector("#sideClose").addEventListener("click", closeSideNav);
  document.querySelector("#sidebarAccount").addEventListener("click", (event) => {
    if (!event.target.closest("#sidebarSignOutBtn")) return;
    clearSession();
    window.location.href = "./login.php";
  });

  // Delegated view interactions
  viewRoot.addEventListener("click", async (event) => {
    const attendanceMonthButton = event.target.closest("[data-attendance-month]");
    if (attendanceMonthButton) {
      const currentMonth = state.attendanceCalendarMonth || new Date();
      state.attendanceCalendarMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + Number(attendanceMonthButton.dataset.attendanceMonth), 1);
      renderView();
      return;
    }

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
      else if (filter === "attendanceGradeFilter") { state.attendanceGrade = filterOption.dataset.value; state.attendancePage = 1; }
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
      if (deletionLocked()) {
        toast("Safe mode is on. File deletion is disabled.", true);
        return;
      }
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
          <button class="btn btn--ghost requirement-delete-file" type="button" data-delete-requirement-file="${requirementKey}" data-student-id="${currentStudent.id}"${deletionLocked() ? ' disabled title="Safe mode is on; deletion is disabled."' : ""}>Delete file</button>
          <button class="btn btn--ghost requirement-view" type="button" data-view-requirement="${requirementKey}" data-student-id="${currentStudent.id}" aria-label="View ${escapeHtml(currentFile.name)}">View</button>`;
      }
      toast(`${requirement.label} ${accepted ? "accepted" : "rejected"} as a draft. Click Save verification to apply it.`);
      return;
    }

    const actionBtn = event.target.closest("[data-action-btn]");
    if (actionBtn) {
      const kind = actionBtn.dataset.actionBtn;
      if (kind === "add") openModal(null);
      else if (kind === "assign-students-to-section") {
        const section = state.sections.find((item) => item.id === actionBtn.dataset.sectionId);
        if (section) openAssignStudentsModal(section);
      }
      else if (kind === "view-section-students") {
        const section = state.sections.find((item) => item.id === actionBtn.dataset.sectionId);
        if (section) openSectionStudentsModal(section);
      }
      else if (kind === "export") exportCsv();
      else if (kind === "export-report") exportReportCsv();
      else if (kind === "back-roster") {
        state.selectedStudentId = null;
        renderView();
      }
      else if (kind === "sign-out") {
        clearSession();
        window.location.href = "./login.php";
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
      } else if (kind === "attendance-prev" && state.attendancePage > 1) {
        state.attendancePage -= 1;
        renderView();
      } else if (kind === "attendance-next") {
        const attendanceCount = Math.ceil((visibleStudents().filter((student) => {
          const query = state.attendanceQuery.trim().toLocaleLowerCase();
          return (state.attendanceGrade === "all" || student.grade === state.attendanceGrade)
            && (!query || [student.name, student.roll, student.guardian, student.email].some((value) => String(value || "").toLocaleLowerCase().includes(query)));
        })).length / PAGE_SIZE);
        if (state.attendancePage < attendanceCount) {
          state.attendancePage += 1;
          renderView();
        }
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
        if (deletionLocked()) {
          toast("Safe mode is on. Section deletion is disabled.", true);
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
        if (deletionLocked()) {
          toast("Safe mode is on. Student record deletion is disabled.", true);
          return;
        }
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
      if (isAttendanceSearch) state.attendancePage = 1;
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
      const themeToggle = event.target.closest(".risky-actions-toggle")?.querySelector(".risky-actions-toggle__track") || event.target;
      const toggleBounds = themeToggle.getBoundingClientRect();
      const originX = toggleBounds.left + toggleBounds.width / 2;
      const originY = toggleBounds.top + toggleBounds.height / 2;
      const root = document.documentElement;
      root.style.setProperty("--theme-origin-x", `${originX}px`);
      root.style.setProperty("--theme-origin-y", `${originY}px`);
      const applyTheme = () => {
        document.body.classList.toggle("is-dark", enabled);
        renderChart();
      };
      if (typeof root.startViewTransition === "function") {
        root.startViewTransition(applyTheme);
      } else {
        applyTheme();
      }
      toast(enabled ? "Dark mode enabled for this dashboard." : "Light mode enabled for this dashboard.");
    } else if (event.target.id === "riskyMode") {
      if (user.role !== "admin") {
        toast("Only administrators can change risky-action settings.", true);
        renderView();
        return;
      }
      try {
        localStorage.setItem(RISKY_MODE_STORAGE_KEY, String(event.target.checked));
      } catch {
        toast("Safe-mode preference could not be saved. The setting was not changed.", true);
        renderView();
        return;
      }
      state.riskyMode = event.target.checked;
      // Keep the current switch in the DOM until its CSS transition finishes.
      window.setTimeout(renderView, 300);
      toast(state.riskyMode
        ? "Safe mode is on. Delete actions are disabled."
        : "Safe mode is off. Delete actions are available to your account.");
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
      saveProfileWithPassword(form);
    } else if (form.id === "addSectionForm") {
      event.preventDefault();
      addSection(form);
    }
  });

  // Attendance quick edit dialog
  document.querySelector("#attendanceModal").addEventListener("submit", async (event) => {
    event.preventDefault();
    const modal = document.querySelector("#attendanceModal");
    const id = Number(modal.dataset.studentId);
    const date = modal.querySelector("#attendanceEntryDate").value;
    const status = modal.querySelector("#attendanceEntryStatus").value;
    const error = modal.querySelector("#attendanceError");
    const saveButton = modal.querySelector('button[type="submit"]');
    if (!date || !ATTENDANCE_STATUSES.includes(status)) {
      error.hidden = false;
      error.textContent = "Choose a valid date and attendance status before saving.";
      return;
    }
    const index = state.students.findIndex((student) => student.id === id);
    if (index === -1 || !canEditAttendance(state.students[index])) {
      error.hidden = false;
      error.textContent = index === -1 ? "That student record no longer exists." : "Your role cannot change attendance for this student.";
      return;
    }
    error.hidden = true;
    saveButton.disabled = true;
    try {
      const response = await fetch("../api.php?action=attendance_entry", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ id, date, status })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "The dated attendance record could not be saved.");
      const previous = state.students[index];
      state.students[index] = {
        ...previous,
        attendance: Number(result.attendance ?? previous.attendance),
        absences: Number(result.absences ?? previous.absences ?? 0),
        lateArrivals: Number(result.lateArrivals ?? previous.lateArrivals ?? 0),
        attendanceEntries: Array.isArray(result.attendanceEntries) ? result.attendanceEntries : previous.attendanceEntries || []
      };
      modal.hidden = true;
      document.body.style.overflow = "";
      renderView();
      toast(`Daily attendance saved for ${previous.name}.`);
      announce(`${status} saved for ${previous.name} on ${formatDate(date)}. Overall attendance is now ${Number(result.attendance).toFixed(1)} percent, with ${result.absences} absences and ${result.lateArrivals} late arrivals.`);
    } catch (saveError) {
      error.hidden = false;
      error.textContent = saveError.message || "Attendance could not be saved.";
    } finally {
      saveButton.disabled = false;
    }
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
      if (!persist()) {
        state.students[index] = existing;
        renderView();
        return;
      }
      closeModal();
      renderView();
      toast(`${payload.name}'s record was updated.`);
      announce(`${payload.name} updated.`);
    } else {
      const nextId = state.students.reduce((max, s) => Math.max(max, s.id), 0) + 1;
      const requirements = Object.fromEntries(SCHOOL_REQUIREMENTS.map((item) => [item.key, { status: "Missing", note: "Please upload here or submit to the handling office." }]));
      const newStudent = {
        id: nextId,
        enrolled: (() => {
          const createdAt = new Date();
          return `${createdAt.getFullYear()}-${String(createdAt.getMonth() + 1).padStart(2, "0")}-${String(createdAt.getDate()).padStart(2, "0")}`;
        })(),
        attendance: 100,
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

  const assignStudentModal = document.querySelector("#assignStudentModal");
  assignStudentModal.addEventListener("click", (event) => {
    if (event.target.closest("[data-reset-assign-students]")) {
      assignStudentModal.querySelectorAll("[data-assign-student-option]").forEach((checkbox) => { checkbox.checked = false; });
      document.querySelector("#assignStudentSelectAll").checked = false;
      updateAssignStudentCount();
      return;
    }
    if (event.target.closest("[data-close-assign-students]")) closeAssignStudentsModal();
  });
  assignStudentModal.addEventListener("change", (event) => {
    const checkboxes = [...assignStudentModal.querySelectorAll("[data-assign-student-option]")];
    if (event.target.id === "assignStudentSelectAll") {
      checkboxes.forEach((checkbox) => { checkbox.checked = event.target.checked; });
    } else if (event.target.matches("[data-assign-student-option]")) {
      const selectAll = document.querySelector("#assignStudentSelectAll");
      selectAll.checked = checkboxes.length > 0 && checkboxes.every((checkbox) => checkbox.checked);
    }
    updateAssignStudentCount();
  });
  document.querySelector("#assignStudentForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const button = document.querySelector(`[data-action-btn="assign-students-to-section"][data-section-id="${CSS.escape(state.assigningSectionId || "")}"]`);
    if (button) assignExistingStudentToSection(button);
  });

  const sectionStudentsModal = document.querySelector("#sectionStudentsModal");
  sectionStudentsModal.addEventListener("click", (event) => {
    if (event.target.closest("[data-close-section-students]")) closeSectionStudentsModal();
  });

  // Confirmation dialog
  document.querySelector("#confirmModal").addEventListener("click", (event) => {
    if (event.target.closest("[data-confirm-cancel]")) closeConfirm(false);
    else if (event.target.closest("[data-confirm-ok]")) closeConfirm(true);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!document.querySelector("#confirmModal").hidden) closeConfirm(false);
    else if (!document.querySelector("#sectionStudentsModal").hidden) closeSectionStudentsModal();
    else if (!document.querySelector("#assignStudentModal").hidden) closeAssignStudentsModal();
    else if (!document.querySelector("#studentModal").hidden) closeModal();
    else if (!document.querySelector("#attendanceModal").hidden) {
      document.querySelector("#attendanceModal").hidden = true;
      document.body.style.overflow = "";
    } else if (!notificationPanel.hidden) {
    setNotificationPanelOpen(false);
    } else closeSideNav();
  });

  let resizeTimer;
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(renderChart, 140);
  });
}

/* ---------------- Attendance dialog (built once) ---------------- */
function absencesForAttendance(student) {
  const savedAbsences = Number(student.absences) || 0;
  if (savedAbsences === 0 && Number(student.attendance) < 100) {
    return Math.min(SCHOOL_DAYS_PER_YEAR, Math.round((100 - Number(student.attendance)) * SCHOOL_DAYS_PER_YEAR / 100));
  }
  return Math.min(SCHOOL_DAYS_PER_YEAR, Math.max(0, Math.round(savedAbsences)));
}

function openAttendancePrompt(student) {
  if (!canEditAttendance(student)) {
    toast("Your role cannot change attendance.", true);
    return;
  }
  const modal = document.querySelector("#attendanceModal");
  modal.dataset.studentId = String(student.id);
  modal.querySelector("#attendanceStudent").textContent = `${student.name} · ${student.roll} · ${student.grade}`;
  const dateInput = modal.querySelector("#attendanceEntryDate");
  const localNow = new Date();
  dateInput.value = `${localNow.getFullYear()}-${String(localNow.getMonth() + 1).padStart(2, "0")}-${String(localNow.getDate()).padStart(2, "0")}`;
  dateInput.dispatchEvent(new Event("change", { bubbles: true }));
  modal.querySelector("#attendanceError").hidden = true;
  modal.hidden = false;
  document.body.style.overflow = "hidden";
  window.setTimeout(() => modal.querySelector("#attendanceDateTrigger").focus(), 30);
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
          <h2 id="attendanceTitle">Attendance record</h2>
        </div>

      </div>
      <form class="modal__form" id="attendanceForm">
        <p class="form-subject" id="attendanceStudent">—</p>
        <section class="attendance-entry-editor" aria-labelledby="attendanceEntryHeading">
          <div><h3 id="attendanceEntryHeading">Daily attendance</h3><p>Choose the school date and mark the student as present, late or absent.</p></div>
          <div class="field-grid field-grid--attendance-entry">
            <div class="field"><label for="attendanceDateTrigger">Date</label><div class="attendance-date-picker"><input id="attendanceEntryDate" type="date" tabindex="-1" aria-hidden="true" /><button class="attendance-control attendance-date-trigger" id="attendanceDateTrigger" type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="attendanceDatePopover"><span id="attendanceDateLabel">Choose date</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg></button><div class="attendance-date-popover" id="attendanceDatePopover" role="dialog" aria-label="Choose attendance date" hidden><div class="attendance-date-popover__head"><button type="button" class="attendance-date-nav" data-calendar-month="-1" aria-label="Previous month"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></button><strong id="attendanceDateMonth">—</strong><button type="button" class="attendance-date-nav" data-calendar-month="1" aria-label="Next month"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></button></div><div class="attendance-date-weekdays" aria-hidden="true">${ATTENDANCE_WEEKDAYS_SHORT.map((day) => `<span>${day}</span>`).join("")}</div><div class="attendance-date-grid" id="attendanceDateGrid"></div><div class="attendance-date-popover__foot"><button type="button" id="attendanceDateToday">Today</button></div></div></div></div>
            <div class="field"><label id="attendanceStatusLabel" for="attendanceStatusTrigger">Attendance status</label><div class="attendance-status-select"><select id="attendanceEntryStatus" aria-hidden="true" tabindex="-1"><option value="" selected>Choose status</option>${ATTENDANCE_STATUSES.map((status) => `<option>${escapeHtml(status)}</option>`).join("")}</select><button class="attendance-control attendance-status-trigger" id="attendanceStatusTrigger" type="button" role="combobox" aria-labelledby="attendanceStatusLabel attendanceStatusValue" aria-haspopup="listbox" aria-expanded="false" aria-controls="attendanceStatusMenu"><span id="attendanceStatusValue">Choose status</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button><div class="attendance-status-menu" id="attendanceStatusMenu" role="listbox" aria-labelledby="attendanceStatusLabel" hidden>${ATTENDANCE_STATUSES.map((status) => `<button type="button" class="attendance-status-option attendance-status-option--${status.toLowerCase()}" role="option" aria-selected="false" data-attendance-status="${status}"><span class="attendance-status-option__dot"></span><span>${status}</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg></button>`).join("")}</div></div></div>
          </div>
        </section>
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
  const dateInput = wrap.querySelector("#attendanceEntryDate");
  const dateTrigger = wrap.querySelector("#attendanceDateTrigger");
  const datePopover = wrap.querySelector("#attendanceDatePopover");
  const statusSelect = wrap.querySelector("#attendanceEntryStatus");
  const statusTrigger = wrap.querySelector("#attendanceStatusTrigger");
  const statusMenu = wrap.querySelector("#attendanceStatusMenu");
  const datePopoverHome = datePopover.parentElement;
  const statusMenuHome = statusMenu.parentElement;
  let calendarMonth = new Date();
  const localDateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const updateStatusControl = () => {
    const value = statusSelect.value;
    wrap.querySelector("#attendanceStatusValue").textContent = value || "Choose status";
    statusTrigger.dataset.value = value.toLowerCase();
    statusMenu.querySelectorAll("[data-attendance-status]").forEach((option) => {
      const selected = option.dataset.attendanceStatus === value;
      option.setAttribute("aria-selected", String(selected));
      option.classList.toggle("is-selected", selected);
    });
  };
  const renderDatePicker = () => {
    datePopover.querySelector("#attendanceDateMonth").textContent = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(calendarMonth);
    const firstWeekday = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1).getDay();
    const daysInMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0).getDate();
    const selected = dateInput.value;
    const today = localDateKey(new Date());
    const currentStudent = state.students.find((student) => student.id === Number(wrap.dataset.studentId));
    const cells = Array.from({ length: firstWeekday }, () => '<span class="attendance-date-grid__blank" aria-hidden="true"></span>');
    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = `${calendarMonth.getFullYear()}-${String(calendarMonth.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const dayEntries = (currentStudent?.attendanceEntries || []).filter((entry) => entry.date === date);
      const dayStatus = dayEntries.some((entry) => entry.status === "Absent") ? "absent"
        : dayEntries.some((entry) => ["Late", "Tardy"].includes(entry.status)) ? "late"
          : dayEntries.length ? "present" : "";
      const accessibleDate = new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric", year: "numeric" }).format(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), day));
      cells.push(`<button type="button" class="attendance-date-day${selected === date ? " is-selected" : ""}${today === date ? " is-today" : ""}${dayStatus ? ` attendance-date-day--${dayStatus}` : ""}" data-attendance-date="${date}" aria-pressed="${selected === date}" aria-label="${accessibleDate}${dayStatus ? `, ${dayStatus}` : ""}">${day}${dayStatus ? '<i aria-hidden="true"></i>' : ""}</button>`);
    }
    datePopover.querySelector("#attendanceDateGrid").innerHTML = cells.join("");
  };
  const syncDate = () => {
    const value = dateInput.value;
    if (!value) {
      wrap.querySelector("#attendanceDateLabel").textContent = "Choose date";
      return;
    }
    const [year, month, day] = value.split("-").map(Number);
    const selectedDate = new Date(year, month - 1, day);
    wrap.querySelector("#attendanceDateLabel").textContent = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(selectedDate);
    calendarMonth = new Date(year, month - 1, 1);
    const currentStudent = state.students.find((student) => student.id === Number(wrap.dataset.studentId));
    const savedEntry = (currentStudent?.attendanceEntries || []).find((entry) => entry.date === value);
    statusSelect.value = savedEntry?.status === "Tardy" ? "Late" : savedEntry?.status || "";
    updateStatusControl();
    renderDatePicker();
  };
  const isCompactAttendance = () => window.matchMedia("(max-width: 900px)").matches;
  const moveAttendancePopupToBody = (popup) => {
    if (isCompactAttendance() && popup.parentElement !== document.body) document.body.appendChild(popup);
  };
  const restoreAttendancePopup = (popup, home) => {
    if (popup.parentElement !== home) home.appendChild(popup);
    ["position", "width", "left", "top", "bottom"].forEach((property) => popup.style.removeProperty(property));
  };
  const placeAttendancePopup = (trigger, popup) => {
    if (!isCompactAttendance()) return;
    const anchor = trigger.getBoundingClientRect();
    const margin = 12;
    const preferredWidth = popup === datePopover ? 330 : anchor.width;
    const width = Math.min(preferredWidth, window.innerWidth - margin * 2);
    popup.style.position = "fixed";
    popup.style.width = `${width}px`;
    const height = Math.min(popup.scrollHeight, window.innerHeight - margin * 2);
    const left = Math.max(margin, Math.min(anchor.left, window.innerWidth - width - margin));
    const below = window.innerHeight - anchor.bottom - margin;
    const above = anchor.top - margin;
    const top = above >= height + 8 ? anchor.top - height - 8
      : below >= height + 8 ? anchor.bottom + 8
        : Math.max(margin, Math.min(anchor.bottom + 8, window.innerHeight - height - margin));
    popup.style.left = `${left}px`;
    popup.dataset.openDirection = top < anchor.top ? "up" : "down";
    popup.style.top = `${top}px`;
    popup.style.bottom = "auto";
  };
  const repositionAttendancePopups = () => {
    if (!isCompactAttendance()) {
      if (!datePopover.hidden) restoreAttendancePopup(datePopover, datePopoverHome);
      if (!statusMenu.hidden) restoreAttendancePopup(statusMenu, statusMenuHome);
      return;
    }
    if (!datePopover.hidden) placeAttendancePopup(dateTrigger, datePopover);
    if (!statusMenu.hidden) placeAttendancePopup(statusTrigger, statusMenu);
  };
  dateInput.addEventListener("change", syncDate);
  dateTrigger.addEventListener("click", () => {
    const open = datePopover.hidden;
    datePopover.hidden = !open;
    dateTrigger.setAttribute("aria-expanded", String(open));
    const datePicker = dateTrigger.closest(".attendance-date-picker");
    const dateRect = dateTrigger.getBoundingClientRect();
    datePicker.classList.add("opens-up");
    statusMenu.hidden = true;
    statusTrigger.setAttribute("aria-expanded", "false");
    restoreAttendancePopup(statusMenu, statusMenuHome);
    if (open) {
      moveAttendancePopupToBody(datePopover);
      renderDatePicker();
      window.requestAnimationFrame(() => placeAttendancePopup(dateTrigger, datePopover));
    } else {
      restoreAttendancePopup(datePopover, datePopoverHome);
    }
  });
  wrap.querySelectorAll("[data-calendar-month]").forEach((button) => button.addEventListener("click", () => {
    calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + Number(button.dataset.calendarMonth), 1);
    renderDatePicker();
    window.requestAnimationFrame(() => placeAttendancePopup(dateTrigger, datePopover));
  }));
  wrap.querySelector("#attendanceDateToday").addEventListener("click", () => {
    dateInput.value = localDateKey(new Date());
    syncDate();
    datePopover.hidden = true;
    dateTrigger.setAttribute("aria-expanded", "false");
    restoreAttendancePopup(datePopover, datePopoverHome);
    dateTrigger.focus();
  });
  datePopover.querySelector("#attendanceDateGrid").addEventListener("click", (event) => {
    const dayButton = event.target.closest("[data-attendance-date]");
    if (!dayButton) return;
    dateInput.value = dayButton.dataset.attendanceDate;
    syncDate();
    datePopover.hidden = true;
    dateTrigger.setAttribute("aria-expanded", "false");
    restoreAttendancePopup(datePopover, datePopoverHome);
    dateTrigger.focus();
  });
  statusTrigger.addEventListener("click", () => {
    const open = statusMenu.hidden;
    statusMenu.hidden = !open;
    statusTrigger.setAttribute("aria-expanded", String(open));
    const statusPicker = statusTrigger.closest(".attendance-status-select");
    const statusRect = statusTrigger.getBoundingClientRect();
    statusPicker.classList.add("opens-up");
    datePopover.hidden = true;
    dateTrigger.setAttribute("aria-expanded", "false");
    restoreAttendancePopup(datePopover, datePopoverHome);
    if (open) {
      moveAttendancePopupToBody(statusMenu);
      window.requestAnimationFrame(() => placeAttendancePopup(statusTrigger, statusMenu));
    } else {
      restoreAttendancePopup(statusMenu, statusMenuHome);
    }
  });
  window.addEventListener("resize", repositionAttendancePopups);
  wrap.closest(".modal__dialog")?.addEventListener("scroll", repositionAttendancePopups, { passive: true });
  statusMenu.addEventListener("click", (event) => {
    const option = event.target.closest("[data-attendance-status]");
    if (!option) return;
    statusSelect.value = option.dataset.attendanceStatus;
    updateStatusControl();
    statusMenu.hidden = true;
    statusTrigger.setAttribute("aria-expanded", "false");
    restoreAttendancePopup(statusMenu, statusMenuHome);
    statusTrigger.focus();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || wrap.hidden || (datePopover.hidden && statusMenu.hidden)) return;
    datePopover.hidden = true;
    statusMenu.hidden = true;
    dateTrigger.setAttribute("aria-expanded", "false");
    statusTrigger.setAttribute("aria-expanded", "false");
    restoreAttendancePopup(datePopover, datePopoverHome);
    restoreAttendancePopup(statusMenu, statusMenuHome);
    dateTrigger.focus();
  });  document.addEventListener("click", (event) => {
    if (wrap.hidden) return;
    if (!datePopover.contains(event.target) && !event.target.closest(".attendance-date-picker")) {
      datePopover.hidden = true;
      dateTrigger.setAttribute("aria-expanded", "false");
      restoreAttendancePopup(datePopover, datePopoverHome);
    }
    if (!statusMenu.contains(event.target) && !event.target.closest(".attendance-status-select")) {
      statusMenu.hidden = true;
      statusTrigger.setAttribute("aria-expanded", "false");
      restoreAttendancePopup(statusMenu, statusMenuHome);
    }
  });
  wrap.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    datePopover.hidden = true;
    statusMenu.hidden = true;
    dateTrigger.setAttribute("aria-expanded", "false");
    statusTrigger.setAttribute("aria-expanded", "false");
    restoreAttendancePopup(datePopover, datePopoverHome);
    restoreAttendancePopup(statusMenu, statusMenuHome);
  });
}

/* ---------------- Boot ---------------- */
function init() {
  if (!user) return;
  installDashboardMotionStyles();
  document.body.classList.toggle("is-dark", state.darkMode);
  document.body.dataset.role = user.role;
  state.riskyMode = loadRiskyModePreference();
  state.students = loadStudents();
  state.sections = loadSections();
  buildAttendanceModal();
  initializeStudentFormDropdowns();
  document.querySelector("#year") && (document.querySelector("#year").textContent = String(new Date().getFullYear()));
  renderChrome();
  animateAppChromeEntrance();
  animateBrandEntrance();
  wire();
  refreshNotifications();
  window.setInterval(refreshNotifications, 20000);
  if (user.role === "teacher") {
    window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const freshStudents = loadStudents();
      const freshSections = loadSections();
      const rosterChanged = JSON.stringify(freshStudents) !== JSON.stringify(state.students);
      const sectionsChanged = JSON.stringify(freshSections) !== JSON.stringify(state.sections);
      if (!rosterChanged && !sectionsChanged) return;
      state.students = freshStudents;
      state.sections = freshSections;
      renderView();
    }, 10000);
  }
  animateViewOnNextRender = true;
  renderView();
  startUsageTracking();
  window.setInterval(updateScheduleClocks, 30000);
}

init();
