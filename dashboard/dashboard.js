/* ============================================================
   PBC COMMAND CENTER — dashboard.js
   Reads live data from the Apps Script webhook (key-gated).
   No frameworks, hand-rolled SVG charts.
   ============================================================ */

const WEBHOOK =
  "https://script.google.com/macros/s/AKfycbyBhh67LuNS1AK7BeA1E0w9OulfH8zlH-rlIZUwgF_ES_dMWCw3iVhAO5f72du3h0xv2w/exec";

/* ---------------- session ----------------

   The key used to be a bare string under `pbc_dash_key` that never expired.
   It now lives in `pbc_dash_session` as { key, expiresAt }, and every
   successful load pushes expiresAt another 30 days out — so what expires is
   30 days of *not opening it*, not 30 days from first unlock.

   Worth being clear about the ceiling: this is a convenience lock on a device
   Lane controls. The key itself never expires server-side, so a stolen
   unlocked phone is still a stolen key. The phone's own passcode is the real
   boundary here.
------------------------------------------ */

const SESSION_STORE = "pbc_dash_session";
const LEGACY_KEY_STORE = "pbc_dash_key";
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

// Anything slower than this on cellular is indistinguishable from a hang, and
// an un-abortable fetch leaves the spinner running forever.
const FETCH_TIMEOUT_MS = 20000;

function readSession() {
  let raw = null;
  try {
    raw = localStorage.getItem(SESSION_STORE);
  } catch (err) {
    return null; // private mode, or storage disabled
  }
  if (raw) {
    try {
      const s = JSON.parse(raw);
      if (s && s.key && s.expiresAt > Date.now()) return s.key;
    } catch (err) {
      /* corrupt — fall through and clear */
    }
    clearSession();
    return null;
  }
  // Migrate the old bare-string key so the laptop doesn't get logged out by
  // this change.
  let legacy = null;
  try {
    legacy = localStorage.getItem(LEGACY_KEY_STORE);
  } catch (err) {
    return null;
  }
  if (legacy) {
    writeSession(legacy);
    try { localStorage.removeItem(LEGACY_KEY_STORE); } catch (err) { /* nothing to do */ }
    return legacy;
  }
  return null;
}

function writeSession(key) {
  try {
    localStorage.setItem(
      SESSION_STORE,
      JSON.stringify({ key, expiresAt: Date.now() + SESSION_MS })
    );
  } catch (err) {
    /* storage full or blocked — the session just won't persist */
  }
}

function clearSession() {
  try {
    localStorage.removeItem(SESSION_STORE);
    localStorage.removeItem(LEGACY_KEY_STORE);
  } catch (err) {
    /* nothing to do */
  }
}

/* ---------------- escaping ----------------

   Every value below comes out of a Google Sheet or a Calendar event and lands
   in an innerHTML template. Unescaped, a client named O"Brien breaks the
   tooltip attribute it sits in and a stray `<` silently swallows the rest of
   the card. Nothing public writes to those sheets today, so this is mostly a
   rendering fix — but it is also the thing that would stop a lead-form field
   from becoming script on this page, which is worth having in place first.
------------------------------------------- */

const esc = (v) =>
  String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

// For values going inside a quoted attribute, where a quote would end it early.
const escAttr = (v) => esc(v).replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const COLORS = {
  lessons: "#E8622A",
  lessonsSoft: "#F59B72",
  chiro: "#1F97AE",
  chiroSoft: "#66BFCE",
  digital: "#9678F0",
  other: "#6B8ECC",
  unclassified: "#8A8F98",
};

const $ = (id) => document.getElementById(id);

// One definition of "phone-shaped", shared by the chart and the month calendar
// so they never disagree about which layout is in force.
const NARROW_QUERY = "(max-width: 600px)";
const isNarrow = () => window.matchMedia(NARROW_QUERY).matches;

const fmt$ = (n) =>
  "$" + Math.round(n).toLocaleString("en-US");
const fmt$c = (n) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

let DATA = null;
let lineMode = "sessions"; // or "leads"
let leadSrcMode = "all"; // "all" | "chiro" | "lessons"
let periodMode = "month"; // "week" | "month" | "quarter"

let calMode = "week"; // "day" | "week" | "month"
let calAnchor = new Date();
let CAL_CACHE = { start: null, end: null, events: [] };

/* ---------------- boot ---------------- */

document.addEventListener("DOMContentLoaded", () => {
  $("gate-form").addEventListener("submit", (e) => {
    e.preventDefault();
    $("gate-error").classList.add("hidden"); // don't leave the last failure showing
    const key = $("gate-input").value.trim();
    if (!key) return;
    writeSession(key);
    $("gate").classList.add("hidden");
    loadData();
  });

  // A 20-character random key typed blind into a masked field is how you end up
  // locked out of your own dashboard on a phone.
  $("gate-reveal").addEventListener("click", () => {
    const input = $("gate-input");
    const shown = input.type === "text";
    input.type = shown ? "password" : "text";
    $("gate-reveal").textContent = shown ? "Show" : "Hide";
    $("gate-reveal").setAttribute("aria-pressed", String(!shown));
    $("gate-reveal").setAttribute("aria-label", (shown ? "Show" : "Hide") + " access key");
    input.focus();
  });

  $("refresh-btn").addEventListener("click", loadData);
  $("retry-btn").addEventListener("click", loadData);
  $("rekey-btn").addEventListener("click", showGate);
  $("lock-btn").addEventListener("click", () => {
    clearSession();
    location.reload();
  });
  $("toggle-sessions").addEventListener("click", () => setLineMode("sessions"));
  $("toggle-leads").addEventListener("click", () => setLineMode("leads"));
  $("src-all").addEventListener("click", () => setLeadSrcMode("all"));
  $("src-chiro").addEventListener("click", () => setLeadSrcMode("chiro"));
  $("src-lessons").addEventListener("click", () => setLeadSrcMode("lessons"));
  $("toggle-period-week").addEventListener("click", () => setPeriodMode("week"));
  $("toggle-period-month").addEventListener("click", () => setPeriodMode("month"));
  $("toggle-period-quarter").addEventListener("click", () => setPeriodMode("quarter"));

  $("task-form").addEventListener("submit", submitTask);

  $("cal-view-day").addEventListener("click", () => setCalMode("day"));
  $("cal-view-week").addEventListener("click", () => setCalMode("week"));
  $("cal-view-month").addEventListener("click", () => setCalMode("month"));
  $("cal-prev").addEventListener("click", () => calNav(-1));
  $("cal-next").addEventListener("click", () => calNav(1));
  $("cal-today").addEventListener("click", calToday);

  if (readSession()) {
    loadData();
  } else {
    $("gate").classList.remove("hidden");
  }

  // The chart and the month calendar pick a layout at render time, so crossing
  // the breakpoint (rotating the phone, mostly) has to redraw them.
  window.matchMedia(NARROW_QUERY).addEventListener("change", () => {
    if (!DATA) return;
    renderPeriodChart(DATA);
    drawCalendar();
  });

  registerServiceWorker();
});

// Scope is implicitly /dashboard/ — the file's own directory — so this can't
// intercept anything on the marketing site.
function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("sw.js").catch(() => {
    // No offline shell. Everything else still works, so this stays quiet.
  });
}

function showGate(withError) {
  clearSession();
  $("loading").classList.add("hidden");
  $("load-error").classList.add("hidden");
  $("app").classList.add("hidden");
  $("gate-input").value = "";
  $("gate-error").classList.toggle("hidden", withError !== true);
  $("gate").classList.remove("hidden");
}

function showLoadError(msg) {
  $("loading").classList.add("hidden");
  $("load-error-msg").textContent = msg;
  $("load-error").classList.remove("hidden");
}

// One place that knows how to call the webhook: aborts rather than hanging, and
// treats a non-JSON body (Google occasionally answers with an HTML interstitial)
// as a connection problem instead of throwing something unreadable.
async function webhookGet(params) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(WEBHOOK + "?" + params.toString(), { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error("The server sent something we couldn’t read.");
  }
}

function setLineMode(mode) {
  lineMode = mode;
  $("toggle-sessions").classList.toggle("active", mode === "sessions");
  $("toggle-leads").classList.toggle("active", mode === "leads");
  if (DATA) renderPeriodChart(DATA);
}

function setLeadSrcMode(mode) {
  leadSrcMode = mode;
  ["all", "chiro", "lessons"].forEach((m) =>
    $("src-" + m).classList.toggle("active", m === mode)
  );
  if (DATA) renderLeadSources(DATA);
}

