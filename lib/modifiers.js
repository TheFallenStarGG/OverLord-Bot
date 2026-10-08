const { EmbedBuilder } = require('discord.js');
const { FILES } = require('../config');
const { realmMult, realmBonus } = require('./realm');
const { scoped, writeJson } = require('./storage');

const HOUR = 60 * 60 * 1000;
const TREASURY_GOAL = 20000;

// How long to wait between automatic events, decrees, and bosses: a random time between these hours
const GAP_HOURS = [2, 6];
const randomGapMs = () => (GAP_HOURS[0] + Math.random() * (GAP_HOURS[1] - GAP_HOURS[0])) * HOUR;

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

const data = scoped(FILES.modifiers, (d) => {
  d.active ??= {}; // id -> { until }
  d.treasury ??= 0;
  d.nextDecreeAt ??= 0;
  d.nextEventAt ??= 0;
  d.boss ??= {}; // guildId -> { last, due }
  if (!d.nextDecreeAt) d.nextDecreeAt = Date.now() + randomGapMs();
  if (!d.nextEventAt) d.nextEventAt = Date.now() + randomGapMs();
  d.nextDecreeAt = Math.min(d.nextDecreeAt, Date.now() + GAP_HOURS[1] * HOUR); // never wait longer than the longest gap
  d.nextEventAt = Math.min(d.nextEventAt, Date.now() + GAP_HOURS[1] * HOUR);
});
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
const mult = (key, max = Infinity) => Math.min(max, activeList().reduce((m, e) => m * (e.def.fx[key] ?? 1), 1) * realmMult(key));
const bonus = (key) => activeList().reduce((sum, e) => sum + (e.def.fx[key] ?? 0), 0) + realmBonus(key);
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
  data.nextDecreeAt = Date.now() + randomGapMs();
  save();
}

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
  data.nextEventAt = Date.now() + randomGapMs();
  save();
}

const dueForEvent = () => Date.now() >= data.nextEventAt && !activeList().some((e) => e.def.event);

function eventEmbed(entry, headline) {
  return new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle(`${entry.def.emoji} ${entry.def.name}`)
    .setDescription(
      `${headline}\n\n${entry.def.desc}\n🏷️ Limited-time title in \`!!shop\`: **${entry.def.titleName}**\nEnds <t:${Math.floor(entry.until / 1000)}:R>.`
    );
}

// ---------- Boss schedule ----------
// Each server has a saved "next boss is due" time. The first message after that time spawns the boss.
// It's kept on disk, so restarting the bot doesn't change it.

function bossDue(guildId) {
  const now = Date.now();
  let b = data.boss[guildId];
  if (!b) {
    b = data.boss[guildId] = { last: 0, due: now + randomGapMs() };
    save();
  }
  if (now >= b.due) return true;
  const rush = mult('bossSpawn'); // during Boss Rush they come back much sooner
  return rush > 1 && now - b.last >= (2 * HOUR) / rush;
}

function bossSpawned(guildId) {
  data.boss[guildId] = { last: Date.now(), due: Date.now() + randomGapMs() };
  save();
}

// If a spawn fails (for example the bot can't post there), try again in 10 minutes instead of on every message
function bossRetryLater(guildId) {
  data.boss[guildId] = { last: Date.now(), due: Date.now() + 10 * 60 * 1000 };
  save();
}

const getSchedule = (guildId) => ({
  nextEventAt: data.nextEventAt,
  nextDecreeAt: data.nextDecreeAt,
  nextBossAt: data.boss[guildId]?.due ?? null,
});

module.exports = {
  DEFS, DECREE_IDS, EVENT_IDS,
  mult, bonus, flag, isActive, activeList,
  findDecree, findEvent,
  issueDecree, scheduleNext, dueForDecree, addTreasury, getTreasury, decreeEmbed,
  startEvent, endEvents, scheduleNextEvent, dueForEvent, eventEmbed,
  bossDue, bossSpawned, bossRetryLater, getSchedule,
};
