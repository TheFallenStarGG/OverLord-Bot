const { FILES } = require('../config');
const { readJson, writeJson } = require('./storage');
const { DAILY_QUESTS, WEEKLY_QUESTS } = require('./questDefs');
const { mult, bonus, flag } = require('./modifiers');

const START_COINS = 100;
const MAX_BET = 100000;
const XP_COOLDOWN_MS = 60 * 1000; // how often chatting can earn XP
const WORK_COOLDOWN_MS = 60 * 1000;
const PRESTIGE_BONUS = 0.05; // extra coin earnings per prestige level

// !!work careers: you get promoted by working. mult = pay multiplier.
const CAREERS = [
  { name: 'Intern', emoji: '📎', min: 0, mult: 1, jobs: ['made copies at the office', 'fetched coffee for the whole team', 'sorted the mail room'] },
  { name: 'Barista', emoji: '☕', min: 25, mult: 1.2, jobs: ['pulled espresso shots', 'practiced your latte art', 'survived the morning rush'] },
  { name: 'Technician', emoji: '🔧', min: 75, mult: 1.5, jobs: ['repaired a broken server', 'rewired the office network', 'finally fixed the printer'] },
  { name: 'Manager', emoji: '📋', min: 200, mult: 2, jobs: ['led a team meeting', 'approved a big budget', 'sorted out a scheduling crisis'] },
  { name: 'Director', emoji: '💼', min: 500, mult: 2.6, jobs: ['pitched to investors', 'signed a major deal', 'reorganized a whole department'] },
  { name: 'CEO', emoji: '👑', min: 1000, mult: 3.5, jobs: ['closed a billion-coin merger', 'gave a keynote speech', 'rang the opening bell'] },
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
const markDirty = scheduleSave; // other files call this after changing a user directly

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
  works: 0, // total times worked (decides your career)
  prestige: 0,
  title: null, // equipped title (an item id)
  inventory: {}, // itemId -> how many you own
  gear: { rod: 0, pick: 0 }, // fishing rod and pickaxe levels
  effects: {}, // active boosts from items
  lastFish: 0,
  lastMine: 0,
  lastHeist: 0,
  quests: null,
});

// Adds any fields that older saved users don't have yet
function fillDefaults(user) {
  for (const [key, value] of Object.entries(newUser())) {
    if (user[key] === undefined) user[key] = value;
  }
  user.gear.rod ??= 0;
  user.gear.pick ??= 0;
}
for (const user of Object.values(users)) fillDefaults(user);

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

// ---------- Dates ----------

const todayUTC = () => new Date().toISOString().slice(0, 10);
const yesterdayUTC = () => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

// The Monday of this week (UTC)
function weekKeyUTC() {
  const d = new Date();
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  return d.toISOString().slice(0, 10);
}

// ---------- Quests ----------

const pickRandom = (list, count) => [...list].sort(() => Math.random() - 0.5).slice(0, count);

// Gives the user fresh quests when a new day or week has started
function ensureQuests(user) {
  if (!user.quests) user.quests = { day: null, week: null, daily: [], weekly: [] };
  const q = user.quests;

  if (q.day !== todayUTC()) {
    q.day = todayUTC();
    q.daily = pickRandom(DAILY_QUESTS, 3).map((d) => ({ id: d.id, progress: 0, claimed: false }));
  }
  if (q.week !== weekKeyUTC()) {
    q.week = weekKeyUTC();
    q.weekly = pickRandom(WEEKLY_QUESTS, 2).map((d) => ({ id: d.id, progress: 0, claimed: false }));
  }
  return q;
}

// Counts progress toward any quest of this type (messages, work, fish, mine, win, daily)
function recordQuest(id, type, amount = 1) {
  const q = ensureQuests(getUser(id));
  const defs = [...DAILY_QUESTS, ...WEEKLY_QUESTS];

  for (const entry of [...q.daily, ...q.weekly]) {
    const def = defs.find((d) => d.id === entry.id);
    if (def && def.type === type && !entry.claimed) {
      entry.progress = Math.min(def.goal, entry.progress + amount);
    }
  }
  scheduleSave();
}

// ---------- Prestige and careers ----------

const bonusMult = (user) => 1 + PRESTIGE_BONUS * (user.prestige ?? 0);

function careerFor(works) {
  let current = CAREERS[0];
  for (const career of CAREERS) if (works >= career.min) current = career;
  return current;
}