function setPeriodMode(mode) {
  periodMode = mode;
  ["week", "month", "quarter"].forEach((m) =>
    $("toggle-period-" + m).classList.toggle("active", m === mode)
  );
  if (DATA) renderPeriodChart(DATA);
}

async function fetchCalendarEvents(start, end) {
  const key = readSession();
  if (!key) throw new Error("locked");
  const data = await webhookGet(
    new URLSearchParams({
      action: "get_calendar_events",
      key,
      range_start: localISO(start),
      range_end: localISO(end),
    })
  );
  if (data.status !== "ok") throw new Error(data.message || "calendar fetch failed");
  return data.events;
}

async function loadData() {
  const key = readSession();
  if (!key) { showGate(); return; }
  $("load-error").classList.add("hidden");
  $("loading").classList.remove("hidden");
  $("app").classList.add("hidden");

  let data;
  try {
    data = await webhookGet(new URLSearchParams({ action: "get_dashboard_data", key }));
  } catch (err) {
    // Reaching the server failed, which says nothing about whether the key is
    // good — so the key is kept, and the error screen offers a way back to the
    // gate for when it turns out the key was the problem after all.
    showLoadError(
      err.name === "AbortError"
        ? "That took too long — the connection may be weak. Try again."
        : "Couldn’t reach the data source. Check your connection and try again."
    );
    return;
  }

  if (data.status !== "ok") {
    if ((data.message || "").indexOf("unauthorized") !== -1) {
      showGate(true);
      return;
    }
    showLoadError(data.message || "The server returned an error.");
    return;
  }

  DATA = data;
  writeSession(key); // opening it counts — slide the 30 days forward
  $("loading").classList.add("hidden");
  $("app").classList.remove("hidden");
  renderAll(data);
}

/* ---------------- helpers ---------------- */

function parseDate(s) {
  if (!s) return null;
  // API sends yyyy-mm-dd; be tolerant of mm/dd/yyyy strings
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s);
  if (m) {
    let yr = +m[3]; if (yr < 100) yr += 2000;
    return new Date(yr, +m[1] - 1, +m[2]);
  }
  return null;
}
// yyyy-mm-dd as the local calendar sees it. `toISOString` is UTC, which is the
// same answer in Florida only by luck of the offset's sign — and these values
// get re-parsed as local dates immediately afterwards.
const localISO = (d) =>
  d.getFullYear() + "-" +
  String(d.getMonth() + 1).padStart(2, "0") + "-" +
  String(d.getDate()).padStart(2, "0");

const monthKey = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function monthLabel(key) {
  const [y, m] = key.split("-");
  return MONTH_NAMES[+m - 1] + (+y !== new Date().getFullYear() ? " ’" + y.slice(2) : "");
}

// Sum (amountField given) or count (amountField null) rows in a trailing window vs the
// equal-length window immediately before it. Window is (now-days, now].
function trailingWindow(rows, days, amountField) {
  const now = new Date();
  const curStart = new Date(now); curStart.setDate(curStart.getDate() - days);
  const prevStart = new Date(now); prevStart.setDate(prevStart.getDate() - 2 * days);
  let cur = 0, prev = 0;
  rows.forEach((r) => {
    const dt = parseDate(r.date);
    if (!dt) return;
    const v = amountField ? (r[amountField] || 0) : 1;
    if (dt > curStart && dt <= now) cur += v;
    else if (dt > prevStart && dt <= curStart) prev += v;
  });
  return { cur, prev };
}

// Same-day-count month-to-date: days 1..N of this month vs days 1..N of last month.
function sameDayCountMTD(rows, amountField) {
  const now = new Date();
  const dayCount = now.getDate();
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const daysInPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
  const prevDayCount = Math.min(dayCount, daysInPrevMonth);
  const thisKey = monthKey(now);
  const prevKey = monthKey(prevMonth);
  let cur = 0, prev = 0;
  rows.forEach((r) => {
    const dt = parseDate(r.date);
    if (!dt) return;
    const v = amountField ? (r[amountField] || 0) : 1;
    const k = monthKey(dt);
    if (k === thisKey && dt.getDate() <= dayCount) cur += v;
    else if (k === prevKey && dt.getDate() <= prevDayCount) prev += v;
  });
  return { cur, prev, dayCount };
}

function computeConversion(leads) {
  const total = leads.length;
  const converted = leads.filter((l) => l.status === "Converted").length;
  return { total, converted, rate: total ? (converted / total) * 100 : 0 };
}

/* Where a "session" comes from.

   These numbers used to be counted off the Mileage log, which counts *trips*.
   Mileage is logged one trip per venue per day, so a morning at Pettis Park
   with three lessons back to back was one session — which undercounted volume
   and, because Avg ticket divides revenue by this, inflated the ticket.

   The Sessions ledger is the real answer, but it only starts at webhook v31.
   Anything earlier has no rows at all, so if the ledger is empty this falls
   back to trips and relabels the tiles to say so rather than quietly reporting
   trips under a "Sessions" heading. */
function sessionSource(d) {
  const rows = (d.sessions || []).filter((s) => parseDate(s.date));
  if (rows.length) return { rows, label: "Sessions", noun: "sessions", ledger: true };
  return { rows: d.mileage || [], label: "Trips", noun: "trips", ledger: false };
}

// Earliest date in the ledger, so the chart can leave a gap over the months
// that predate it instead of drawing a cliff down to zero.
function firstDate(rows) {
  let min = null;
  rows.forEach((r) => {
    const dt = parseDate(r.date);
    if (dt && (!min || dt < min)) min = dt;
  });
  return min;
}

function computeClientValue(clients) {
  const billed = clients.filter((c) => (c.total_paid || 0) > 0);
  const n = billed.length;
  const totalPaid = billed.reduce((s, c) => s + c.total_paid, 0);
  const rebooked = billed.filter((c) => (+c.sessions_total || 0) > 1).length;
  return { avg: n ? totalPaid / n : 0, rebookRate: n ? (rebooked / n) * 100 : 0, n };
}

// Build [{start, end (exclusive), label}] buckets spanning startDate..now at the given grain.
function buildPeriodBuckets(startDate, now, mode) {
  const buckets = [];
  if (mode === "week") {
    // Monday-aligned 7-day buckets.
    const day = startDate.getDay(); // 0=Sun..6=Sat
    const mondayOffset = day === 0 ? -6 : 1 - day;
    let cur = new Date(startDate); cur.setDate(cur.getDate() + mondayOffset);
    cur.setHours(0, 0, 0, 0);
    while (cur <= now) {
      const end = new Date(cur); end.setDate(end.getDate() + 7);
      buckets.push({
        start: new Date(cur),
        end,
        label: cur.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      });
      cur = end;
    }
    return buckets.slice(-12);
  }
  if (mode === "quarter") {
    let cur = new Date(startDate.getFullYear(), Math.floor(startDate.getMonth() / 3) * 3, 1);
    while (cur <= now) {
      const end = new Date(cur.getFullYear(), cur.getMonth() + 3, 1);
      const q = Math.floor(cur.getMonth() / 3) + 1;
      const label = "Q" + q + (cur.getFullYear() !== now.getFullYear() ? " ’" + String(cur.getFullYear()).slice(2) : "");
      buckets.push({ start: new Date(cur), end, label });
      cur = end;
    }
    return buckets;
  }
  // month (default)
  let cur = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  while (cur <= now) {
    const end = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    buckets.push({ start: new Date(cur), end, label: monthLabel(monthKey(cur)) });
    cur = end;
  }
  return buckets;
}

// Classify an income row into { parent, sub }
function classify(row) {
  const desc = (row.description || "").toLowerCase();
  const isPkg = desc.indexOf("package") !== -1 || desc.indexOf("pkg") !== -1;
  switch (row.type) {
    case "Pickleball Lessons":
      return { parent: "Pickleball Lessons", sub: isPkg ? "Package" : "One-off" };
    case "Mobile Chiro Visit":
      return { parent: "Mobile Chiro", sub: isPkg ? "Package" : "One-off" };
    case "Package Sales":
      if (/lesson|pickleball/.test(desc)) return { parent: "Pickleball Lessons", sub: "Package" };
      if (/chiro/.test(desc)) return { parent: "Mobile Chiro", sub: "Package" };
      return { parent: "Unclassified", sub: "Package" };
    case "Digital Products (Guides)":
      return { parent: "Digital Products", sub: "One-off" };
    default:
      return { parent: "Other", sub: "One-off" };
  }
}

/* ---------------- render ---------------- */

