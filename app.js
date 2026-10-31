const { createClient } = window.supabase;
const config = window.SUPABASE_CONFIG || {};
const app = document.querySelector("#app");
const header = document.querySelector("#site-header");
const TERMS = ["midterm", "final"];
const CATEGORIES = ["recitation", "activity", "quiz", "exam"];
const WEIGHTS = { recitation: 0.10, activity: 0.30, quiz: 0.20, exam: 0.40 };
const PASSING_GRADE = 75;
const hasConfig = config.url && !config.url.includes("YOUR-PROJECT-REF") &&
  config.anonKey && !config.anonKey.includes("YOUR-PUBLISHABLE");
const db = hasConfig ? createClient(config.url, config.anonKey) : null;

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
}

function fmt(value) {
  return value == null ? "—" : Number(value).toFixed(2);
}

function showError(error) {
  console.error(error);
  app.insertAdjacentHTML("afterbegin",
    `<div class="flash error">${esc(error.message || "Something went wrong.")}</div>`);
}

function showMessage(message, type = "success") {
  app.insertAdjacentHTML("afterbegin", `<div class="flash ${type}">${esc(message)}</div>`);
}

function requireDb() {
  if (!db) throw new Error("Configure supabase-config.js before using the application.");
  return db;
}

function categoryPercentages(scores) {
  const totals = Object.fromEntries(CATEGORIES.map((category) => [category, [0, 0]]));
  scores.forEach((score) => {
    totals[score.category][0] += Number(score.score);
    totals[score.category][1] += Number(score.max_score);
  });
  return Object.fromEntries(CATEGORIES.map((category) => {
    const [score, max] = totals[category];
    return [category, max ? score / max * 100 : null];
  }));
}

function termGrade(scores) {
  const percentages = categoryPercentages(scores);
  const used = CATEGORIES.filter((category) => percentages[category] != null);
  if (!used.length) return null;
  const weight = used.reduce((sum, category) => sum + WEIGHTS[category], 0);
  return used.reduce((sum, category) => sum + percentages[category] * WEIGHTS[category], 0) / weight;
}

function summary(scores) {
  const byTerm = Object.fromEntries(TERMS.map((term) => [
    term, scores.filter((score) => score.term === term)
  ]));
  const midterm = termGrade(byTerm.midterm);
  const final = termGrade(byTerm.final);
  const grades = [midterm, final].filter((grade) => grade != null);
  const overall = grades.length ? grades.reduce((sum, grade) => sum + grade, 0) / grades.length : null;
  return {
    midterm, final, overall,
    remark: overall == null ? "No grade yet" : overall >= PASSING_GRADE ? "Passed" : "Failed",
    categoryPct: Object.fromEntries(TERMS.map((term) => [term, categoryPercentages(byTerm[term])]))
  };
}

async function getStudents() {
  const { data, error } = await requireDb().from("students")
    .select("*").order("last_name").order("first_name");
  if (error) throw error;
  return data;
}

async function getScores(studentId) {
  const { data, error } = await requireDb().from("scores")
    .select("*").eq("student_id", studentId).order("term").order("category").order("id");
  if (error) throw error;
  return data;
}

function formFields(student = {}) {
  return [
    ["student_number", "Student number", "text", true],
    ["last_name", "Last name", "text", true],
    ["first_name", "First name", "text", true],
    ["middle_name", "Middle name", "text", false],
    ["course", "Course", "text", false],
    ["year_section", "Year / section", "text", false],
    ["email", "Email", "email", false]
  ].map(([key, label, type, required]) =>
    `<label for="${key}">${label}${required ? " *" : ""}</label>` +
    `<input id="${key}" name="${key}" type="${type}" value="${esc(student[key])}" ${required ? "required" : ""}>`
  ).join("");
}

