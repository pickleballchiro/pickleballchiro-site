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
  if (DATA) renderMonthly(DATA);
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
  renderMonthly(d);
  renderStreams(d);
  renderMoney(d);
  renderClients(d);
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
  const now = new Date();
  const thisKey = monthKey(now);
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevKey = monthKey(prev);

  const inMonth = (rows, key) =>
    rows.filter((r) => { const dt = parseDate(r.date); return dt && monthKey(dt) === key; });

  const revThis = inMonth(d.income, thisKey).reduce((s, r) => s + r.amount, 0);
  const revPrev = inMonth(d.income, prevKey).reduce((s, r) => s + r.amount, 0);
  const sessThis = inMonth(d.mileage, thisKey).length;
  const sessPrev = inMonth(d.mileage, prevKey).length;

  const activeClients = d.clients.filter((c) => c.status === "Active").length;
  const incomeTotal = d.income.reduce((s, r) => s + r.amount, 0);
  const expenseTotal = d.expenses.reduce((s, r) => s + r.amount, 0);
  const net = incomeTotal - expenseTotal;
  const taxSetAside = Math.max(0, net) * 0.25;
  const mileageDeduction = d.mileage.reduce((s, r) => s + r.deduction, 0);

  const delta = (cur, prevV, money) => {
    if (!prevV) return "";
    const pct = ((cur - prevV) / prevV) * 100;
    const cls = pct >= 0 ? "up" : "down";
    const arrow = pct >= 0 ? "▲" : "▼";
    return `<div class="kpi-delta ${cls}">${arrow} ${Math.abs(pct).toFixed(0)}% vs last month (${money ? fmt$(prevV) : prevV})</div>`;
  };

  const tiles = [
    { label: "Revenue · " + MONTH_NAMES[now.getMonth()], value: fmt$(revThis), extra: delta(revThis, revPrev, true) },
    { label: "Sessions · " + MONTH_NAMES[now.getMonth()], value: sessThis, extra: delta(sessThis, sessPrev, false) },
    { label: "Active clients", value: activeClients, extra: "" },
    { label: "Net profit · YTD", value: fmt$(net), extra: `<div class="kpi-delta">${fmt$(incomeTotal)} in − ${fmt$(expenseTotal)} out</div>` },
    { label: "Tax set-aside (25% of net)", value: fmt$(taxSetAside), extra: `<div class="kpi-delta">keep this much in reserve</div>` },
    { label: "Mileage deduction · YTD", value: fmt$c(mileageDeduction), extra: `<div class="kpi-delta">${d.mileage.length} trips logged</div>` },
  ];
  $("kpis").innerHTML = tiles
    .map(
      (t) => `<div class="kpi"><div class="kpi-label">${t.label}</div><div class="kpi-value">${t.value}</div>${t.extra}</div>`
    )
    .join("");
}

/* ------- monthly chart (bars = revenue, line = sessions/clients) ------- */

