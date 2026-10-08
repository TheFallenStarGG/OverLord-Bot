const { FILES } = require('../config');
const { peekUser, getUser, applyDelta, addCoins, spendCoins, saveNow: saveEconomy, markDirty, top, fmt, ROB } = require('./economy');
const { bonus, flag } = require('./modifiers');
const { weatherBonus } = require('./weather');
const { logEvent } = require('./world');
const { scoped, writeJson } = require('./storage');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const JOB_MS = 3 * HOUR; // how often a thief goes out on a job
const JAIL_MS = 6 * HOUR; // a caught thief sits out this long
const THIEF_IMMUNE_MS = 6 * HOUR; // after a thief targets someone, thieves leave them alone this long
const ACTIVE_MS = 7 * DAY; // thieves only target people who played this recently
const MIN_TARGET_COINS = 200;
const FINE_SHARE = 0.5; // a caught thief costs the boss this share of what was at stake
const MAX_GUARDS = 3;
const MAX_THIEVES = 2;
const MAX_GUARD_POWER = 0.35; // guards can never lower a robber's chance by more than this

// power = how much lower a robber's success chance is against you
const GUARDS = {
  bouncer: { kind: 'guard', emoji: '💪', name: 'Bouncer', cost: 800, upkeep: 60, power: 0.06 },
  sellsword: { kind: 'guard', emoji: '⚔️', name: 'Sellsword', cost: 2500, upkeep: 180, power: 0.12 },
  warden: { kind: 'guard', emoji: '🛡️', name: 'Warden', cost: 8000, upkeep: 500, power: 0.18 },
};
// chance = base success chance, min/max = share of the victim's coins, cap = most they can carry
const THIEVES = {
  pickpocket: { kind: 'thief', emoji: '🧤', name: 'Pickpocket', cost: 1000, upkeep: 80, chance: 0.4, min: 0.03, max: 0.07, cap: 800 },
  burglar: { kind: 'thief', emoji: '🗝️', name: 'Burglar', cost: 4000, upkeep: 300, chance: 0.45, min: 0.04, max: 0.09, cap: 3000 },
  mastermind: { kind: 'thief', emoji: '🎭', name: 'Mastermind', cost: 12000, upkeep: 900, chance: 0.48, min: 0.05, max: 0.1, cap: 6000 },
};
const STAFF = { ...GUARDS, ...THIEVES };

const data = scoped(FILES.muscle, (d) => {
  d.owners ??= {};
  d.victims ??= {};
  d.incidents ??= {};
});

const save = () => writeJson(FILES.muscle, data);
const persist = () => {
  saveEconomy();
  save();
};

const newOwner = () => ({ staff: [], stash: 0, earned: 0, nextUpkeepAt: 0, notices: [], log: [] });
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function findStaff(text) {
  const q = norm(text ?? '');
  if (!q) return null;
  const ids = Object.keys(STAFF);
  return ids.find((id) => id === q || norm(STAFF[id].name) === q) ?? ids.find((id) => norm(STAFF[id].name).includes(q)) ?? null;
}

function addLog(owner, text) {
  owner.log.push({ at: Date.now(), text });
  if (owner.log.length > 8) owner.log.shift();
}

function addIncident(victimId, text) {
  const list = (data.incidents[victimId] ??= []);
  list.unshift({ at: Date.now(), text });
  if (list.length > 5) list.length = 5;
}

// How much lower a robber's success chance is against this person (used by !!rob and by thieves)
function guardPower(userId) {
  const o = data.owners[userId];
  if (!o) return 0;
  const total = o.staff.reduce((sum, s) => sum + (GUARDS[s.id]?.power ?? 0), 0);
  return Math.min(MAX_GUARD_POWER, total);
}

const upkeepOf = (o) => o.staff.reduce((sum, s) => sum + STAFF[s.id].upkeep, 0);

// ---------- Hiring ----------