function scoreFields(score = {}) {
  return `
    <label for="term">Grading period</label>
    <select id="term" name="term" required>${TERMS.map((term) =>
      `<option value="${term}" ${score.term === term ? "selected" : ""}>${term[0].toUpperCase() + term.slice(1)}</option>`).join("")}</select>
    <label for="category">Category</label>
    <select id="category" name="category" required>${CATEGORIES.map((category) =>
      `<option value="${category}" ${score.category === category ? "selected" : ""}>${category[0].toUpperCase() + category.slice(1)}</option>`).join("")}</select>
    <label for="title">Activity / assessment title</label><input id="title" name="title" value="${esc(score.title)}" required>
    <label for="score">Score</label><input id="score" name="score" type="number" min="0" step="any" value="${esc(score.score)}" required>
    <label for="max_score">Maximum score</label><input id="max_score" name="max_score" type="number" min="0.01" step="any" value="${esc(score.max_score)}" required>`;
}

async function renderLogin() {
  header.hidden = true;
  app.innerHTML = `<section class="panel"><h1>Teacher sign in</h1>
    ${hasConfig ? "" : '<div class="flash error">Copy supabase-config.example.js to supabase-config.js and add your Supabase URL and publishable key.</div>'}
    <form id="login-form"><label for="email">Email</label><input id="email" type="email" required autocomplete="username">
    <label for="password">Password</label><input id="password" type="password" required autocomplete="current-password">
    <p><button type="submit">Log in</button></p></form>
    <p class="muted">Create the teacher account in Supabase Authentication first.</p></section>`;
  document.querySelector("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const { error } = await requireDb().auth.signInWithPassword({
        email: document.querySelector("#email").value.trim(),
        password: document.querySelector("#password").value
      });
      if (error) throw error;
      await route();
    } catch (error) { showError(error); }
  });
}

async function renderDashboard() {
  const students = await getStudents();
  const scoreLists = await Promise.all(students.map((student) => getScores(student.id)));
  const allScores = scoreLists.flat();
  const overalls = scoreLists.map((scores) => summary(scores).overall).filter((grade) => grade != null);
  const average = overalls.length ? overalls.reduce((sum, grade) => sum + grade, 0) / overalls.length : null;
  app.innerHTML = `<h1>Dashboard</h1><div class="stats">
    <div class="stat">Students<strong>${students.length}</strong></div>
    <div class="stat">Recorded scores<strong>${allScores.length}</strong></div>
    <div class="stat">Average overall grade<strong>${fmt(average)}</strong></div>
    <div class="stat">Passing students<strong>${overalls.filter((grade) => grade >= PASSING_GRADE).length} / ${overalls.length}</strong></div>
    </div><p class="actions"><a class="button" href="#/students/new">Add student</a>
    <a class="button secondary" href="#/class-record">View class record</a></p>`;
}

async function renderStudents() {
  const students = await getStudents();
  const query = new URLSearchParams(location.hash.split("?")[1] || "").get("q") || "";
  const filtered = students.filter((student) => [student.student_number, student.last_name, student.first_name]
    .some((value) => value.toLowerCase().includes(query.toLowerCase())));
  app.innerHTML = `<h1>Students</h1><form id="student-search" class="student-search">
    <label for="q">Search by name or student number</label><input id="q" value="${esc(query)}">
    <div class="actions search-actions"><button type="submit">Search</button>
    ${query ? '<a href="#/students">Clear</a>' : ""}<a class="button" href="#/students/new">Add student</a></div></form>
    <div class="panel table-wrap"><table><thead><tr><th>Student number</th><th>Name</th><th>Course</th><th>Year / section</th><th>Actions</th></tr></thead><tbody>
    ${filtered.length ? filtered.map((student) => `<tr><td>${esc(student.student_number)}</td>
      <td><a href="#/students/${student.id}">${esc(student.last_name)}, ${esc(student.first_name)} ${esc(student.middle_name)}</a></td>
      <td>${esc(student.course)}</td><td>${esc(student.year_section)}</td><td class="actions">
      <a href="#/students/${student.id}/edit">Edit</a><button class="danger delete-student" data-id="${student.id}">Delete</button></td></tr>`).join("") :
      '<tr><td colspan="5" class="muted">No students found.</td></tr>'}</tbody></table></div>`;
  document.querySelector("#student-search").addEventListener("submit", (event) => {
    event.preventDefault(); location.hash = `#/students?q=${encodeURIComponent(document.querySelector("#q").value)}`;
  });
  document.querySelectorAll(".delete-student").forEach((button) => button.addEventListener("click", async () => {
    if (!confirm("Delete this student and all their scores?")) return;
    try {
      const { error } = await requireDb().from("students").delete().eq("id", button.dataset.id);
      if (error) throw error; await renderStudents();
    } catch (error) { showError(error); }
  }));
}

