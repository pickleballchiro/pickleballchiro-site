// TODO: Replace localStorage tracking with Plausible or Fathom for persistent analytics

// ============================================================
// CLICK TRACKING
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
});

// ============================================================
// LEAD CAPTURE FORM — Free Checklist
// ============================================================
const checklistForm = document.getElementById('checklist-form');
const checklistThankyou = document.getElementById('checklist-thankyou');

if (checklistForm) {
  checklistForm.addEventListener('submit', function (e) {
    e.preventDefault();
    const formData = new FormData(checklistForm);
    fetch('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(formData).toString()
    })
    .finally(() => {
      checklistForm.style.display = 'none';
      checklistThankyou.style.display = 'block';
    });
  });
}

// ============================================================
// VIRTUAL COACHING INTEREST FORM
// ============================================================
const coachingForm = document.getElementById('coaching-form');
const coachingThankyou = document.getElementById('coaching-thankyou');

if (coachingForm) {
  coachingForm.addEventListener('submit', function (e) {
    e.preventDefault();
    const formData = new FormData(coachingForm);
    fetch('https://formspree.io/f/maqaboey', {
            method: 'POST',
                  body: formData,
                        headers: { 'Accept': 'application/json' }
                            })
                                .then(function (res) {
                                      if (res.ok) {
                                              coachingForm.style.display = 'none';
                                                      coachingThankyou.style.display = 'block';
                                                            } else {
                                                                    alert('Something went wrong — please try again.');
                                                                          }
                                                                              })
                                                                                  .catch(function () {
                                                                                        alert('Something went wrong — please try again.');
                                                                                            });
    })
}

// ============================================================
// BOOKING ACCORDION
// ============================================================
const bookingToggle = document.getElementById('booking-toggle');
const bookingOptions = document.getElementById('booking-options');

if (bookingToggle && bookingOptions) {
  // CSS sets display:flex on .booking-options, so we must use inline style
  // (inline styles override stylesheet rules; the hidden attribute does not)
  bookingOptions.style.display = 'none';
  bookingToggle.setAttribute('aria-expanded', 'false');

  bookingToggle.addEventListener('click', function () {
    const isHidden = bookingOptions.style.display === 'none';
    if (isHidden) {
      bookingOptions.style.display = '';   // let CSS flex kick back in
      bookingToggle.setAttribute('aria-expanded', 'true');
    } else {
      bookingOptions.style.display = 'none';
      bookingToggle.setAttribute('aria-expanded', 'false');
    }
  });
}

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
