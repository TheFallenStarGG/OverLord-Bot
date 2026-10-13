// Everything about !!rob: methods, odds, minigame, crews, NPC marks, heat, ranks, items and chases.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require('discord.js');
const { getUser, peekUser, transferUpTo, addCoins, applyDelta, spendCoins, markDirty, careerFor, topBy, ROB, fmt } = require('./economy');
const { bonus, flag, mult } = require('./modifiers');
const { weatherBonus } = require('./weather');
const { isRobEnabled } = require('./serverSettings');
const { removeItem } = require('./inventory');
const { onSuccessfulRob } = require('./bounty');

// ---------- Settings you can tweak ----------
const HOUR = 60 * 60 * 1000;
const SESSION_MS = 2 * 60 * 1000; // how long a menu stays open
const LOBBY_MS = 45 * 1000; // how long a crew waits for members
const CHASE_MS = 60 * 1000; // how long the victim can chase
const MARK_WINDOW_MS = 3 * HOUR; // NPC marks rotate this often
const REVENGE_MS = 24 * HOUR;
const REVENGE_BONUS = 0.15; // success bonus when robbing someone who robbed you
const CHASE_MIN_LOOT = 50; // smaller thefts don't offer a chase
const FINE_CAP = 0.6; // a fine can never take more than this share of your coins
const HEAT_DECAY = 12; // heat lost per hour
const WANTED_AT = 75; // heat that makes you "Wanted"
const NPC_DAILY_LIMIT = 12; // NPC jobs per person per day (UTC)
const MAX_CREW = 4;
const INSURANCE_CAP = 600;

// chance = base success. lo/hi = stake as % of the TARGET's coins. cap = most you risk, as % of YOUR coins.
// You win the stake if it works and pay the same stake if you're caught.
const METHODS = {
  pickpocket: { emoji: '🧤', name: 'Pickpocket', blurb: 'Quick and quiet. Solid cut of their wallet, good odds.', chance: 0.52, lo: 8, hi: 16, cap: 18, heat: 6 },
  burglary: { emoji: '🔓', name: 'Burglary', blurb: 'The classic job. Balanced risk and reward.', chance: 0.44, lo: 14, hi: 26, cap: 28, heat: 12 },
  smash: { emoji: '💥', name: 'Smash & Grab', blurb: 'Loud and brutal. Huge cut of their wallet, awful odds.', chance: 0.34, lo: 24, hi: 40, cap: 40, heat: 22 },
  crew: { emoji: '👥', name: 'Crew Job', blurb: 'Team up for a bigger score. Everyone shares the risk and the loot.', chance: 0.40, lo: 18, hi: 34, cap: 28, heat: 14 },
};

// The thief ladder (counts every successful robbery, including NPC marks)
const RANKS = [
  { name: 'Street Rat', emoji: '🐀', min: 0, chance: 0, cooldown: 1, cap: 0 },
  { name: 'Pickpocket', emoji: '🧤', min: 10, chance: 0.01, cooldown: 0.9, cap: 2 },
  { name: 'Cutpurse', emoji: '🗡️', min: 30, chance: 0.02, cooldown: 0.8, cap: 4 },
  { name: 'Burglar', emoji: '🔓', min: 75, chance: 0.03, cooldown: 0.7, cap: 6 },
  { name: 'Cat Burglar', emoji: '🐈', min: 150, chance: 0.04, cooldown: 0.6, cap: 8 },
  { name: 'Shadow', emoji: '🌑', min: 300, chance: 0.05, cooldown: 0.5, cap: 10 },
  { name: 'Crime Boss', emoji: '🎩', min: 600, chance: 0.06, cooldown: 0.5, cap: 12 },
];

// Gear you can switch on in the menu (the defensive items work on their own from the victim's inventory)
const GEAR = {
  lockpick: { emoji: '🪛', label: 'Lockpick' },
  crowbar: { emoji: '🔧', label: 'Crowbar' },
  disguise: { emoji: '🎭', label: 'Disguise' },
  getaway: { emoji: '💨', label: 'Getaway' },
};

// pay = multiples of your "unit" (60 coins x career multiplier x rank bonus)
const NPC_MARKS = [
  { id: 'caravan', emoji: '🐪', name: 'Merchant Caravan', blurb: 'Slow wagons and sleepy guards.', chance: 0.62, pay: [0.8, 1.4], heat: 4, minRank: 0 },
  { id: 'tavern', emoji: '🍺', name: 'Rowdy Tavern', blurb: 'Everyone is too drunk to notice.', chance: 0.58, pay: [1.0, 1.8], heat: 5, minRank: 0 },
  { id: 'manor', emoji: '🏰', name: "Noble's Manor", blurb: 'Silver, gems and a few hired swords.', chance: 0.48, pay: [1.8, 3.0], heat: 9, minRank: 1 },
  { id: 'shipment', emoji: '📦', name: 'Smuggler Shipment', blurb: 'Stealing from thieves. Poetic.', chance: 0.44, pay: [2.4, 3.8], heat: 12, minRank: 1 },
  { id: 'temple', emoji: '⛪', name: 'Temple Offerings', blurb: 'The gods can spare a little.', chance: 0.4, pay: [3, 4.8], heat: 14, minRank: 2 },
  { id: 'vault', emoji: '🏦', name: 'Royal Vault', blurb: 'The big one. Almost nobody makes it out.', chance: 0.28, pay: [5, 9], heat: 22, minRank: 3 },
];

const SCENES = {
  pickpocket: {
    go: ['🧤 You melt into the crowd behind **{t}**…', '🧤 You fall into step behind **{t}**, fingers loose…', '🧤 You bump into **{t}** with a charming smile…'],
    tense: ['👀 Their hand drifts toward their coin purse…', '👀 They stop to look at a stall. Perfect… or is it?', '👀 A guard glances your way…'],
    win: ['Light fingers. They never felt a thing.', 'A bump, an apology, and a lighter purse.', 'You vanish into the crowd with the goods.'],
    lose: ['A hand clamps onto your wrist. Busted!', '"Thief!" someone shouts. Everyone turns around.', 'Your fingers were not as light as you thought.'],
  },
  burglary: {
    go: ['🔓 You creep up to **{t}**\'s door as the street goes quiet…', '🔓 You slip through a back window at **{t}**\'s place…', '🔓 You kneel at **{t}**\'s lock, tools in hand…'],
    tense: ['👀 Floorboards creak under your boots…', '👀 A light flickers on upstairs…', '👀 The lock clicks… almost…'],
    win: ['The lock gives way. In and out, clean.', 'You empty the strongbox and slip away.', 'Nobody heard a thing. Easy money.'],
    lose: ['The floor creaks and a lantern snaps on. Caught!', 'You trip a wire and a bell starts ringing.', 'A guard dog finds you before you find the coins.'],
  },
  smash: {
    go: ['💥 You kick in **{t}**\'s door with a crash…', '💥 You smash through the window and grab for the safe…', '💥 No subtlety today. You storm **{t}**\'s place…'],
    tense: ['👀 Shouting erupts in the street…', '👀 You hear running footsteps…', '👀 Glass crunches. Every second counts…'],
    win: ['You grab everything you can carry and bolt!', 'The loot is yours. The neighbors are screaming.', 'A brutal job, a huge haul.'],
    lose: ['The whole street heard you. The guards swarm in!', 'The safe was bolted down. So were the guards.', 'You\'re tackled before you reach the door.'],
  },
  crew: {
    go: ['👥 Your crew spreads out around **{t}**…', '👥 Signals pass between you. Time to move on **{t}**…', '👥 The crew slips into position. Nobody speaks…'],
    tense: ['👀 The lookout whistles twice. Someone is coming…', '👀 One crew member is on the roof, another at the lock…', '👀 The plan is in motion. Don\'t breathe…'],
    win: ['The plan worked perfectly. You split the haul!', 'Smooth teamwork. Not a single witness.', 'In, out, and gone before anyone could blink.'],
    lose: ['Somebody sneezed. The whole crew is caught!', 'The lookout fell asleep. Busted!', 'The plan fell apart and so did the crew\'s purses.'],
  },
  npc: {
    go: ['🌙 You scout **{t}** from the shadows…', '🌙 You case **{t}**, counting the guards…', '🌙 You slip toward **{t}** as the lanterns flicker…'],
    tense: ['👀 A patrol rounds the corner…', '👀 A dog starts barking somewhere…', '👀 The lock clicks… slowly…'],
    win: ['Clean job. You vanish with the loot.', 'In and out. Nobody saw a thing.', 'Your pockets are heavier and your conscience lighter.'],
    lose: ['The guards spot you! You drop the loot and run.', 'An alarm bell rings. You bribe your way out.', 'You trip over a barrel. So much for stealth.'],
  },
};