function renderAll(d) {
  const asof = new Date(d.generated_at);
  $("data-asof").textContent =
    "Data as of " + asof.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  renderDrift(d);
  renderKpis(d);
  renderSchedule(d);
  renderTasks(d);
  renderPeriodChart(d);
  renderStreams(d);
  renderMoney(d);
  renderUnserviced(d);
  renderOwed(d);
  renderClients(d);
  renderReengage(d);
  renderRecent(d);
  renderPipeline(d);
  renderLeadSources(d);
  renderRecentLeads(d);
  renderAttention(d);
}

function renderDrift(d) {
  const incomeTotal = d.income.reduce((s, r) => s + r.amount, 0);
  const clientTotal = d.clients.reduce((s, c) => s + (c.total_paid || 0), 0);
  const gap = incomeTotal - clientTotal;
  const el = $("drift-banner");
  if (Math.abs(gap) > 0.5) {
    el.textContent =
      "⚠ Client records are out of sync with the Income tab by " + fmt$c(Math.abs(gap)) +
      " — a payment was logged as income but not added to a client’s Total Paid (or vice versa).";
    el.classList.remove("hidden");
  } else {
    el.classList.add("hidden");
  }
}

function renderKpis(d) {
  const src = sessionSource(d);
  const revTrailing = trailingWindow(d.income, 30, "amount");
  const sessTrailing = trailingWindow(src.rows, 30, null);
  const revMTD = sameDayCountMTD(d.income, "amount");
  const sessMTD = sameDayCountMTD(src.rows, null);

  // Active = anyone not Inactive: on an open package, seen within 14 days, with a
  // booked next session, or brand-new (single source of truth = the webhook's Stage).
  const activeClients = d.clients.filter(
    (c) => c.name && c.stage !== "Inactive"
  ).length;
  const leadRows = d.leads.map((l) => ({ date: l.date_added }));
  const leadsTrailing = trailingWindow(leadRows, 30, null);
  const ig = d.instagram || null;
  const incomeTotal = d.income.reduce((s, r) => s + r.amount, 0);
  const expenseTotal = d.expenses.reduce((s, r) => s + r.amount, 0);
  const net = incomeTotal - expenseTotal;

  const conversion = computeConversion(d.leads);
  const avgTicket = sessTrailing.cur ? revTrailing.cur / sessTrailing.cur : null;
  const clientValue = computeClientValue(d.clients);
  const delta = (cur, prevV, money) => {
    if (!prevV) return "";
    const pct = ((cur - prevV) / prevV) * 100;
    const cls = pct >= 0 ? "up" : "down";
    const arrow = pct >= 0 ? "▲" : "▼";
    return `<div class="kpi-delta ${cls}">${arrow} ${Math.abs(pct).toFixed(0)}% vs prior 30 days (${money ? fmt$(prevV) : prevV})</div>`;
  };
  const mtdLine = (mtd, money) => {
    if (!mtd.cur && !mtd.prev) return "";
    const curTxt = money ? fmt$(mtd.cur) : mtd.cur;
    const prevTxt = money ? fmt$(mtd.prev) : mtd.prev;
    return `<div class="kpi-delta">Day 1–${mtd.dayCount}: ${curTxt} vs ${prevTxt} last month</div>`;
  };

  const tiles = [
    { label: "Revenue · 30d", value: fmt$(revTrailing.cur), extra: delta(revTrailing.cur, revTrailing.prev, true) + mtdLine(revMTD, true) },
    { label: src.label + " · 30d", value: sessTrailing.cur, extra: delta(sessTrailing.cur, sessTrailing.prev, false) + mtdLine(sessMTD, false) },
    { label: "Active clients", value: activeClients, extra: "" },
    { label: "Net profit · YTD", value: fmt$(net), extra: `<div class="kpi-delta">${fmt$(incomeTotal)} in − ${fmt$(expenseTotal)} out</div>` },
    // Spell out the denominator — this tile reads very differently depending on
    // whether it is dividing by sessions or by trips.
    { label: "Avg ticket · 30d", value: avgTicket !== null ? fmt$(avgTicket) : "—",
      extra: avgTicket !== null ? `<div class="kpi-delta">${fmt$(revTrailing.cur)} ÷ ${sessTrailing.cur} ${src.noun}</div>` : "" },
    { label: "New leads · 30d", value: leadsTrailing.cur, extra: delta(leadsTrailing.cur, leadsTrailing.prev, false) },
    { label: "Lead conversion", value: conversion.rate.toFixed(0) + "%", extra: `<div class="kpi-delta">${conversion.converted} of ${conversion.total} leads · all-time</div>` },
    { label: "Avg client value", value: fmt$(clientValue.avg), extra: `<div class="kpi-delta">${clientValue.rebookRate.toFixed(0)}% rebook (${clientValue.n} clients)</div>` },
  ];
  if (ig && ig.followers) {
    const d7 = ig.delta_7d;
    const igExtra = d7 === null || d7 === undefined
      ? `<div class="kpi-delta">@${"dr.lane_o"} · as of ${ig.as_of || "—"}</div>`
      : `<div class="kpi-delta ${d7 >= 0 ? "up" : "down"}">${d7 >= 0 ? "▲" : "▼"} ${Math.abs(d7).toLocaleString("en-US")} in 7 days</div>`;
    tiles.push({ label: "Instagram followers", value: ig.followers.toLocaleString("en-US"), extra: igExtra });
  }
  $("kpis").innerHTML = tiles
    .map(
      (t) => `<div class="kpi"><div class="kpi-label">${t.label}</div><div class="kpi-value">${t.value}</div>${t.extra}</div>`
    )
    .join("");
}

/* ------- period chart (bars = revenue, line = sessions/clients) ------- */

