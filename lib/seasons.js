const { FILES } = require('../config');
const { scoped, writeJson, runIn } = require('./storage');

// ---------- Settings you can tweak ----------
const FIRST_SEASON = { year: 2026, month: 10 }; // the month that counts as Season 1
const PRIZES = [10000, 6000, 3000]; // coins for 1st, 2nd and 3rd place
const RUNNER_UP_PRIZE = 1000; // coins for places 4-10
const MIN_SCORE = 500; // season score needed to win any prize

const META = '__meta';
const DAY_MS = 24 * 60 * 60 * 1000;

// One row per player: { s, sk, ps, psk, w, wk, pw, pwk, h }
//   s/w = season/week score, sk/wk = which season/week that score belongs to,
//   ps/pw = the previous period's score (kept so a rollover never loses it), h = trophies
const data = scoped(FILES.seasons);
const save = () => writeJson(FILES.seasons, data);

// ---------- Dates ----------

const seasonKey = (date = new Date()) => date.toISOString().slice(0, 7); // "2026-10"

function seasonNumber(key = seasonKey()) {
  const [y, m] = key.split('-').map(Number);
  return (y - FIRST_SEASON.year) * 12 + (m - FIRST_SEASON.month) + 1;
}

function seasonEnd(key = seasonKey()) {
  const [y, m] = key.split('-').map(Number);
  return Date.UTC(y, m, 1); // first moment of next month
}

// The Monday of this week (UTC), like "2026-10-05"
function weekKey(date = new Date()) {
  const d = new Date(date);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  return d.toISOString().slice(0, 10);
}

const weekEnd = (key = weekKey()) => new Date(`${key}T00:00:00Z`).getTime() + 7 * DAY_MS;

// ---------- Scores ----------

// Moves a player's old score into "previous" when a new period starts
function roll(p, field, keyField, key) {
  if (p[keyField] === key) return;
  p['p' + field] = p[field] ?? 0;
  p['p' + keyField] = p[keyField] ?? null;
  p[field] = 0;
  p[keyField] = key;
}

const valueFor = (p, field, keyField, key) =>
  (p[keyField] === key ? p[field] : p['p' + keyField] === key ? p['p' + field] : 0) ?? 0;

// Ranked list of { id, value } (only players above 0). Works on one server's season data.
function board(obj, field, keyField, key) {
  return Object.entries(obj)
    .filter(([id, p]) => id !== META && p && typeof p === 'object')
    .map(([id, p]) => ({ id, value: valueFor(p, field, keyField, key) }))
    .filter((e) => e.value > 0)
    .sort((a, b) => b.value - a.value);
}

let muted = 0;
// Coin changes made inside this don't count toward scores (used for gifts, trades and prizes)
function untracked(fn) {
  muted++;
  try {
    return fn();
  } finally {
    muted--;
  }
}

function record(guildId, userId, delta) {
  if (muted > 0 || !delta || !Number.isFinite(delta)) return;
  runIn(guildId, () => {
    const p = (data[userId] ??= {});
    roll(p, 's', 'sk', seasonKey());
    roll(p, 'w', 'wk', weekKey());
    p.s += delta;
    p.w += delta;
    save();
  });
}

// Makes every change to user.coins count toward the scores, wherever in the bot it happens
const tracked = new WeakSet();
function trackCoins(user, userId, guildId) {
  if (!guildId || !user || tracked.has(user)) return;
  tracked.add(user);
  let value = user.coins ?? 0;
  Object.defineProperty(user, 'coins', {
    enumerable: true,
    configurable: true,
    get: () => value,
    set: (next) => {
      const delta = Number(next) - value;
      value = next;
      if (Number.isFinite(delta)) record(guildId, userId, delta);
    },
  });
}

function meta() {
  const m = (data[META] ??= { key: seasonKey() });
  m.history ??= [];
  return m;
}

const scoreOf = (userId) => {
  const p = data[userId];
  return p ? valueFor(p, 's', 'sk', seasonKey()) : 0;
};

module.exports = {
  PRIZES,
  RUNNER_UP_PRIZE,
  MIN_SCORE,
  META,
  data,
  save,
  seasonKey,
  seasonNumber,
  seasonEnd,
  weekKey,
  weekEnd,
  board,
  untracked,
  trackCoins,
  meta,
  scoreOf,
};