const SYMBOLS = ['🔴', '🟢', '🔵', '🟡'];

// ---------- Small helpers ----------
const rand = (min, max) => min + Math.random() * (max - min);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const signed = (n) => `${n >= 0 ? '+' : '−'}${Math.abs(Math.round(n * 100))}%`;
const newId = (map) => {
  let id;
  do {
    id = Math.random().toString(36).slice(2, 8);
  } while (map.has(id));
  return id;
};
const privateReply = (interaction, content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });

// ---------- Thief record (lives on each player's economy data) ----------
const R_DEFAULTS = {
  wins: 0, fails: 0, stolen: 0, lost: 0, biggest: 0, streak: 0, bestStreak: 0,
  robbed: 0, robbedTotal: 0, chases: 0, npc: 0, npcWins: 0, npcStolen: 0, npcDay: null, npcToday: 0,
  heat: 0, heatAt: 0, revenge: null,
};
function ensureRob(u) {
  u.rob ??= {};
  for (const [key, value] of Object.entries(R_DEFAULTS)) if (u.rob[key] === undefined) u.rob[key] = value;
  return u.rob;
}
const readRob = (u) => ({ ...R_DEFAULTS, ...(u?.rob ?? {}) });

function rankIndex(wins) {
  let index = 0;
  RANKS.forEach((rank, i) => {
    if (wins >= rank.min) index = i;
  });
  return index;
}

// Heat cools down by itself over time
const heatOf = (r) => Math.max(0, (r.heat ?? 0) - (((Date.now() - (r.heatAt || Date.now())) / HOUR) * HEAT_DECAY));
function addHeat(r, amount) {
  r.heat = clamp(heatOf(r) + amount, 0, 100);
  r.heatAt = Date.now();
}
const heatLabel = (h) => (h >= WANTED_AT ? '🚨 Wanted' : h >= 50 ? '🔥 Hunted' : h >= 25 ? '👀 Noticed' : '🧊 Cool');
const cooldownMs = (r) => ROB.COOLDOWN_MS * RANKS[rankIndex(r.wins)].cooldown;

function revengeFor(robberId, targetId) {
  const rv = peekUser(robberId).rob?.revenge;
  return rv && rv.id === targetId && rv.until > Date.now() ? rv : null;
}

function ownedGear(u) {
  const inv = u.inventory ?? {};
  return {
    lockpick: Boolean(u.effects?.lockpick) || (inv.lockpick ?? 0) > 0,
    crowbar: (inv.crowbar ?? 0) > 0,
    disguise: (inv.disguise ?? 0) > 0,
    getaway: (inv.getaway ?? 0) > 0,
  };
}

// ---------- Odds and stakes ----------
function stakeRange(methodId, targetCoins, robberCoins, rankIdx) {
  const m = METHODS[methodId];
  const winFloor = { pickpocket: 50, burglary: 100, smash: 160, crew: 120 }[methodId] ?? 50;
  const absMax = 2500 + rankIdx * 500;
  const winAt = (p) => Math.max(winFloor, Math.min(Math.floor((targetCoins * p) / 100), absMax));
  const loseLimit = Math.max(1, Math.floor((robberCoins * (m.cap + RANKS[rankIdx].cap)) / 100));
  return { lo: winAt(m.lo), hi: winAt(m.hi), loseLimit, absMax };
}

// Adds up every effect on the success chance. With consume = true a spy mark is used up (real robbery).
// Defenses the thief doesn't know about (padlock, alarm, guards) only count once they're revealed by a spy.
function oddsFor({ robberId, targetId, methodId, items = {}, steps = 0, crew = 1, reveal = false, consume = false }) {
  const m = METHODS[methodId];
  const R = readRob(peekUser(robberId));
  const spy = require('./spy');
  const parts = [];
  let total = 0;
  const add = (label, value) => {
    if (!value) return;
    total += value;
    if (Math.abs(value) >= 0.005) parts.push({ label, value });
  };

  const rank = RANKS[rankIndex(R.wins)];
  const heat = heatOf(R);
  add(`${rank.emoji} ${rank.name}`, rank.chance);
  add('🔥 Heat', -(heat / 100) * 0.15);
  if (heat >= WANTED_AT) add('🚨 Wanted', -0.05);
  add('📜 Decrees & events', bonus('robChance'));
  add('🌦️ Weather', weatherBonus('robChance'));
  const mark = consume ? spy.markBonus(robberId, targetId) : spy.peekMark(robberId, targetId);
  add('🕵️ Spy mark', mark);
  if (revengeFor(robberId, targetId)) add('😡 Revenge', REVENGE_BONUS);
  if (items.lockpick) add('🪛 Lockpick', 0.2);
  if (steps) add('🧠 Minigame', 0.03 * steps);
  if (methodId === 'crew' && crew > 1) add('👥 Crew', Math.min(0.21, 0.07 * (crew - 1)));

  const known = reveal || mark > 0;
  let defense = null;
  if (known) {
    const { guardPower } = require('./muscle');
    const inv = peekUser(targetId).inventory ?? {};
    add('🛡️ Their guards', -guardPower(targetId) * mult('guardWeak'));
    if ((inv.alarm ?? 0) > 0) add('🚨 Their alarm', -0.12);
    defense = { padlock: inv.padlock ?? 0, alarm: inv.alarm ?? 0, decoy: inv.decoy ?? 0, insurance: inv.insurance ?? 0 };
  }
  return { chance: clamp(m.chance + total, 0.05, 0.9), parts, known, defense };
}