function renderPeriodChart(d) {
  const src = sessionSource(d);

  // range: first activity in 2026+ -> now
  const dates = [];
  d.income.forEach((r) => { const dt = parseDate(r.date); if (dt && dt.getFullYear() >= 2026) dates.push(dt); });
  d.mileage.forEach((r) => { const dt = parseDate(r.date); if (dt && dt.getFullYear() >= 2026) dates.push(dt); });
  d.leads.forEach((r) => { const dt = parseDate(r.date_added); if (dt && dt.getFullYear() >= 2026) dates.push(dt); });
  if (!dates.length) { $("monthly-chart").innerHTML = '<p class="empty-note">No data yet.</p>'; return; }
  dates.sort((a, b) => a - b);
  const now = new Date();
  let buckets = buildPeriodBuckets(dates[0], now, periodMode);
  if (!buckets.length) { $("monthly-chart").innerHTML = '<p class="empty-note">No data yet.</p>'; return; }

  // On a phone the full run of buckets renders its labels at around 5px once the
  // 720-wide viewBox is scaled to fit. Fewer, bigger buckets beats a horizontal
  // scroll region fighting the page's own vertical scroll.
  const narrow = isNarrow();
  const allBuckets = buckets.length;
  if (narrow) buckets = buckets.slice(-6);
  const trimmed = allBuckets - buckets.length;

  const revenue = buckets.map(() => 0);
  const sessions = buckets.map(() => 0);
  const leads = buckets.map(() => 0);
  const bucketFor = (dt) => buckets.findIndex((b) => dt >= b.start && dt < b.end);

  d.income.forEach((r) => {
    const dt = parseDate(r.date); if (!dt) return;
    const i = bucketFor(dt); if (i === -1) return;
    revenue[i] += r.amount;
  });
  src.rows.forEach((r) => {
    const dt = parseDate(r.date); if (!dt) return;
    const i = bucketFor(dt); if (i === -1) return;
    sessions[i]++;
  });
  d.leads.forEach((r) => {
    const dt = parseDate(r.date_added); if (!dt) return;
    const i = bucketFor(dt); if (i === -1) return;
    leads[i]++;
  });

  // The Sessions ledger starts partway through the history. A bucket that ended
  // before the first ledger row has no answer, not an answer of zero — plot a
  // gap, because a line dropping to the floor reads as "no sessions happened".
  const ledgerStart = src.ledger ? firstDate(src.rows) : null;
  const preLedger = (b) => ledgerStart !== null && b.end <= ledgerStart;

  const lineVals = buckets.map((b, i) =>
    lineMode === "sessions" ? (preLedger(b) ? null : sessions[i]) : leads[i]
  );
  const barVals = revenue;

  // --- SVG: two aligned panels sharing the period axis (never dual-axis) ---
  //
  // The viewBox width is the thing that decides legibility, not the font-size
  // attribute. A fixed 720 squeezed into a ~300px card scales everything by
  // 0.42, so a "13px" label lands on screen at 5.4px. Matching the viewBox to
  // the container makes the scale 1:1 and the numbers mean what they say.
  const availW = $("monthly-chart").clientWidth || 720;
  const W = narrow ? Math.max(300, Math.round(availW)) : 720;
  const fs = narrow ? 12 : 10;
  const padL = narrow ? 58 : 52, padR = narrow ? 10 : 16, padT = 14;
  const barH = narrow ? 140 : 170, gapH = 30, lineH = narrow ? 64 : 80, padB = narrow ? 30 : 26;
  const H = padT + barH + gapH + lineH + padB;
  const plotW = W - padL - padR;
  const niceMax = niceCeil(Math.max(...barVals, 1));
  const lineMax = niceCeil(Math.max(...lineVals.filter((v) => v !== null), 1));

  const bw = Math.min(44, (plotW / buckets.length) * 0.55);
  const xC = (i) => padL + (plotW / buckets.length) * (i + 0.5);
  const barBase = padT + barH;
  const lineTop = padT + barH + gapH;
  const lineBase = lineTop + lineH;
  const yBar = (v) => barBase - (v / niceMax) * barH;
  const yLine = (v) => lineBase - (v / lineMax) * lineH;

  const periodLabel = periodMode === "week" ? "Weekly" : periodMode === "quarter" ? "Quarterly" : "Monthly";

  const seriesName = lineMode === "sessions" ? src.label : "New leads";
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escAttr(periodLabel)} revenue and ${escAttr(seriesName)}">`;
  // ---- panel 1: revenue bars ----
  for (let g = 0; g <= 4; g++) {
    const v = (niceMax / 4) * g;
    const y = yBar(v);
    svg += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>`;
    svg += `<text x="${padL - 8}" y="${y + fs / 3}" text-anchor="end" font-size="${fs}" fill="#9C9C9C">${fmt$(v)}</text>`;
  }
  buckets.forEach((b, i) => {
    const v = barVals[i];
    const x = xC(i) - bw / 2;
    const y = yBar(v);
    if (v > 0) {
      svg += `<path d="M${x},${barBase} L${x},${y + 4} Q${x},${y} ${x + 4},${y} L${x + bw - 4},${y} Q${x + bw},${y} ${x + bw},${y + 4} L${x + bw},${barBase} Z"
        fill="${COLORS.lessons}" data-tip="${escAttr(b.label)}|Revenue: ${escAttr(fmt$c(v))}"/>`;
    }
  });
  // ---- panel 2: sessions / leads line ----
  svg += `<text x="${padL - 8}" y="${lineTop + fs / 3}" text-anchor="end" font-size="${fs}" fill="#9C9C9C">${lineMax}</text>`;
  svg += `<text x="${padL - 8}" y="${lineBase + fs / 3}" text-anchor="end" font-size="${fs}" fill="#9C9C9C">0</text>`;
  svg += `<line x1="${padL}" y1="${lineBase}" x2="${W - padR}" y2="${lineBase}" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>`;
  svg += `<line x1="${padL}" y1="${lineTop}" x2="${W - padR}" y2="${lineTop}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>`;

  // Null entries are pre-ledger gaps, so the line is drawn as one polyline per
  // contiguous run rather than a single one that would bridge straight over them.
  const linePts = buckets.map((b, i) =>
    lineVals[i] === null ? null : [xC(i), yLine(lineVals[i])]
  );
  const runs = [];
  let run = [];
  linePts.forEach((p) => {
    if (p) { run.push(p); return; }
    if (run.length) runs.push(run);
    run = [];
  });
  if (run.length) runs.push(run);
  runs.forEach((seg) => {
    if (seg.length < 2) return;
    svg += `<polyline points="${seg.map((p) => p.join(",")).join(" ")}" fill="none" stroke="${COLORS.chiro}" stroke-width="2"/>`;
  });
  linePts.forEach((p, i) => {
    if (!p) return;
    svg += `<circle cx="${p[0]}" cy="${p[1]}" r="${narrow ? 6 : 4.5}" fill="${COLORS.chiro}" stroke="#202226" stroke-width="2"
      data-tip="${escAttr(buckets[i].label)}|${escAttr(seriesName)}: ${lineVals[i]}"/>`;
  });
  // ---- shared period labels ----
  buckets.forEach((b, i) => {
    svg += `<text x="${xC(i)}" y="${H - 10}" text-anchor="middle" font-size="${fs}" fill="#9C9C9C">${esc(b.label)}</text>`;
  });
  svg += "</svg>";
  $("monthly-chart").innerHTML = svg;

  const lineLegend = lineMode === "sessions"
    ? (src.ledger ? "Sessions logged" : "Trips logged (no session ledger yet)")
    : "New leads added";
  const trimNote = trimmed > 0
    ? `<span class="legend-item legend-note">showing the last ${buckets.length} · ${trimmed} earlier hidden</span>`
    : "";
  $("monthly-legend").innerHTML = `
    <span class="legend-item"><span class="legend-swatch" style="background:${COLORS.lessons}"></span>Revenue</span>
    <span class="legend-item"><span class="legend-line" style="background:${COLORS.chiro}"></span>${lineLegend}</span>
    ${trimNote}`;

  attachTooltips($("monthly-chart"));
}

function niceCeil(v) {
  if (v <= 10) return 10;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (v <= m * mag) return m * mag;
  }
  return 10 * mag;
}

/* ------- schedule (Google Calendar sync) ------- */

function normalizeEvent(ev) {
  return {
    id: ev.id, title: ev.title,
    start: new Date(ev.start), end: new Date(ev.end),
    allDay: !!ev.all_day, description: ev.description || "",
  };
}

function renderSchedule(d) {
  const events = d.calendar_events || [];
  const now = new Date();

  // An empty array is ambiguous: it means "no events in that window" *or* "the
  // Calendar call threw server-side and getDashboardData swallowed it". Claiming
  // the window is covered on the second reading used to wedge the card empty for
  // three months, because ensureCalWindow then never re-fetched. Leaving the
  // window null costs one extra request on a genuinely empty calendar and
  // guarantees the card recovers on its own.
  CAL_CACHE = events.length
    ? {
        start: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7),
        end: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 83),
        events: events.map(normalizeEvent),
      }
    : { start: null, end: null, events: [] };

  drawCalendar();
}

