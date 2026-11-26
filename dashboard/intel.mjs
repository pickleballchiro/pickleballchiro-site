import {
  METRICS, ADDITIVE, ranges, latest, chosen, measure, summarize, trend,
  matchingAges, experiments, isPublished,
} from "./metrics.mjs?v=29";

const output = document.querySelector("#intel-output");
const refresh = document.querySelector("#intel-refresh");
const preview = LOCAL_PREVIEW;
let section = "";
let activeRequest;
const model = {
  preset: "7", grain: "day", mode: "cohort", metric: "views", filters: { distribution: "trial" },
  q: "", sort: "value", detail: "", comparison: "", metricAge: "views",
  filtersOpen: !matchMedia("(max-width: 580px)").matches,
};
const num = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const snapshotTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", year: "numeric", month: "short", day: "numeric",
  hour: "numeric", minute: "2-digit", timeZoneName: "short",
});
const modes = { cohort: "Publication cohort", accrued: "Accrued in period", latest: "Latest cumulative" };
const descriptions = {
  cohort: "Groups by publication date. Each metric uses one observation per published piece through the end date.",
  accrued: "Measured change between comparable samples inside the dates. A known in-range publication can start at zero. Unsampled activity is missing.",
  latest: "Uses the most recent observation per published piece through the end date. The start date only affects the trend.",
};
const labels = {
  trial: "Trial", organic: "Main feed", "": "Unknown",
  trial_reel: "Trial Reel", reel: "Reel", carousel: "Carousel", youtube_short: "YouTube Short",
};
const filters = { platform: "Platform", format: "Format", topic: "Topic", status: "Publication",
  distribution: "Distribution", version: "Version", objective: "Objective" };
const presets = { today: "Today", yesterday: "Yesterday", week: "This week", month: "This month", quarter: "This quarter",
  7: "Last 7 days", 30: "Last 30 days", 90: "Last 90 days", all: "All time", custom: "Custom" };
const easternDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York",
  year: "numeric", month: "2-digit", day: "2-digit" });
const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

let payload;
let byId;
let obs;
let lab;

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue;
    if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  node.append(...children.flat(Infinity).filter((child) => child != null && child !== false));
  return node;
}
const h = (level, text) => el("h" + level, {}, text);
const muted = (text) => el("p", { class: "intel-muted" }, text);
const title = (value) => labels[value] || String(value || "Unknown").replaceAll("_", " ");
const day = (date) => date ? dateFormat.format(new Date(date + "T12:00:00Z")) : "Unknown";
const stamp = (o) => o ? [o.date, o.time, o.time && "ET"].filter(Boolean).join(" ") : "Unknown";
const pill = (v, variant = "") => el("span", { class: "intel-pill " + variant }, v);
const link = (href, text) => href && el("a", { href, target: "_blank", rel: "noopener noreferrer" }, text);

function format(metric, value) {
  if (value == null) return "—";
  if (metric === "revenue_usd") return "$" + num.format(value);
  if (metric.endsWith("_pct") || ["relative_watch", "skip_rate", "hold_3s"].includes(metric)) return num.format(value) + "%";
  if (metric === "avg_watch_s") return num.format(value) + " s";
  return num.format(value);
}

function card(heading, ...children) {
  return el("section", { class: "card intel-card" }, h(2, heading), children);
}

function select(label, key, options, value, onChange) {
  const input = el("select", { id: key, onchange: (e) => onChange(e.target.value) },
    Object.entries(options).map(([id, name]) => el("option", { value: id }, name)));
  input.value = value;
  return el("label", { class: "intel-input" }, label, input);
}

function dateInput(key, text) {
  return el("label", { class: "intel-input" }, text,
    el("input", { type: "date", id: key, value: model[key], max: payload.today,
      onchange: (e) => { model[key] = e.target.value; render(); } }));
}

function set(key, value) {
  model[key] = value;
  render();
  document.getElementById(key)?.focus({ preventScroll: true });
}