async function renderStudentForm(id) {
  const editing = Boolean(id);
  let student = {};
  if (editing) {
    const { data, error } = await requireDb().from("students").select("*").eq("id", id).single();
    if (error) throw error; student = data;
  }
  app.innerHTML = `<section class="panel"><h1>${editing ? "Edit" : "Add"} student</h1>
    <form id="student-form">${formFields(student)}<p class="actions"><button type="submit">Save student</button>
    <a class="button secondary" href="#/students">Cancel</a></p></form></section>`;
  document.querySelector("#student-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.target));
    try {
      const result = editing ? await requireDb().from("students").update(values).eq("id", id) :
        await requireDb().from("students").insert(values);
      if (result.error) throw result.error; location.hash = "#/students";
    } catch (error) { showError(error); }
  });
}

function summaryTable(studentSummary) {
  return `<div class="table-wrap"><table><thead><tr><th>Period</th>${CATEGORIES.map((category) =>
    `<th>${category[0].toUpperCase() + category.slice(1)} (${WEIGHTS[category] * 100}%)</th>`).join("")}<th>Term grade</th></tr></thead><tbody>
    ${TERMS.map((term) => `<tr><th>${term[0].toUpperCase() + term.slice(1)}</th>${CATEGORIES.map((category) =>
      `<td>${fmt(studentSummary.categoryPct[term][category])}${studentSummary.categoryPct[term][category] == null ? "" : "%"}</td>`).join("")}
      <td>${fmt(studentSummary[term])}</td></tr>`).join("")}</tbody></table></div>`;
}

async function renderStudent(id) {
  const [{ data: student, error: studentError }, scores] = await Promise.all([
    requireDb().from("students").select("*").eq("id", id).single(), getScores(id)
  ]);
  if (studentError) throw studentError;
  const studentSummary = summary(scores);
  app.innerHTML = `<h1>${esc(student.last_name)}, ${esc(student.first_name)} ${esc(student.middle_name)}</h1>
    <p class="muted">${esc(student.student_number)}${student.course ? ` · ${esc(student.course)}` : ""}${student.year_section ? ` · ${esc(student.year_section)}` : ""}</p>
    <section class="panel"><h2>Grade summary</h2>${summaryTable(studentSummary)}
    <p><strong>Overall grade:</strong> ${fmt(studentSummary.overall)} &nbsp; <strong>Remark:</strong> ${studentSummary.remark}</p></section>
    <section class="panel"><h2>Record a score</h2><form id="score-form">${scoreFields()}
    <p><button type="submit">Record score</button></p></form></section>
    <section class="panel table-wrap"><h2>Scores</h2><table><thead><tr><th>Period</th><th>Category</th><th>Title</th><th>Score</th><th>Actions</th></tr></thead><tbody>
    ${scores.length ? scores.map((score) => `<tr><td>${esc(score.term)}</td><td>${esc(score.category)}</td><td>${esc(score.title)}</td>
      <td>${fmt(score.score)} / ${fmt(score.max_score)}</td><td class="actions"><a href="#/scores/${score.id}/edit">Edit</a>
      <button class="danger delete-score" data-id="${score.id}">Delete</button></td></tr>`).join("") :
      '<tr><td colspan="5" class="muted">No scores recorded yet.</td></tr>'}</tbody></table></section>
    <a href="#/students">Back to students</a>`;
  document.querySelector("#score-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.target));
    values.student_id = id; values.score = Number(values.score); values.max_score = Number(values.max_score);
    if (values.score < 0 || values.max_score <= 0 || values.score > values.max_score) {
      showError(new Error("Score must be between 0 and the maximum score.")); return;
    }
    try {
      const { error } = await requireDb().from("scores").insert(values);
      if (error) throw error; await renderStudent(id);
    } catch (error) { showError(error); }
  });
  document.querySelectorAll(".delete-score").forEach((button) => button.addEventListener("click", async () => {
    if (!confirm("Delete this score?")) return;
    try {
      const { error } = await requireDb().from("scores").delete().eq("id", button.dataset.id);
      if (error) throw error; await renderStudent(id);
    } catch (error) { showError(error); }
  }));
}