function weekBounds(date) {
  const start = new Date(date);
  start.setDate(start.getDate() - start.getDay());
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function eventsInRange(start, end) {
  return CAL_CACHE.events
    .filter((ev) => ev.start < end && ev.end > start)
    .sort((a, b) => a.start - b.start);
}

let calError = false;

async function ensureCalWindow(neededStart, neededEnd) {
  if (CAL_CACHE.start && CAL_CACHE.end && neededStart >= CAL_CACHE.start && neededEnd <= CAL_CACHE.end) {
    // Already covered, so nothing is missing from this view — drop a warning
    // left over from navigating somewhere that wasn't.
    calError = false;
    return;
  }
  try {
    const bufStart = new Date(neededStart); bufStart.setDate(bufStart.getDate() - 30);
    const bufEnd = new Date(neededEnd); bufEnd.setDate(bufEnd.getDate() + 30);
    const events = await fetchCalendarEvents(bufStart, bufEnd);
    CAL_CACHE = { start: bufStart, end: bufEnd, events: events.map(normalizeEvent) };
    calError = false;
  } catch (err) {
    // Keep whatever is cached, but say so — an empty grid that silently means
    // "the fetch failed" is indistinguishable from an empty grid that means
    // "nothing is booked".
    calError = true;
  }
}

// Rendered under the grid whenever the last fetch failed.
function calErrorNote() {
  return calError
    ? '<p class="empty-note cal-error">Couldn’t load the calendar — showing what was already loaded.</p>'
    : "";
}

function eventChip(ev) {
  const time = ev.allDay ? "All day" : ev.start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `<div class="cal-event"><span class="cal-event-time">${esc(time)}</span><span class="cal-event-title">${esc(ev.title)}</span></div>`;
}

async function drawCalendar() {
  if (calMode === "day") {
    const dayStart = new Date(calAnchor); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(calAnchor); dayEnd.setHours(23, 59, 59, 999);
    await ensureCalWindow(dayStart, dayEnd);
    renderCalDay();
  } else if (calMode === "month") {
    const monthStart = new Date(calAnchor.getFullYear(), calAnchor.getMonth(), 1);
    const monthEnd = new Date(calAnchor.getFullYear(), calAnchor.getMonth() + 1, 0, 23, 59, 59, 999);
    await ensureCalWindow(monthStart, monthEnd);
    renderCalMonth();
  } else {
    const { start, end } = weekBounds(calAnchor);
    await ensureCalWindow(start, end);
    renderCalWeek();
  }
}

function renderCalDay() {
  $("cal-range-label").textContent = calAnchor.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  const dayStart = new Date(calAnchor); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(calAnchor); dayEnd.setHours(23, 59, 59, 999);
  const evs = eventsInRange(dayStart, dayEnd);
  $("calendar").innerHTML = (evs.length
    ? `<div class="cal-day-list">${evs.map(eventChip).join("")}</div>`
    : '<p class="empty-note">No sessions scheduled.</p>') + calErrorNote();
}

function renderCalWeek() {
  const { start, end } = weekBounds(calAnchor);
  $("cal-range-label").textContent =
    start.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " – " +
    end.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  const days = [];
  for (let i = 0; i < 7; i++) { const day = new Date(start); day.setDate(day.getDate() + i); days.push(day); }

  $("calendar").innerHTML = `<div class="cal-week-grid">${days
    .map((day) => {
      const dayEnd = new Date(day); dayEnd.setHours(23, 59, 59, 999);
      const evs = eventsInRange(day, dayEnd);
      const isToday = day.getTime() === today0.getTime();
      return `<div class="cal-week-col${isToday ? " is-today" : ""}">
        <div class="cal-week-daylabel">${day.toLocaleDateString("en-US", { weekday: "short" })}<span>${day.getDate()}</span></div>
        <div class="cal-week-events">${evs.length ? evs.map(eventChip).join("") : ""}</div>
      </div>`;
    })
    .join("")}</div>` + calErrorNote();
}

function renderCalMonth() {
  const y = calAnchor.getFullYear(), m = calAnchor.getMonth();
  $("cal-range-label").textContent = calAnchor.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const gridStart = new Date(y, m, 1);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());
  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  const MAX_CHIPS = 3;

  const cells = [];
  for (let i = 0; i < 42; i++) { const day = new Date(gridStart); day.setDate(day.getDate() + i); cells.push(day); }
  const rows = [];
  for (let r = 0; r < 6; r++) rows.push(cells.slice(r * 7, r * 7 + 7));

  // A 375px screen gives each cell about 45px, which is not enough for a title
  // chip — the old ones truncated to an ellipsis and read as noise. Show a count
  // instead; tapping the day still opens Day view, which has the full titles.
  const narrow = isNarrow();

  const cellHtml = (day) => {
    const inMonth = day.getMonth() === m;
    const dayEnd = new Date(day); dayEnd.setHours(23, 59, 59, 999);
    const evs = eventsInRange(day, dayEnd);
    const isToday = day.getTime() === today0.getTime();
    const shown = evs.slice(0, MAX_CHIPS);
    const overflow = evs.length - shown.length;
    const body = narrow
      ? (evs.length ? `<div class="cal-month-count">${evs.length}</div>` : "")
      : shown
          .map((ev) => {
            const time = ev.allDay ? "" : ev.start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) + " ";
            return `<div class="cal-month-chip" title="${escAttr(ev.title)}">${esc(time + ev.title)}</div>`;
          })
          .join("") + (overflow > 0 ? `<div class="cal-month-more">+${overflow} more</div>` : "");
    return `<div class="cal-month-cell${inMonth ? "" : " is-outside"}${isToday ? " is-today" : ""}" data-date="${localISO(day)}">
      <div class="cal-month-daynum">${day.getDate()}</div>
      ${body}
    </div>`;
  };

  $("calendar").innerHTML = `<div class="cal-month-grid${narrow ? " is-compact" : ""}">
    <div class="cal-month-row cal-month-head">${(narrow
      ? ["S", "M", "T", "W", "T", "F", "S"]
      : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    ).map((wd) => `<div class="cal-month-headcell">${wd}</div>`).join("")}</div>
    ${rows.map((row) => `<div class="cal-month-row">${row.map(cellHtml).join("")}</div>`).join("")}
  </div>` + calErrorNote();

  $("calendar").querySelectorAll(".cal-month-cell").forEach((cell) => {
    cell.addEventListener("click", () => {
      calAnchor = new Date(cell.getAttribute("data-date") + "T00:00:00");
      setCalMode("day");
    });
  });
}

function setCalMode(mode) {
  calMode = mode;
  ["day", "week", "month"].forEach((m) => $("cal-view-" + m).classList.toggle("active", m === mode));
  drawCalendar();
}

function calNav(dir) {
  if (calMode === "day") calAnchor.setDate(calAnchor.getDate() + dir);
  else if (calMode === "week") calAnchor.setDate(calAnchor.getDate() + dir * 7);
  else calAnchor = new Date(calAnchor.getFullYear(), calAnchor.getMonth() + dir, 1);
  drawCalendar();
}

function calToday() {
  calAnchor = new Date();
  drawCalendar();
}

/* ------- tasks (day-to-day to-dos, separate from the Calendar) ------- */

function renderTasks(d) {
  const open = (d.tasks || []).filter((t) => t.status !== "Done");
  const withDeadline = open
    .filter((t) => t.deadline)
    .sort((a, b) => parseDate(a.deadline) - parseDate(b.deadline));
  const whenever = open.filter((t) => !t.deadline);

  $("task-count").textContent = open.length ? `${open.length} open` : "";

  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  const row = (t) => {
    const dl = t.deadline ? parseDate(t.deadline) : null;
    const overdue = !!(dl && dl < today0);
    const dlLabel = dl ? dl.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
    return `<div class="task-row">
      <button type="button" class="task-check" aria-label="Mark done" data-action="complete" data-id="${escAttr(t.id)}"></button>
      <span class="task-text">${esc(t.task)}</span>
      ${dl ? `<span class="task-deadline-chip${overdue ? " is-overdue" : ""}">${esc(dlLabel)}</span>` : ""}
      <button type="button" class="task-del" aria-label="Delete task" data-action="delete" data-id="${escAttr(t.id)}">✕</button>
    </div>`;
  };

  const section = (title, list) =>
    list.length ? `<div class="task-group"><h3 class="task-group-title">${title}</h3>${list.map(row).join("")}</div>` : "";

  $("tasks").innerHTML =
    section("Has a deadline", withDeadline) + section("Whenever", whenever) ||
    '<p class="empty-note">No open tasks — you’re caught up.</p>';

  $("tasks").querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      if (btn.getAttribute("data-action") === "complete") completeTaskUI(id);
      else deleteTaskUI(id);
    });
  });
}

// Re-fetches dashboard data and re-renders just the Tasks card, so an add/
// complete/delete doesn't flash the whole app through the full-page loading
// screen the way a "Refresh" tap does.
async function refreshTasksQuietly() {
  const key = readSession();
  if (!key) return;
  try {
    const data = await webhookGet(new URLSearchParams({ action: "get_dashboard_data", key }));
    if (data.status !== "ok") return;
    DATA = data;
    renderTasks(DATA);
  } catch (err) {
    // The mutating call already reported success or failure; a failed refresh
    // just means the list looks stale until the next tap or manual refresh.
  }
}

function showTaskError(msg) {
  $("task-error").textContent = msg;
  $("task-error").classList.remove("hidden");
}

async function submitTask(e) {
  e.preventDefault();
  const key = readSession();
  if (!key) { showGate(); return; }
  const input = $("task-input");
  const task = input.value.trim();
  if (!task) return;
  const deadline = $("task-deadline").value;
  $("task-error").classList.add("hidden");
  const btn = e.target.querySelector("button[type=submit]");
  btn.disabled = true;
  try {
    const params = new URLSearchParams({ action: "add_task", key, task });
    if (deadline) params.set("deadline", deadline);
    const res = await webhookGet(params);
    if (res.status !== "ok") throw new Error(res.message || "Couldn’t add the task.");
    input.value = "";
    $("task-deadline").value = "";
    await refreshTasksQuietly();
  } catch (err) {
    showTaskError(err.message || "Couldn’t add the task.");
  } finally {
    btn.disabled = false;
  }
}

async function completeTaskUI(id) {
  const key = readSession();
  if (!key) return;
  try {
    const res = await webhookGet(new URLSearchParams({ action: "complete_task", key, id }));
    if (res.status !== "ok") throw new Error(res.message || "Couldn’t update the task.");
    await refreshTasksQuietly();
  } catch (err) {
    showTaskError(err.message || "Couldn’t update the task.");
  }
}

async function deleteTaskUI(id) {
  const key = readSession();
  if (!key) return;
  try {
    const res = await webhookGet(new URLSearchParams({ action: "delete_task", key, id }));
    if (res.status !== "ok") throw new Error(res.message || "Couldn’t delete the task.");
    await refreshTasksQuietly();
  } catch (err) {
    showTaskError(err.message || "Couldn’t delete the task.");
  }
}

/* ------- revenue by stream ------- */