function setFilter(key, value) {
  model.filters[key] = value;
  render();
  document.getElementById(key)?.focus({ preventScroll: true });
}

function table(headers, rows, label) {
  if (!rows.length) return muted("No records in this view.");
  const head = el("thead", {}, el("tr", {}, headers.map((v) => el("th", { scope: "col" }, v))));
  const body = el("tbody", {}, rows.map((row) => el("tr", {}, row.map((v) => el("td", {}, v ?? "—")))));
  return el("div", { class: "intel-table", tabindex: "0", role: "region", "aria-label": label }, el("table", {}, head, body));
}

function sourcePanel() {
  const s = payload.sources;
  if (payload.schema === "pbc-content-intelligence/1") {
    const c = payload.coverage;
    return el("details", { class: "card intel-card", open: "" }, el("summary", {}, "Data sources and coverage"),
      c && muted(`${payload.observations.length} of ${c.recorded} recorded observations are included across ${payload.creatives.length} published posts. Source ends at ${c.sourceThrough}.`),
      c && muted(`Latest included observation ${c.includedObservedThrough}. Latest source observation ${c.sourceObservedThrough}.`),
      c && muted(`Excluded: ${c.publication} without eligible publication, ${c.accountOrBatch} account or unattributed batch, ${c.metric} outside supported metrics and labels, ${c.unavailable} unavailable or unlinked.`),
      muted("Published content snapshot saved " + snapshotTime.format(new Date(payload.asOf)) + ". Refresh reads the latest saved snapshot."),
      muted("Publication identity comes from HQ Post Log. Observations come from the Content Engine performance registry."));
  }
  return el("details", { class: "card intel-card" },
    el("summary", {}, "Data sources and coverage"),
    muted(`${payload.observations.length} of ${payload.observationCount} recorded observations loaded locally.`),
    muted(`HQ snapshot contains ${payload.hq.posts} Post Log entries and ${payload.hq.plannedRecords} Content records. Ideas: ${payload.hq.ideas ?? "unknown"}. Clip Catalog: ${payload.hq.clips ?? "unknown"}.`),
    table(["Source", "Availability", "Timestamp"], Object.entries(s).map(([name, row]) => [
      name, row.state === "snapshot" ? "Dated read-only capture" : row.state, row.readAt || row.modified || "Unknown",
    ]), "Source freshness"),
    muted("Recent registry and production data reload from disk. The HQ snapshot is a dated capture. Post Log metrics without observation dates and unscoped account activity are kept out of post totals."));
}

