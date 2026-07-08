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