function npcOdds(userId, mark) {
  const R = readRob(peekUser(userId));
  const rank = RANKS[rankIndex(R.wins)];
  const heat = heatOf(R);
  const parts = [];
  let total = 0;
  const add = (label, value) => {
    if (!value) return;
    total += value;
    if (Math.abs(value) >= 0.005) parts.push({ label, value });
  };
  add(`${rank.emoji} ${rank.name}`, rank.chance);
  add('🔥 Heat', -(heat / 100) * 0.15);
  if (heat >= WANTED_AT) add('🚨 Wanted', -0.05);
  add('📜 Decrees & events', bonus('robChance'));
  add('🌦️ Weather', weatherBonus('robChance'));
  return { chance: clamp(mark.chance + total, 0.05, 0.9), parts };
}

const npcUnit = (u, rankIdx) => Math.round(120 * careerFor(u.works ?? 0).mult * (1 + 0.08 * rankIdx));

// ---------- Checks before a robbery ----------
function validate(robberIds, targetId) {
  if (!isRobEnabled()) return 'Robbing is turned off in this server. An admin can enable it with `!!settings rob on`.';
  if (flag('robBan')) return '🕊️ The Overlord has decreed peace. Robbery is forbidden for now.';
  const now = Date.now();
  const crew = robberIds.length > 1;

  for (const id of robberIds) {
    const u = peekUser(id);
    const who = crew ? `<@${id}>: ` : '';
    const readyAt = (u.lastRob ?? 0) + cooldownMs(readRob(u));
    if (now < readyAt) return `⏳ ${who}You're laying low after your last job. Try again <t:${Math.ceil(readyAt / 1000)}:R>.`;
    if (u.coins < ROB.MIN_COINS) return `${who}You need at least **${fmt(ROB.MIN_COINS)}** to pull a job, because you'd pay a fine if you got caught.`;
  }

  const target = peekUser(targetId);
  if (target.coins < ROB.MIN_COINS) return `They only have **${fmt(target.coins)}**. That's not worth the risk!`;
  const until = target.robProtectedUntil ?? 0;
  if (until > now && !revengeFor(robberIds[0], targetId)) {
    return `🛡️ They were just robbed and are being watched closely. Try again <t:${Math.ceil(until / 1000)}:R>.`;
  }
  return null;
}

function validateNpc(userId, mark) {
  if (!isRobEnabled()) return 'Robbing is turned off in this server. An admin can enable it with `!!settings rob on`.';
  const u = peekUser(userId);
  const R = readRob(u);
  const need = mark.minRank ?? 0;
  if (rankIndex(R.wins) < need) return `🔒 You need to be a **${RANKS[need].name}** to hit the ${mark.name}.`;
  const readyAt = (u.lastRob ?? 0) + cooldownMs(R);
  if (Date.now() < readyAt) return `⏳ You're laying low after your last job. Try again <t:${Math.ceil(readyAt / 1000)}:R>.`;
  const today = new Date().toISOString().slice(0, 10);
  if (R.npcDay === today && R.npcToday >= NPC_DAILY_LIMIT) return `The marks are wise to you today (${NPC_DAILY_LIMIT} jobs max per day). Come back tomorrow, or rob a player.`;
  return null;
}

// ---------- NPC marks rotate every few hours (same marks for everyone in a server, no saving needed) ----------
function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function currentMarks(guildId) {
  const window = Math.floor(Date.now() / MARK_WINDOW_MS);
  const random = mulberry32(hashStr(`${guildId}:${window}`));
  const pool = [...NPC_MARKS];
  const marks = [];
  while (marks.length < 3 && pool.length) marks.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  return { marks, until: (window + 1) * MARK_WINDOW_MS };
}

// ---------- The actual robbery (runs in one go, so nothing can change halfway) ----------
function chronicle(out, leaderId, targetId, crewSize) {
  try {
    const { logEvent } = require('./world');
    if (out.kind === 'success') {
      const total = out.robbers.reduce((n, b) => n + b.gain, 0);
      if (total >= 1000) {
        logEvent(`🦹 ${crewSize > 1 ? `A crew of ${crewSize}` : `<@${leaderId}>`} robbed <@${targetId}> for ${fmt(total)}`);
      }
    }
    for (const b of out.robbers) if (b.wanted) logEvent(`🚨 <@${b.id}> is now Most Wanted`);
  } catch {
    /* the chronicle is optional */
  }
}

function resolveRob({ methodId, robberIds, targetId, items = {}, steps = 0 }) {
  const m = METHODS[methodId];
  const now = Date.now();
  const target = getUser(targetId);
  const tRob = ensureRob(target);
  const tInv = target.inventory;

  const robbers = robberIds.map((id) => {
    const u = getUser(id);
    const r = ensureRob(u);
    u.effects ??= {};
    const rank = rankIndex(r.wins);
    return {
      id, u, r, rank,
      limit: Math.max(1, Math.floor((u.coins * (m.cap + RANKS[rank].cap)) / 100)),
      wasWanted: heatOf(r) >= WANTED_AT,
    };
  });
  const L = robbers[0];
  const totalLimit = robbers.reduce((n, b) => n + b.limit, 0);
  const targetBefore = target.coins;
  const usedRevenge = Boolean(revengeFor(L.id, targetId));

  const absMax = 2500 + L.rank * 500;
  const winStake = Math.max(1, Math.min(Math.floor((targetBefore * rand(m.lo, m.hi)) / 100), absMax));
  const loseStake = Math.max(1, Math.min(winStake, totalLimit));
  const stake = winStake;
  const odds = oddsFor({ robberId: L.id, targetId, methodId, items, steps, crew: robbers.length, reveal: true, consume: true });
  const heatGain = m.heat * mult('robHeat') * (items.disguise ? 0.4 : 1);

  const out = {
    kind: 'fail', methodId, odds, stake, loseStake, targetBefore, usedRevenge,
    robbers: robbers.map((b) => ({ id: b.id, gain: 0, loss: 0, after: 0, heatAfter: 0, rankUp: null, wanted: false })),
  };

  for (const b of robbers) b.u.lastRob = now;
  if (usedRevenge) L.r.revenge = null;
  if (items.disguise) {
    removeItem(L.u, 'disguise');
    out.disguiseUsed = true;
  }
  const useLockpick = () => {
    if (!items.lockpick) return;
    if (L.u.effects.lockpick) L.u.effects.lockpick = false;
    else removeItem(L.u, 'lockpick');
    out.lockpickUsed = true;
  };

  // A padlock stops the robbery (a crowbar breaks it open and the job goes ahead)
  let blocked = false;
  if ((tInv.padlock ?? 0) > 0) {
    if (items.crowbar) {
      removeItem(L.u, 'crowbar');
      removeItem(target, 'padlock');
      out.crowbarUsed = true;
      out.padlockBroken = true;
    } else {
      removeItem(target, 'padlock');
      blocked = true;
    }
  }
  useLockpick();

  if (blocked) {
    out.kind = 'padlock';
    for (const b of robbers) {
      b.r.fails++;
      b.r.streak = 0;
      addHeat(b.r, heatGain * 0.5);
    }
  } else {
    const hasAlarm = (tInv.alarm ?? 0) > 0;
    if (hasAlarm) {
      removeItem(target, 'alarm'); // one charge per attempt
      out.alarm = true;
    }

    if (Math.random() < odds.chance) {
      out.kind = 'success';
      out.lucky = Math.random() < 0.05;
      let loot = Math.round(stake * mult('robLoot') * (out.lucky ? 1.5 : 1));
      if ((tInv.decoy ?? 0) > 0) {
        removeItem(target, 'decoy');
        loot = Math.round(loot * 0.4);
        out.decoy = true;
      }
      const parts = robbers.map((b) => Math.floor((loot * b.limit) / totalLimit));
      parts[0] += loot - parts.reduce((n, p) => n + p, 0);

      let moved = 0;
      robbers.forEach((b, i) => {
        const got = transferUpTo(targetId, b.id, parts[i]);
        moved += got;
        out.robbers[i].gain = got;
        b.r.wins++;
        b.r.stolen += got;
        b.r.biggest = Math.max(b.r.biggest, got);
        b.r.streak++;
        b.r.bestStreak = Math.max(b.r.bestStreak, b.r.streak);
        addHeat(b.r, heatGain);
      });

      if ((tInv.insurance ?? 0) > 0 && moved > 0) {
        removeItem(target, 'insurance');
        out.refund = Math.min(INSURANCE_CAP, Math.round(moved * 0.4));
        addCoins(targetId, out.refund);
      }
      tRob.robbed++;
      tRob.robbedTotal += moved;
      target.robProtectedUntil = now + ROB.PROTECTION_MS;
      if (moved > 0) tRob.revenge = { id: L.id, until: now + REVENGE_MS, amount: moved };
    } else {
      out.kind = 'fail';
      let fine = loseStake * mult('robFine') * (hasAlarm ? 1.5 : 1) * (items.disguise ? 0.5 : 1);
      if (items.getaway) {
        removeItem(L.u, 'getaway');
        out.getawayUsed = true;
        fine = 0;
      } else if (Math.random() < 0.12) {
        fine *= 0.5;
        out.narrow = true;
      }
      robbers.forEach((b, i) => {
        const wanted = Math.min(Math.round((fine * b.limit) / totalLimit), Math.floor(b.u.coins * FINE_CAP));
        const paid = wanted > 0 ? transferUpTo(b.id, targetId, wanted) : 0;
        out.robbers[i].loss = paid;
        b.r.fails++;
        b.r.lost += paid;
        b.r.streak = 0;
        addHeat(b.r, heatGain * 0.5);
      });
    }
  }

  robbers.forEach((b, i) => {
    const o = out.robbers[i];
    o.after = b.u.coins;
    o.heatAfter = heatOf(b.r);
    const newRank = rankIndex(b.r.wins);
    if (newRank > b.rank) o.rankUp = RANKS[newRank];
    o.wanted = !b.wasWanted && o.heatAfter >= WANTED_AT;
  });
  markDirty();
  chronicle(out, L.id, targetId, robbers.length);
  return out;
}

