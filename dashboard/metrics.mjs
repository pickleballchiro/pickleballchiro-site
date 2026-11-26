export const METRICS = {
  views: "Views", reach: "Reach", viewers: "Viewers", likes: "Likes", comments: "Comments",
  shares: "Shares", saves: "Saves", follows: "Follows", reposts: "Reposts",
  avg_watch_s: "Avg. watch time", relative_watch: "Avg. watch / duration", skip_rate: "Skip rate",
  hold_3s: "3-sec hold", retention_end_pct: "End retention", profile_visits: "Profile visits",
  link_taps: "Link taps", coach_inquiries: "Coaching inquiries", dms: "DMs",
  free_analysis_submissions: "Free analyses", paying_clients: "Paying clients", revenue_usd: "Revenue",
};
export const ADDITIVE = new Set([
  "views", "likes", "comments", "shares", "saves", "follows", "reposts",
  "profile_visits", "link_taps", "coach_inquiries", "dms", "free_analysis_submissions", "paying_clients", "revenue_usd",
]);
const timedWindow = "dated";

const utc = (date) => new Date(date + "T12:00:00Z");
const iso = (date) => date.toISOString().slice(0, 10);

export function shift(date, n) {
  const d = utc(date);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

export function bucketStart(date, grain) {
  const d = utc(date);
  if (grain === "day") return date;
  if (grain === "week") return shift(date, -((d.getUTCDay() + 6) % 7));
  const month = grain === "quarter" ? Math.floor(d.getUTCMonth() / 3) * 3 : d.getUTCMonth();
  return iso(new Date(Date.UTC(d.getUTCFullYear(), month, 1)));
}

function bucketEnd(start, grain) {
  if (grain === "day") return start;
  if (grain === "week") return shift(start, 6);
  const d = utc(start);
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + (grain === "quarter" ? 3 : 1), 0)));
}

export function ranges(preset, today, custom) {
  if (preset === "custom") return custom;
  if (preset === "all") return { start: "", end: today };
  if (preset === "yesterday") return { start: shift(today, -1), end: shift(today, -1) };
  if (preset === "today") return { start: today, end: today };
  if (["week", "month", "quarter"].includes(preset)) return { start: bucketStart(today, preset), end: today };
  return { start: shift(today, 1 - Number(preset)), end: today };
}

function clock(o) {
  const match = /^~?(\d{2}:\d{2})(?:-\d{2}:\d{2})?$/.exec(o.time);
  return match?.[1] || (o.time === "morning" ? "06:00" : "");
}

function compare(a, b) {
  return a.date.localeCompare(b.date) || clock(a).localeCompare(clock(b)) ||
    a.id.localeCompare(b.id, undefined, { numeric: true });
}

export function validRows(rows, metric, end) {
  return rows.filter((o) => o.metric === metric && Number.isFinite(o.value) &&
    o.date <= end).sort(compare);
}

export function latest(rows, metric, end, duration) {
  const watch = metric === "relative_watch";
  const o = validRows(rows, watch ? "avg_watch_s" : metric, end).at(-1);
  if (!o || (watch && !(duration > 0))) return null;
  return { ...o, value: watch ? o.value / duration * 100 : o.value };
}

export function accrued(item, rows, metric, range) {
  if (!ADDITIVE.has(metric) || item.status !== "published" || item.conflict) return null;
  const readings = validRows(rows, metric, range.end).filter((o) =>
    o.date >= range.start && (!item.publishedOn || o.date >= item.publishedOn) &&
    o.quality === "actual" && o.window === timedWindow && /^\d{2}:\d{2}(?:-\d{2}:\d{2})?$/.test(o.time));
  if (!readings.length) return null;
  // Same-clock disagreements cannot be ordered. Preserve them in history.
  const distinct = new Map();
  for (const o of readings) {
    const stamp = o.date + clock(o);
    if (distinct.has(stamp) && distinct.get(stamp).value !== o.value) return null;
    distinct.set(stamp, o);
  }
  const ordered = [...distinct.values()];
  const last = ordered.at(-1);
  const startsAtPublication = item.dateQuality === "exact" && item.publishedOn &&
    (!range.start || item.publishedOn >= range.start) && item.publishedOn <= last.date;
  if (ordered.some((o, i) => i > 0 && o.value < ordered[i - 1].value)) return null;
  if (!startsAtPublication && ordered.length < 2) return null;
  return { ...last, value: last.value - (startsAtPublication ? 0 : ordered[0].value),
    startObserved: startsAtPublication ? item.publishedOn : ordered[0].date,
    anchor: startsAtPublication ? "publication" : "observation" };
}

export function isPublished(item) {
  return item.status === "published" || item.status === "historical · provisional";
}

