const { EmbedBuilder } = require('discord.js');
const { FILES } = require('../config');
const { readJson, writeJson } = require('./storage');

const HOUR = 60 * 60 * 1000;
const TREASURY_GOAL = 20000;

// fx = what it changes. Keys that multiply: work, xp, daily, sell, shop, bossSpawn, bossReward,
// fishCooldown, mineCooldown. Keys that add: robChance, fishLuck, mineLuck. robBan blocks !!rob.
const DECREES = {
  industry: { emoji: '⚒️', name: 'Decree of Industry', desc: '`!!work` pays **double**.', ms: HOUR, good: true, weight: 2, fx: { work: 2 } },
  wisdom: { emoji: '📚', name: 'Decree of Wisdom', desc: 'Chatting earns **double XP**.', ms: HOUR, good: true, weight: 2, fx: { xp: 2 } },
  largesse: { emoji: '🎁', name: 'Decree of Largesse', desc: '`!!daily` pays **50% more**.', ms: 3 * HOUR, good: true, weight: 2, fx: { daily: 1.5 } },
  peace: { emoji: '🕊️', name: 'Decree of Peace', desc: '`!!rob` is **forbidden**. Keep your coins safe!', ms: 2 * HOUR, good: true, weight: 2, fx: { robBan: true } },
  plunder: { emoji: '🏴‍☠️', name: 'Decree of Plunder', desc: 'Robberies are **15% more likely** to succeed.', ms: HOUR, good: true, weight: 2, fx: { robChance: 0.15 } },
  austerity: { emoji: '📉', name: 'Decree of Austerity', desc: '`!!work` pays **half**. The Overlord needs funds.', ms: HOUR, good: false, weight: 1, fx: { work: 0.5 } },
};

// titleName is only shown in announcements. The real titles live in lib/items.js, so keep the names in sync.
const EVENTS = {
  fishfrenzy: { emoji: '🎣', name: 'Fishing Frenzy', desc: '`!!fish` has a **half-length cooldown** and much better odds of rare catches!', ms: 3 * HOUR, fx: { fishCooldown: 0.5, fishLuck: 0.6 }, titleName: 'the Frenzied Angler' },
  minerush: { emoji: '⛏️', name: 'Mining Rush', desc: '`!!mine` has a **half-length cooldown** and much better odds of rare ores!', ms: 3 * HOUR, fx: { mineCooldown: 0.5, mineLuck: 0.6 }, titleName: 'the Deep Delver' },
  xpsurge: { emoji: '🌟', name: 'XP Surge', desc: 'Chatting earns **triple XP**!', ms: 2 * HOUR, fx: { xp: 3 }, titleName: 'the Prodigy' },
  goldrush: { emoji: '💰', name: 'Gold Rush', desc: 'Fish and ores sell for **50% more** with `!!sell`!', ms: 2 * HOUR, fx: { sell: 1.5 }, titleName: 'the Prospector' },
  flashsale: { emoji: '🏷️', name: 'Flash Sale', desc: 'Everything in the `!!shop` is **25% off**!', ms: 2 * HOUR, fx: { shop: 0.75 }, titleName: 'the Bargain Hunter' },
  bossrush: { emoji: '🐉', name: 'Boss Rush', desc: 'Bosses appear **far more often** and pay **50% more**!', ms: 2 * HOUR, fx: { bossSpawn: 8, bossReward: 1.5 }, titleName: 'the Relentless' },
};

const DEFS = {
  ...Object.fromEntries(Object.entries(DECREES).map(([id, d]) => [id, { ...d, decree: true }])),
  ...Object.fromEntries(Object.entries(EVENTS).map(([id, d]) => [id, { ...d, event: true, good: true }])),
};
const DECREE_IDS = Object.keys(DECREES);
const EVENT_IDS = Object.keys(EVENTS);

const data = readJson(FILES.modifiers, null) ?? {};
data.active ??= {}; // id -> { until }
data.treasury ??= 0;
data.nextDecreeAt ??= 0;
data.nextEventAt ??= 0;
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

const isActive = (id) => activeList().some((e) => e.id === id);
const mult = (key, max = Infinity) => Math.min(max, activeList().reduce((m, e) => m * (e.def.fx[key] ?? 1), 1));
const bonus = (key) => activeList().reduce((sum, e) => sum + (e.def.fx[key] ?? 0), 0);
const flag = (key) => activeList().some((e) => e.def.fx[key]);

const find = (ids, text) => {
  const q = norm(text ?? '');
  if (!q) return null;
  return ids.find((id) => id === q || norm(DEFS[id].name).includes(q)) ?? null;
};
const findDecree = (text) => find(DECREE_IDS, text);
const findEvent = (text) => find(EVENT_IDS, text);

// ---------- Decrees ----------

function issueDecree({ goodOnly = false, id = null } = {}) {
  if (!id) {
    const live = new Set(activeList().map((e) => e.id));
    let pool = DECREE_IDS.filter((d) => (!goodOnly || DEFS[d].good) && !live.has(d));
    if (!pool.length) pool = DECREE_IDS.filter((d) => !goodOnly || DEFS[d].good); // all running: refresh one
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

// ---------- Server events ----------

// Starts an event (a random one, or a specific one with `id`; `hours` overrides the length)
function startEvent({ id = null, hours = null } = {}) {
  if (!id) {
    const live = new Set(activeList().map((e) => e.id));
    const pool = EVENT_IDS.filter((e) => !live.has(e));
    const choices = pool.length ? pool : EVENT_IDS;
    id = choices[Math.floor(Math.random() * choices.length)];
  }
  const ms = hours ? Math.min(Math.max(hours, 0.05), 48) * HOUR : DEFS[id].ms;
  data.active[id] = { until: Date.now() + ms };
  save();
  return { id, def: DEFS[id], until: data.active[id].until };
}

// Ends one event (or all of them). Returns how many were ended.
function endEvents(id = null) {
  let n = 0;
  for (const e of activeList()) {
    if (e.def.event && (!id || e.id === id)) {
      delete data.active[e.id];
      n++;
    }
  }
  if (n) save();
  return n;
}

function scheduleNextEvent() {
  data.nextEventAt = Date.now() + (18 + Math.random() * 18) * HOUR; // every 18 to 36 hours
  save();
}
if (!data.nextEventAt) scheduleNextEvent();

const dueForEvent = () => Date.now() >= data.nextEventAt && !activeList().some((e) => e.def.event);

function eventEmbed(entry, headline) {
  return new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle(`${entry.def.emoji} ${entry.def.name}`)
    .setDescription(
      `${headline}\n\n${entry.def.desc}\n🏷️ Limited-time title in \`!!shop\`: **${entry.def.titleName}**\nEnds <t:${Math.floor(entry.until / 1000)}:R>.`
    );
}

module.exports = {
  DEFS, DECREE_IDS, EVENT_IDS,
  mult, bonus, flag, isActive, activeList,
  findDecree, findEvent,
  issueDecree, scheduleNext, dueForDecree, addTreasury, getTreasury, decreeEmbed,
  startEvent, endEvents, scheduleNextEvent, dueForEvent, eventEmbed,
};
