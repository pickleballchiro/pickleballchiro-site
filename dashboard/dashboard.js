/* ============================================================
   PBC COMMAND CENTER — dashboard.js
   Reads live data from the Apps Script webhook (key-gated).
   No frameworks, hand-rolled SVG charts.
   ============================================================ */

const WEBHOOK =
  "https://script.google.com/macros/s/AKfycbxLcsR_4HVnmf3GkJkSx2kOf2KErYONQvEHROXjMLuThcHjnCI6IulpcDOIDrE1-1AKJw/exec";
const KEY_STORE = "pbc_dash_key";

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
const fmt$ = (n) =>
  "$" + Math.round(n).toLocaleString("en-US");
const fmt$c = (n) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

let DATA = null;
let lineMode = "sessions"; // or "clients"
let periodMode = "month"; // "week" | "month" | "quarter"

/* ---------------- boot ---------------- */

document.addEventListener("DOMContentLoaded", () => {
  $("gate-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const key = $("gate-input").value.trim();
    if (!key) return;
    localStorage.setItem(KEY_STORE, key);
    $("gate").classList.add("hidden");
    loadData();
  });
  $("refresh-btn").addEventListener("click", loadData);
  $("retry-btn").addEventListener("click", loadData);
  $("lock-btn").addEventListener("click", () => {
    localStorage.removeItem(KEY_STORE);
    location.reload();
  });
  $("toggle-sessions").addEventListener("click", () => setLineMode("sessions"));
  $("toggle-clients").addEventListener("click", () => setLineMode("clients"));
  $("toggle-period-week").addEventListener("click", () => setPeriodMode("week"));
  $("toggle-period-month").addEventListener("click", () => setPeriodMode("month"));
  $("toggle-period-quarter").addEventListener("click", () => setPeriodMode("quarter"));

  if (localStorage.getItem(KEY_STORE)) {
    loadData();
  } else {
    $("gate").classList.remove("hidden");
  }
});

function setLineMode(mode) {
  lineMode = mode;
  $("toggle-sessions").classList.toggle("active", mode === "sessions");
  $("toggle-clients").classList.toggle("active", mode === "clients");
  if (DATA) renderPeriodChart(DATA);
}

function setPeriodMode(mode) {
  periodMode = mode;
  ["week", "month", "quarter"].forEach((m) =>
    $("toggle-period-" + m).classList.toggle("active", m === mode)
  );
  if (DATA) renderPeriodChart(DATA);
}

async function loadData() {
  const key = localStorage.getItem(KEY_STORE);
  if (!key) { $("gate").classList.remove("hidden"); return; }
  $("load-error").classList.add("hidden");
  $("loading").classList.remove("hidden");
  $("app").classList.add("hidden");
  try {
    const res = await fetch(
      WEBHOOK + "?action=get_dashboard_data&key=" + encodeURIComponent(key)
    );
    const data = await res.json();
    if (data.status !== "ok") {
      if ((data.message || "").indexOf("unauthorized") !== -1) {
        localStorage.removeItem(KEY_STORE);
        $("loading").classList.add("hidden");
        $("gate").classList.remove("hidden");
        $("gate-error").classList.remove("hidden");
        return;
      }
      throw new Error(data.message || "bad response");
    }
    DATA = data;
    $("loading").classList.add("hidden");
    $("app").classList.remove("hidden");
    renderAll(data);
  } catch (err) {
    $("loading").classList.add("hidden");
    $("load-error").classList.remove("hidden");
  }
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
      const label = "Q" + q + (cur.getFullYear() !== now.getFullYear() ? " '" + String(cur.getFullYear()).slice(2) : "");
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
  renderPeriodChart(d);
  renderStreams(d);
  renderMoney(d);
  renderClients(d);
  renderReengage(d);
  renderRecent(d);
  renderPipeline(d);
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
  const revTrailing = trailingWindow(d.income, 30, "amount");
  const sessTrailing = trailingWindow(d.mileage, 30, null);
  const revMTD = sameDayCountMTD(d.income, "amount");
  const sessMTD = sameDayCountMTD(d.mileage, null);

  const activeClients = d.clients.filter((c) => c.status === "Active").length;
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
    { label: "Sessions · 30d", value: sessTrailing.cur, extra: delta(sessTrailing.cur, sessTrailing.prev, false) + mtdLine(sessMTD, false) },
    { label: "Active clients", value: activeClients, extra: "" },
    { label: "Net profit · YTD", value: fmt$(net), extra: `<div class="kpi-delta">${fmt$(incomeTotal)} in − ${fmt$(expenseTotal)} out</div>` },
    { label: "Avg ticket · 30d", value: avgTicket !== null ? fmt$(avgTicket) : "—", extra: "" },
    { label: "Lead conversion", value: conversion.rate.toFixed(0) + "%", extra: `<div class="kpi-delta">${conversion.converted} of ${conversion.total} leads · all-time</div>` },
    { label: "Avg client value", value: fmt$(clientValue.avg), extra: `<div class="kpi-delta">${clientValue.rebookRate.toFixed(0)}% rebook (${clientValue.n} clients)</div>` },
  ];
  $("kpis").innerHTML = tiles
    .map(
      (t) => `<div class="kpi"><div class="kpi-label">${t.label}</div><div class="kpi-value">${t.value}</div>${t.extra}</div>`
    )
    .join("");
}