export function chosen(items, mode, range) {
  return items.filter((item) => {
    if (item.status === "account") return false;
    if (mode === "cohort" && isPublished(item)) {
      return item.status === "published" && item.publishedOn && item.publishedOn >= range.start &&
        item.publishedOn <= range.end;
    }
    if (mode === "cohort") return item.plannedOn ? item.plannedOn >= range.start && item.plannedOn <= range.end : !range.start;
    return !item.publishedOn || item.publishedOn <= range.end;
  });
}

export function measure(item, rows, metric, mode, range) {
  if (!isPublished(item) || item.unboundMetrics) return null;
  if (mode === "accrued") return accrued(item, rows, metric, range);
  return latest(rows, metric, range.end, item.duration);
}

export function summarize(items, observations, metric, mode, range) {
  const published = items.filter(isPublished);
  const values = published.map((item) => measure(item, observations.get(item.id) || [], metric, mode, range)).filter(Boolean);
  const available = values.length;
  const sum = values.reduce((s, o) => s + o.value, 0);
  return {
    value: available ? (ADDITIVE.has(metric) ? sum : sum / available) : null,
    available, eligible: published.length, partial: available !== published.length,
    approximate: values.some((o) => o.quality !== "actual"),
    partialWindow: mode === "accrued" && available > 0,
  };
}

export function trend(items, observations, metric, mode, range, grain) {
  const dates = items.map((i) => i.publishedOn).filter(Boolean);
  for (const rows of observations.values()) for (const o of rows) dates.push(o.date);
  const first = range.start || dates.sort()[0] || range.end;
  const bins = [];
  let cursor = bucketStart(first, grain);
  while (cursor <= range.end) {
    const displayEnd = bucketEnd(cursor, grain);
    const span = { start: cursor < first ? first : cursor, end: displayEnd > range.end ? range.end : displayEnd };
    const selected = mode === "cohort"
      ? chosen(items, mode, span)
      : items.filter((i) => !i.publishedOn || i.publishedOn <= span.end);
    const m = summarize(selected, observations, metric, mode, { ...span, end: mode === "cohort" ? range.end : span.end });
    bins.push({ ...m, start: span.start, end: span.end });
    cursor = shift(displayEnd, 1);
  }
  return bins;
}

export function matchingAges(items, observations, metric) {
  if (items.length < 2 || items.some((i) => i.status !== "published" || !i.publishedOn || i.conflict ||
    !i.platform || !i.distribution || i.platform !== items[0].platform || i.distribution !== items[0].distribution ||
    i.format !== items[0].format)) return [];
  const series = items.map((item) => {
    const ages = new Map();
    for (const obs of validRows(observations.get(item.id) || [], metric, "9999-12-31")) {
      if (Number.isInteger(obs.age) && obs.age >= 0 && obs.quality === "actual" &&
          obs.window === timedWindow && clock(obs) && obs.date >= item.publishedOn) {
        // Earliest clocked sample at each reported age keeps a late-day value from silently taking precedence.
        if (!ages.has(obs.age)) ages.set(obs.age, obs);
      }
    }
    return ages;
  });
  return [...series[0].keys()].filter((age) => series.every((s) => s.has(age))).sort((a, b) => a - b)
    .map((age) => ({ age, observations: series.map((s) => s.get(age)), precision: "reported calendar age" }));
}

export function experiments(templates, creatives) {
  const owners = new Map();
  const configured = templates.map((ex) => {
    const versions = ex.versions.map((v) => {
      owners.set(v.id, ex.id);
      return { ...v, item: creatives.get(v.id) || { id: v.id, title: v.id, status: v.status || "record unavailable" } };
    });
    return { ...ex, versions };
  });
  const pending = [...creatives.values()].filter((i) => i.parent || i.family);
  const generated = new Map();
  function add(item, visiting = new Set()) {
    if (owners.has(item.id)) return owners.get(item.id);
    if (visiting.has(item.id)) return null;
    visiting.add(item.id);
    const parent = creatives.get(item.parent);
    const existing = parent && add(parent, visiting);
    const id = existing || (item.parent ? item.family + "/" + item.parent : item.family || item.id);
    const ex = configured.find((e) => e.id === id) || generated.get(id) || {
      id, family: item.family || item.id, title: item.topic || item.title, status: "unclassified",
      versions: [], result: "", next: "",
    };
    if (!configured.includes(ex)) generated.set(id, ex);
    ex.versions.push({ id: item.id, item, baseline: !item.parent && pending.some((i) => i.parent === item.id),
      design: "Change attribution unrecorded", changes: {} });
    owners.set(item.id, id);
    return id;
  }
  for (const item of pending) add(item);
  return [...configured, ...generated.values()].filter((e) => e.versions.length > 1 || e.versions.some((v) => v.item.parent));
}