function renderContent() {
  const range = ranges(model.preset, payload.today, { start: model.from, end: model.to });
  const mode = model.mode;
  const metricOptions = Object.fromEntries(Object.entries(METRICS).filter(([m]) => mode !== "accrued" || ADDITIVE.has(m)));
  const metric = metricOptions[model.metric] ? model.metric : "views";
  const all = [...byId.values()].filter((i) => i.status !== "account");
  const presetsInOrder = ["today", "yesterday", "week", "month", "quarter", "7", "30", "90", "all", "custom"];
  const period = select("Date range", "preset", {}, model.preset, (v) => set("preset", v));
  const periodSelect = period.querySelector("select");
  for (const id of presetsInOrder) periodSelect.append(el("option", { value: id }, presets[id]));
  periodSelect.value = model.preset;
  const rangeControls = el("div", { class: "intel-controls" },
    period, model.preset === "custom" && [dateInput("from", "From"), dateInput("to", "Through")].filter(Boolean),
    select("Measure", "mode", modes, mode, (v) => set("mode", v)),
    select("Trend by", "grain", { day: "Day", week: "Week", month: "Month", quarter: "Quarter" }, model.grain, (v) => set("grain", v)),
    select("Metric", "metric", metricOptions, metric, (v) => set("metric", v)));
  const options = Object.entries(filters).map(([k, label]) => {
    const values = k === "distribution" ? ["trial", "organic"] : [...new Set(all.map((i) => i[k]).filter(Boolean))].sort();
    const opts = { all: "All", ...Object.fromEntries(values.map((v) => [v, title(v)])), missing: "Unknown" };
    return select(label, k, opts, model.filters[k] || "all", (v) => setFilter(k, v));
  });
  output.replaceChildren(el("section", { class: "card intel-card intel-filter-card" }, rangeControls,
    el("details", { class: "intel-filter-details", open: model.filtersOpen ? "" : null,
      ontoggle: (e) => { if (e.target.isConnected) model.filtersOpen = e.target.open; } },
      el("summary", {}, "Content filters"), el("div", { class: "intel-controls intel-filters" }, options)), muted(descriptions[mode])));
  if (!range.end || range.start > range.end || range.end > payload.today || (model.preset === "custom" && !range.start)) {
    output.append(card("Choose a valid range", muted("Select both dates on or before today, with the start on or before the end.")));
    return;
  }
  const items = chosen(all.filter((i) => Object.keys(filters).every((k) => {
    const v = model.filters[k];
    return !v || v === "all" || (v === "missing" ? !i[k] : i[k] === v);
  })), mode, range);
  const groups = [...new Set(items.filter(isPublished).map((i) => i.distribution || ""))]
    .sort((a, b) => (a === model.filters.distribution ? -1 : b === model.filters.distribution ? 1 : a.localeCompare(b)));
  const observations = [...obs.values()].flat().filter((o) => byId.get(o.creativeId)?.status !== "account");
  const latestObserved = observations.map((o) => o.date).sort().at(-1);
  const freshness = latestObserved === payload.today ? "observed today" : "no observation today";
  output.append(el("div", { class: "intel-context" },
    pill(`${range.start ? day(range.start) + " – " : "Through "}${day(range.end)} · ET`),
    pill(`Latest post observation ${latestObserved || "unknown"} · ${freshness}`),
    pill(`${items.filter(isPublished).length} published or historical in view`)));
  if (groups.length) output.append(...groups.map((d) => renderGroup(d, items, metric, mode, range)));
  else output.append(card("Performance", muted("No published content matches this view.")));
  output.append(leaderboard(items, metric, mode, range));
  if (preview) output.append(accountCard(range));
  output.append(sourcePanel());
}

function renderGroup(distribution, items, metric, mode, range) {
  const group = items.filter((i) => (i.distribution || "") === distribution);
  const metrics = [...new Set([metric, "views", "reach", "shares", "saves", "follows"])]
    .filter((m) => mode !== "accrued" || ADDITIVE.has(m));
  const kpis = metrics.map((m) => {
    const s = summarize(group, obs, m, mode, range);
    return el("div", { class: "intel-kpi" }, el("span", {}, METRICS[m]),
      el("strong", {}, (s.approximate ? "≈" : "") + format(m, s.value)),
      el("small", {}, `${s.available}/${s.eligible} observed${s.partial ? " · partial" : ""}`));
  });
  const filteredObservations = new Map(group.map((item) => [item.id, obs.get(item.id) || []]));
  const bins = trend(group, filteredObservations, metric, mode, range, model.grain);
  const available = bins.filter((b) => b.value != null);
  const recent = bins.slice(-14);
  const formats = [...new Set(group.filter(isPublished).map((i) => i.format || ""))];
  const formatRows = formats.map((f) => {
    const s = summarize(group.filter((item) => (item.format || "") === f), obs, metric, mode, range);
    return [title(f), (s.approximate ? "≈" : "") + format(metric, s.value), `${s.available}/${s.eligible}`];
  });
  return card(`${title(distribution)} performance`, el("div", { class: "intel-kpis" }, kpis),
    mode === "accrued" && muted("All accrued totals cover observed intervals only. Daily buckets can omit change between days."),
    el("div", { class: "intel-columns" },
      el("div", {}, h(3, METRICS[metric] + " trend"), available.length
        ? [bars(recent, metric), bins.length > recent.length ? el("details", {}, el("summary", {}, "All periods"),
            table(["From", "Through", METRICS[metric], "Observed"], bins.map((b) => [
              b.start, b.end, (b.approximate ? "≈" : "") + format(metric, b.value), `${b.available}/${b.eligible}`,
            ]), "All reporting periods")) : null]
        : muted("No observations usable in these buckets.")),
      el("div", {}, h(3, "Format comparison"), table(["Format", METRICS[metric], "Observed"], formatRows, "Format comparison"),
        muted(ADDITIVE.has(metric) ? "Totals use observed posts only." : "Unweighted mean across observed posts."))));
}

