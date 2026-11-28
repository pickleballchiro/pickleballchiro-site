const quizVersion = 'v2.2';
const unknownAnswer = 'unknown';
const maxItemScore = 2;
const minCompetencyAnswers = 2;
const minTotalAnswers = 9;
const minCoveredCompetencies = 3;

function assessQuiz(answerIds) {
  const scored = new Map();
  const signals = new Map();

  for (const question of quizQuestions) {
    const answer = question.options.find(({ id }) => id === answerIds[question.id]);
    if (!answer) continue;
    scored.set(question.id, answer.score);
    if (!answer.priority) continue;

    if (!signals.has(answer.priority)) {
      signals.set(answer.priority, { id: answer.priority, strength: 0, evidence: [] });
    }
    const signal = signals.get(answer.priority);
    signal.strength += answer.strength;
    signal.evidence.push({
      questionId: question.id,
      prompt: question.prompt,
      answerId: answer.id,
      text: answer.text,
      mode: question.decision ? 'On-court decisions' : practicePlans[answer.priority].mode,
    });
  }

  const scores = quizCompetencies.map(({ id, label, short, items }) => {
    const points = items.filter(item => scored.has(item)).map(item => scored.get(item));
    const answered = points.length;
    const value = answered >= minCompetencyAnswers
      ? points.reduce((sum, score) => sum + score, 0) / (answered * maxItemScore)
      : null;
    return { id, label, short, answered, total: items.length, value };
  });
  const answered = scored.size;
  const covered = scores.filter(competency => competency.value !== null).length;
  if (answered < minTotalAnswers || covered < minCoveredCompetencies) {
    return { status: 'insufficient', answered, scores, priorities: [] };
  }

  const ranked = [...signals.values()].sort((a, b) => b.strength - a.strength);
  if (!ranked.length || ranked[0].strength < 2) {
    return { status: 'no_clear_priority', answered, scores, priorities: [] };
  }

  const leaders = ranked.filter(signal => signal.strength === ranked[0].strength);
  if (leaders.length === 1) {
    return { status: 'priority', answered, scores, priorities: leaders };
  }

  // Apply the order of operations only to equally strong, explicitly related signals.
  const upstream = leaders.filter(signal => leaders.every(other =>
    other.id === signal.id || practicePlans[signal.id].before.includes(other.id)
  ));
  if (upstream.length === 1) {
    return { status: 'priority', answered, scores, priorities: upstream, upstream: true };
  }

  return { status: 'tie', answered, scores, priorities: leaders };
}
