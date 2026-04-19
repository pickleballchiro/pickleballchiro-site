// TODO: Replace localStorage tracking with Plausible or Fathom for persistent analytics

// ============================================================
// CLICK TRACKING
// ============================================================
document.addEventListener('click', function (e) {
  const target = e.target.closest('[data-track]');
  if (!target) return;

  const label = target.getAttribute('data-track');
  const event = {
    event: 'click',
    label: label,
    timestamp: new Date().toISOString()
  };

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
    // TODO: Connect to email service (ConvertKit, Mailchimp, etc.)
    checklistForm.style.display = 'none';
    checklistThankyou.style.display = 'block';
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
    // TODO: Connect to email service (ConvertKit, Mailchimp, etc.)
    coachingForm.style.display = 'none';
    coachingThankyou.style.display = 'block';
  });
}

// ============================================================
// BOOKING ACCORDION
// ============================================================
const bookingToggle = document.getElementById('booking-toggle');
const bookingOptions = document.getElementById('booking-options');

if (bookingToggle && bookingOptions) {
  bookingToggle.addEventListener('click', function () {
    const isExpanded = bookingToggle.getAttribute('aria-expanded') === 'true';
    bookingToggle.setAttribute('aria-expanded', String(!isExpanded));
    if (isExpanded) {
      bookingOptions.setAttribute('hidden', '');
    } else {
      bookingOptions.removeAttribute('hidden');
      // Smooth scroll so first option is visible
      setTimeout(function () {
        bookingOptions.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 50);
    }
  });
}
