// ============================================================
// CLICK TRACKING
// Every element with a data-track attribute logs a click event
// to localStorage (viewable at /stats.html) AND to GA4.
// ============================================================
document.addEventListener('click', function (e) {
  const target = e.target.closest('[data-track]');
  if (!target) return;
  const label = target.getAttribute('data-track');
  const event = { event: 'click', label: label, timestamp: new Date().toISOString() };
  console.log('[Pickleball Chiro Analytics]', event);
  const stored = JSON.parse(localStorage.getItem('pb_events') || '[]');
  stored.push(event);
  localStorage.setItem('pb_events', JSON.stringify(stored));
  if (typeof window.gtag === 'function') {
    window.gtag('event', 'cta_click', { label: label });
  }
});

// ============================================================
// SCROLL FADE-IN — Intersection Observer (no external libraries)
// ============================================================
(function () {
  var fadeEls = document.querySelectorAll('.fade-up');
  if (!fadeEls.length) return;

  // Fallback: if IntersectionObserver not supported, just show everything
  if (!('IntersectionObserver' in window)) {
    fadeEls.forEach(function (el) { el.classList.add('visible'); });
    return;
  }

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });

  fadeEls.forEach(function (el) {
    // Elements already visible on load get .visible immediately (no animation)
    var rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight) {
      el.classList.add('visible');
    } else {
      observer.observe(el);
    }
  });
})();

// ============================================================
// HIGHLIGHTS CAROUSEL — auto-rotates, with arrows, dots, swipe,
// and pause-on-hover/touch so photos can actually be looked at.
// ============================================================
(function () {
  var track = document.getElementById('hl-track');
  var dotsWrap = document.getElementById('hl-dots');
  var root = document.getElementById('hl-carousel');
  if (!track || !dotsWrap || !root) return;

  var slides = track.children;
  var n = slides.length;

  var idx = 0, timer = null;
  var DELAY = 4500; // auto-rotate every 4.5s

  // Build the dot buttons
  var dots = [];
  for (var i = 0; i < n; i++) {
    (function (i) {
      var d = document.createElement('button');
      d.className = 'car-dot';
      d.type = 'button';
      d.setAttribute('aria-label', 'Go to highlight ' + (i + 1));
      d.addEventListener('click', function () { go(i); restart(); });
      dotsWrap.appendChild(d);
      dots.push(d);
    })(i);
  }

  function render() {
    track.style.transform = 'translateX(' + (-idx * 100) + '%)';
    for (var j = 0; j < dots.length; j++) {
      dots[j].classList.toggle('active', j === idx);
    }
  }
  function go(i) { idx = (i + n) % n; render(); }
  function next() { go(idx + 1); }
  function prev() { go(idx - 1); }
  function stop() { clearInterval(timer); timer = null; }
  function restart() { stop(); timer = setInterval(next, DELAY); }

  root.querySelector('.next').addEventListener('click', function () { next(); restart(); });
  root.querySelector('.prev').addEventListener('click', function () { prev(); restart(); });

  // Pause while the pointer is over the carousel; resume on leave
  root.addEventListener('mouseenter', stop);
  root.addEventListener('mouseleave', restart);

  // Touch drag: the track follows the finger 1:1, then settles on the nearest
  // slide, using release velocity to decide (a short fast flick counts). Grabbing
  // mid-settle picks the track up where it is on screen rather than where it was
  // headed. Vertical movement is left to native scroll (touch-action: pan-y).
  var HYST = 10;            // px before a touch commits to horizontal
  var drag = null;

  function liveX() {
    var m = new DOMMatrix(getComputedStyle(track).transform);
    return m.m41;
  }

  track.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse') return;   // desktop keeps arrows + dots
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, base: liveX(),
             live: false, hist: [{ x: e.clientX, t: e.timeStamp }] };
    stop();
  });

  track.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    var dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.live) {
      if (Math.abs(dx) < HYST && Math.abs(dy) < HYST) return;
      if (Math.abs(dy) > Math.abs(dx)) { drag = null; restart(); return; }  // it's a scroll
      drag.live = true;
      track.classList.add('dragging');
      track.style.transform = 'translateX(' + drag.base + 'px)';  // freeze at live position
      try { track.setPointerCapture(e.pointerId); } catch (err) {}
    }
    drag.hist.push({ x: e.clientX, t: e.timeStamp });
    if (drag.hist.length > 6) drag.hist.shift();
    track.style.transform = 'translateX(' + (drag.base + dx) + 'px)';
  });

  function release(e, cancelled) {
    if (!drag || e.pointerId !== drag.id) return;
    var d = drag; drag = null;
    if (!d.live) { restart(); return; }
    track.classList.remove('dragging');
    var width = root.clientWidth;
    var dx = e.clientX - d.x0;
    // Velocity from the last 100ms only: a finger that paused before lifting
    // is not a flick.
    var recent = d.hist.filter(function (p) { return e.timeStamp - p.t <= 100; });
    var first = recent[0], last = recent[recent.length - 1];
    var v = recent.length > 1 && last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0;  // px/ms
    // Where the flick is headed: position plus ~100ms of carried velocity.
    var projected = cancelled ? 0 : dx + v * 100;
    var step = Math.abs(projected) > width * 0.2 ? (projected < 0 ? 1 : -1) : 0;
    // Settle from wherever the finger left the track.
    track.style.transition = '';
    go(idx + step);
  }
  track.addEventListener('pointerup', function (e) { release(e, false); restart(); });
  track.addEventListener('pointercancel', function (e) { release(e, true); restart(); });

  render();
  restart();
})();

// ============================================================
// STICKY BAR DISMISS LOGIC
// ============================================================
(function () {
  var bar = document.getElementById('sticky-cta-bar');
  var dismissBtn = document.getElementById('sticky-cta-dismiss');
  if (!bar || !dismissBtn) return;

  if (sessionStorage.getItem('checklistBarDismissed') === 'true') {
    bar.style.display = 'none';
    return;
  }

  dismissBtn.addEventListener('click', function () {
    bar.style.display = 'none';
    sessionStorage.setItem('checklistBarDismissed', 'true');
  });
})();
