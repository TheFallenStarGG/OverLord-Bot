const { FILES } = require('../config');
const { scoped, writeJson } = require('./storage');

// How much a fish or ore handed in counts for on the builders list (coins count 1 each)
const GOODS_WEIGHT = 25;

// coins + goods = what the project needs. fx = the permanent perk once it is built.
// Keys that add: fishLuck, mineLuck. Keys that multiply: xp, sell, daily, bossReward.
const PROJECTS = {
  lighthouse: {
    emoji: '🗼', name: 'Lighthouse', coins: 25000, goods: { kind: 'fish', amount: 120 },
    perk: '🎣 +15% luck for rare catches when fishing', fx: { fishLuck: 0.15 },
    blurb: 'A great beacon on the coast that guides the fishing boats to the best waters.',
  },
  minelift: {
    emoji: '⛏️', name: 'Mine Lift', coins: 25000, goods: { kind: 'ore', amount: 120 },
    perk: '⛏️ +15% luck for rare ores when mining', fx: { mineLuck: 0.15 },
    blurb: 'A huge lift that takes miners deeper than ever before.',
  },
  library: {
    emoji: '📚', name: 'Grand Library', coins: 40000, goods: { kind: 'ore', amount: 100 },
    perk: '📈 +10% XP from chatting', fx: { xp: 1.1 },
    blurb: 'A stone library full of books. Everyone who visits learns a little faster.',
  },
  market: {
    emoji: '🏛️', name: 'Royal Market', coins: 40000, goods: { kind: 'fish', amount: 100 },
    perk: '💰 Fish and ores sell for 5% more', fx: { sell: 1.05 },
    blurb: 'A busy market hall where merchants pay better prices.',
  },
  granary: {
    emoji: '🌾', name: 'Granary', coins: 30000, goods: { kind: 'fish', amount: 100 },
    perk: '🎁 `!!daily` pays 10% more', fx: { daily: 1.1 },
    blurb: 'Full storehouses mean a bigger daily ration for everyone.',
  },
  barracks: {
    emoji: '🏰', name: 'Barracks', coins: 50000, goods: { kind: 'ore', amount: 150 },
    perk: '🐉 Boss fights pay 10% more', fx: { bossReward: 1.1 },
    blurb: 'Trained soldiers and better weapons make every boss fight more rewarding.',
  },
};

const newState = () => ({ coins: 0, goods: 0, done: false, doneAt: null, contributors: {} });

const data = scoped(FILES.realm, (d) => {
  d.projects ??= {};
  for (const id of Object.keys(PROJECTS)) d.projects[id] ??= newState();
});

const save = () => writeJson(FILES.realm, data);

const built = () => Object.keys(PROJECTS).filter((id) => data.projects[id].done);

// Used by lib/modifiers.js so finished projects boost the whole realm
function realmMult(key) {
  let m = 1;
  for (const id of built()) m *= PROJECTS[id].fx[key] ?? 1;
  return m;
}
function realmBonus(key) {
  let sum = 0;
  for (const id of built()) sum += PROJECTS[id].fx[key] ?? 0;
  return sum;
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
function findProject(text) {
  const q = norm(text ?? '');
  if (!q) return null;
  const ids = Object.keys(PROJECTS);
  return ids.find((id) => id === q || norm(PROJECTS[id].name) === q) ?? ids.find((id) => norm(PROJECTS[id].name).includes(q)) ?? null;
}

const getProject = (id) => data.projects[id];

function remaining(id) {
  const p = data.projects[id];
  return {
    coins: Math.max(0, PROJECTS[id].coins - p.coins),
    goods: Math.max(0, PROJECTS[id].goods.amount - p.goods),
  };
}

// Records a contribution. Returns { completed: true } if it just finished the project.
function contribute(id, userId, { coins = 0, goods = 0 }) {
  const def = PROJECTS[id];
  const p = data.projects[id];
  p.coins += coins;
  p.goods += goods;
  p.contributors[userId] = (p.contributors[userId] ?? 0) + coins + goods * GOODS_WEIGHT;

  let completed = false;
  if (!p.done && p.coins >= def.coins && p.goods >= def.goods.amount) {
    p.done = true;
    p.doneAt = Date.now();
    completed = true;
  }
  save();
  return { completed };
}

function topContributors(id, count = 5) {
  return Object.entries(data.projects[id].contributors)
    .map(([userId, value]) => ({ userId, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, count);
}

module.exports = { PROJECTS, realmMult, realmBonus, findProject, getProject, remaining, contribute, topContributors };