function resolveNpc(userId, mark) {
  const u = getUser(userId);
  const r = ensureRob(u);
  const rankBefore = rankIndex(r.wins);
  const wasWanted = heatOf(r) >= WANTED_AT;
  const odds = npcOdds(userId, mark);
  const stake = Math.max(10, Math.round(npcUnit(u, rankBefore) * rand(mark.pay[0], mark.pay[1])));
  const today = new Date().toISOString().slice(0, 10);

  u.lastRob = Date.now();
  if (r.npcDay !== today) {
    r.npcDay = today;
    r.npcToday = 0;
  }
  r.npcToday++;
  r.npc++;

  const out = { kind: 'npc', mark, odds, stake, success: false, gain: 0, loss: 0 };
  if (Math.random() < odds.chance) {
    out.success = true;
    out.gain = Math.round(stake * mult('npcLoot'));
    addCoins(userId, out.gain);
    r.wins++;
    r.npcWins++;
    r.npcStolen += out.gain;
    r.biggest = Math.max(r.biggest, out.gain);
    r.streak++;
    r.bestStreak = Math.max(r.bestStreak, r.streak);
    addHeat(r, mark.heat * mult('robHeat'));
  } else {
    const fine = Math.min(Math.round(stake * 0.5 * mult('robFine')), Math.floor(u.coins * FINE_CAP));
    out.loss = fine > 0 ? -applyDelta(userId, -fine) : 0;
    r.fails++;
    r.lost += out.loss;
    r.streak = 0;
    addHeat(r, mark.heat * mult('robHeat') * 0.5);
  }
  out.after = u.coins;
  out.heatAfter = heatOf(r);
  const rankAfter = rankIndex(r.wins);
  out.rankUp = rankAfter > rankBefore ? RANKS[rankAfter] : null;
  out.wanted = !wasWanted && out.heatAfter >= WANTED_AT;
  markDirty();
  try {
    if (out.wanted) require('./world').logEvent(`🚨 <@${userId}> is now Most Wanted`);
  } catch {
    /* optional */
  }
  return out;
}

// ---------- Open menus, lobbies and chases (in memory only: coins only move when a robbery is resolved) ----------
const sessions = new Map(); // id -> session
const byUser = new Map(); // userId -> session id
const chases = new Map(); // id -> chase

function endSession(s) {
  if (!s) return;
  clearTimeout(s.timer);
  clearTimeout(s.lobbyTimer);
  clearTimeout(s.miniTimer);
  sessions.delete(s.id);
  if (byUser.get(s.userId) === s.id) byUser.delete(s.userId);
}

const editMsg = (s, payload) => {
  const message = s.msg ?? s.ref;
  if (!message?.edit) return Promise.resolve(null);
  return Promise.resolve(message.edit(payload)).catch(() => null);
};

function expire(s) {
  if (!sessions.has(s.id)) return;
  if (s.locked) {
    s.timer = setTimeout(() => expire(s), 30 * 1000);
    return;
  }
  endSession(s);
  editMsg(s, { content: '⌛ The moment passed. You decided not to risk it.', embeds: [], components: [] });
}

function touch(s) {
  clearTimeout(s.timer);
  s.timer = setTimeout(() => expire(s), SESSION_MS);
}

function createSession(data) {
  const old = sessions.get(byUser.get(data.userId));
  if (old && !old.locked) {
    endSession(old);
    editMsg(old, { content: '↩️ You started a new plan, so this one was dropped.', embeds: [], components: [] });
  }
  const s = { id: newId(sessions), state: 'menu', items: {}, steps: 0, locked: false, ...data };
  sessions.set(s.id, s);
  byUser.set(s.userId, s.id);
  touch(s);
  return s;
}

// ---------- Cards ----------
const btn = (s, action, arg, label, style = ButtonStyle.Secondary, emoji = null, disabled = false) => {
  const id = ['rob', s.id, action, arg].filter((x) => x !== undefined && x !== null).join(':');
  const b = new ButtonBuilder().setCustomId(id).setLabel(String(label).slice(0, 80)).setStyle(style).setDisabled(disabled);
  if (emoji) b.setEmoji(emoji);
  return b;
};
const row = (...buttons) => new ActionRowBuilder().addComponents(...buttons);
const card = (embed, rows = []) => ({ content: null, embeds: [embed], components: rows });
const edgeText = (parts) => (parts.length ? parts.map((p) => `${p.label} ${signed(p.value)}`).join(' · ') : 'No bonuses or penalties right now');

