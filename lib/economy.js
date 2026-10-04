const { FILES } = require('../config');
const { readJson, writeJson } = require('./storage');

const START_COINS = 100;
const MAX_BET = 100000;
const XP_COOLDOWN_MS = 60 * 1000; // how often chatting can earn XP

// userId -> { coins, lastDaily, streak, xp, level, lastXp }
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

const newUser = () => ({ coins: START_COINS, lastDaily: null, streak: 0, xp: 0, level: 0, lastXp: 0 });

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
  levelFromXp,
  xpForLevel,
  addMessageXp,
  top,
  rankOf,
};
