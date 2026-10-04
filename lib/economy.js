const { FILES } = require('../config');
const { readJson, writeJson } = require('./storage');

const START_COINS = 100;
const MAX_BET = 100000;
const XP_COOLDOWN_MS = 60 * 1000; // how often chatting can earn XP

// !!work
const WORK_COOLDOWN_MS = 60 * 1000;
const JOBS = [
  'delivered pizzas',
  'walked the neighbors\' dogs',
  'fixed a stranger\'s computer',
  'mowed some lawns',
  'ran a lemonade stand',
  'played guitar on the street corner',
  'washed cars',
  'tutored a student',
  'stacked shelves at the store',
  'painted a fence',
  'helped someone move house',
  'sold homemade cookies',
];

// !!rob
const ROB = {
  MIN_COINS: 100, // both people need at least this much
  SUCCESS_CHANCE: 0.45,
  MIN_PERCENT: 10, // of the target's coins
  MAX_PERCENT: 30,
  COOLDOWN_MS: 5 * 60 * 1000, // between attempts
  PROTECTION_MS: 30 * 60 * 1000, // victims can't be robbed again for this long
};

// userId -> { coins, lastDaily, streak, xp, level, lastXp, lastWork, lastRob, robProtectedUntil }
const users = readJson(FILES.economy, {});
let saveTimer = null;

const fmt = (n) => `${Number(n).toLocaleString('en-US')} 🪙`;

function saveNow() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  writeJson(FILES.economy, users);
}

// Saves a moment after a change, so busy chats don't write to disk constantly
function scheduleSave() {
  if (!saveTimer) saveTimer = setTimeout(saveNow, 2000);
}

const newUser = () => ({
  coins: START_COINS,
  lastDaily: null,
  streak: 0,
  xp: 0,
  level: 0,
  lastXp: 0,
  lastWork: 0,
  lastRob: 0,
  robProtectedUntil: 0,
});

// Looks a user up without creating an entry for them
const peekUser = (id) => users[id] ?? newUser();

function getUser(id) {
  return (users[id] ??= newUser());
}

// ---------- Coins ----------

function addCoins(id, amount) {
  getUser(id).coins += amount;
  scheduleSave();
}

// Takes coins if the user has enough. Returns true if it worked.
function spendCoins(id, amount) {
  const u = getUser(id);
  if (u.coins < amount) return false;
  u.coins -= amount;
  scheduleSave();
  return true;
}

// Applies a win (positive) or a loss (negative). Losses are capped at what the user has.
// Returns the amount that actually changed.
function applyDelta(id, delta) {
  const u = getUser(id);
  const actual = delta < 0 ? -Math.min(-delta, u.coins) : delta;
  u.coins += actual;
  scheduleSave();
  return actual;
}

// Moves up to `amount` coins from one user to another. Returns how much actually moved.
function transferUpTo(fromId, toId, amount) {
  const moved = -applyDelta(fromId, -amount);
  addCoins(toId, moved);
  return moved;
}

// Turns "50" or "all" into a number (or null if it isn't a valid bet)
function parseBet(text, balance) {
  if (!text) return null;
  if (text.toLowerCase() === 'all') return Math.min(balance, MAX_BET);
  if (!/^\d+$/.test(text)) return null;
  return parseInt(text, 10);
}

// Returns a message explaining why the bet isn't allowed, or null if it's fine
function betError(id, bet, { allowZero = false } = {}) {
  if (!Number.isInteger(bet) || bet < (allowZero ? 0 : 1)) {
    return `The bet must be a whole number${allowZero ? '' : ' of at least 1'} (or \`all\`).`;
  }
  if (bet > MAX_BET) return `The maximum bet is ${fmt(MAX_BET)}.`;
  const coins = peekUser(id).coins;
  if (bet > coins) return `You only have ${fmt(coins)}.`;
  return null;
}

// ---------- Daily reward ----------

const todayUTC = () => new Date().toISOString().slice(0, 10);
const yesterdayUTC = () => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

function claimDaily(id) {
  const u = getUser(id);

  if (u.lastDaily === todayUTC()) {
    const midnight = new Date();
    midnight.setUTCHours(24, 0, 0, 0);
    return { ok: false, nextTs: Math.floor(midnight.getTime() / 1000) };
  }

  u.streak = u.lastDaily === yesterdayUTC() ? u.streak + 1 : 1;
  u.lastDaily = todayUTC();
  const amount = 100 + Math.min(u.streak - 1, 10) * 10; // 100 coins, +10 per streak day (up to +100)
  u.coins += amount;
  scheduleSave();
  return { ok: true, amount, streak: u.streak, coins: u.coins };
}