function renderMonthly(d) {
  // month range: first month with activity -> current month
  const dates = [];
  d.income.forEach((r) => { const dt = parseDate(r.date); if (dt && dt.getFullYear() >= 2026) dates.push(dt); });
  d.mileage.forEach((r) => { const dt = parseDate(r.date); if (dt && dt.getFullYear() >= 2026) dates.push(dt); });
  if (!dates.length) { $("monthly-chart").innerHTML = '<p class="empty-note">No data yet.</p>'; return; }
  dates.sort((a, b) => a - b);
  const start = new Date(dates[0].getFullYear(), dates[0].getMonth(), 1);
  const now = new Date();
  const months = [];
  for (let dt = new Date(start); dt <= now; dt.setMonth(dt.getMonth() + 1)) {
    months.push(monthKey(dt));
  }

  const revenue = {}, sessions = {}, clients = {};
  months.forEach((k) => { revenue[k] = 0; sessions[k] = 0; clients[k] = new Set(); });
  d.income.forEach((r) => {
    const dt = parseDate(r.date); if (!dt) return;
    const k = monthKey(dt); if (k in revenue) {
      revenue[k] += r.amount;
      clients[k].add((r.client || "").toLowerCase().trim());
    }
  });
  d.mileage.forEach((r) => {
    const dt = parseDate(r.date); if (!dt) return;
    const k = monthKey(dt); if (k in sessions) sessions[k]++;
  });

  const lineVals = months.map((k) => lineMode === "sessions" ? sessions[k] : clients[k].size);
  const barVals = months.map((k) => revenue[k]);

  // --- SVG: two aligned panels sharing the month axis (never dual-axis) ---
  const W = 720, padL = 52, padR = 16, padT = 14;
  const barH = 170, gapH = 30, lineH = 80, padB = 26;
  const H = padT + barH + gapH + lineH + padB;
  const plotW = W - padL - padR;
  const niceMax = niceCeil(Math.max(...barVals, 1));
  const lineMax = niceCeil(Math.max(...lineVals, 1));

  const bw = Math.min(44, (plotW / months.length) * 0.55);
  const xC = (i) => padL + (plotW / months.length) * (i + 0.5);
  const barBase = padT + barH;
  const lineTop = padT + barH + gapH;
  const lineBase = lineTop + lineH;
  const yBar = (v) => barBase - (v / niceMax) * barH;
  const yLine = (v) => lineBase - (v / lineMax) * lineH;

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Monthly revenue and ${lineMode}">`;
  // ---- panel 1: revenue bars ----
  for (let g = 0; g <= 4; g++) {
    const v = (niceMax / 4) * g;
    const y = yBar(v);
    svg += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>`;
    svg += `<text x="${padL - 8}" y="${y + 3}" text-anchor="end" font-size="10" fill="#9C9C9C">${fmt$(v)}</text>`;
  }
  months.forEach((k, i) => {
    const v = barVals[i];
    const x = xC(i) - bw / 2;
    const y = yBar(v);
    if (v > 0) {
      svg += `<path d="M${x},${barBase} L${x},${y + 4} Q${x},${y} ${x + 4},${y} L${x + bw - 4},${y} Q${x + bw},${y} ${x + bw},${y + 4} L${x + bw},${barBase} Z"
        fill="${COLORS.lessons}" data-tip="${monthLabel(k)}|Revenue: ${fmt$c(v)}"/>`;
    }
  });
  // ---- panel 2: sessions / clients line ----
  svg += `<text x="${padL - 8}" y="${lineTop + 4}" text-anchor="end" font-size="10" fill="#9C9C9C">${lineMax}</text>`;
  svg += `<text x="${padL - 8}" y="${lineBase + 3}" text-anchor="end" font-size="10" fill="#9C9C9C">0</text>`;
  svg += `<line x1="${padL}" y1="${lineBase}" x2="${W - padR}" y2="${lineBase}" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>`;
  svg += `<line x1="${padL}" y1="${lineTop}" x2="${W - padR}" y2="${lineTop}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>`;
  const linePts = months.map((k, i) => [xC(i), yLine(lineVals[i])]);
  svg += `<polyline points="${linePts.map((p) => p.join(",")).join(" ")}" fill="none" stroke="${COLORS.chiro}" stroke-width="2"/>`;
  linePts.forEach((p, i) => {
    svg += `<circle cx="${p[0]}" cy="${p[1]}" r="4.5" fill="${COLORS.chiro}" stroke="#202226" stroke-width="2"
      data-tip="${monthLabel(months[i])}|${lineMode === "sessions" ? "Sessions" : "Paying clients"}: ${lineVals[i]}"/>`;
  });
  // ---- shared month labels ----
  months.forEach((k, i) => {
    svg += `<text x="${xC(i)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="#9C9C9C">${monthLabel(k)}</text>`;
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

  $("money-summary").innerHTML = `
    <div class="money-line"><div class="m-label">Total income</div><div class="m-value">${fmt$c(income)}</div></div>
    <div class="money-line"><div class="m-label">Total expenses</div><div class="m-value">${fmt$c(expenses)}</div></div>
    <div class="money-line"><div class="m-label">Net profit (taxable est.)</div><div class="m-value">${fmt$c(net)}</div></div>
    <div class="money-line accent"><div class="m-label">Tax set-aside · 25%</div><div class="m-value">${fmt$c(setAside)}</div></div>`;

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

function renderClients(d) {
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
    const total = hasPkg ? +c.included : used + (left ?? 0);
    const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
    const next = comingUpNext(c.notes);
    const lastSession = c.last_session
      ? parseDate(c.last_session)?.toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : "—";
    return `
    <div class="client-card">
      <div class="client-top"><span class="client-name">${c.name}</span>${chipFor(c)}</div>
      <div class="client-rows">
        ${c.package ? `<div class="row"><span class="k">Package</span><span class="v">${c.package}</span></div>` : ""}
        ${(used || left !== null) ? `<div class="row"><span class="k">Sessions</span><span class="v">${used} used${left !== null ? " · " + left + " left" : ""}</span></div>` : ""}
        ${left !== null && total > 0 ? `<div class="pkg-meter"><div class="fill" style="width:${pct}%"></div></div>` : ""}
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
  const total = d.leads.length;
  const converted = counts["Converted"];
  const rate = total ? ((converted / total) * 100).toFixed(1) : "0";
  $("conversion").textContent = `${total} leads · ${rate}% converted`;

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
