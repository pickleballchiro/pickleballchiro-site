const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const read = name => fs.readFileSync(path.join(__dirname, '../quiz', name), 'utf8');
const scoring = ['content.js', 'practice.js', 'scoring.js'].map(read).join('\n');
const data = vm.runInNewContext(scoring + '\n({ quizQuestions, practicePlans, quizResources, quizAxes, quizCompetencies, assessQuiz })');
const { quizQuestions, practicePlans, quizResources, quizAxes, quizCompetencies, assessQuiz } = data;
const best = Object.fromEntries(quizQuestions.map(q => [q.id, q.options.find(a => a.score === 2).id]));

test('all 15 questions have stable answer IDs and complete, reachable practice plans', () => {
  assert.equal(quizQuestions.length, 15);
  assert.equal(new Set(quizQuestions.map(q => q.id)).size, quizQuestions.length);
  const used = new Set();
  for (const q of quizQuestions) {
    assert.ok(Object.hasOwn(quizAxes, q.axis));
    assert.equal(new Set(q.options.map(a => a.id)).size, q.options.length);
    assert.equal(q.options.filter(a => a.score === 2).length, 1);
    for (const answer of q.options) {
      assert.ok([0, 1, 2].includes(answer.score));
      assert.notEqual(answer.id, 'unknown');
      if (answer.priority) {
        assert.ok(Object.hasOwn(practicePlans, answer.priority), q.id);
        assert.ok(answer.strength > 0 && answer.strength <= 2 - answer.score);
        used.add(answer.priority);
      } else {
        assert.equal(answer.strength, 0);
      }
    }
  }
  assert.equal(used.size, Object.keys(practicePlans).length);
  for (const [id, plan] of Object.entries(practicePlans)) {
    for (const field of ['title', 'mode', 'why', 'practice']) assert.ok(plan[field], id + ': ' + field);
    assert.ok(Object.hasOwn(quizResources, plan.resource));
    assert.ok(quizCompetencies.some(competency => competency.id === plan.category));
    for (const next of plan.before) assert.ok(used.has(next) && next !== id);
  }
});

test('same return score distinguishes depth from readiness and preserves the answer', () => {
  const depth = assessQuiz({ ...best, return: 'short' });
  const readiness = assessQuiz({ ...best, return_setup: 'rush' });
  assert.equal(depth.scores.find(score => score.id === 'return').value, readiness.scores.find(score => score.id === 'return').value);
  assert.equal(depth.priorities[0].id, 'return_depth');
  assert.equal(readiness.priorities[0].id, 'return_ready');
  assert.equal(readiness.priorities[0].evidence[0].answerId, 'rush');
});

test('a missed split in practice yields a different plan from losing it in games', () => {
  const practice = assessQuiz({ ...best, transfer: 'both' });
  const live = assessQuiz({ ...best, transfer: 'game' });
  assert.equal(practice.priorities[0].id, 'split_timing');
  assert.equal(live.priorities[0].id, 'game_ready');
  const decision = assessQuiz({ ...best, third_follow: 'drive_again' });
  assert.equal(decision.priorities[0].evidence[0].mode, 'On-court decisions');
});

test('equally strong related patterns prioritize the earlier movement problem', () => {
  const result = assessQuiz({ ...best, transfer: 'both', reset: 'jammed' });
  assert.equal(result.status, 'priority');
  assert.equal(result.upstream, true);
  assert.equal(result.priorities[0].id, 'split_timing');
});

test('unrelated ties stay visible and stronger signals still lead', () => {
  const tie = assessQuiz({ ...best, serve: 'miss', kitchen_finish: 'hard' });
  assert.equal(tie.status, 'tie');
  assert.deepEqual(Array.from(tie.priorities, p => p.id), ['serve_depth', 'high_finish']);
  const stronger = assessQuiz({ ...best, transfer: 'both', reset: 'popped', kitchen_defend: 'caught', spacing: 'jammed' });
  assert.equal(stronger.upstream, undefined);
  assert.equal(stronger.priorities[0].id, 'contact_space');
});

test('strong or marginal answers do not manufacture a weakness', () => {
  assert.equal(assessQuiz(best).status, 'no_clear_priority');
  assert.equal(assessQuiz({ ...best, serve: 'short' }).status, 'no_clear_priority');
  const low = Object.fromEntries(quizQuestions.map(q => [q.id, q.options.find(a => a.score === 0).id]));
  assert.notEqual(assessQuiz(low).status, 'no_clear_priority');
});

test('getting stuck supports a diagnosis without assigning one by itself', () => {
  const stuck = assessQuiz({ ...best, advance: 'often' });
  assert.equal(stuck.status, 'no_clear_priority');
  assert.equal(stuck.scores.find(score => score.id === 'transition').value, 0.75);
  assert.equal(stuck.scores.find(score => score.id === 'decisions').value, 1);

  const confirmed = assessQuiz({ ...best, advance: 'often', advance_live: 'fixed' });
  assert.equal(confirmed.priorities[0].id, 'advance_read');
  assert.equal(confirmed.priorities[0].strength, 3);
});