const nextCareer = (works) => CAREERS.find((c) => c.min > works) ?? null;

// ---------- Daily reward ----------

function claimDaily(id) {
  const u = getUser(id);

  if (u.lastDaily === todayUTC()) {
    const midnight = new Date();
    midnight.setUTCHours(24, 0, 0, 0);
    return { ok: false, nextTs: Math.floor(midnight.getTime() / 1000) };
  }

  u.streak = u.lastDaily === yesterdayUTC() ? u.streak + 1 : 1;
  u.lastDaily = todayUTC();
  const base = 100 + Math.min(u.streak - 1, 10) * 10; // 100 coins, +10 per streak day (up to +100)
  const amount = Math.round(base * bonusMult(u) * mult('daily'));
  u.coins += amount;
  recordQuest(id, 'daily');
  scheduleSave();
  return { ok: true, amount, streak: u.streak, coins: u.coins };
}

// ---------- Work ----------

// 15-45 coins times your career multiplier, once a minute
function doWork(id) {
  const u = getUser(id);
  const now = Date.now();
  const readyAt = (u.lastWork ?? 0) + WORK_COOLDOWN_MS;
  if (now < readyAt) return { ok: false, nextTs: Math.ceil(readyAt / 1000) };

  const before = careerFor(u.works);
  u.lastWork = now;
  u.works++;
  const career = careerFor(u.works);

  let amount = (15 + Math.floor(Math.random() * 31)) * career.mult;
  let boosted = false;
  if ((u.effects.workBoostLeft ?? 0) > 0) {
    amount *= 2;
    u.effects.workBoostLeft--;
    boosted = true;
  }
  amount = Math.round(amount * bonusMult(u) * mult('work'));
  u.coins += amount;

  recordQuest(id, 'work');
  scheduleSave();
  return {
    ok: true,
    amount,
    job: career.jobs[Math.floor(Math.random() * career.jobs.length)],
    coins: u.coins,
    career,
    promoted: career !== before ? career : null,
    boosted,
  };
}

// ---------- Rob ----------

// The amount at stake is a percentage of the target's coins, but never more than the robber owns.
// Win and you take that amount. Get caught and you pay the same amount to the target.
// Returns { error } or { blocked } or { success, amount, percent, robberCoins, usedLockpick }
function attemptRob(robberId, targetId) {
  if (flag('robBan')) return { error: '🕊️ The Overlord has decreed peace. Robbery is forbidden for now.' };
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

  const robberData = getUser(robberId);
  robberData.lastRob = now;

  // A lockpick armed with !!use gives +20% success and is used up by this attempt
  let chance = ROB.SUCCESS_CHANCE + bonus('robChance');
  const usedLockpick = Boolean(robberData.effects.lockpick);
  if (usedLockpick) {
    chance += 0.2;
    robberData.effects.lockpick = false;
  }

  // A padlock automatically stops the robbery (and breaks)
  const targetData = getUser(targetId);
  if ((targetData.inventory.padlock ?? 0) > 0) {
    targetData.inventory.padlock--;
    if (!targetData.inventory.padlock) delete targetData.inventory.padlock;
    scheduleSave();
    return { blocked: true, usedLockpick };
  }

  if (Math.random() < chance) {
    const moved = transferUpTo(targetId, robberId, amount);
    targetData.robProtectedUntil = now + ROB.PROTECTION_MS;
    return { success: true, amount: moved, percent: Math.round(percent), robberCoins: peekUser(robberId).coins, usedLockpick };
  }

  const moved = transferUpTo(robberId, targetId, amount);
  return { success: false, amount: moved, percent: Math.round(percent), robberCoins: peekUser(robberId).coins, usedLockpick };
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
  const boost = ((u.effects.xpUntil ?? 0) > now ? 2 : 1) * mult('xp', 4);
  u.xp += Math.round((15 + Math.floor(Math.random() * 11)) * boost); // 15-25 XP (doubled by an XP Boost or decree)
  
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
  CAREERS,
  PRESTIGE_BONUS,
  fmt,
  saveNow,
  markDirty,
  peekUser,
  getUser,
  addCoins,
  spendCoins,
  applyDelta,
  transferUpTo,
  parseBet,
  betError,
  ensureQuests,
  recordQuest,
  bonusMult,
  careerFor,
  nextCareer,
  claimDaily,
  doWork,
  attemptRob,
  levelFromXp,
  xpForLevel,
  addMessageXp,
  top,
  rankOf,
};
