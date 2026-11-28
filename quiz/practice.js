const practicePlans = {
  serve_depth: {
    category: 'serve', resource: 'opening', mode: 'Execution',
    title: 'Start with your serve',
    why: 'A good serve buys you time for the next shot.',
    practice: 'Hit 10 serves. Aim deep, then step back.',
    before: ['third_read', 'drop_contact', 'fifth_drop', 'advance_read'],
  },
  return_depth: {
    category: 'return', resource: 'opening', mode: 'Execution',
    title: 'Send your return deeper',
    why: 'A deep return can give you more time to move up.',
    practice: 'Hit 10 returns. Aim high over the net and near the back line.',
    before: ['return_ready'],
  },
  return_ready: {
    category: 'return', resource: 'opening', mode: 'Using it in points',
    title: 'Get set after your return',
    why: 'If you’re still moving when they hit, the next ball can catch you off guard.',
    practice: 'Move up after your return. Get your feet set as they hit.',
    before: ['game_ready'],
  },
  third_read: {
    category: 'third', resource: 'third', mode: 'On-court decisions',
    title: 'Pick your third shot sooner',
    why: 'It’s hard to hit a good shot if you make up your mind late.',
    practice: 'Call “drive” or “drop” before you swing. If you’re off balance, try a soft shot.',
    before: ['advance_read', 'fifth_drop'],
  },
  fifth_drop: {
    category: 'third', resource: 'third', mode: 'Using it in points',
    title: 'Try a soft shot after a drive',
    why: 'A drive can give you an easy ball to drop into the kitchen.',
    practice: 'Hit a drive. If the next ball comes back slow and low, try a drop.',
    before: ['advance_read'],
  },
  drop_contact: {
    category: 'third', resource: 'third', mode: 'Execution',
    title: 'Find a soft drop you can repeat',
    why: 'A good drop goes over the net and lands soft.',
    practice: 'Ask for 10 easy balls. Aim for a soft drop in the kitchen.',
    before: ['advance_read'],
  },
  advance_read: {
    category: 'transition', resource: 'reset', mode: 'On-court decisions',
    title: 'Pick when to move up',
    why: 'The other team can catch you on the move.',
    practice: 'Take a step in when they have to hit up. Get set when they can hit hard.',
    before: [],
  },
  reset_touch: {
    category: 'transition', resource: 'reset', mode: 'Execution',
    title: 'Soften the ball at your feet',
    why: 'A big swing can make a fast ball pop up.',
    practice: 'Have a partner hit at your feet. Use a light grip and a small lift.',
    before: [],
  },
  split_timing: {
    category: 'footwork', resource: 'reset', mode: 'Execution',
    title: 'Get your feet ready sooner',
    why: 'If your feet are set, you can move either way.',
    practice: 'Have a partner hit a few balls to you. Get set as they hit.',
    before: ['contact_space'],
  },
  contact_space: {
    category: 'footwork', resource: 'kitchen', mode: 'Execution',
    title: 'Give yourself room to swing',
    why: 'It’s hard to hit a clean shot with the ball close to your body.',
    practice: 'Take a small step to make room. Meet the ball out in front.',
    before: [],
  },
  game_ready: {
    category: 'footwork', resource: 'reset', mode: 'Using it in points',
    title: 'Use your footwork in games',
    why: 'It’s harder to get set when you don’t know where the ball will go.',
    practice: 'For five points, focus on getting set as the other team hits.',
    before: ['contact_space'],
  },
  attack_window: {
    category: 'kitchen', resource: 'decision', mode: 'On-court decisions',
    title: 'Wait for a ball you can hit down',
    why: 'A low ball is hard to hit fast and keep in.',
    practice: 'Play low balls soft. Try to hit down when you get a high one.',
    before: ['high_finish'],
  },
  compact_hands: {
    category: 'volley', resource: 'kitchen', mode: 'Execution',
    title: 'Use a smaller swing',
    why: 'A big swing can send a fast ball up or out.',
    practice: 'When the ball comes fast, hold your paddle out front and block it back.',
    before: [],
  },
  high_finish: {
    category: 'volley', resource: 'high_ball_video', mode: 'Execution',
    title: 'Pick a spot for the high ball',
    why: 'A clear spot to aim at can help you keep the ball in.',
    practice: 'Ask for 10 high balls. Aim at your partner’s feet or an open spot.',
    before: [],
  },
};

const quizResources = {
  opening: {
    label: 'See tips for the first few shots',
    url: 'https://pickleballchiro.co/why-youre-stuck-at-3-5/#first-four-shots',
  },
  third: {
    label: 'Try the drive or drop drill',
    url: 'https://pickleballchiro.co/third-shot-drive-or-drop/#drill',
  },
  reset: {
    label: 'Try the reset drill',
    url: 'https://pickleballchiro.co/why-youre-stuck-at-3-5/#transition-zone',
  },
  decision: {
    label: 'Try a drill for when to hit hard',
    url: 'https://pickleballchiro.co/why-youre-stuck-at-3-5/#shot-selection',
  },
  high_ball_video: {
    label: 'Watch when to hit the high ball',
    url: 'https://www.youtube.com/watch?v=sDBA-iscl7I&t=68s',
  },
  kitchen: {
    label: 'See tips for play at the kitchen',
    url: 'https://pickleballchiro.co/why-youre-stuck-at-3-5/#kitchen-game',
  },
};