function renderStreams(d) {
  const buckets = {}; // parent -> {One-off, Package}
  d.income.forEach((r) => {
    const c = classify(r);
    buckets[c.parent] = buckets[c.parent] || { "One-off": 0, "Package": 0 };
    buckets[c.parent][c.sub] += r.amount;
  });

  const colorFor = {
    "Pickleball Lessons": [COLORS.lessons, COLORS.lessonsSoft],
    "Mobile Chiro": [COLORS.chiro, COLORS.chiroSoft],
    "Digital Products": [COLORS.digital, COLORS.digital],
    "Other": [COLORS.other, COLORS.other],
    "Unclassified": [COLORS.unclassified, COLORS.unclassified],
  };
  const order = ["Pickleball Lessons", "Mobile Chiro", "Digital Products", "Other", "Unclassified"];
  const parents = order.filter((p) => buckets[p] && (buckets[p]["One-off"] + buckets[p]["Package"]) > 0);
  const maxTotal = Math.max(...parents.map((p) => buckets[p]["One-off"] + buckets[p]["Package"]), 1);

  $("streams").innerHTML = parents
    .map((p) => {
      const one = buckets[p]["One-off"], pkg = buckets[p]["Package"];
      const total = one + pkg;
      const [c1, c2] = colorFor[p];
      const wTotal = (total / maxTotal) * 100;
      const wOne = total ? (one / total) * wTotal : 0;
      const wPkg = wTotal - wOne;
      const showSplit = p === "Pickleball Lessons" || p === "Mobile Chiro";
      return `
      <div class="hbar-row">
        <div class="hbar-top"><span class="hbar-name">${p}${p === "Unclassified" ? " ⚠" : ""}</span><span class="hbar-total">${fmt$c(total)}</span></div>
        <div class="hbar-track">
          ${one > 0 ? `<div class="hbar-seg" style="width:${wOne}%;background:${c1}" data-tip="${p}|One-off: ${fmt$c(one)}"></div>` : ""}
          ${pkg > 0 ? `<div class="hbar-seg" style="width:${wPkg}%;background:${c2}" data-tip="${p}|Package: ${fmt$c(pkg)}"></div>` : ""}
        </div>
        ${showSplit ? `<div class="hbar-split">
          <span><span class="dot" style="background:${c1}"></span>One-off ${fmt$c(one)}</span>
          <span><span class="dot" style="background:${c2}"></span>Package ${fmt$c(pkg)}</span>
        </div>` : ""}
      </div>`;
    })
    .join("") || '<p class="empty-note">No income yet.</p>';
  attachTooltips($("streams"));
}

/* ------- money ------- */

function renderMoney(d) {
  const income = d.income.reduce((s, r) => s + r.amount, 0);
  const expenses = d.expenses.reduce((s, r) => s + r.amount, 0);
  const net = income - expenses;
  const setAside = Math.max(0, net) * 0.25;
  const mileageDeduction = d.mileage.reduce((s, r) => s + r.deduction, 0);

  $("money-summary").innerHTML = `
    <div class="money-line"><div class="m-label">Total income</div><div class="m-value">${fmt$c(income)}</div></div>
    <div class="money-line"><div class="m-label">Total expenses</div><div class="m-value">${fmt$c(expenses)}</div></div>
    <div class="money-line"><div class="m-label">Net profit (taxable est.)</div><div class="m-value">${fmt$c(net)}</div></div>
    <div class="money-line accent"><div class="m-label">Tax set-aside · 25%</div><div class="m-value">${fmt$c(setAside)}</div></div>
    <div class="money-line"><div class="m-label">Mileage deduction · YTD</div><div class="m-value">${fmt$c(mileageDeduction)}</div></div>`;

  const cats = {};
  d.expenses.forEach((r) => {
    if (!(r.amount > 0)) return;
    cats[r.category] = (cats[r.category] || 0) + r.amount;
  });
  const entries = Object.entries(cats).sort((a, b) => b[1] - a[1]);
  const maxV = entries.length ? entries[0][1] : 1;
  $("expense-cats").innerHTML = entries
    .map(
      ([cat, v]) => `
      <div class="hbar-row">
        <div class="hbar-top"><span class="hbar-name" style="font-weight:400;font-size:0.78rem">${esc(cat)}</span><span class="hbar-total" style="font-size:0.85rem">${fmt$c(v)}</span></div>
        <div class="hbar-track" style="height:10px"><div class="hbar-seg" style="width:${(v / maxV) * 100}%;background:${COLORS.chiro}" data-tip="${escAttr(cat)}|${escAttr(fmt$c(v))}"></div></div>
      </div>`
    )
    .join("");
  attachTooltips($("expense-cats"));
}

/* ------- clients ------- */

function chipFor(c) {
  const stage = c.stage || c.status || "";
  if (stage === "Package Client") return '<span class="chip package">Package</span>';
  if (stage === "Active") return '<span class="chip active">Active</span>';
  if (stage === "Inactive") return '<span class="chip atrisk">Inactive</span>';
  if (stage === "New") return '<span class="chip">New</span>';
  return '<span class="chip">' + esc(stage || "—") + "</span>";
}

function comingUpNext(notes) {
  if (!notes) return "";
  const m = /next[^.;]*[.;]?/i.exec(notes);
  if (m) return m[0].replace(/[;.]$/, "");
  return "";
}

// Tally each client's one-off vs package sessions from the ledger.
function sessionTally(d) {
  const map = {};
  (d.sessions || []).forEach((s) => {
    const key = (s.client || "").toLowerCase().trim();
    if (!key) return;
    const t = map[key] || (map[key] = { lessonOneOff: 0, chiroOneOff: 0, exam: 0, lessonPkg: 0, chiroPkg: 0 });
    if (s.billing === "Exam") t.exam++;
    else if (s.billing === "Package") s.discipline === "Chiro" ? t.chiroPkg++ : t.lessonPkg++;
    else s.discipline === "Chiro" ? t.chiroOneOff++ : t.lessonOneOff++;
  });
  return map;
}

function oneOffSummary(t) {
  if (!t) return "";
  const parts = [];
  const plural = (n, w) => n + " " + w + (n > 1 ? "s" : "");
  if (t.lessonOneOff) parts.push(plural(t.lessonOneOff, "lesson"));
  if (t.chiroOneOff) parts.push(plural(t.chiroOneOff, "chiro visit"));
  if (t.exam) parts.push(plural(t.exam, "exam"));
  return parts.join(" · ");
}

function renderClients(d) {
  const tally = sessionTally(d);
  const rank = { "Package Client": 0, "Active": 1, "New": 2, "Inactive": 3 };
  const sorted = [...d.clients].sort((a, b) => {
    const ra = rank[a.stage] ?? 2, rb = rank[b.stage] ?? 2;
    if (ra !== rb) return ra - rb;
    return (b.last_session || "").localeCompare(a.last_session || "");
  });
  const active = sorted.filter((c) => c.stage !== "Inactive");
  const inactive = sorted.filter((c) => c.stage === "Inactive");
  $("client-count").textContent = `${active.length} active · ${inactive.length} inactive`;

  const card = (c) => {
    const hasPkg = c.included !== "" && c.included > 0;
    const used = +c.used || 0, left = c.left === "" ? null : +c.left;
    const total = hasPkg ? +c.included : 0;
    const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
    const next = comingUpNext(c.notes);
    const oneOff = oneOffSummary(tally[(c.name || "").toLowerCase().trim()]);
    const lastSession = c.last_session
      ? parseDate(c.last_session)?.toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : "—";
    return `
    <div class="client-card">
      <div class="client-top"><span class="client-name">${esc(c.name)}</span>${chipFor(c)}</div>
      <div class="client-rows">
        ${hasPkg ? `<div class="row"><span class="k">Package</span><span class="v">${esc(c.package)}</span></div>` : ""}
        ${hasPkg ? `<div class="row"><span class="k">Package used</span><span class="v">${used} / ${total}${left !== null ? " · " + left + " left" : ""}</span></div>` : ""}
        ${hasPkg && total > 0 ? `<div class="pkg-meter"><div class="fill" style="width:${pct}%"></div></div>` : ""}
        ${oneOff ? `<div class="row"><span class="k">One-off</span><span class="v">${esc(oneOff)}</span></div>` : ""}
        <div class="row"><span class="k">Last session</span><span class="v">${esc(lastSession)}</span></div>
        <div class="row"><span class="k">Total paid</span><span class="v">${fmt$c(c.total_paid)}</span></div>
        ${c.outstanding > 0 ? `<div class="row"><span class="k">Outstanding</span><span class="v" style="color:var(--warn)">${fmt$c(c.outstanding)}</span></div>` : ""}
      </div>
      ${next ? `<div class="client-next"><strong>Up next:</strong> ${esc(next)}</div>` : ""}
    </div>`;
  };

  $("client-cards").innerHTML =
    active.map(card).join("") +
    (inactive.length
      ? `<details style="grid-column:1/-1"><summary class="empty-note" style="cursor:pointer">Show ${inactive.length} inactive clients</summary><div class="client-grid" style="margin-top:12px">${inactive.map(card).join("")}</div></details>`
      : "");
}