function menuCard(s) {
  const robber = peekUser(s.userId);
  const target = peekUser(s.targetId);
  const R = readRob(robber);
  const rankIdx = rankIndex(R.wins);
  const heat = heatOf(R);
  const lines = [];
  let edge = [];
  let known = false;

  for (const id of ['pickpocket', 'burglary', 'smash', 'crew']) {
    const m = METHODS[id];
    const o = oddsFor({ robberId: s.userId, targetId: s.targetId, methodId: id });
    if (id === 'burglary') {
      edge = o.parts;
      known = o.known;
    }
    const range = stakeRange(id, target.coins, robber.coins, rankIdx);
    lines.push(
      `${m.emoji} **${m.name}**: **${Math.round(o.chance * 100)}%** · stake ${fmt(range.lo)}–${fmt(range.hi)}` +
        (id === 'crew' ? ' *(more with a bigger crew)*' : '')
    );
  }

  const rv = revengeFor(s.userId, s.targetId);
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`🥷 Robbing ${s.targetName}`)
    .setDescription(
      `Their wallet: **${fmt(target.coins)}**\n` +
        `${RANKS[rankIdx].emoji} **${RANKS[rankIdx].name}** · ${heatLabel(heat)} (${Math.round(heat)}/100)` +
        (rv ? '\n😡 **Revenge token:** they robbed you, so you get +15% and ignore their protection.' : '')
    )
    .addFields(
      { name: 'Choose your approach', value: lines.join('\n') },
      { name: 'Your edge', value: edgeText(edge) },
      { name: 'Their defenses', value: known ? 'Included in the odds above (spy intel).' : '❓ Unknown. A `!!spy` reveals guards and traps.' }
    )
    .setFooter({ text: 'Win loot scales with THEIR wallet. If you get caught, you only risk a share of YOUR coins.' });

  return card(embed, [
    row(
      btn(s, 'm', 'pickpocket', 'Pickpocket', ButtonStyle.Secondary, '🧤'),
      btn(s, 'm', 'burglary', 'Burglary', ButtonStyle.Primary, '🔓'),
      btn(s, 'm', 'smash', 'Smash & Grab', ButtonStyle.Danger, '💥'),
      btn(s, 'm', 'crew', 'Crew', ButtonStyle.Success, '👥'),
      btn(s, 'abort', null, 'Abort', ButtonStyle.Secondary, '✖️')
    ),
  ]);
}

function methodCard(s) {
  const m = METHODS[s.method];
  const robber = peekUser(s.userId);
  const target = peekUser(s.targetId);
  const rankIdx = rankIndex(readRob(robber).wins);
  const o = oddsFor({ robberId: s.userId, targetId: s.targetId, methodId: s.method, items: s.items });
  const range = stakeRange(s.method, target.coins, robber.coins, rankIdx);
  const owned = ownedGear(robber);

  const defenseText = o.known
    ? `🔒 Padlocks: ${o.defense.padlock} · 🚨 Alarms: ${o.defense.alarm} · 👛 Decoys: ${o.defense.decoy} · 📜 Insurance: ${o.defense.insurance}`
    : '❓ Unknown (spy to reveal)';

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${m.emoji} ${m.name} on ${s.targetName}`)
    .setDescription(m.blurb)
    .addFields(
      { name: 'Success chance', value: `**${Math.round(o.chance * 100)}%**`, inline: true },
      { name: 'Stake', value: `${fmt(range.lo)}–${fmt(range.hi)}\n*win or lose the same*`, inline: true },
      { name: 'Breakdown', value: edgeText(o.parts) },
      { name: 'Known defenses', value: defenseText },
      { name: '🧠 Minigame', value: 'Memorize a **5-step** lock sequence. One wrong press fails it. Up to **+15%** if perfect.' }
    );

  const gearButtons = Object.entries(GEAR)
    .filter(([key]) => owned[key])
    .map(([key, g]) => btn(s, 'gear', key, g.label, s.items[key] ? ButtonStyle.Success : ButtonStyle.Secondary, g.emoji));

  const rows = [
    row(
      btn(s, 'go', null, 'Go!', ButtonStyle.Success, '▶️'),
      btn(s, 'mini', null, 'Minigame', ButtonStyle.Primary, '🧠'),
      btn(s, 'back', null, 'Back', ButtonStyle.Secondary, '⬅️')
    ),
  ];
  if (gearButtons.length) {
    rows.push(row(...gearButtons));
    embed.setFooter({ text: '🪛 +20% success · 🔧 beats a Padlock · 🎭 less heat, half fine · 💨 no fine if caught (green = on)' });
  }
  return card(embed, rows);
}

function lobbyCard(s) {
  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(`👥 Crew job on ${s.targetName}`)
    .setDescription(
      `**Crew (${s.members.length}/${MAX_CREW}):**\n${s.members.map((id) => `• <@${id}>`).join('\n')}\n\n` +
        'Everyone risks their own coins and shares the loot in proportion. +7% success per extra member.\n' +
        `The job starts <t:${Math.floor(s.deadline / 1000)}:R> or when the leader presses Start.`
    );
  return card(embed, [
    row(
      btn(s, 'join', null, 'Join the crew', ButtonStyle.Success, '🤝'),
      btn(s, 'start', null, 'Start now', ButtonStyle.Primary, '🚀'),
      btn(s, 'cancel', null, 'Cancel', ButtonStyle.Secondary, '✖️')
    ),
  ]);
}

function miniCard(s) {
  const progress = s.seq.map((_, i) => (i < s.pos ? '🔓' : '🔒')).join(' ');
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle('🧠 Repeat the sequence!')
    .setDescription(`${progress}\n\nPress the colors in the order you saw them.`);
  return card(embed, [row(...SYMBOLS.map((symbol, i) => btn(s, 'seq', i, ' ', ButtonStyle.Secondary, symbol)))]);
}

function hubCard(s) {
  const u = peekUser(s.userId);
  const R = readRob(u);
  const rankIdx = rankIndex(R.wins);
  const heat = heatOf(R);
  const { marks, until } = currentMarks(s.guildId);
  const unit = npcUnit(u, rankIdx);
  const today = new Date().toISOString().slice(0, 10);
  const left = NPC_DAILY_LIMIT - (R.npcDay === today ? R.npcToday : 0);
  const readyAt = (u.lastRob ?? 0) + cooldownMs(R);

  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle('🥷 The Underworld')
    .setDescription(
      `${RANKS[rankIdx].emoji} **${RANKS[rankIdx].name}** · ${heatLabel(heat)} (${Math.round(heat)}/100)\n` +
        `${Date.now() < readyAt ? `⏳ Laying low until <t:${Math.ceil(readyAt / 1000)}:R>` : '✅ Ready for a job'} · NPC jobs left today: **${left}**\n` +
        `New marks <t:${Math.floor(until / 1000)}:R>. To rob a player use \`!!rob @user\`.`
    );
  for (const mark of marks) {
    const o = npcOdds(s.userId, mark);
    const lock = rankIdx < mark.minRank ? ` 🔒 *needs ${RANKS[mark.minRank].name}*` : '';
    embed.addFields({
      name: `${mark.emoji} ${mark.name}${lock}`,
      value: `${mark.blurb}\n**${Math.round(o.chance * 100)}%** · ${fmt(Math.round(unit * mark.pay[0]))}–${fmt(Math.round(unit * mark.pay[1]))} · 🔥 +${mark.heat}`,
    });
  }
  return card(embed, [
    row(
      ...marks.map((mark) => btn(s, 'npc', mark.id, mark.name, ButtonStyle.Primary, mark.emoji, rankIdx < mark.minRank)),
      btn(s, 'stats', null, 'Stats', ButtonStyle.Secondary, '📊'),
      btn(s, 'close', null, 'Close', ButtonStyle.Secondary, '✖️')
    ),
  ]);
}

