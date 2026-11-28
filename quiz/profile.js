function renderRadar(scores) {
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  svg.setAttribute('viewBox', '0 0 360 305');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('radar');

  const draw = (tag, attributes, text) => {
    const element = document.createElementNS(namespace, tag);
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    if (text) element.textContent = text;
    svg.append(element);
  };

  const center = { x: 180, y: 150 };
  const point = (index, radius) => {
    const angle = index * 2 * Math.PI / scores.length;
    return { x: center.x + Math.sin(angle) * radius, y: center.y - Math.cos(angle) * radius };
  };
  const polygon = points => points.map(({ x, y }) => x + ',' + y).join(' ');
  const radius = 99;
  for (const scale of [0.25, 0.5, 0.75, 1]) {
    draw('polygon', { points: polygon(scores.map((_, i) => point(i, radius * scale))), class: 'radar-ring' });
  }
  scores.forEach((score, i) => {
    const edge = point(i, radius);
    draw('line', {
      x1: center.x, y1: center.y, x2: edge.x, y2: edge.y,
      class: score.value === null ? 'radar-spoke radar-missing' : 'radar-spoke',
    });
  });

  const values = scores.map((score, i) => score.value === null ? null : point(i, radius * score.value));
  if (values.every(Boolean)) {
    draw('polygon', { points: polygon(values), class: 'radar-profile' });
  } else {
    values.forEach((value, i) => {
      const next = values[(i + 1) % values.length];
      if (!value || !next) return;
      draw('line', { x1: value.x, y1: value.y, x2: next.x, y2: next.y, class: 'radar-partial' });
    });
  }
  const plotted = new Set();
  values.forEach(value => {
    if (!value) return;
    const key = value.x + ',' + value.y;
    if (plotted.has(key)) return;
    plotted.add(key);
    draw('circle', { cx: value.x, cy: value.y, r: 4, class: 'radar-point' });
  });

  scores.forEach((score, i) => {
    const position = point(i, radius + 17);
    const align = Math.abs(position.x - center.x) < 1 ? 'middle' : position.x > center.x ? 'start' : 'end';
    const rows = score.short.length > 10 ? score.short.split(' ') : [score.short];
    rows.forEach((row, rowIndex) => {
      draw('text', {
        x: position.x, y: position.y + 13 * rowIndex,
        'text-anchor': align, 'dominant-baseline': 'middle',
        class: score.value === null ? 'radar-label radar-label-missing' : 'radar-label',
      }, row);
    });
    draw('text', {
      x: position.x, y: position.y + 13 * rows.length + 1,
      'text-anchor': align, 'dominant-baseline': 'middle',
      class: score.value === null ? 'radar-label-missing' : 'radar-value',
    }, score.value === null ? '—' : Math.round(score.value * 100) + '%');
  });
  return svg;
}


function summarizeProfile(scores) {
  const rated = scores.filter(({ value }) => value !== null)
    .map(({ label, value }) => ({ name: label.toLowerCase(), percent: Math.round(value * 100) }));
  if (!rated.length) return '';
  if (rated.length === 1) return 'Only your ' + rated[0].name + ' has a score so far.';

  const highest = Math.max(...rated.map(({ percent }) => percent));
  const lowest = Math.min(...rated.map(({ percent }) => percent));
  if (highest === lowest) return 'Your scored skills look about the same.';

  const top = rated.filter(({ percent }) => percent === highest);
  const bottom = rated.filter(({ percent }) => percent === lowest);
  const names = skills => skills.map(({ name }) => name).join(' and ');
  const strength = top.length > 2 ? 'Several skills share your top score'
    : 'Your ' + names(top) + (top.length === 1 ? ' looks' : ' look') + ' strongest';
  const growth = bottom.length > 2 ? 'several skills may need work' : 'your ' + names(bottom) + ' may need work';
  return strength + ', and ' + growth + '.';
}