/* ------- follow up / re-engage ------- */

function daysSince(dateStr) {
  const dt = parseDate(dateStr);
  if (!dt) return null;
  return Math.floor((Date.now() - dt.getTime()) / 86400000);
}

function renderReengage(d) {
  const COOL_DAYS = 14;
  const items = [];
  d.clients.forEach((c) => {
    // Stage, not status — the raw Clients column drifts out of step with the
    // computed one, and everything else on this page treats Stage as the single
    // source of truth (see renderKpis).
    if (c.stage === "Inactive") return;
    const onActivePackage = c.pkg_status === "Active" || (c.left !== "" && +c.left > 0);
    if (onActivePackage) return; // still working through a package — not a re-engage target
    const since = daysSince(c.last_session);
    const oneOff = (+c.sessions_total || 0) <= 1;
    let reason = "";
    if (oneOff && (since === null || since >= 7)) {
      reason = "One-off only — never came back for a second";
    } else if (since !== null && since >= COOL_DAYS) {
      reason = `No session in ${since} days`;
    }
    if (reason) {
      items.push({ name: c.name, since: since === null ? Infinity : since, reason, last: c.last_session, paid: c.total_paid, notes: c.notes });
    }
  });
  items.sort((a, b) => b.since - a.since); // coldest first
  const shown = items.slice(0, 4);

  $("reengage-sub").textContent = items.length
    ? (items.length > shown.length ? `${shown.length} of ${items.length} worth a nudge` : `${items.length} worth a nudge`)
    : "all warm";
  $("reengage").innerHTML = shown.length
    ? `<div class="reengage-grid">${shown
        .map((i) => {
          const lastTxt = i.last && parseDate(i.last)
            ? parseDate(i.last).toLocaleDateString("en-US", { month: "short", day: "numeric" })
            : "never";
          const notesTxt = (i.notes || "").trim();
          const notesShort = notesTxt.length > 90 ? notesTxt.slice(0, 90) + "…" : notesTxt;
          return `<div class="reengage-item">
            <div class="reengage-top"><span class="reengage-name">${esc(i.name)}</span><span class="reengage-days">${i.since === Infinity ? "—" : i.since + "d"}</span></div>
            <div class="reengage-reason">${esc(i.reason)}</div>
            <div class="reengage-meta">Last: ${esc(lastTxt)} · ${fmt$c(i.paid)} paid</div>
            ${notesShort ? `<div class="reengage-notes">${esc(notesShort)}</div>` : ""}
          </div>`;
        })
        .join("")}</div>`
    : '<p class="empty-note">Everyone active has a recent session or an open package. 🎉</p>';
}

/* ------- recent activity ------- */

function renderRecent(d) {
  const byDateDesc = (rows) =>
    [...rows]
      .filter((r) => r.amount > 0)
      .sort((a, b) => {
        const da = parseDate(a.date), db = parseDate(b.date);
        return (db ? db.getTime() : 0) - (da ? da.getTime() : 0);
      })
      .slice(0, 10);

  const fmtRow = (dateStr, name, amount, tone) => {
    const dt = parseDate(dateStr);
    const d2 = dt ? dt.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
    return `<div class="activity-row">
      <span class="activity-date">${esc(d2)}</span>
      <span class="activity-name">${esc(name)}</span>
      <span class="activity-amt ${tone}">${tone === "in" ? "+" : "−"}${fmt$c(amount)}</span>
    </div>`;
  };

  // Exclude the auto-logged IRS mileage rows so this feed shows real purchases.
  const realExpenses = d.expenses.filter((r) => r.category !== "Mileage & Travel");

  $("recent-income").innerHTML =
    byDateDesc(d.income).map((r) => fmtRow(r.date, r.client || r.type || "—", r.amount, "in")).join("") ||
    '<p class="empty-note">No income yet.</p>';
  $("recent-expenses").innerHTML =
    byDateDesc(realExpenses).map((r) => fmtRow(r.date, r.vendor || r.category || "—", r.amount, "out")).join("") ||
    '<p class="empty-note">No expenses yet.</p>';
}

/* ------- pipeline + attention ------- */

function renderPipeline(d) {
  const statuses = ["New", "Contacted", "Nurturing", "Booked", "Converted", "Lost"];
  const counts = {};
  statuses.forEach((s) => (counts[s] = 0));
  let other = 0;
  d.leads.forEach((l) => {
    if (l.status in counts) counts[l.status]++;
    else other++;
  });
  const conversion = computeConversion(d.leads);
  $("conversion").textContent = `${conversion.total} leads · ${conversion.rate.toFixed(1)}% converted`;

  const maxC = Math.max(...statuses.map((s) => counts[s]), 1);
  $("pipeline").innerHTML =
    statuses
      .map(
        (s) => `
    <div class="pipe-row">
      <span class="pipe-label">${s}</span>
      <div class="pipe-bar"><div class="fill" style="width:${(counts[s] / maxC) * 100}%${s === "Converted" ? ";background:" + COLORS.lessons : ""}"></div></div>
      <span class="pipe-count">${counts[s] || "–"}</span>
    </div>`
      )
      .join("") +
    (other ? `<p class="empty-note">${other} lead(s) with other statuses</p>` : "");
}

function renderAttention(d) {
  const items = [];
  const today = new Date(); today.setHours(0, 0, 0, 0);

  d.leads.forEach((l) => {
    if (!l.follow_up || l.status === "Converted" || l.status === "Lost" || l.status === "Not a Fit") return;
    const due = parseDate(l.follow_up);
    if (due && due <= today) {
      items.push({ tag: "followup", label: "Follow up", name: l.name, note: "due " + due.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + (l.notes ? " · " + l.notes.slice(0, 60) : "") });
    }
  });
  d.clients.forEach((c) => {
    if (c.stage === "New") items.push({ tag: "new", label: "New", name: c.name, note: "no sessions yet — book their first" });
  });

  $("attention").innerHTML = items.length
    ? items
        .map(
          (i) => `<div class="attn-item"><span class="attn-tag ${i.tag}">${esc(i.label)}</span><span class="attn-name">${esc(i.name)}</span><span class="attn-note">${esc(i.note)}</span></div>`
        )
        .join("")
    : '<p class="empty-note">Nothing urgent — everyone’s covered. 🎉</p>';
}

/* ------- unserviced (prepaid) package value ------- */

function renderUnserviced(d) {
  const rows = [];
  let totalSessions = 0, totalDollars = 0;
  d.clients.forEach((c) => {
    const incl = +c.included || 0;
    const left = c.left === "" ? 0 : (+c.left || 0);
    if (incl <= 0 || left <= 0) return;
    const perValue = (+c.pkg_value || 0) > 0 ? +c.pkg_value / incl : 0;
    const dollars = left * perValue;
    totalSessions += left;
    totalDollars += dollars;
    rows.push({ name: c.name, left, dollars, pkg: c.package });
  });
  rows.sort((a, b) => b.dollars - a.dollars);

  $("unserviced-sub").textContent = rows.length
    ? `${totalSessions} session${totalSessions === 1 ? "" : "s"} · ${fmt$(totalDollars)} prepaid`
    : "none outstanding";

  if (!rows.length) {
    $("unserviced").innerHTML = '<p class="empty-note">No open packages — nothing prepaid left to deliver. 🎉</p>';
    return;
  }
  $("unserviced").innerHTML = `
    <div class="unserviced-totals">
      <div class="u-tot"><div class="u-tot-num">${totalSessions}</div><div class="u-tot-lbl">sessions owed</div></div>
      <div class="u-tot"><div class="u-tot-num">${fmt$(totalDollars)}</div><div class="u-tot-lbl">prepaid value to deliver</div></div>
    </div>
    <div class="unserviced-list">${rows
      .map(
        (r) => `<div class="activity-row">
        <span class="activity-name">${esc(r.name)}${r.pkg ? ` <span class="u-pkg">${esc(r.pkg)}</span>` : ""}</span>
        <span class="u-left">${r.left} left</span>
        <span class="u-amt">${fmt$(r.dollars)}</span>
      </div>`
      )
      .join("")}</div>`;
}

/* ------- money outstanding (delivered but not yet paid for) ------- */