function bars(bins, metric) {
  const max = Math.max(1, ...bins.map((b) => b.value ?? 0));
  return el("div", { class: "intel-bars" }, bins.map((b) =>
    el("div", { class: "intel-bar" }, el("time", { datetime: b.start }, b.start === b.end ? day(b.start) : `${day(b.start)}–${day(b.end)}`),
      b.value == null ? el("span", { class: "intel-empty-line" }, "Missing") :
        el("meter", { min: 0, max, value: Math.max(0, b.value), "aria-label": `${METRICS[metric]} for ${b.start} to ${b.end}` }),
      el("span", { class: "intel-numeric", title: `${b.available}/${b.eligible} observed` }, (b.approximate ? "≈" : "") + format(metric, b.value)))));
}

function leaderboard(items, metric, mode, range) {
  const search = el("input", { type: "search", id: "intel-search", value: model.q, placeholder: "Search by title, topic, ID…",
    oninput: (e) => { model.q = e.target.value; update(); } });
  const sort = select("Sort by", "sort", { value: `${METRICS[metric]} ↓`, low: `${METRICS[metric]} ↑`, date: "Newest", title: "Title A–Z" },
    model.sort, (v) => { model.sort = v; update(); });
  const list = el("div", {});
  const detail = el("div", { id: "intel-detail" });
  const data = items.map((item) => ({ item, reading: measure(item, obs.get(item.id) || [], metric, mode, range) }));
  function update() {
    const q = model.q.toLowerCase().trim();
    const rows = data.filter(({ item }) => [item.title, item.id, item.postId, item.ideaId, item.topic, item.family, item.objective]
      .some((v) => v?.toLowerCase().includes(q)));
    const order = ({ a, b }) => (model.sort === "title" ? a.item.title.localeCompare(b.item.title) :
      model.sort === "date" ? (b.item.publishedOn || "").localeCompare(a.item.publishedOn || "") :
      (model.sort === "low" ? 1 : -1) * ((a.reading?.value ?? (model.sort === "low" ? Infinity : -Infinity)) -
        (b.reading?.value ?? (model.sort === "low" ? Infinity : -Infinity))));
    rows.sort((a, b) => order({ a, b }) || a.item.id.localeCompare(b.item.id));
    if (!rows.some(({ item }) => item.id === model.detail)) detail.replaceChildren();
    else if (!detail.hasChildNodes()) show(byId.get(model.detail), false);
    list.replaceChildren(muted(`${rows.length} matching records`), table(
      ["Creative", "Publication", "Distribution", METRICS[metric], "Observed"],
      rows.map(({ item, reading }) => [
        el("div", {}, el("button", { type: "button", class: "intel-text-button", onclick: () => show(item) }, item.title),
          el("small", { class: "intel-id" }, [item.id, item.version, title(item.format)].filter(Boolean).join(" · "))),
        item.status === "published" ? item.publishedOn || "Published · date unknown" : item.status,
        title(item.distribution),
        reading ? (reading.quality !== "actual" ? "≈" : "") + format(metric, reading.value) : "—",
        reading ? stamp(reading) : "—",
      ]), "Content leaderboard"));
  }
  function show(item, scroll = true) {
    model.detail = item.id;
    detail.replaceChildren(renderDetail(item));
    if (scroll) {
      detail.scrollIntoView({ behavior: "instant", block: "start" });
      detail.firstElementChild?.focus({ preventScroll: true });
    }
  }
  update();
  return card("Content leaderboard", el("div", { class: "intel-controls" },
    el("label", { class: "intel-input intel-search" }, "Search", search), sort), list, detail);
}

