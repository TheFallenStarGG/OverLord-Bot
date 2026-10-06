const { addCoins, fmt } = require('./economy');
const { DECREE_IDS, findDecree, issueDecree } = require('./modifiers');
const { data, save, saveNow, logEvent } = require('./world');

const GOAL = 2000; // Rebellion points needed to summon the Overlord
const RAID_HP = 12000;
const RAID_MS = 60 * 60 * 1000; // how long the Overlord stays
const REIGN_MS = 24 * 60 * 60 * 1000; // how long a Usurper rules
const STIPEND = 400;
const STIPEND_GAP_MS = 2 * 60 * 60 * 1000;
const POINT_GAP_MS = 60 * 1000;

const state = () => data.rebellion;
const lastPoint = new Map(); // userId -> time

function addRebellion(points) {
  const s = state();
  if (s.raid) return; // the Overlord is already here
  s.meter = Math.min(GOAL, s.meter + points);
  save();
}

// Every command someone runs feeds the Rebellion, at most once a minute each
function commandUsed(userId) {
  const now = Date.now();
  if (now - (lastPoint.get(userId) ?? 0) < POINT_GAP_MS) return;
  lastPoint.set(userId, now);
  addRebellion(1);
}

// Called when any boss falls: everyone who fought feeds the Rebellion
function bossDefeated(name, killerId, fighterIds) {
  addRebellion(15 * fighterIds.length);
  logEvent(`⚔️ <@${killerId}> struck the final blow on the ${name}`);
}

const meterInfo = () => ({ meter: state().meter, goal: GOAL, raid: Boolean(state().raid) });

// ---------- The raid ----------

function startRaid() {
  state().raid = { startedAt: Date.now() };
  logEvent('👑 The Overlord descended to crush the Rebellion');
  saveNow();
}

// Ends the raid. Returns false if it was already ended (for example in another server).
function finishRaid(won, killerId, name) {
  const s = state();
  if (!s.raid) return false;
  s.raid = null;
  if (won) {
    s.meter = 0;
    crown(killerId, name);
  } else {
    s.meter = Math.floor(GOAL * 0.3);
    logEvent('💀 The Overlord crushed the Rebellion');
    saveNow();
  }
  return true;
}

// Bosses only live in memory. If the bot restarted mid-raid, the Overlord simply comes back.
function recoverRaid() {
  const s = state();
  if (!s.raid) return;
  s.raid = null;
  s.meter = GOAL;
  saveNow();
}

// ---------- The throne ----------

function crown(userId, name) {
  state().usurper = { id: userId, name, since: Date.now(), until: Date.now() + REIGN_MS, decreeUsed: false, stipendAt: 0 };
  logEvent(`👑 <@${userId}> seized the throne`);
  saveNow();
}

function currentUsurper() {
  const u = state().usurper;
  return u && u.until > Date.now() ? u : null;
}

// Removes an expired Usurper and returns them (or null)
function expireUsurper() {
  const u = state().usurper;
  if (!u || u.until > Date.now()) return null;
  state().usurper = null;
  logEvent(`The reign of <@${u.id}> ended`);
  saveNow();
  return u;
}

function useDecree(userId, text) {
  const king = currentUsurper();
  if (!king || king.id !== userId) return { error: 'Only the Usurper can command a decree.' };
  if (king.decreeUsed) return { error: 'You already used your decree this reign.' };
  const id = findDecree(text);
  if (!id) return { error: `Which decree? Options: ${DECREE_IDS.map((d) => `\`${d}\``).join(', ')}.` };

  const entry = issueDecree({ id });
  king.decreeUsed = true;
  logEvent(`📜 Usurper <@${userId}> commanded the ${entry.def.name}`);
  saveNow();
  return { entry };
}

function claimStipend(userId) {
  const king = currentUsurper();
  if (!king || king.id !== userId) return { error: 'Only the Usurper can collect the royal stipend.' };
  const readyAt = (king.stipendAt ?? 0) + STIPEND_GAP_MS;
  if (Date.now() < readyAt) return { error: `The treasury is empty for now. Come back <t:${Math.ceil(readyAt / 1000)}:R>.` };

  addCoins(userId, STIPEND);
  king.stipendAt = Date.now();
  saveNow();
  return { text: `👑 The royal treasury pays you **${fmt(STIPEND)}**.` };
}

module.exports = {
  GOAL, RAID_HP, RAID_MS,
  addRebellion, commandUsed, bossDefeated, meterInfo,
  startRaid, finishRaid, recoverRaid,
  crown, currentUsurper, expireUsurper, useDecree, claimStipend,
};
