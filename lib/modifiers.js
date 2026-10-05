const { EmbedBuilder } = require('discord.js');
const { FILES } = require('../config');
const { readJson, writeJson } = require('./storage');

const HOUR = 60 * 60 * 1000;
const TREASURY_GOAL = 20000;

// fx = what it changes: work / xp / daily multiply, robChance adds, robBan blocks !!rob
const DECREES = {
  industry: { emoji: '⚒️', name: 'Decree of Industry', desc: '`!!work` pays **double**.', ms: HOUR, good: true, weight: 2, fx: { work: 2 } },
  wisdom: { emoji: '📚', name: 'Decree of Wisdom', desc: 'Chatting earns **double XP**.', ms: HOUR, good: true, weight: 2, fx: { xp: 2 } },
  largesse: { emoji: '🎁', name: 'Decree of Largesse', desc: '`!!daily` pays **50% more**.', ms: 3 * HOUR, good: true, weight: 2, fx: { daily: 1.5 } },
  peace: { emoji: '🕊️', name: 'Decree of Peace', desc: '`!!rob` is **forbidden**. Keep your coins safe!', ms: 2 * HOUR, good: true, weight: 2, fx: { robBan: true } },
  plunder: { emoji: '🏴‍☠️', name: 'Decree of Plunder', desc: 'Robberies are **15% more likely** to succeed.', ms: HOUR, good: true, weight: 2, fx: { robChance: 0.15 } },
  austerity: { emoji: '📉', name: 'Decree of Austerity', desc: '`!!work` pays **half**. The Overlord needs funds.', ms: HOUR, good: false, weight: 1, fx: { work: 0.5 } },
};
const DEFS = Object.fromEntries(Object.entries(DECREES).map(([id, d]) => [id, { ...d, decree: true }]));

const data = readJson(FILES.modifiers, null) ?? {};
data.active ??= {}; // id -> { until }
data.treasury ??= 0;
data.nextDecreeAt ??= 0;
const save = () => writeJson(FILES.modifiers, data);
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// Everything currently running (expired ones are dropped here)
function activeList() {
  const now = Date.now();
  let changed = false;
  for (const [id, m] of Object.entries(data.active)) {
    if (m.until <= now || !DEFS[id]) {
      delete data.active[id];
      changed = true;
    }
  }
  if (changed) save();
  return Object.entries(data.active).map(([id, m]) => ({ id, until: m.until, def: DEFS[id] }));
}

const mult = (key) => activeList().reduce((m, e) => m * (e.def.fx[key] ?? 1), 1);
const bonus = (key) => activeList().reduce((sum, e) => sum + (e.def.fx[key] ?? 0), 0);
const flag = (key) => activeList().some((e) => e.def.fx[key]);

function findDecree(text) {
  const q = norm(text ?? '');
  if (!q) return null;
  return Object.keys(DEFS).find((id) => id === q || norm(DEFS[id].name).includes(q)) ?? null;
}

// Starts a decree (a random one, or a specific one with `id`)
function issueDecree({ goodOnly = false, id = null } = {}) {
  if (!id) {
    const live = new Set(activeList().map((e) => e.id));
    let pool = Object.keys(DEFS).filter((d) => (!goodOnly || DEFS[d].good) && !live.has(d));
    if (!pool.length) pool = Object.keys(DEFS).filter((d) => !goodOnly || DEFS[d].good); // all running: refresh one
    const weighted = pool.flatMap((d) => Array(DEFS[d].weight ?? 1).fill(d));
    id = weighted[Math.floor(Math.random() * weighted.length)];
  }
  data.active[id] = { until: Date.now() + DEFS[id].ms };
  save();
  return { id, def: DEFS[id], until: data.active[id].until };
}

function scheduleNext() {
  data.nextDecreeAt = Date.now() + (6 + Math.random() * 6) * HOUR; // every 6 to 12 hours
  save();
}
if (!data.nextDecreeAt) scheduleNext();

const dueForDecree = () => Date.now() >= data.nextDecreeAt && !activeList().some((e) => e.def.decree);

// Adds a tribute to the treasury. Returns true when it just reached the goal.
function addTreasury(amount) {
  data.treasury += amount;
  let reached = false;
  if (data.treasury >= TREASURY_GOAL) {
    data.treasury -= TREASURY_GOAL;
    reached = true;
  }
  save();
  return reached;
}
const getTreasury = () => ({ amount: data.treasury, goal: TREASURY_GOAL });

function decreeEmbed(entry, headline) {
  return new EmbedBuilder()
    .setColor(entry.def.good ? 0xf1c40f : 0x992d22)
    .setTitle(`${entry.def.emoji} ${entry.def.name}`)
    .setDescription(`${headline}\n\n${entry.def.desc}\nEnds <t:${Math.floor(entry.until / 1000)}:R>.`);
}

module.exports = { DEFS, mult, bonus, flag, activeList, findDecree, issueDecree, scheduleNext, dueForDecree, addTreasury, getTreasury, decreeEmbed };