async function renderScoreForm(id) {
  const { data: score, error } = await requireDb().from("scores").select("*, students(*)").eq("id", id).single();
  if (error) throw error;
  app.innerHTML = `<section class="panel"><h1>Edit score</h1><p>Student: ${esc(score.students.last_name)}, ${esc(score.students.first_name)}</p>
    <form id="score-edit-form">${scoreFields(score)}<p class="actions"><button type="submit">Save score</button>
    <a class="button secondary" href="#/students/${score.student_id}">Cancel</a></p></form></section>`;
  document.querySelector("#score-edit-form").addEventListener("submit", async (event) => {
    event.preventDefault(); const values = Object.fromEntries(new FormData(event.target));
    values.score = Number(values.score); values.max_score = Number(values.max_score);
    try {
      const result = await requireDb().from("scores").update(values).eq("id", id);
      if (result.error) throw result.error; location.hash = `#/students/${score.student_id}`;
    } catch (error) { showError(error); }
  });
}

async function renderClassRecord() {
  const students = await getStudents();
  const records = await Promise.all(students.map(async (student) => ({ student, summary: summary(await getScores(student.id)) })));
  app.innerHTML = `<h1>Class record</h1><div class="panel table-wrap"><table><thead><tr><th>Student number</th><th>Student</th><th>Midterm</th><th>Final</th><th>Overall</th><th>Remark</th></tr></thead><tbody>
    ${records.length ? records.map(({ student, summary: record }) => `<tr><td>${esc(student.student_number)}</td><td><a href="#/students/${student.id}">${esc(student.last_name)}, ${esc(student.first_name)}</a></td>
      <td>${fmt(record.midterm)}</td><td>${fmt(record.final)}</td><td>${fmt(record.overall)}</td><td>${record.remark}</td></tr>`).join("") :
      '<tr><td colspan="6" class="muted">No students have been added.</td></tr>'}</tbody></table></div>`;
}

async function renderAccount() {
  app.innerHTML = `<section class="panel"><h1>Change password</h1><form id="account-form">
    <label for="password">New password (at least 8 characters)</label><input id="password" type="password" minlength="8" required>
    <label for="confirm">Confirm new password</label><input id="confirm" type="password" minlength="8" required>
    <p><button type="submit">Change password</button></p></form></section>`;
  document.querySelector("#account-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = document.querySelector("#password").value;
    if (password !== document.querySelector("#confirm").value) { showError(new Error("New passwords do not match.")); return; }
    try {
      const { error } = await requireDb().auth.updateUser({ password });
      if (error) throw error; showMessage("Password changed.");
    } catch (error) { showError(error); }
  });
}

async function route() {
  app.innerHTML = '<p class="panel">Loading…</p>';
  try {
    if (!db) { await renderLogin(); return; }
    const { data: { session } } = await requireDb().auth.getSession();
    if (!session) { await renderLogin(); return; }
    header.hidden = false;
    const path = location.hash.replace(/^#\/?/, "").split("?")[0];
    const parts = path.split("/").filter(Boolean);
    if (!parts.length) await renderDashboard();
    else if (parts[0] === "students" && parts[1] === "new") await renderStudentForm();
    else if (parts[0] === "students" && parts[2] === "edit") await renderStudentForm(parts[1]);
    else if (parts[0] === "students" && parts[1]) await renderStudent(parts[1]);
    else if (parts[0] === "students") await renderStudents();
    else if (parts[0] === "scores" && parts[2] === "edit") await renderScoreForm(parts[1]);
    else if (parts[0] === "class-record") await renderClassRecord();
    else if (parts[0] === "account") await renderAccount();
    else await renderDashboard();
  } catch (error) { app.innerHTML = ""; showError(error); }
}

document.querySelector("#logout-button").addEventListener("click", async () => {
  const { error } = await requireDb().auth.signOut();
  if (error) showError(error); else await route();
});
if (db) db.auth.onAuthStateChange(() => route());
window.addEventListener("hashchange", route);
route();