test('unknowns reduce coverage, not scores, and very sparse axes have no meter value', () => {
  const result = assessQuiz({ ...best, serve: 'unknown', return_setup: 'rush' });
  assert.equal(result.scores.find(score => score.id === 'serve').value, null);
  assert.equal(result.scores.find(score => score.id === 'return').value, 0.5);
  const sparse = assessQuiz({ serve: 'miss', return_setup: 'rush', transfer: 'game' });
  assert.equal(sparse.status, 'insufficient');
  assert.equal(sparse.priorities.length, 0);
  assert.equal(sparse.scores.find(axis => axis.id === 'footwork').value, null);
});

test('eight distinct competencies use only the assigned questions', () => {
  assert.equal(quizCompetencies.length, 8);
  const items = new Set(quizQuestions.map(q => q.id));
  for (const competency of quizCompetencies) {
    assert.ok(competency.items.length >= 2);
    assert.equal(new Set(competency.items).size, competency.items.length);
    assert.ok(competency.items.every(id => items.has(id)));
  }
  const profile = assessQuiz({ ...best, serve: 'miss', serve_recovery: 'inside', kitchen_finish: 'safe' });
  const byId = Object.fromEntries(profile.scores.map(s => [s.id, s.value]));
  assert.equal(byId.serve, 0);
  assert.equal(byId.return, 1);
  assert.equal(byId.third, 1);
  assert.equal(byId.volley, 0.75);
});

function mockSvgElement(tag) {
  return {
    tag, attributes: {}, children: [],
    classList: { add() {} },
    setAttribute(name, value) { this.attributes[name] = value; },
    append(child) { this.children.push(child); },
  };
}

test('radar breaks the outline and leaves a dash for an unknown competency', () => {
  const radar = vm.runInNewContext(read('profile.js') + '\nrenderRadar', {
    document: { createElementNS: (_, tag) => mockSvgElement(tag) },
  });
  const scores = assessQuiz({ ...best, serve: 'unknown' }).scores;
  const elements = radar(scores).children;
  assert.equal(elements.filter(el => el.tag === 'circle').length, 7);
  assert.ok(elements.some(el => el.attributes.class === 'radar-partial'));
  assert.ok(!elements.some(el => el.attributes.class === 'radar-profile'));
  assert.ok(elements.some(el => el.textContent === '—'));
});

function simulateQuiz(location) {
  const elements = new Map();
  const handlers = new Map();
  const sent = [];
  const scripts = [];
  function element() {
    return { append() {}, focus() {}, replaceChildren() {}, setAttribute() {}, addEventListener() {} };
  }
  const document = {
    createElement: element,
    createElementNS: (_, tag) => mockSvgElement(tag),
    head: { append: script => scripts.push(script.src) },
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, { ...element(), addEventListener: (event, callback) => handlers.set(id + ':' + event, callback) });
      }
      return elements.get(id);
    },
  };
  const window = {
    location, scrollTo() {}, gtag: (...args) => sent.push(args),
    dataLayer: [['config', 'G-TEST']],
  };
  const script = scoring + '\n' + read('profile.js') + '\n' + read('quiz.js') + '\n({ chooseAnswer, showQuestion, quizQuestions })';
  const app = vm.runInNewContext(script, { document, window });
  const click = id => handlers.get(id + ':click')();
  click('start');
  app.quizQuestions.forEach(({ id, options }, index) => {
    const answerId = options.find(option => option.score === 2).id;
    app.chooseAnswer(index, id, answerId);
    if (index === 4 || index === 14) {
      app.showQuestion(index);
      app.chooseAnswer(index, id, answerId);
    }
  });
  click('review-cta');
  click('local-cta');
  return { sent: JSON.parse(JSON.stringify(sent)), scripts };
}

test('analytics are versioned, deduplicate milestones, and send no answers or results', () => {
  const { sent, scripts } = simulateQuiz({ protocol: 'https:', hostname: 'pickleballchiro.co' });
  assert.equal(scripts.length, 1);
  assert.deepEqual(sent, [
    ['event', 'quiz_start', { quiz_version: 'v2.2' }],
    ['event', 'quiz_progress', { quiz_version: 'v2.2', questions_completed: 5 }],
    ['event', 'quiz_progress', { quiz_version: 'v2.2', questions_completed: 10 }],
    ['event', 'quiz_complete', { quiz_version: 'v2.2', result_category: 'no_clear_priority' }],
    ['event', 'quiz_gameplay_review_click', { quiz_version: 'v2.2' }],
    ['event', 'quiz_local_coaching_click', { quiz_version: 'v2.2' }],
  ]);
  assert.deepEqual(simulateQuiz({ protocol: 'http:', hostname: '127.0.0.1' }), { sent: [], scripts: [] });
});

test('profile summary handles tied scores and omits unanswered skills', () => {
  const summarizeProfile = vm.runInNewContext(read('profile.js') + '\nsummarizeProfile');
  const score = (label, value) => ({ label, value });
  const selection = score('Shot selection', 1);
  const transition = score('Transition', null);
  const serve = score('Serve', 1);
  const returns = score('Return', 0.5);
  const volleys = score('Volleys', 0.5);
  assert.equal(summarizeProfile([transition]), '');
  assert.equal(summarizeProfile([selection, transition]), 'Only your shot selection has a score so far.');
  assert.equal(summarizeProfile([selection, transition, serve]), 'Your scored skills look about the same.');
  assert.equal(summarizeProfile([selection, transition, returns, volleys]), 'Your shot selection looks strongest, and your return and volleys may need work.');
  assert.equal(summarizeProfile([selection, serve, score('Footwork', 1), returns, transition]), 'Several skills share your top score, and your return may need work.');
});