function hire(userId, id) {
  const def = STAFF[id];
  if (!def) return { error: 'There is nobody with that name for hire. See `!!muscle shop`.' };

  const o = data.owners[userId] ?? newOwner();
  const limit = def.kind === 'guard' ? MAX_GUARDS : MAX_THIEVES;
  const count = o.staff.filter((s) => STAFF[s.id].kind === def.kind).length;
  if (count >= limit) {
    return { error: `You can only employ ${limit} ${def.kind === 'guard' ? 'guards' : 'thieves'} at a time. Let one go first with \`!!muscle fire <name>\`.` };
  }
  const have = peekUser(userId).coins;
  if (have < def.cost) return { error: `A ${def.name} costs ${fmt(def.cost)} to hire, but you only have ${fmt(have)}.` };

  spendCoins(userId, def.cost);
  if (!o.staff.length) o.nextUpkeepAt = Date.now() + DAY;
  o.staff.push({ id, nextAt: Date.now() + (def.kind === 'thief' ? HOUR : 0) });
  data.owners[userId] = o;
  persist();
  return { ok: true, def };
}

function fire(userId, id) {
  const o = data.owners[userId];
  const index = o ? o.staff.findIndex((s) => s.id === id) : -1;
  if (index === -1) return { error: 'You do not have anyone like that on the payroll.' };
  o.staff.splice(index, 1);
  if (!o.staff.length) o.nextUpkeepAt = 0;
  save();
  return { ok: true, def: STAFF[id] };
}

function collect(userId) {
  const o = data.owners[userId];
  if (!o || o.stash < 1) return { error: 'Your stash is empty.' };
  const amount = o.stash;
  o.stash = 0;
  addCoins(userId, amount);
  persist();
  return { ok: true, amount };
}

function status(userId) {
  const o = data.owners[userId] ?? newOwner();
  return {
    staff: o.staff.map((s) => ({ ...s })),
    stash: o.stash,
    earned: o.earned,
    upkeep: upkeepOf(o),
    nextUpkeepAt: o.nextUpkeepAt,
    guardPower: guardPower(userId),
    log: o.log,
    incidents: data.incidents[userId] ?? [],
  };
}

// Returns (and clears) the messages left for you while you were away
function takeNotices(userId) {
  const o = data.owners[userId];
  if (!o || !o.notices.length) return [];
  const notices = o.notices;
  o.notices = [];
  save();
  return notices;
}

// ---------- Daily upkeep ----------

function runUpkeep() {
  const now = Date.now();
  let changed = false;

  for (const [id, o] of Object.entries(data.owners)) {
    if (!o.staff.length || now < o.nextUpkeepAt) continue;
    o.nextUpkeepAt = now + DAY;
    changed = true;

    // The stash pays first, then your wallet. Whoever can't be paid walks out (cheapest are paid first).
    let budget = o.stash + peekUser(id).coins;
    let paid = 0;
    const quit = [];
    for (const s of [...o.staff].sort((a, b) => STAFF[a.id].upkeep - STAFF[b.id].upkeep)) {
      const cost = STAFF[s.id].upkeep;
      if (cost <= budget) {
        budget -= cost;
        paid += cost;
      } else {
        quit.push(s);
      }
    }

    const fromStash = Math.min(o.stash, paid);
    o.stash -= fromStash;
    if (paid > fromStash) applyDelta(id, -(paid - fromStash));

    for (const s of quit) {
      o.staff.splice(o.staff.indexOf(s), 1);
      o.notices.push(`💨 Your **${STAFF[s.id].name}** quit because you could not cover their upkeep.`);
    }
    if (o.notices.length > 5) o.notices = o.notices.slice(-5);
    if (paid) addLog(o, `💸 Paid ${fmt(paid)} in upkeep.`);
  }

  if (changed) persist();
}

// ---------- Thieves ----------

// Picks a random active player to rob. Richer people are more likely to be picked.
function pickVictim(ownerId, now) {
  const pool = top('coins', 300).filter((e) => {
    if (e.id === ownerId || e.value < MIN_TARGET_COINS) return false;
    if ((data.victims[e.id] ?? 0) > now) return false;
    const u = peekUser(e.id);
    if ((u.robProtectedUntil ?? 0) > now) return false;
    const lastSeen = Math.max(u.lastXp ?? 0, u.lastWork ?? 0, u.lastRob ?? 0, u.lastFish ?? 0, u.lastMine ?? 0);
    return lastSeen > now - ACTIVE_MS;
  });
  if (!pool.length) return null;

  const weights = pool.map((e) => Math.sqrt(e.value));
  let roll = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i];
    if (roll < 0) return pool[i].id;
  }
  return pool[pool.length - 1].id;
}