function renderDetail(item) {
  const rows = obs.get(item.id) || [];
  const group = [item.id, item.postId, item.ideaId, item.family, item.parent && "Version of " + item.parent,
    item.editRevision && "Engine revision " + item.editRevision, item.edlVersion && "EDL " + item.edlVersion, item.publicationBasis, item.identity === "provisional" && "Permalink identity provisional"];
  const measured = Object.entries(METRICS).flatMap(([metric, name]) => {
    const sample = isPublished(item) && !item.unboundMetrics && latest(rows, metric, payload.today, item.duration);
    return sample ? [[name, format(metric, sample.value), stamp(sample), sample.quality]] : [];
  });
  const series = [...rows].sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time) ||
    b.id.localeCompare(a.id, undefined, { numeric: true }));
  const feedback = payload.feedback.filter((f) => f.creativeId === item.id);
  const peers = [...byId.values()].filter((o) => !o.distributionWarning && o.id !== item.id && o.platform === item.platform &&
    o.distribution === item.distribution && o.format === item.format && o.objective === item.objective);
  const ages = item.distributionWarning ? [] : matchingAges([item, item], obs, "views").map((row) => row.age);
  const comparable = ages.map((age) => {
    const values = peers.flatMap((peer) => matchingAges([item, peer], obs, "views")
      .filter((r) => r.age === age).map((r) => r.observations[1].value)).sort((a, b) => a - b);
    const mid = Math.floor(values.length / 2);
    return { age, count: values.length, median: values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2 };
  }).filter((r) => r.count >= 3);
  return el("section", { class: "intel-detail", tabindex: "-1" }, h(3, item.title), muted(group.filter(Boolean).join(" · ")),
    item.conflict && muted(item.conflict),
    item.distributionWarning && muted(item.distributionWarning),
    el("div", { class: "intel-context" }, link(item.url, "Open published post"),
      link(item.design, "Open Canva design"), item.publications?.filter((p) => p.url && p.url !== item.url)
        .map((p) => link(p.url, p.platform + " " + title(p.distribution)))),
    h(4, "Latest cumulative and observed rates"), table(["Metric", "Value", "Observed", "Quality"], measured, "Latest metrics"),
    h(4, "Comparable posts"), comparable.length
      ? table(["Reported age", "Posts", "Median views"], comparable.map((r) => [`Day ${r.age}`, r.count, format("views", r.median)]), "Comparable posts")
      : muted("No group of three comparable posts with the same platform, format, distribution, objective and reported age."),
    h(4, "Performance observations"),
    table(["Observed (ET)", "Age", "Metric", "Value", "Window", "Quality", "Source"], series.map((o) => [
      stamp(o), o.age ?? "—", METRICS[o.metric] || title(o.metric),
      o.metric.includes("_batch_") ? "See unattributed batches" :
        o.reportedLabel ?? (o.value == null ? "Qualitative record" : format(o.metric, o.value)),
      title(o.window), o.quality, o.provenance,
    ]), "Performance observations"),
    feedback.length > 0 && h(4, "Owner creative feedback"),
    feedback.map((f) => muted(`${f.date} · ${f.text}`)));
}