function statsEmbed(user, u) {
  const R = readRob(u);
  const idx = rankIndex(R.wins);
  const rank = RANKS[idx];
  const next = RANKS[idx + 1];
  const total = R.wins + R.fails;
  const heat = heatOf(R);
  const rv = R.revenge && R.revenge.until > Date.now() ? `<@${R.revenge.id}> (<t:${Math.floor(R.revenge.until / 1000)}:R>)` : 'none';
  return new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle(`${rank.emoji} ${user.globalName ?? user.username}: ${rank.name}`)
    .setDescription(
      (next ? `**${R.wins}/${next.min}** wins to **${next.emoji} ${next.name}**` : 'Top of the underworld. 🎩') +
        `\nPerks: ${signed(rank.chance)} success · ${Math.round((1 - rank.cooldown) * 100)}% shorter cooldown · +${rank.cap}% stake room`
    )
    .addFields(
      { name: 'Record', value: `✅ ${R.wins} wins · ❌ ${R.fails} fails · ${total ? Math.round((R.wins / total) * 100) : 0}% success`, inline: false },
      { name: 'Loot', value: `Stolen: **${fmt(R.stolen + R.npcStolen)}**\nLost to fines: **${fmt(R.lost)}**\nBiggest score: **${fmt(R.biggest)}**`, inline: true },
      { name: 'Streaks', value: `Current: **${R.streak}**\nBest: **${R.bestStreak}**`, inline: true },
      { name: 'As a victim', value: `Robbed **${R.robbed}** times (${fmt(R.robbedTotal)})\nChases won: **${R.chases}**`, inline: true },
      { name: 'Underworld', value: `🔥 Heat **${Math.round(heat)}/100** (${heatLabel(heat)})\nNPC jobs: **${R.npc}** (${R.npcWins} won)\n😡 Revenge token: ${rv}` }
    );
}

function resultCard(s, sceneKey, r) {
  const scene = SCENES[sceneKey];
  const name = s.targetName ?? 'the mark';
  const fill = (text) => text.replaceAll('{t}', name);
  const lines = [];
  let color = 0x5865f2;
  let title = '';
  const used = [];

  if (r.kind === 'npc') {
    if (r.success) {
      color = 0x2ecc71;
      title = `🎉 ${r.mark.name}: success!`;
      lines.push(fill(pick(scene.win)), '', `💰 You took **${fmt(r.gain)}**`);
    } else {
      color = 0xe74c3c;
      title = `🚔 ${r.mark.name}: caught!`;
      lines.push(fill(pick(scene.lose)), '', `You lost **${fmt(r.loss)}** in bribes and fines.`);
    }
    lines.push(`Balance: ${fmt(r.after)}`);
    if (r.rankUp) lines.push(`🎉 **Rank up!** You're now a **${r.rankUp.emoji} ${r.rankUp.name}**.`);
    if (r.wanted) lines.push('🚨 You are now **Most Wanted**!');
    lines.push(`🔥 Heat ${Math.round(r.heatAfter)}/100 (${heatLabel(r.heatAfter)})`);
    return card(new EmbedBuilder().setColor(color).setTitle(title).setDescription(lines.join('\n')).setFooter({ text: `Odds were ${Math.round(r.odds.chance * 100)}%` }));
  }

  const crew = r.robbers.length > 1;
  const total = r.robbers.reduce((n, b) => n + b.gain, 0);
  const paid = r.robbers.reduce((n, b) => n + b.loss, 0);
  const me = r.robbers[0];

  if (r.kind === 'padlock') {
    color = 0x95a5a6;
    title = '🔒 Padlock!';
    lines.push(`<@${s.targetId}> had a **Padlock**! The job failed and their lock broke. You pay nothing.`);
  } else if (r.kind === 'success') {
    color = 0x2ecc71;
    title = crew ? '👥 The crew pulled it off!' : '🦹 Success!';
    lines.push(fill(pick(scene.win)), '', `💰 **${fmt(total)}** stolen (${Math.round((total / r.targetBefore) * 1000) / 10}% of their ${fmt(r.targetBefore)})`);
    if (r.lucky) lines.push('🍀 **Lucky score!** The haul was 50% bigger.');
    if (r.decoy) lines.push('👛 It was a **Decoy Wallet**! You only walked off with 40% of the haul.');
    if (r.padlockBroken) lines.push('🔧 Your **Crowbar** popped their padlock open.');
    if (crew) for (const b of r.robbers) lines.push(`• <@${b.id}> +${fmt(b.gain)}`);
  } else {
    color = 0xe74c3c;
    title = crew ? '🚔 The crew got caught!' : '🚔 Caught!';
    lines.push(fill(pick(scene.lose)), '');
    if (r.getawayUsed) lines.push('💨 Your **Getaway Smoke** hid you. **No fine!**');
    else lines.push(`You paid **${fmt(paid)}** to <@${s.targetId}>.`);
    if (r.narrow) lines.push('😮‍💨 A close call! The fine was cut in half.');
    if (r.alarm) lines.push('🚨 Their **Alarm System** blared: the fine was 50% bigger.');
    if (r.padlockBroken) lines.push('🔧 Your **Crowbar** popped their padlock, but it still went wrong.');
    if (crew) for (const b of r.robbers) lines.push(`• <@${b.id}> −${fmt(b.loss)}`);
  }

  if (r.lockpickUsed) used.push('🪛 Lockpick');
  if (r.crowbarUsed) used.push('🔧 Crowbar');
  if (r.disguiseUsed) used.push('🎭 Disguise');
  if (r.getawayUsed) used.push('💨 Getaway');
  if (r.usedRevenge) lines.push('😡 Revenge token used.');
  if (used.length) lines.push(`*Used up: ${used.join(', ')}*`);
  if (!crew) lines.push(`Balance: ${fmt(me.after)} · 🔥 Heat ${Math.round(me.heatAfter)}/100 (${heatLabel(me.heatAfter)})`);
  for (const b of r.robbers) {
    if (b.rankUp) lines.push(`🎉 <@${b.id}> ranked up to **${b.rankUp.emoji} ${b.rankUp.name}**!`);
    if (b.wanted) lines.push(`🚨 <@${b.id}> is now **Most Wanted**!`);
  }
  if (r.kind === 'success' && total >= CHASE_MIN_LOOT) lines.push(`\n🏃 <@${s.targetId}> has 60 seconds to chase you down…`);

  return card(new EmbedBuilder().setColor(color).setTitle(title).setDescription(lines.join('\n')).setFooter({ text: `Odds were ${Math.round(r.odds.chance * 100)}%` }));
}