function renderOwed(d) {
  const owed = d.clients
    .filter((c) => c.name && (+c.outstanding || 0) > 0)
    .map((c) => ({ name: c.name, amount: +c.outstanding || 0 }))
    .sort((a, b) => b.amount - a.amount);
  const owedTotal = owed.reduce((s, r) => s + r.amount, 0);

  $("owed-sub").textContent = owed.length
    ? `${owed.length} client${owed.length === 1 ? "" : "s"} behind`
    : "all paid up";

  if (!owed.length) {
    $("owed").innerHTML = '<p class="empty-note">Nobody owes you a dime. 🎉</p>';
    return;
  }
  $("owed").innerHTML = `
    <div class="unserviced-totals">
      <div class="u-tot owed"><div class="u-tot-num">${fmt$(owedTotal)}</div><div class="u-tot-lbl">still to collect</div></div>
      <div class="u-tot owed"><div class="u-tot-num">${owed.length}</div><div class="u-tot-lbl">client${owed.length === 1 ? "" : "s"} owing</div></div>
    </div>
    <div class="owed-list">${owed
      .map(
        (o) => `<div class="activity-row">
        <span class="activity-name">${esc(o.name)}</span>
        <span class="owed-amt">${fmt$(o.amount)}</span>
      </div>`
      )
      .join("")}</div>`;
}

/* ------- leads by source (donut) ------- */

const SOURCE_COLORS = [
  "#E8622A", "#1F97AE", "#9678F0", "#6B8ECC",
  "#E0A32E", "#4FB477", "#D8577D", "#8A8F98",
];

function donutSlices(entries, total, cx, cy, rOuter, rInner) {
  let a0 = -Math.PI / 2; // start at 12 o'clock
  return entries
    .map(([label, value], i) => {
      let sweep = (value / total) * Math.PI * 2;
      if (sweep >= Math.PI * 2) sweep = Math.PI * 2 - 0.001; // avoid degenerate full-circle path
      const a1 = a0 + sweep;
      const large = sweep > Math.PI ? 1 : 0;
      const x0o = cx + rOuter * Math.cos(a0), y0o = cy + rOuter * Math.sin(a0);
      const x1o = cx + rOuter * Math.cos(a1), y1o = cy + rOuter * Math.sin(a1);
      const x0i = cx + rInner * Math.cos(a1), y0i = cy + rInner * Math.sin(a1);
      const x1i = cx + rInner * Math.cos(a0), y1i = cy + rInner * Math.sin(a0);
      const color = SOURCE_COLORS[i % SOURCE_COLORS.length];
      const pct = ((value / total) * 100).toFixed(0);
      a0 = a1;
      return `<path d="M${x0o},${y0o} A${rOuter},${rOuter} 0 ${large} 1 ${x1o},${y1o} L${x0i},${y0i} A${rInner},${rInner} 0 ${large} 0 ${x1i},${y1i} Z"
        fill="${color}" data-tip="${escAttr(label)}|${value} lead${value === 1 ? "" : "s"} · ${pct}%"/>`;
    })
    .join("");
}

function leadMatchesSrcMode(l) {
  const it = (l.interest || "").toLowerCase();
  if (leadSrcMode === "chiro") return it.indexOf("chiro") !== -1;
  if (leadSrcMode === "lessons") return it.indexOf("lesson") !== -1 || it.indexOf("pickleball") !== -1;
  return true;
}

function renderLeadSources(d) {
  const counts = {};
  d.leads.filter(leadMatchesSrcMode).forEach((l) => {
    const s = (l.source || "").trim() || "Unknown";
    counts[s] = (counts[s] || 0) + 1;
  });
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, e) => s + e[1], 0);
  if (!total) {
    $("lead-sources").innerHTML = '<p class="empty-note">No ' + (leadSrcMode === "all" ? "" : leadSrcMode + " ") + 'leads yet.</p>';
    return;
  }

  const cx = 90, cy = 90, rOuter = 80, rInner = 46;
  const legend = entries
    .map(([label, value], i) => {
      const pct = ((value / total) * 100).toFixed(0);
      return `<div class="src-legend-row">
        <span class="src-swatch" style="background:${SOURCE_COLORS[i % SOURCE_COLORS.length]}"></span>
        <span class="src-name">${esc(label)}</span>
        <span class="src-val">${value} · ${pct}%</span>
      </div>`;
    })
    .join("");

  $("lead-sources").innerHTML = `
    <div class="src-wrap">
      <svg viewBox="0 0 180 180" class="src-donut" role="img" aria-label="Leads by source">
        ${donutSlices(entries, total, cx, cy, rOuter, rInner)}
        <text x="${cx}" y="${cy - 3}" text-anchor="middle" font-size="26" font-weight="700" fill="#F2F1EE">${total}</text>
        <text x="${cx}" y="${cy + 14}" text-anchor="middle" font-size="10" fill="#9C9C9C">${leadSrcMode === "all" ? "leads" : leadSrcMode}</text>
      </svg>
      <div class="src-legend">${legend}</div>
    </div>`;
  attachTooltips($("lead-sources"));
}

/* ------- recent leads ------- */

function leadStatusChip(status) {
  const s = status || "New";
  const cls = s === "Converted" ? "active" : (s === "Lost" || s === "Not a Fit") ? "atrisk" : "";
  return `<span class="chip ${cls}">${esc(s)}</span>`;
}

function renderRecentLeads(d) {
  const sorted = [...d.leads]
    .sort((a, b) => {
      const da = parseDate(a.date_added), db = parseDate(b.date_added);
      return (db ? db.getTime() : 0) - (da ? da.getTime() : 0);
    })
    .slice(0, 5);
  if (!sorted.length) { $("recent-leads").innerHTML = '<p class="empty-note">No leads yet.</p>'; return; }
  $("recent-leads").innerHTML = sorted
    .map((l) => {
      const dt = parseDate(l.date_added);
      const dstr = dt ? dt.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
      const meta = [l.interest, l.source].filter(Boolean).join(" · ") || "—";
      return `<div class="lead-row">
        <div class="lead-main"><span class="lead-name">${esc(l.name)}</span>${leadStatusChip(l.status)}</div>
        <div class="lead-meta">${esc(meta)}</div>
        <div class="lead-date">${esc(dstr)}</div>
      </div>`;
    })
    .join("");
}

/* ------- tooltips ------- */

/* These were bound to mousemove/mouseleave, which a touchscreen never fires — so
   on a phone every number behind a tooltip (the revenue bars, the sessions line,
   the stream splits, the expense bars, the donut) was simply unreachable and the
   charts were decoration. Pointer events cover both: hover for a mouse, tap for a
   finger, with the tip placed above the touch point so it isn't under the thumb. */

let tipTimer = null;

function hideTip() {
  clearTimeout(tipTimer);
  $("tooltip").classList.add("hidden");
}

function showTip(el, clientX, clientY, above) {
  const tip = $("tooltip");
  // getAttribute decodes the entities escAttr put in, so this is raw sheet text
  // again by the time it gets here and has to be escaped a second time.
  const [title, ...lines] = (el.getAttribute("data-tip") || "").split("|");
  tip.innerHTML =
    `<div class="t-title">${esc(title)}</div>` +
    lines.map((l) => `<div class="t-line">${esc(l)}</div>`).join("");
  tip.classList.remove("hidden");

  const pad = 12;
  const r = tip.getBoundingClientRect();
  let x = clientX + pad;
  if (x + r.width > window.innerWidth - 8) x = clientX - r.width - pad;
  x = Math.max(8, x);

  let y = above ? clientY - r.height - 16 : clientY + pad;
  if (y + r.height > window.innerHeight - 8) y = clientY - r.height - pad;
  y = Math.max(8, y);

  tip.style.left = x + "px";
  tip.style.top = y + "px";
}

function attachTooltips(root) {
  root.querySelectorAll("[data-tip]").forEach((el) => {
    el.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse") return;
      showTip(el, e.clientX, e.clientY, false);
    });
    el.addEventListener("pointerleave", (e) => {
      if (e.pointerType !== "mouse") return;
      hideTip();
    });
    el.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse") return;
      showTip(el, e.clientX, e.clientY, true);
      // Auto-dismiss as well as tap-away, so a tip can never be left stranded
      // over the page after a scroll.
      clearTimeout(tipTimer);
      tipTimer = setTimeout(hideTip, 3500);
    });
  });
}

// Registered once, not per render: a tap anywhere that isn't a tooltip target
// dismisses whatever is showing.
document.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "mouse") return;
  if (e.target && e.target.closest && e.target.closest("[data-tip]")) return;
  hideTip();
});
window.addEventListener("scroll", hideTip, { passive: true });