function accountCard(range) {
  const account = [...byId.values()].filter((i) => i.status === "account");
  const rows = account.flatMap((i) => {
    const readings = obs.get(i.id) || [];
    return [...new Set(readings.map((o) => o.metric))].filter((m) => !m.includes("_batch_"))
      .map((metric) => latest(readings, metric, range.end)).filter(Boolean);
  });
  const batch = [...obs.values()].flat().filter((o) => o.metric.includes("_batch_") && o.date <= range.end)
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id, undefined, { numeric: true }));
  return el("details", { class: "card intel-card" }, el("summary", {}, "Account activity and unattributed batches"),
    muted("Latest records through the end date. Account totals, batches and audience percentages are independent of post performance."),
    table(["Metric", "Value", "Observed", "Window"], rows.map((o) => [
      title(o.metric), o.value == null ? "See source record" : format(o.metric, o.value), stamp(o), title(o.window),
     ]), "Account activity"),
    h(3, "Unattributed batches"),
    table(["Recorded batch", "Value", "Observed", "Quality"], batch.map((o) => [
      title(o.metric), o.value == null ? "Qualitative record" : format(o.metric, o.value), stamp(o), o.quality,
    ]), "Unattributed batches"));
}

const comparisonFields = {
  title: "Title / recorded hook", topic: "Topic", objective: "Objective", duration: "Duration",
  style: "Creative style", hookStyle: "Hook style", structure: "Structure", broll: "B-roll",
  subtitles: "Subtitles", cta: "CTA", slides: "Slide count",
};
const changeFields = [
  "Concept", "Angle", "Hook", "Spoken hook", "Text hook", "Visual hook", "Opening footage", "Pacing",
  "Demonstration", "Framing", "B-roll", "B-roll and slow motion", "Audio", "Subtitles",
  "Cover", "Captions", "CTA", "Slide sequence", "Slide layout",
];