/* ------- period chart (bars = revenue, line = sessions/clients) ------- */

function renderPeriodChart(d) {
  // range: first activity in 2026+ -> now
  const dates = [];
  d.income.forEach((r) => { const dt = parseDate(r.date); if (dt && dt.getFullYear() >= 2026) dates.push(dt); });
  d.mileage.forEach((r) => { const dt = parseDate(r.date); if (dt && dt.getFullYear() >= 2026) dates.push(dt); });
  if (!dates.length) { $("monthly-chart").innerHTML = '<p class="empty-note">No data yet.</p>'; return; }
  dates.sort((a, b) => a - b);
  const now = new Date();
  const buckets = buildPeriodBuckets(dates[0], now, periodMode);
  if (!buckets.length) { $("monthly-chart").innerHTML = '<p class="empty-note">No data yet.</p>'; return; }

  const revenue = buckets.map(() => 0);
  const sessions = buckets.map(() => 0);
  const clients = buckets.map(() => new Set());
  const bucketFor = (dt) => buckets.findIndex((b) => dt >= b.start && dt < b.end);

  d.income.forEach((r) => {
    const dt = parseDate(r.date); if (!dt) return;
    const i = bucketFor(dt); if (i === -1) return;
    revenue[i] += r.amount;
    clients[i].add((r.client || "").toLowerCase().trim());
  });
  d.mileage.forEach((r) => {
    const dt = parseDate(r.date); if (!dt) return;
    const i = bucketFor(dt); if (i === -1) return;
    sessions[i]++;
  });

  const lineVals = buckets.map((b, i) => lineMode === "sessions" ? sessions[i] : clients[i].size);
  const barVals = revenue;

  // --- SVG: two aligned panels sharing the period axis (never dual-axis) ---
  const W = 720, padL = 52, padR = 16, padT = 14;
  const barH = 170, gapH = 30, lineH = 80, padB = 26;
  const H = padT + barH + gapH + lineH + padB;
  const plotW = W - padL - padR;
  const niceMax = niceCeil(Math.max(...barVals, 1));
  const lineMax = niceCeil(Math.max(...lineVals, 1));

  const bw = Math.min(44, (plotW / buckets.length) * 0.55);
  const xC = (i) => padL + (plotW / buckets.length) * (i + 0.5);
  const barBase = padT + barH;
  const lineTop = padT + barH + gapH;
  const lineBase = lineTop + lineH;
  const yBar = (v) => barBase - (v / niceMax) * barH;
  const yLine = (v) => lineBase - (v / lineMax) * lineH;

  const periodLabel = periodMode === "week" ? "Weekly" : periodMode === "quarter" ? "Quarterly" : "Monthly";

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${periodLabel} revenue and ${lineMode}">`;
  // ---- panel 1: revenue bars ----
  for (let g = 0; g <= 4; g++) {
    const v = (niceMax / 4) * g;
    const y = yBar(v);
    svg += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>`;
    svg += `<text x="${padL - 8}" y="${y + 3}" text-anchor="end" font-size="10" fill="#9C9C9C">${fmt$(v)}</text>`;
  }
  buckets.forEach((b, i) => {
    const v = barVals[i];
    const x = xC(i) - bw / 2;
    const y = yBar(v);
    if (v > 0) {
      svg += `<path d="M${x},${barBase} L${x},${y + 4} Q${x},${y} ${x + 4},${y} L${x + bw - 4},${y} Q${x + bw},${y} ${x + bw},${y + 4} L${x + bw},${barBase} Z"
        fill="${COLORS.lessons}" data-tip="${b.label}|Revenue: ${fmt$c(v)}"/>`;
    }
  });
  // ---- panel 2: sessions / clients line ----
  svg += `<text x="${padL - 8}" y="${lineTop + 4}" text-anchor="end" font-size="10" fill="#9C9C9C">${lineMax}</text>`;
  svg += `<text x="${padL - 8}" y="${lineBase + 3}" text-anchor="end" font-size="10" fill="#9C9C9C">0</text>`;
  svg += `<line x1="${padL}" y1="${lineBase}" x2="${W - padR}" y2="${lineBase}" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>`;
  svg += `<line x1="${padL}" y1="${lineTop}" x2="${W - padR}" y2="${lineTop}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>`;
  const linePts = buckets.map((b, i) => [xC(i), yLine(lineVals[i])]);
  svg += `<polyline points="${linePts.map((p) => p.join(",")).join(" ")}" fill="none" stroke="${COLORS.chiro}" stroke-width="2"/>`;
  linePts.forEach((p, i) => {
    svg += `<circle cx="${p[0]}" cy="${p[1]}" r="4.5" fill="${COLORS.chiro}" stroke="#202226" stroke-width="2"
      data-tip="${buckets[i].label}|${lineMode === "sessions" ? "Sessions" : "Paying clients"}: ${lineVals[i]}"/>`;
  });
  // ---- shared period labels ----
  buckets.forEach((b, i) => {
    svg += `<text x="${xC(i)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="#9C9C9C">${b.label}</text>`;
  });
  svg += "</svg>";
  $("monthly-chart").innerHTML = svg;

  $("monthly-legend").innerHTML = `
    <span class="legend-item"><span class="legend-swatch" style="background:${COLORS.lessons}"></span>Revenue</span>
    <span class="legend-item"><span class="legend-line" style="background:${COLORS.chiro}"></span>${lineMode === "sessions" ? "Sessions (trips logged)" : "Unique paying clients"}</span>`;

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
        <div class="hbar-top"><span class="hbar-name" style="font-weight:400;font-size:0.78rem">${cat}</span><span class="hbar-total" style="font-size:0.85rem">${fmt$c(v)}</span></div>
        <div class="hbar-track" style="height:10px"><div class="hbar-seg" style="width:${(v / maxV) * 100}%;background:${COLORS.chiro}" data-tip="${cat}|${fmt$c(v)}"></div></div>
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
  if (stage === "Check In") return '<span class="chip checkin">Check in</span>';
  if (stage === "At Risk") return '<span class="chip atrisk">At risk</span>';
  if (stage === "New") return '<span class="chip">New</span>';
  return '<span class="chip">' + (stage || "—") + "</span>";
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
  const rank = { "Package Client": 0, "Active": 1, "New": 2, "Check In": 3, "At Risk": 4, "Inactive": 5 };
  const sorted = [...d.clients].sort((a, b) => {
    const ra = rank[a.stage] ?? 3, rb = rank[b.stage] ?? 3;
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
      <div class="client-top"><span class="client-name">${c.name}</span>${chipFor(c)}</div>
      <div class="client-rows">
        ${hasPkg ? `<div class="row"><span class="k">Package</span><span class="v">${c.package}</span></div>` : ""}
        ${hasPkg ? `<div class="row"><span class="k">Package used</span><span class="v">${used} / ${total}${left !== null ? " · " + left + " left" : ""}</span></div>` : ""}
        ${hasPkg && total > 0 ? `<div class="pkg-meter"><div class="fill" style="width:${pct}%"></div></div>` : ""}
        ${oneOff ? `<div class="row"><span class="k">One-off</span><span class="v">${oneOff}</span></div>` : ""}
        <div class="row"><span class="k">Last session</span><span class="v">${lastSession}</span></div>
        <div class="row"><span class="k">Total paid</span><span class="v">${fmt$c(c.total_paid)}</span></div>
        ${c.outstanding > 0 ? `<div class="row"><span class="k">Outstanding</span><span class="v" style="color:var(--warn)">${fmt$c(c.outstanding)}</span></div>` : ""}
      </div>
      ${next ? `<div class="client-next"><strong>Up next:</strong> ${next}</div>` : ""}
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
  const COOL_DAYS = 21;
  const items = [];
  d.clients.forEach((c) => {
    if (c.status === "Inactive") return;
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
      items.push({ name: c.name, since: since === null ? Infinity : since, reason, last: c.last_session, paid: c.total_paid });
    }
  });
  items.sort((a, b) => b.since - a.since); // coldest first

  $("reengage-sub").textContent = items.length ? `${items.length} worth a nudge` : "all warm";
  $("reengage").innerHTML = items.length
    ? `<div class="reengage-grid">${items
        .map((i) => {
          const lastTxt = i.last && parseDate(i.last)
            ? parseDate(i.last).toLocaleDateString("en-US", { month: "short", day: "numeric" })
            : "never";
          return `<div class="reengage-item">
            <div class="reengage-top"><span class="reengage-name">${i.name}</span><span class="reengage-days">${i.since === Infinity ? "—" : i.since + "d"}</span></div>
            <div class="reengage-reason">${i.reason}</div>
            <div class="reengage-meta">Last: ${lastTxt} · ${fmt$c(i.paid)} paid</div>
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
      <span class="activity-date">${d2}</span>
      <span class="activity-name">${name}</span>
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
    if (c.stage === "At Risk") items.push({ tag: "atrisk", label: "At risk", name: c.name, note: "60+ days since last session — reach out" });
    else if (c.stage === "Check In") items.push({ tag: "checkin", label: "Check in", name: c.name, note: "31–60 days since last session" });
    else if (c.stage === "New") items.push({ tag: "new", label: "New", name: c.name, note: "no sessions yet — book their first" });
  });

  $("attention").innerHTML = items.length
    ? items
        .map(
          (i) => `<div class="attn-item"><span class="attn-tag ${i.tag}">${i.label}</span><span>${i.name}</span><span class="attn-note">${i.note}</span></div>`
        )
        .join("")
    : '<p class="empty-note">Nothing urgent — everyone’s covered. 🎉</p>';
}

/* ------- tooltips ------- */

function attachTooltips(root) {
  const tip = $("tooltip");
  root.querySelectorAll("[data-tip]").forEach((el) => {
    el.addEventListener("mousemove", (e) => {
      const [title, ...lines] = el.getAttribute("data-tip").split("|");
      tip.innerHTML =
        `<div class="t-title">${title}</div>` +
        lines.map((l) => `<div class="t-line">${l}</div>`).join("");
      tip.classList.remove("hidden");
      const pad = 12;
      let x = e.clientX + pad, y = e.clientY + pad;
      const r = tip.getBoundingClientRect();
      if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - pad;
      if (y + r.height > window.innerHeight - 8) y = e.clientY - r.height - pad;
      tip.style.left = x + "px";
      tip.style.top = y + "px";
    });
    el.addEventListener("mouseleave", () => tip.classList.add("hidden"));
  });
}
