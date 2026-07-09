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

  // Touch swipe (left/right) — pause while a finger is down
  var startX = null;
  track.addEventListener('touchstart', function (e) { startX = e.touches[0].clientX; stop(); }, { passive: true });
  track.addEventListener('touchend', function (e) {
    if (startX === null) { restart(); return; }
    var dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 40) { dx < 0 ? next() : prev(); }
    restart();
    startX = null;
  });

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