function renderLab() {
  const selected = lab.find((e) => e.id === model.comparison) || lab[0];
  if (!selected) { output.replaceChildren(card("No experiments", muted("The creative registry has no version relationships yet."))); return; }
  model.comparison = selected.id;
  const versions = selected.versions;
  const vals = versions.map((v) => v.item);
  const pick = (item) => item.status === "published" && !item.unboundMetrics;
  const plotted = vals.filter((item) => pick(item) && !item.distributionWarning);
  const ages = matchingAges(plotted, obs, model.metricAge);
  const fields = [...new Set([...changeFields, ...versions.flatMap((v) => Object.keys(v.changes))])];
  output.replaceChildren(
    el("div", { class: "intel-lab-grid" },
      el("aside", { class: "card intel-card intel-lab-list", "aria-label": "Experiments" },
        h(2, "Experiments"), lab.map((e) => el("button", { type: "button", "aria-pressed": e.id === selected.id,
          onclick: () => { model.comparison = e.id; render(); document.getElementById("lab-title")?.focus(); } },
          el("span", {}, e.title), el("small", {}, `${e.status} · ${e.versions.length} versions`)))),
      el("div", { class: "intel-lab-main" },
        el("section", { class: "card intel-card" }, el("div", { class: "intel-context" }, pill(selected.status), pill(selected.family)),
          el("h2", { id: "lab-title", tabindex: "-1" }, selected.title),
          el("div", { class: "intel-columns intel-experiment-summary" },
            ...[["Hypothesis", selected.hypothesis], ["Review notes", selected.result], ["Next action", selected.next]]
              .map(([key, val]) => el("div", {}, h(3, key), muted(val || "Unrecorded."))))),
        card("Side by side",
          el("div", { class: "intel-versions" }, versions.map((v) =>
            el("article", { class: "intel-version" }, el("div", { class: "intel-context" },
              pill(v.version || v.item.version || "Version unnumbered"), v.baseline && pill("V1 baseline", "intel-accent")),
              h(3, v.item.title), muted(`${v.id} · ${v.item.status}`), muted(v.design || "Original baseline"),
              v.item.distributionWarning && muted(v.item.distributionWarning),
              link(v.item.url, "Open published post"), link(v.item.design, "Open Canva design")))),
          table(["Creative decision", ...versions.map((v) => v.version || v.id)],
            [...Object.entries(comparisonFields).filter(([key]) => vals.some((i) => i[key]))
              .map(([key, label]) => [label, ...vals.map((i) => key === "duration" ? format("avg_watch_s", i[key]) : i[key] || "—")]),
            ...fields.filter((f) => versions.some((v) => v.changes[f]))
              .map((f) => [f, ...versions.map((v) => v.changes[f] || "Unrecorded")])], "Creative comparison"),
          el("details", {}, el("summary", {}, "Additional tracked creative fields"),
            muted("Concept and angle, spoken/text/visual hooks, footage, duration, sequence, pacing, framing, B-roll, slow motion, audio, subtitles, covers, captions, CTA, slide count, sequence and layout. Blank fields depend on evidence in the existing records."))),
        card("Latest cumulative performance", table(["Metric", ...versions.map((v) => v.version || v.id)],
          Object.entries(METRICS).flatMap(([metric, name]) => {
            const data = vals.map((i) => pick(i) && latest(obs.get(i.id) || [], metric, payload.today, i.duration));
            return data.some(Boolean) ? [[name, ...data.map((o) => o ? `${format(metric, o.value)} · ${stamp(o)} · ${o.quality}` : "—")]] : [];
          }), "Latest performance by version"), muted("Observation ages can differ. Observational snapshots alone cannot establish what caused a result. Versions with a distribution warning are excluded from matched comparisons.")),
        card("Same reported age", select("Metric", "metricAge",
          { views: "Views", shares: "Shares", saves: "Saves", follows: "Follows", avg_watch_s: "Avg. watch time", skip_rate: "Skip rate" },
          model.metricAge, (v) => set("metricAge", v)),
          muted("Earliest clocked actual sample at each common reported age. Elapsed hours may differ. Published versions must share platform, format and distribution."),
          ages.length ? table(["Age", ...plotted.map((i) => i.version || i.id)], ages.map((r) => [
            `Day ${r.age}`, ...r.observations.map((o) => `${format(model.metricAge, o.value)} · ${stamp(o)}`),
          ]), "Performance at the same reported age") : muted("No comparable samples for these published versions and this metric.")),
        retentionCard(vals),
        card("Evidence", (selected.evidence || []).map(muted), selected.measurementFlag && muted(selected.measurementFlag),
          payload.feedback.filter((f) => vals.some((v) => v.id === f.creativeId))
            .map((f) => muted(`Owner feedback · ${f.id} · ${f.date} · ${f.text}`)),
          muted(preview
            ? "Produced versions use their recorded status. Audience comparisons require published observations."
            : "New published versions appear after the next approved snapshot.")))),
    sourcePanel());
}

function retentionCard(items) {
  const curves = items.filter((i) => i.status === "published").flatMap((i) => {
    const sets = new Map();
    for (const o of obs.get(i.id) || []) {
      const match = /^retention_at_(\d+)s_pct$/.exec(o.metric);
      if (match && o.quality === "actual" && Number.isFinite(o.value) && o.value >= 0 && o.value <= 100) {
        const timestamp = stamp(o);
        if (!sets.has(timestamp)) sets.set(timestamp, new Map());
        sets.get(timestamp).set(Number(match[1]), o.value);
      }
    }
    const latestSet = [...sets.entries()].filter(([, points]) => points.size >= 2).sort((a, b) => a[0].localeCompare(b[0])).at(-1);
    return latestSet ? [{ item: i, stamp: latestSet[0], points: [...latestSet[1].entries()].sort((a, b) => a[0] - b[0]) }] : [];
  });
  return card("Retention", curves.length ? curves.map((c) => el("div", {},
    h(3, c.item.title), muted(c.stamp), el("div", { class: "intel-bars" },
      c.points.map(([second, value]) => el("div", { class: "intel-bar" }, el("span", {}, second + " s"),
        el("meter", { min: 0, max: 100, value, "aria-label": `Retention at ${second} seconds` }), format("retention_end_pct", value))))))
    : muted("No timestamped retention series available here. Any observed end-retention value is shown in the metrics table."));
}

