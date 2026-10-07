const { peekUser, spendCoins, fmt } = require('./economy');
const { weatherBonus } = require('./weather');
const { guardPower, status: muscleStatus, STAFF } = require('./muscle');
const { portfolio } = require('./stocks');

const SPY_COST = 300;
const SPY_COOLDOWN_MS = 10 * 60 * 1000;
const BASE_CHANCE = 0.6;
const MARK_MS = 15 * 60 * 1000; // how long a successful spy helps your next robbery
const MARK_BONUS = 0.1;
const REPORT_MS = 15 * 60 * 1000; // how long you can re-read the intel

// All of this lives in memory, since it only matters for a few minutes
const lastSpy = new Map(); // spyId -> when they last sent a spy
const marks = new Map(); // spyId -> { targetId, until }
const reports = new Map(); // reportId -> { spyId, targetId, expires, intel }

function gather(targetId) {
  const u = peekUser(targetId);
  const m = muscleStatus(targetId);
  return {
    coins: u.coins,
    invested: Math.round(portfolio(targetId).value),
    guards: m.staff.filter((s) => STAFF[s.id].kind === 'guard').map((s) => STAFF[s.id]),
    thieves: m.staff.filter((s) => STAFF[s.id].kind === 'thief').map((s) => ({ def: STAFF[s.id], nextAt: s.nextAt ?? 0 })),
    guardPower: m.guardPower,
    stash: m.stash,
    padlocks: u.inventory.padlock ?? 0,
    protectedUntil: u.robProtectedUntil ?? 0,
  };
}

// Returns { error }, { caught: true }, or { success: true, reportId }
function attempt(spyId, targetId) {
  const now = Date.now();
  for (const [id, r] of reports) if (r.expires < now) reports.delete(id);

  const readyAt = (lastSpy.get(spyId) ?? 0) + SPY_COOLDOWN_MS;
  if (now < readyAt) return { error: `⏳ Your spies are laying low. Try again <t:${Math.ceil(readyAt / 1000)}:R>.` };
  if (peekUser(spyId).coins < SPY_COST) return { error: `Sending a spy costs **${fmt(SPY_COST)}**, and you do not have enough.` };

  spendCoins(spyId, SPY_COST);
  lastSpy.set(spyId, now);

  // Guards make spies easier to catch, and the weather helps or hurts them like it does robbers
  const chance = Math.min(0.9, Math.max(0.1, BASE_CHANCE + weatherBonus('robChance') - guardPower(targetId)));
  if (Math.random() >= chance) return { caught: true };

  marks.set(spyId, { targetId, until: now + MARK_MS });
  const reportId = Math.random().toString(36).slice(2, 8);
  reports.set(reportId, { spyId, targetId, expires: now + REPORT_MS, intel: gather(targetId) });
  return { success: true, reportId };
}

// Used by !!rob: a successful spy makes your next robbery on that person more likely to work
function markBonus(robberId, targetId) {
  const m = marks.get(robberId);
  if (!m || m.targetId !== targetId || m.until < Date.now()) return 0;
  marks.delete(robberId);
  return MARK_BONUS;
}

function getReport(reportId) {
  const r = reports.get(reportId);
  return r && r.expires > Date.now() ? r : null;
}

module.exports = { SPY_COST, SPY_COOLDOWN_MS, MARK_MS, MARK_BONUS, REPORT_MS, attempt, markBonus, getReport };
