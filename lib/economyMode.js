// Classic (default) vs scarce (closed-ish loop) economy mode — per guild via world settings
const { data, saveNow, logEvent } = require('./world');
const treasury = require('./treasury');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const TAX_INTERVAL_MS = 24 * HOUR;

// Money supply target ≈ BASE + activeUsers * PER_ACTIVE (scarce mode only)
const SUPPLY_BASE = 5000;
const SUPPLY_PER_ACTIVE = 2500;
const ACTIVE_MS = 7 * DAY;

// Progressive tax on coins above brackets (daily when scarce)
// tax is applied to the excess in each band
const TAX_BRACKETS = [
  { above: 3000, rate: 0.02 },
  { above: 8000, rate: 0.05 },
  { above: 15000, rate: 0.1 },
  { above: 30000, rate: 0.15 },
];

function ensureSettings() {
  data.settings ??= {};
  data.settings.economyMode ??= 'classic';
  if (data.settings.economyMode !== 'scarce') data.settings.economyMode = 'classic';
  return data.settings;
}

function getMode() {
  return ensureSettings().economyMode === 'scarce' ? 'scarce' : 'classic';
}

function isScarce() {
  return getMode() === 'scarce';
}

function isClassic() {
  return !isScarce();
}

/**
 * Enable/disable scarce mode.
 * When turning scarce ON, seeds the treasury if empty so wages can pay out.
 */
function setMode(mode, { seedReserve = true } = {}) {
  const next = mode === 'scarce' ? 'scarce' : 'classic';
  const prev = getMode();
  ensureSettings().economyMode = next;
  treasury.ensure();

  if (next === 'scarce' && prev !== 'scarce' && seedReserve) {
    const { peekUser, top } = require('./economy');
    let circulating = 0;
    try {
      for (const e of top('coins', 500)) circulating += peekUser(e.id).coins || 0;
    } catch (_) {}
    const active = estimateActiveUsers();
    const targetM = SUPPLY_BASE + Math.max(1, active) * SUPPLY_PER_ACTIVE;
    // Seed reserve to ~30% of target M (or 35% of circulating), whichever is more useful
    const seed = Math.max(
      Math.floor(targetM * 0.3),
      Math.floor(circulating * 0.35),
      3000
    );
    if (treasury.getReserve() < seed) {
      treasury.setReserve(seed);
      logEvent(`🏛️ Scarce economy enabled — realm treasury seeded with ${seed} coins`);
    } else {
      logEvent('🏛️ Scarce economy enabled');
    }
  } else if (next === 'classic' && prev === 'scarce') {
    logEvent('🏛️ Economy mode set back to classic (open minting)');
  }

  saveNow();
  return next;
}

function estimateActiveUsers() {
  try {
    const { top, peekUser } = require('./economy');
    const cutoff = Date.now() - ACTIVE_MS;
    return top('lastXp', 500).filter((e) => (e.value || 0) >= cutoff).length || 1;
  } catch (_) {
    return 1;
  }
}

function targetMoneySupply() {
  return SUPPLY_BASE + Math.max(1, estimateActiveUsers()) * SUPPLY_PER_ACTIVE;
}

/** How much of a nominal reward is actually paid in scarce mode (reserve-backed). */
function payReward(userId, amount) {
  const { addCoins } = require('./economy');
  return addCoins(userId, amount, { fromReserve: true });
}

/**
 * Progressive daily tax for scarce mode. Returns list of { id, taxed }.
 */
function collectWealthTax() {
  if (!isScarce()) return [];
  const t = treasury.ensure();
  const now = Date.now();
  if (t.lastTaxAt && now - t.lastTaxAt < TAX_INTERVAL_MS - 60 * 1000) return [];

  const { top, peekUser, applyDelta } = require('./economy');
  const results = [];
  for (const e of top('coins', 500)) {
    const u = peekUser(e.id);
    const coins = u.coins || 0;
    if (coins <= TAX_BRACKETS[0].above) continue;

    let tax = 0;
    let prev = TAX_BRACKETS[0].above;
    for (let i = 0; i < TAX_BRACKETS.length; i++) {
      const bot = TAX_BRACKETS[i].above;
      const topCap = TAX_BRACKETS[i + 1] ? TAX_BRACKETS[i + 1].above : Infinity;
      const rate = TAX_BRACKETS[i].rate;
      if (coins <= bot) break;
      const band = Math.min(coins, topCap) - bot;
      if (band > 0) tax += Math.floor(band * rate);
      prev = topCap;
    }
    tax = Math.min(tax, Math.floor(coins * 0.25)); // never tax more than 25% of wallet in one day
    if (tax < 1) continue;
    const taken = -applyDelta(e.id, -tax, { tax: true });
    if (taken > 0) {
      treasury.depositReserve(taken);
      t.totalTaxed = (t.totalTaxed || 0) + taken;
      results.push({ id: e.id, taxed: taken });
    }
  }

  t.lastTaxAt = now;
  saveNow();
  if (results.length) {
    const total = results.reduce((s, r) => s + r.taxed, 0);
    logEvent(`📜 Wealth tax collected **${total}** coins into the realm treasury (${results.length} citizens)`);
  }
  return results;
}

/**
 * Soft-cap: richer targets get shorter post-rob protection (ms multiplier 1 → ~0.35).
 */
function protectionMultiplier(targetCoins) {
  if (!isScarce()) return 1;
  if (targetCoins <= 3000) return 1;
  if (targetCoins <= 8000) return 0.75;
  if (targetCoins <= 15000) return 0.55;
  return 0.35;
}

/**
 * Extra rob chance against whales in scarce mode (added to attacker chance).
 */
function whaleRobBonus(targetCoins) {
  if (!isScarce()) return 0;
  if (targetCoins <= 5000) return 0;
  if (targetCoins <= 10000) return 0.05;
  if (targetCoins <= 20000) return 0.1;
  return 0.15;
}

/**
 * Guards are weaker against protecting ultra-wealth in scarce mode.
 */
function guardPowerScale(targetCoins) {
  if (!isScarce()) return 1;
  if (targetCoins <= 5000) return 1;
  if (targetCoins <= 15000) return 0.75;
  return 0.5;
}

function statusSnapshot() {
  const mode = getMode();
  const reserve = treasury.getReserve();
  let circulating = 0;
  try {
    const { top, peekUser } = require('./economy');
    for (const e of top('coins', 500)) circulating += peekUser(e.id).coins || 0;
  } catch (_) {}
  return {
    mode,
    reserve,
    circulating,
    targetM: targetMoneySupply(),
    activeUsers: estimateActiveUsers(),
  };
}

module.exports = {
  getMode,
  isScarce,
  isClassic,
  setMode,
  targetMoneySupply,
  estimateActiveUsers,
  collectWealthTax,
  protectionMultiplier,
  whaleRobBonus,
  guardPowerScale,
  statusSnapshot,
  TAX_BRACKETS,
  TAX_INTERVAL_MS,
  SUPPLY_BASE,
  SUPPLY_PER_ACTIVE,
};