function renderHealth() {
  output.replaceChildren(
    card("Current local readings", el("div", { class: "intel-kpis" },
      ...[["Available disk", `${num.format(payload.diskFree / 1e9)} GB`],
        ["Operations commits ahead of local origin/main", payload.localOnly ?? "Unknown"],
        ["Skill records", Object.values(payload.skills).reduce((a, b) => a + b, 0)]].map(([label, v]) =>
        el("div", { class: "intel-kpi" }, el("span", {}, label), el("strong", {}, String(v))))),
      muted("Read " + payload.asOf)),
    card("Skill registry", table(["Status", "Skills"], Object.entries(payload.skills).map(([s, n]) => [s, String(n)]), "Skill registry"),
      muted("Reads the local registry file. Server-side skill status comes from the last recorded verification.")),
    card("Recovery", muted(payload.backup.cutoff ? "Recorded verified cutoff " + payload.backup.cutoff : "No recovery register available."),
      (payload.backup.items || []).map(muted), muted("Recovery values are from the recorded checkpoint.")));
}

function render() {
  if (section === "health") renderHealth();
  else if (section === "experiments") renderLab();
  else renderContent();
}

async function load() {
  activeRequest?.abort();
  const controller = new AbortController();
  activeRequest = controller;
  const current = section;
  refresh.disabled = true;
  output.setAttribute("aria-busy", "true");
  try {
    const endpoint = current === "health" ? "health" : "content";
    const path = preview ? "local/" + endpoint : "api/intelligence";
    const headers = preview ? { "X-PBC-Local": "1" } : { "X-Requested-With": "XMLHttpRequest" };
    const response = await fetch(path, { headers, cache: "no-store", redirect: "manual", signal: controller.signal });
    if (response.type === "opaqueredirect" || response.status === 401 || response.status === 403) {
      if (controller.signal.aborted) return;
      if (!preview) document.dispatchEvent(new Event("pbc-dashboard-sign-in"));
      return;
    }
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) {
      throw new Error("Content records unavailable");
    }
    const result = await response.json();
    if (controller.signal.aborted) return;
    if (!preview) {
      if (result.schema !== "pbc-content-intelligence/1") throw new Error("Unexpected snapshot schema");
      const parts = Object.fromEntries(easternDay.formatToParts(new Date()).map(({ type, value }) => [type, value]));
      Object.assign(result, { today: `${parts.year}-${parts.month}-${parts.day}`, feedback: [] });
    }
    payload = result;
    if (endpoint === "content") {
      model.from ||= ranges("7", payload.today).start;
      model.to ||= payload.today;
      byId = new Map(payload.creatives.map((i) => [i.id, i]));
      obs = new Map();
      for (const o of payload.observations) {
        if (!obs.has(o.creativeId)) obs.set(o.creativeId, []);
        obs.get(o.creativeId).push(o);
      }
      lab = experiments(payload.experiments, byId);
      for (const e of lab) for (const v of e.versions) {
        if (v.version && byId.has(v.id)) byId.get(v.id).version = v.version;
      }
    }
    render();
  } catch (error) {
    if (!controller.signal.aborted) output.replaceChildren(card("Content data unavailable", muted("Use Refresh data to retry.")));
  } finally {
    if (activeRequest === controller) {
      refresh.disabled = false;
      output.setAttribute("aria-busy", "false");
    }
  }
}

refresh.addEventListener("click", load);
document.addEventListener("pbc-dashboard-section", ({ detail }) => {
  if (section === detail) return;
  activeRequest?.abort();
  activeRequest = null;
  section = detail;
  payload = byId = obs = lab = null;
  output.replaceChildren();
  if (["content", "experiments", "health"].includes(section)) {
    output.append(muted("Reading content records…"));
    load();
  }
});