// ---------- Work ----------

// A small payout (15-45 coins), once a minute
function doWork(id) {
  const u = getUser(id);
  const now = Date.now();
  const readyAt = (u.lastWork ?? 0) + WORK_COOLDOWN_MS;
  if (now < readyAt) return { ok: false, nextTs: Math.ceil(readyAt / 1000) };

  u.lastWork = now;
  const amount = 15 + Math.floor(Math.random() * 31);
  u.coins += amount;
  scheduleSave();
  return { ok: true, amount, job: JOBS[Math.floor(Math.random() * JOBS.length)], coins: u.coins };
}

// ---------- Rob ----------

// The amount at stake is a percentage of the target's coins, but never more than the robber owns.
// Win and you take that amount. Get caught and you pay the same amount to the target.
// Returns { error } or { success, amount, percent, robberCoins }
function attemptRob(robberId, targetId) {
  const robber = peekUser(robberId);
  const target = peekUser(targetId);
  const now = Date.now();

  const readyAt = (robber.lastRob ?? 0) + ROB.COOLDOWN_MS;
  if (now < readyAt) {
    return { error: `⏳ You're laying low after your last attempt. Try again <t:${Math.ceil(readyAt / 1000)}:R>.` };
  }
  if (robber.coins < ROB.MIN_COINS) {
    return { error: `You need at least **${fmt(ROB.MIN_COINS)}** to try a robbery, because you'd have to pay a fine if you got caught.` };
  }
  if (target.coins < ROB.MIN_COINS) {
    return { error: `They only have **${fmt(target.coins)}**. That's not worth the risk!` };
  }
  const protectedUntil = target.robProtectedUntil ?? 0;
  if (protectedUntil > now) {
    return { error: `🛡️ They were just robbed and are being watched closely. Try again <t:${Math.ceil(protectedUntil / 1000)}:R>.` };
  }

  const percent = ROB.MIN_PERCENT + Math.random() * (ROB.MAX_PERCENT - ROB.MIN_PERCENT);
  const amount = Math.max(1, Math.min(Math.floor((target.coins * percent) / 100), robber.coins));

  getUser(robberId).lastRob = now;

  if (Math.random() < ROB.SUCCESS_CHANCE) {
    const moved = transferUpTo(targetId, robberId, amount);
    getUser(targetId).robProtectedUntil = now + ROB.PROTECTION_MS;
    return { success: true, amount: moved, percent: Math.round(percent), robberCoins: peekUser(robberId).coins };
  }

  const moved = transferUpTo(robberId, targetId, amount);
  return { success: false, amount: moved, percent: Math.round(percent), robberCoins: peekUser(robberId).coins };
}

// ---------- XP and levels ----------

const levelFromXp = (xp) => Math.floor(Math.sqrt(xp / 100));
const xpForLevel = (level) => level * level * 100;

// Called for every message. Returns null if still on cooldown, otherwise info about any level-up.
function addMessageXp(id) {
  const u = getUser(id);
  const now = Date.now();
  if (now - u.lastXp < XP_COOLDOWN_MS) return null;

  u.lastXp = now;
  u.xp += 15 + Math.floor(Math.random() * 11); // 15-25 XP

  const level = levelFromXp(u.xp);
  let reward = 0;
  for (let l = u.level + 1; l <= level; l++) reward += l * 25; // each level pays level x 25 coins
  const leveledUp = level > u.level;
  u.level = Math.max(u.level, level);
  u.coins += reward;

  scheduleSave();
  return { leveledUp, level, reward };
}

// ---------- Leaderboards ----------

function top(field, count = 10) {
  return Object.entries(users)
    .map(([id, u]) => ({ id, value: u[field] }))
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, count);
}

function rankOf(id, field) {
  const mine = users[id]?.[field] ?? 0;
  return Object.values(users).filter((u) => u[field] > mine).length + 1;
}

module.exports = {
  MAX_BET,
  ROB,
  fmt,
  saveNow,
  peekUser,
  getUser,
  addCoins,
  spendCoins,
  applyDelta,
  transferUpTo,
  parseBet,
  betError,
  claimDaily,
  doWork,
  attemptRob,
  levelFromXp,
  xpForLevel,
  addMessageXp,
  top,
  rankOf,
};