// ---------- Staged scene ----------
async function playOut(s, interaction, sceneKey, intro, finish) {
  s.locked = true;
  const scene = SCENES[sceneKey];
  const name = s.targetName ?? 'the mark';
  const fill = (text) => text.replaceAll('{t}', name);
  const frame = (text) => card(new EmbedBuilder().setColor(0x5865f2).setDescription(text));
  const first = `${intro}${fill(pick(scene.go))}`;
  const second = `${first}\n${fill(pick(scene.tense))}`;

  try {
    if (interaction && !interaction.replied && !interaction.deferred) await interaction.update(frame(first));
    else await editMsg(s, frame(first));
    await sleep(1300);
    await editMsg(s, frame(second));
    await sleep(1300);
    const result = finish();
    await editMsg(s, resultCard(s, sceneKey, result));
    if (result.kind === 'success') await offerChase(s, result);
  } catch (err) {
    const text = require('./guard').friendlyError(err, '!!rob');
    await editMsg(s, { content: text, embeds: [], components: [] });
  } finally {
    endSession(s);
  }
}

async function offerChase(s, r) {
  const total = r.robbers.reduce((n, b) => n + b.gain, 0);
  if (total < CHASE_MIN_LOOT) return;
  const channel = s.msg?.channel ?? s.ref?.channel;
  if (!channel?.send) return;

  const id = newId(chases);
  const chase = {
    id,
    victimId: s.targetId,
    thieves: r.robbers.filter((b) => b.gain > 0).map((b) => ({ id: b.id, amount: b.gain })),
    heat: r.robbers[0].heatAfter,
  };
  const button = new ButtonBuilder().setCustomId(`rob:chase:${id}`).setLabel('Chase them!').setEmoji('🏃').setStyle(ButtonStyle.Danger);
  const msg = await channel
    .send({
      content: `🚨 <@${s.targetId}>, you were just robbed of **${fmt(total)}**! Chase the thief?`,
      components: [row(button)],
      allowedMentions: { users: [s.targetId] }, // remove this line if you don't want victims pinged
    })
    .catch(() => null);
  if (!msg) return;
  chase.timer = setTimeout(() => {
    if (!chases.delete(id)) return;
    msg.edit({ content: `💨 The thief got away with **${fmt(total)}**. Your revenge token lasts 24 hours (\`!!rob @thief\`).`, components: [] }).catch(() => {});
  }, CHASE_MS);
  chases.set(id, chase);
}

async function handleChase(interaction, id) {
  const chase = chases.get(id);
  if (!chase) return privateReply(interaction, '💨 Too late. They got away.');
  if (interaction.user.id !== chase.victimId) return privateReply(interaction, "This isn't your chase.");
  chases.delete(id);
  clearTimeout(chase.timer);

  const { guardPower } = require('./muscle');
  const chance = clamp(0.35 + Math.min(0.25, chase.heat / 400) + guardPower(chase.victimId) * 0.5, 0.1, 0.85);
  let text;
  if (Math.random() < chance) {
    let back = 0;
    for (const thief of chase.thieves) {
      back += transferUpTo(thief.id, chase.victimId, Math.round(thief.amount * 0.6));
      addHeat(ensureRob(getUser(thief.id)), 8);
    }
    ensureRob(getUser(chase.victimId)).chases++;
    markDirty();
    text = `🏃 <@${chase.victimId}> tackled the thief and took back **${fmt(back)}**!`;
  } else {
    text = `💨 <@${chase.victimId}> chased them through the alleys but lost them in the crowd. Your revenge token is still active for 24 hours.`;
  }
  return interaction.update({ content: text, components: [] });
}

// ---------- Minigame ----------
async function startMinigame(s, interaction) {
  s.seq = Array.from({ length: 5 }, () => Math.floor(Math.random() * SYMBOLS.length));
  s.pos = 0;
  s.failed = false;
  s.failed = false;
  s.state = 'mini-show';
  await interaction.update(
    card(new EmbedBuilder().setColor(0xf1c40f).setTitle('🧠 Memorize the tumblers! (5 steps — one mistake fails)')
      .setDescription(`# ${s.seq.map((i) => SYMBOLS[i]).join(' ')}

Then press them **in order**.`))
  );
  await sleep(1800);
  if (!sessions.has(s.id) || s.state !== 'mini-show') return;
  s.state = 'mini';
  await editMsg(s, miniCard(s));
  s.miniTimer = setTimeout(() => {
    if (!sessions.has(s.id) || s.state !== 'mini' || s.locked) return;
    endSession(s);
    editMsg(s, { content: '😰 You froze up and the moment passed.', embeds: [], components: [] });
  }, 25 * 1000);
}

async function handleSeq(s, interaction, index) {
  if (s.state !== 'mini') return interaction.deferUpdate().catch(() => {});
  if (index === s.seq[s.pos]) {
    s.pos++;
  } else {
    s.failed = true;
    s.pos = 0;
  }
  if (s.failed || s.pos >= s.seq.length) {
    clearTimeout(s.miniTimer);
    return goSolo(s, interaction, s.failed ? 0 : s.pos);
  }
  return interaction.update(miniCard(s));
}

// ---------- Starting the robbery ----------
async function goSolo(s, interaction, steps) {
  const err = validate([s.userId], s.targetId);
  if (err) {
    endSession(s);
    return interaction.update({ content: err, embeds: [], components: [] });
  }
  const owned = ownedGear(peekUser(s.userId));
  for (const key of Object.keys(GEAR)) if (s.items[key] && !owned[key]) s.items[key] = false;
  const intro = steps ? `🧠 The tumblers click… **+${steps * 3}%**\n` : s.state === 'mini' ? '🧠 The tumblers jam… **+0%**\n' : '';
  return playOut(s, interaction, s.method, intro, () =>
    resolveRob({ methodId: s.method, robberIds: [s.userId], targetId: s.targetId, items: s.items, steps })
  );
}

async function startLobby(s, interaction) {
  s.method = 'crew';
  s.members = [s.userId];
  s.state = 'lobby';
  s.deadline = Date.now() + LOBBY_MS;
  s.lobbyTimer = setTimeout(() => startCrewRun(s, null).catch(() => {}), LOBBY_MS);
  return interaction.update(lobbyCard(s));
}

async function handleJoin(s, interaction) {
  if (s.state !== 'lobby') return privateReply(interaction, 'That crew has already left.');
  const id = interaction.user.id;
  if (id === s.targetId) return privateReply(interaction, "You can't join a job against yourself!");
  if (s.members.includes(id)) return privateReply(interaction, "You're already in the crew.");
  if (s.members.length >= MAX_CREW) return privateReply(interaction, 'The crew is full.');
  const err = validate([id], s.targetId);
  if (err) return privateReply(interaction, err);
  s.members.push(id);
  s.msg = interaction.message;
  return interaction.update(lobbyCard(s));
}

