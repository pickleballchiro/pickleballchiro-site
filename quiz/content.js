const quizAxes = {
  opening: 'Serve & return',
  third: 'Third shot',
  transition: 'Move to the kitchen',
  movement: 'Footwork',
  kitchen: 'At the kitchen',
};

const quizCompetencies = [
  { id: 'serve', label: 'Serve', short: 'Serve', items: ['serve', 'serve_recovery'] },
  { id: 'return', label: 'Return', short: 'Return', items: ['return', 'return_setup'] },
  { id: 'third', label: 'Third shot', short: 'Third shot', items: ['third_read', 'third_live'] },
  { id: 'transition', label: 'Transition', short: 'Transition', items: ['third_follow', 'advance', 'advance_live', 'reset'] },
  { id: 'footwork', label: 'Footwork', short: 'Footwork', items: ['spacing', 'transfer'] },
  { id: 'decisions', label: 'Shot selection', short: 'Shot selection', items: ['third_read', 'third_follow', 'kitchen_attack'] },
  { id: 'kitchen', label: 'Kitchen play', short: 'Kitchen play', items: ['kitchen_attack', 'kitchen_defend', 'kitchen_finish'] },
  { id: 'volley', label: 'Volleys', short: 'Volleys', items: ['kitchen_defend', 'kitchen_finish'] },
];

function option(id, text, score, priority = null, strength = priority ? 2 - score : 0) {
  return { id, text, score, priority, strength };
}

const quizQuestions = [
  {
    id: 'serve', axis: 'opening', prompt: 'Where do most of your serves go?',
    options: [
      option('steady', 'Deep in the box.', 2),
      option('short', 'In, but often short.', 1, 'serve_depth'),
      option('miss', 'I miss a lot.', 0, 'serve_depth'),
    ],
  },
  {
    id: 'serve_recovery', axis: 'opening', prompt: 'What do you do after you serve?',
    options: [
      option('ready', 'I stay back and get ready.', 2),
      option('inconsistent', 'I stay back but feel slow to get set.', 1, 'serve_depth'),
      option('inside', 'I step in and have to back up.', 0, 'serve_depth'),
    ],
  },
  {
    id: 'return', axis: 'opening', prompt: 'Where do most of your returns land?',
    options: [
      option('deep', 'Deep in the court.', 2),
      option('mixed', 'Near the middle of the court.', 1, 'return_depth'),
      option('short', 'Short, or I miss.', 0, 'return_depth'),
    ],
  },
  {
    id: 'return_setup', axis: 'opening', prompt: 'What happens after you return a serve?',
    options: [
      option('set', 'I move up and get set.', 2),
      option('rush', 'I’m still moving when they hit.', 0, 'return_ready'),
      option('stay', 'I stay back.', 1, 'return_ready'),
    ],
  },
  {
    id: 'third_read', axis: 'third', decision: true, prompt: 'How do you pick your third shot?',
    options: [
      option('read', 'I go by the ball I get.', 2),
      option('same', 'I stick with my usual shot.', 1, 'third_read'),
      option('rush', 'I feel rushed and just swing.', 0, 'third_read'),
    ],
  },
  {
    id: 'third_follow', axis: 'third', decision: true, prompt: 'What happens after you hit a drive?',
    options: [
      option('drop', 'I play the next ball soft if I can.', 2),
      option('drive_again', 'I hit it hard again.', 0, 'fifth_drop'),
      option('move_first', 'I rush in and get caught on the move.', 0, 'advance_read'),
    ],
  },
  {
    id: 'third_live', axis: 'third', prompt: 'How does your third-shot drop go?',
    options: [
      option('held_up', 'It often lands in the kitchen.', 2),
      option('contact', 'It pops up or hits the net.', 0, 'drop_contact'),
      option('under_pressure', 'It works in drills, but I drive in games.', 0, 'fifth_drop'),
    ],
  },
  {
    id: 'advance', axis: 'transition', prompt: 'How often do you get stuck in the transition zone?',
    help: 'That’s the space between the baseline and the kitchen.',
    options: [
      option('rarely', 'Hardly ever.', 2),
      option('sometimes', 'Now and then.', 1),
      option('often', 'A lot.', 0, 'advance_read', 1),
    ],
  },
  {
    id: 'advance_live', axis: 'transition', prompt: 'When do you move up to the kitchen?',
    options: [
      option('read', 'When my shot stays low.', 2),
      option('fixed', 'I go as soon as I hit.', 0, 'advance_read'),
      option('late', 'I try, but I often get there late.', 1, 'game_ready'),
    ],
  },
  {
    id: 'reset', axis: 'transition', prompt: 'What happens when a fast ball comes at your feet?',
    options: [
      option('lift', 'I get it back soft and low.', 2),
      option('jammed', 'I can’t get my feet set.', 0, 'contact_space'),
      option('popped', 'It pops up or hits the net.', 0, 'reset_touch'),
      option('variable', 'Some stay low. Some pop up.', 1, 'reset_touch'),
    ],
  },
  {
    id: 'spacing', axis: 'movement', prompt: 'How often do you feel jammed on a forehand?',
    options: [
      option('front', 'Hardly ever.', 2),
      option('sometimes', 'Now and then.', 1, 'contact_space'),
      option('jammed', 'A lot.', 0, 'contact_space'),
    ],
  },
  {
    id: 'transfer', axis: 'movement', prompt: 'When do you get caught with your feet moving?',
    options: [
      option('steady', 'Hardly ever.', 2),
      option('game', 'Mostly in games. In drills I’m fine.', 0, 'game_ready'),
      option('both', 'In drills and in games.', 0, 'split_timing'),
    ],
  },
  {
    id: 'kitchen_attack', axis: 'kitchen', decision: true, prompt: 'At the kitchen, which balls do you hit hard?',
    options: [
      option('change', 'Mostly balls above the net.', 2),
      option('both_hard', 'Even balls below the net.', 0, 'attack_window'),
      option('both_soft', 'I keep almost every ball soft.', 1, 'attack_window'),
    ],
  },
  {
    id: 'kitchen_defend', axis: 'kitchen', prompt: 'At the kitchen, what happens when a hard ball comes at you?',
    options: [
      option('settled', 'I get it back low.', 2),
      option('caught', 'It jams me up.', 0, 'contact_space'),
      option('big_swing', 'I swing and it flies up or out.', 0, 'compact_hands'),
      option('mixed', 'I block it back, but it pops up.', 1, 'compact_hands'),
    ],
  },
  {
    id: 'kitchen_finish', axis: 'kitchen', prompt: 'What happens when you get a high ball at the kitchen?',
    options: [
      option('finishing', 'I hit it down or into open space.', 2),
      option('hard', 'I hit it out or into the net.', 0, 'high_finish'),
      option('safe', 'I tap it back soft.', 1, 'high_finish'),
    ],
  },
];
