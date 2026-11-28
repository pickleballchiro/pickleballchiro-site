const productionAnalytics = window.location.protocol === 'https:' &&
  window.location.hostname === 'pickleballchiro.co';

function trackQuiz(event, params = {}) {
  if (productionAnalytics && typeof window.gtag === 'function') {
    window.gtag('event', event, { quiz_version: quizVersion, ...params });
  }
}

function loadQuizAnalytics() {
  if (!productionAnalytics || typeof window.gtag !== 'function') return;
  const config = window.dataLayer.find(entry => entry[0] === 'config');
  if (!config || !/^G-[A-Z0-9]+$/.test(config[1])) return;

  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://www.googletagmanager.com/gtag/js?id=' + config[1];
  document.head.append(script);
}

const byId = id => document.getElementById(id);
const screens = ['intro', 'question', 'result'];
const milestones = new Set();
let currentIndex = 0;
let answerIds = {};
let completed = false;

function textElement(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function showScreen(id, focusId) {
  for (const screen of screens) byId(screen).hidden = screen !== id;
  window.scrollTo(0, 0);
  byId(focusId).focus({ preventScroll: true });
}

function showQuestion(index) {
  currentIndex = index;
  const question = quizQuestions[index];
  byId('question-area').textContent = quizAxes[question.axis];
  byId('question-position').textContent = `Question ${index + 1} of ${quizQuestions.length}`;
  byId('question-title').textContent = question.prompt;
  const help = byId('question-help');
  help.textContent = question.help || '';
  help.hidden = !question.help;
  byId('question-title').setAttribute('aria-describedby', question.help ? 'question-help' : '');
  byId('progress').max = quizQuestions.length;
  byId('progress').value = index;

  const options = [...question.options, { id: unknownAnswer, text: 'I’m not sure.' }];
  byId('answers').replaceChildren(...options.map(({ id, text }) => {
    const button = textElement('button', text, 'answer');
    button.type = 'button';
    button.setAttribute('aria-pressed', String(answerIds[question.id] === id));
    button.addEventListener('click', () => chooseAnswer(index, question.id, id));
    return button;
  }));
  showScreen('question', 'question-title');
}

function chooseAnswer(index, questionId, answerId) {
  if (currentIndex !== index || byId('question').hidden) return;
  answerIds[questionId] = answerId;

  const count = index + 1;
  if ((count === 5 || count === 10) && !milestones.has(count)) {
    milestones.add(count);
    trackQuiz('quiz_progress', { questions_completed: count });
  }
  if (count === quizQuestions.length) showResult();
  else showQuestion(count);
}

function renderPractice(plan, label) {
  const card = document.createElement('article');
  card.className = 'panel practice';
  const practice = document.createElement('p');
  practice.append(textElement('strong', 'Try this. '), textElement('span', plan.practice));

  if (label) card.append(textElement('p', label, 'eyebrow'));
  card.append(textElement('h3', plan.title), textElement('p', plan.why), practice);

  if (plan.resource) {
    const resource = quizResources[plan.resource];
    const link = textElement('a', resource.label, 'practice-resource');
    link.href = resource.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    card.append(link);
  }
  return card;
}

function renderAxis(axis) {
  const item = document.createElement('li');
  const label = document.createElement('div');
  label.className = 'profile-label';
  const name = textElement('strong', axis.label);
  name.id = 'axis-' + axis.id;
  const summary = axis.value === null
    ? 'No score yet'
    : Math.round(axis.value * 100) + '%';
  label.append(name, textElement('span', summary, 'muted'));
  item.append(label);
  if (axis.value !== null) {
    const meter = document.createElement('meter');
    meter.min = 0;
    meter.max = 1;
    meter.value = axis.value;
    meter.setAttribute('aria-labelledby', name.id);
    item.append(meter);
  }
  return item;
}

function showResult() {
  const result = assessQuiz(answerIds);
  const [first, ...others] = result.priorities;
  const plan = first ? practicePlans[first.id] : {
    title: result.status === 'insufficient' ? 'Watch for one missed shot' : 'Look at the shot before the miss',
    why: result.status === 'insufficient'
      ? 'I need to know a bit more to pick a skill for you.'
      : 'Your answers didn’t point to one skill to work on first.',
    practice: 'Next game, pick three points you lost. Think about what happened just before the miss.',
  };

  const recommendations = byId('recommendations');
  const label = result.status === 'tie' ? 'One place to start' : 'Start here';
  recommendations.replaceChildren(renderPractice(plan, label));
  if (others.length) {
    const details = document.createElement('details');
    details.className = 'panel more-practice';
    details.append(
      textElement('summary', others.length === 1 ? 'One more thing to try' : 'More things to try'),
      ...others.map(({ id }) => renderPractice(practicePlans[id])),
    );
    recommendations.append(details);
  }

  const hasScores = result.scores.some(({ value }) => value !== null);
  const hasGaps = result.scores.some(({ value }) => value === null);
  byId('radar').replaceChildren(...(hasScores ? [renderRadar(result.scores)] : []));
  const summary = byId('profile-summary');
  summary.textContent = summarizeProfile(result.scores);
  summary.hidden = !summary.textContent;
  let note = 'Higher scores show likely strengths. Lower scores show what to work on. Percentages are estimates from your answers. Shot success rates, game reviews, and DUPR ratings use other data.';
  if (!hasScores) note = 'There’s no score yet. You can still try the tip below.';
  else if (hasGaps) note += ' A dash means there’s no score yet.';
  byId('profile-note').textContent = note;
  byId('score-details').hidden = !hasScores;
  byId('profile').replaceChildren(...result.scores.map(renderAxis));

  if (!completed) {
    completed = true;
    const result_category = result.status === 'priority' ? practicePlans[first.id].category : result.status;
    trackQuiz('quiz_complete', { result_category });
  }
  showScreen('result', 'result-title');
}

byId('question-count').textContent = quizQuestions.length;
byId('start').hidden = false;
byId('start').addEventListener('click', () => {
  answerIds = {};
  completed = false;
  milestones.clear();
  byId('score-details').open = false;
  byId('send-details').open = false;
  trackQuiz('quiz_start');
  showQuestion(0);
});
byId('back').addEventListener('click', () => {
  if (currentIndex === 0) showScreen('intro', 'start');
  else showQuestion(currentIndex - 1);
});
byId('edit-answers').addEventListener('click', () => showQuestion(quizQuestions.length - 1));
byId('retake').addEventListener('click', () => showScreen('intro', 'start'));
byId('review-cta').addEventListener('click', () => trackQuiz('quiz_gameplay_review_click'));
byId('local-cta').addEventListener('click', () => trackQuiz('quiz_local_coaching_click'));
loadQuizAnalytics();
