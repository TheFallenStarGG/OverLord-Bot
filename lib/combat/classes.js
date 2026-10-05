// atk = [min, max] damage of a basic attack. crit = crit chance.
const CLASSES = {
  warrior: {
    name: 'Warrior',
    emoji: '⚔️',
    hp: 120,
    atk: [12, 20],
    crit: 0.1,
    blurb: 'Tough and steady, with big hits and a strong shield.',
    specials: [
      { id: 'power', name: 'Power Strike', emoji: '💥', cost: 3, desc: '1.8× damage' },
      { id: 'wall', name: 'Shield Wall', emoji: '🛡️', cost: 2, desc: 'Block this round + a 20 HP shield' },
    ],
    boss: { id: 'rally', name: 'Rally', emoji: '📣', desc: 'Everyone deals +20% damage for 15 seconds' },
  },
  rogue: {
    name: 'Rogue',
    emoji: '🥷',
    hp: 90,
    atk: [10, 18],
    crit: 0.25,
    blurb: 'Fragile but deadly, with lots of crits and poison.',
    specials: [
      { id: 'backstab', name: 'Backstab', emoji: '🗡️', cost: 3, desc: '1.5× damage that ignores blocks' },
      { id: 'poison', name: 'Poison Dart', emoji: '☠️', cost: 2, desc: '5 damage + poison for 3 rounds' },
    ],
    boss: { id: 'exploit', name: 'Exploit', emoji: '🎯', desc: 'Your next hit deals triple damage' },
  },
  mage: {
    name: 'Mage',
    emoji: '🔮',
    hp: 80,
    atk: [9, 15],
    crit: 0.1,
    blurb: 'A glass cannon with burning and stunning spells.',
    specials: [
      { id: 'fireball', name: 'Fireball', emoji: '🔥', cost: 3, desc: '1.7× damage + burn for 2 rounds' },
      { id: 'frost', name: 'Frost Bolt', emoji: '❄️', cost: 2, desc: 'Damage that stuns unless blocked' },
    ],
    boss: { id: 'burst', name: 'Arcane Burst', emoji: '✨', desc: 'A huge instant hit' },
  },
  cleric: {
    name: 'Cleric',
    emoji: '🩹',
    hp: 110,
    atk: [9, 15],
    crit: 0.1,
    blurb: 'A sturdy healer who drains life from enemies.',
    specials: [
      { id: 'smite', name: 'Smite', emoji: '☀️', cost: 3, desc: '1.5× damage, heal half of it' },
      { id: 'heal', name: 'Heal', emoji: '💚', cost: 2, desc: 'Heal 30 HP and cleanse poison/burn' },
    ],
    boss: { id: 'cleanse', name: 'Cleanse', emoji: '💚', desc: 'Removes every stun in the raid' },
  },
};

// Every arena has the same defaults unless it changes them.
const ARENA_DEFAULTS = { cheerNeed: 3, guardEnergy: 1, healMult: 1 };
const ARENAS = [
  {
    name: 'Colosseum', emoji: '🏟️', desc: 'The crowd is loud: cheers power fighters up twice as fast.',
    cheerNeed: 2,
  },
  {
    name: 'Lava Pit', emoji: '🌋', desc: 'The heat hurts: both fighters lose 4 HP every round.',
    end(game, lines) {
      game.fighters.forEach((f) => (f.hp -= 4));
      lines.push('🌋 The heat scorches both fighters (−4 HP each).');
    },
  },
  {
    name: 'Frozen Lake', emoji: '❄️', desc: 'Slippery footing: a successful block gives +2 energy.',
    guardEnergy: 2,
  },
  {
    name: 'Storm Plains', emoji: '⛈️', desc: 'Each round there\'s a 30% chance lightning strikes a random fighter for 10.',
    end(game, lines) {
      if (Math.random() >= 0.3) return;
      const f = game.fighters[Math.floor(Math.random() * 2)];
      f.hp -= 10;
      lines.push(`⚡ Lightning strikes **${f.name}** for 10 damage!`);
    },
  },
  {
    name: 'Haunted Forest', emoji: '🌲', desc: 'Cursed ground: healing is only half as effective.',
    healMult: 0.5,
  },
].map((a) => ({ ...ARENA_DEFAULTS, ...a }));

module.exports = { CLASSES, ARENAS };