async function startCrewRun(s, interaction) {
  if (s.state !== 'lobby') return;
  clearTimeout(s.lobbyTimer);
  s.state = 'run';
  const fail = (text) => {
    endSession(s);
    const payload = { content: text, embeds: [], components: [] };
    return interaction ? interaction.update(payload) : editMsg(s, payload);
  };
  if (s.members.length < 2) return fail('👥 Nobody joined your crew, so the job is off.');
  const err = validate(s.members, s.targetId);
  if (err) return fail(err);
  return playOut(s, interaction, 'crew', `👥 **Crew of ${s.members.length}**\n`, () =>
    resolveRob({ methodId: 'crew', robberIds: s.members, targetId: s.targetId, items: {}, steps: 0 })
  );
}

async function runNpc(s, interaction, markId) {
  const mark = NPC_MARKS.find((m) => m.id === markId);
  if (!mark) return interaction.deferUpdate().catch(() => {});
  const err = validateNpc(s.userId, mark);
  if (err) return privateReply(interaction, err);
  s.targetName = mark.name;
  return playOut(s, interaction, 'npc', '', () => resolveNpc(s.userId, mark));
}

// ---------- Button router ----------
async function handleInteraction(interaction) {
  const [, sid, action, arg] = interaction.customId.split(':'); // rob:<session>:<action>:<arg>
  if (require('./guard').isBlocked(interaction.user.id, interaction.guildId)) {
    return privateReply(interaction, '🚫 You (or this server) are blocked from using this bot.');
  }
  if (sid === 'chase') return handleChase(interaction, action);

  const s = sessions.get(sid);
  if (!s) return privateReply(interaction, '⌛ That plan has expired. Start a new one with `!!rob`.');
  if (action === 'join') return handleJoin(s, interaction);
  if (interaction.user.id !== s.userId) return privateReply(interaction, "This isn't your robbery.");
  if (s.locked) return interaction.deferUpdate().catch(() => {});

  s.msg = interaction.message;
  touch(s);

  switch (action) {
    case 'abort':
    case 'close':
      endSession(s);
      return interaction.update({ content: '🚶 You walk away. Maybe next time.', embeds: [], components: [] });
    case 'm':
      if (arg === 'crew') return startLobby(s, interaction);
      s.method = arg;
      s.state = 'method';
      return interaction.update(methodCard(s));
    case 'back':
      s.state = 'menu';
      return interaction.update(menuCard(s));
    case 'gear': {
      if (!ownedGear(peekUser(s.userId))[arg]) return privateReply(interaction, "You don't have one of those.");
      s.items[arg] = !s.items[arg];
      return interaction.update(methodCard(s));
    }
    case 'go':
      return goSolo(s, interaction, 0);
    case 'mini':
      return startMinigame(s, interaction);
    case 'seq':
      return handleSeq(s, interaction, Number(arg));
    case 'npc':
      return runNpc(s, interaction, arg);
    case 'stats':
      return interaction.reply({ embeds: [statsEmbed(interaction.user, peekUser(interaction.user.id))], flags: MessageFlags.Ephemeral });
    case 'start':
      return startCrewRun(s, interaction);
    case 'cancel':
      endSession(s);
      return interaction.update({ content: '✖️ The crew job was called off.', embeds: [], components: [] });
    case 'pay': {
      if (!spendCoins(s.userId, s.cost)) {
        endSession(s);
        return interaction.update({ content: "You can't afford that anymore.", embeds: [], components: [] });
      }
      const r = ensureRob(getUser(s.userId));
      r.heat = 0;
      r.heatAt = Date.now();
      markDirty();
      endSession(s);
      return interaction.update({ content: `🤝 You slipped the guard captain **${fmt(s.cost)}**. Your Heat is back to 0.`, embeds: [], components: [] });
    }
    default:
      return interaction.deferUpdate().catch(() => {});
  }
}

// ---------- The !!rob command ----------
async function showHub(message) {
  if (!isRobEnabled()) return message.reply('Robbing is turned off in this server. An admin can enable it with `!!settings rob on`.');
  const s = createSession({ kind: 'hub', userId: message.author.id, guildId: message.guildId ?? message.guild?.id });
  s.ref = await message.reply(hubCard(s));
}

async function startBribe(message) {
  const u = peekUser(message.author.id);
  const heat = heatOf(readRob(u));
  if (heat < 10) return message.reply(`🧊 You're not hot enough to need a bribe (Heat ${Math.round(heat)}/100).`);
  const cost = Math.max(100, Math.ceil(heat * 6));
  if (u.coins < cost) return message.reply(`A bribe would cost **${fmt(cost)}** and you only have **${fmt(u.coins)}**. Heat cools by ${HEAT_DECAY} per hour on its own.`);
  const s = createSession({ kind: 'bribe', userId: message.author.id, guildId: message.guildId ?? message.guild?.id, cost });
  s.ref = await message.reply(
    card(
      new EmbedBuilder()
        .setColor(0x95a5a6)
        .setTitle('🤝 Bribe the guard captain?')
        .setDescription(`Your Heat is **${Math.round(heat)}/100**. Pay **${fmt(cost)}** to wipe it clean? (Heat also cools by ${HEAT_DECAY} per hour for free.)`),
      [row(btn(s, 'pay', null, `Pay ${fmt(cost)}`, ButtonStyle.Success, '💰'), btn(s, 'close', null, 'Never mind', ButtonStyle.Secondary, '✖️'))]
    )
  );
}

async function showTop(message) {
  const rows = topBy((u) => (u.rob?.stolen ?? 0) + (u.rob?.npcStolen ?? 0), 10);
  if (!rows.length) return message.reply('Nobody has stolen anything yet. Be the first with `!!rob`!');
  const lines = rows.map((e, i) => `**${i + 1}.** <@${e.id}> ${RANKS[rankIndex(peekUser(e.id).rob?.wins ?? 0)].emoji} ${fmt(e.value)}`);
  return message.reply({ embeds: [new EmbedBuilder().setColor(0x2b2d31).setTitle('🥷 Top thieves').setDescription(lines.join('\n'))] });
}

async function run(message, arg) {
  const words = arg.split(/\s+/).filter(Boolean);
  const sub = words.find((w) => !/^<@!?\d+>$/.test(w)) ?? '';
  const target = message.mentions.users.first();

  if (['stats', 'profile', 'me'].includes(sub)) {
    const who = target ?? message.author;
    return message.reply({ embeds: [statsEmbed(who, peekUser(who.id))] });
  }
  if (['top', 'lb', 'leaderboard'].includes(sub)) return showTop(message);
  if (['bribe', 'laylow'].includes(sub)) return startBribe(message);
  if (!target || sub === 'marks') return showHub(message);

  if (target.bot) return message.reply("Bots don't carry any coins.");
  if (target.id === message.author.id) return message.reply("You can't rob yourself!");
  const err = validate([message.author.id], target.id);
  if (err) return message.reply(err);

  const s = createSession({
    kind: 'pvp',
    userId: message.author.id,
    targetId: target.id,
    targetName: target.globalName ?? target.username,
    guildId: message.guildId ?? message.guild?.id,
  });
  s.items = { lockpick: Boolean(peekUser(s.userId).effects?.lockpick) }; // an armed lockpick starts switched on
  s.ref = await message.reply(menuCard(s));
}

module.exports = { run, handleInteraction, METHODS, RANKS, NPC_MARKS };