// One thief goes out on a job. Returns a report, or null if there was nobody worth robbing.
function doJob(ownerId, o, s, def, now) {
  const victimId = pickVictim(ownerId, now);
  if (!victimId) return null;

  const victim = getUser(victimId);
  const percent = def.min + Math.random() * (def.max - def.min);
  const amount = Math.min(Math.floor(victim.coins * percent), def.cap);
  if (amount < 10) return null;

  data.victims[victimId] = now + THIEF_IMMUNE_MS;

  // A Padlock stops the thief (and breaks)
  if ((victim.inventory.padlock ?? 0) > 0) {
    victim.inventory.padlock--;
    if (!victim.inventory.padlock) delete victim.inventory.padlock;
    markDirty();
    addIncident(victimId, '🔒 A thief tried to break in, but your **Padlock** stopped them (and broke).');
    addLog(o, `🔒 Your ${def.name} was stopped by a Padlock at <@${victimId}>'s place.`);
    return { type: 'blocked', ownerId, victimId, amount: 0, def };
  }

  // Guards, the weather, and decrees all change the odds, just like a normal robbery
  const chance = clamp(def.chance + bonus('robChance') + weatherBonus('robChance') - guardPower(victimId), 0.05, 0.9);

  if (Math.random() < chance) {
    const moved = -applyDelta(victimId, -amount);
    o.stash += moved;
    o.earned += moved;
    victim.robProtectedUntil = now + ROB.PROTECTION_MS;
    markDirty();
    addIncident(victimId, `🕵️ A thief stole **${fmt(moved)}** from you. Nobody saw who it was.`);
    addLog(o, `🕵️ Your ${def.name} stole ${fmt(moved)} from <@${victimId}>!`);
    if (moved >= 500) logEvent(`🕵️ A thief made off with **${fmt(moved)}** from <@${victimId}>.`);
    return { type: 'steal', ownerId, victimId, amount: moved, def };
  }

  // Caught: the boss pays damages (stash first), and the thief goes to jail
  const fine = Math.round(amount * FINE_SHARE);
  let paid = Math.min(o.stash, fine);
  o.stash -= paid;
  if (fine > paid) paid += -applyDelta(ownerId, -(fine - paid));
  addCoins(victimId, paid);
  s.nextAt = now + JAIL_MS;
  addIncident(victimId, `🚔 A thief tried to rob you but was caught! Their boss <@${ownerId}> paid you **${fmt(paid)}** in damages.`);
  addLog(o, `🚔 Your ${def.name} was caught robbing <@${victimId}>. You paid ${fmt(paid)} in damages and they are in jail for 6 hours.`);
  if (amount >= 300) logEvent(`🚔 <@${ownerId}>'s ${def.name} was caught robbing <@${victimId}>.`);
  return { type: 'caught', ownerId, victimId, amount: paid, def };
}

// Runs every thief whose next job is due. Returns the reports (so big ones can be announced).
function runJobs() {
  const reports = [];
  if (flag('robBan')) return reports; // under a Decree of Peace the thieves lie low

  const now = Date.now();
  let changed = false;
  for (const [ownerId, o] of Object.entries(data.owners)) {
    for (const s of o.staff) {
      const def = THIEVES[s.id];
      if (!def || now < (s.nextAt ?? 0)) continue;
      s.nextAt = now + JOB_MS;
      changed = true;
      const report = doJob(ownerId, o, s, def, now);
      if (report) reports.push(report);
    }
  }

  for (const [id, until] of Object.entries(data.victims)) if (until <= now) delete data.victims[id];
  if (changed) persist();
  return reports;
}

module.exports = {
  GUARDS, THIEVES, STAFF, MAX_GUARDS, MAX_THIEVES, JOB_MS, JAIL_MS,
  findStaff, guardPower, hire, fire, collect, status, takeNotices, runUpkeep, runJobs,
};
