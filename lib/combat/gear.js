const { getUser, spendCoins, markDirty, fmt } = require('../economy');
const { LOOT } = require('../items');

// ---------- Weapons ----------

const TIERS = [
  { name: 'Wooden', dmg: 0 },
  { name: 'Iron', dmg: 4 },
  { name: 'Steel', dmg: 8 },
  { name: 'Mythril', dmg: 13 },
  { name: 'Dragon', dmg: 20 },
];

// dmgMult scales the tier's damage. crit = extra crit chance. bossCd = time between swings against bosses.
const TYPES = {
  sword: { name: 'Sword', emoji: '🗡️', dmgMult: 1, crit: 0, bossCd: 6000, note: 'Balanced.' },
  dagger: { name: 'Dagger', emoji: '🔪', dmgMult: 0.75, crit: 0.15, bossCd: 4000, note: 'Fast swings and more crits, but less damage.' },
  hammer: { name: 'Hammer', emoji: '🔨', dmgMult: 1.5, crit: 0, bossCd: 9000, note: 'Heavy hits but slow. Misses 15% of the time in duels.' },
  bow: { name: 'Bow', emoji: '🏹', dmgMult: 0.9, crit: 0.05, bossCd: 5000, note: 'Quick shots. Arrows get through blocks better in duels.' },
};

// Index = tier. reduce = flat damage prevented per hit in duels (and it shortens boss stuns).
const ARMOR = [
  null,
  { name: 'Leather Armor', reduce: 2 },
  { name: 'Chain Armor', reduce: 4 },
  { name: 'Plate Armor', reduce: 7 },
  { name: 'Dragon Armor', reduce: 11 },
];

const ELEMENTS = {
  fire: { name: 'Fire', emoji: '🔥' },
  ice: { name: 'Ice', emoji: '❄️' },
  poison: { name: 'Poison', emoji: '☠️' },
};

// ---------- Materials, recipes, skins, titles ----------

// Dropped by bosses (ores and coal come from !!mine)
const MATERIALS = {
  dragonscale: { name: 'Dragon Scale', emoji: '🐲' },
  essence_fire: { name: 'Fire Essence', emoji: '🔥' },
  essence_ice: { name: 'Frost Essence', emoji: '❄️' },
  essence_poison: { name: 'Venom Gland', emoji: '☠️' },
};
const materialName = (id) => {
  const m = MATERIALS[id] ?? LOOT[id];
  return m ? `${m.emoji} ${m.name}` : id;
};

// Same recipe for every weapon type of a tier, and for the armor of that tier
const RECIPES = {
  1: { coins: 500, mats: { iron: 6, coal: 4 } },
  2: { coins: 1500, mats: { iron: 10, coal: 6, gold: 3 } },
  3: { coins: 4000, mats: { gold: 8, ruby: 2 } },
  4: { coins: 10000, mats: { diamond: 2, ruby: 4, dragonscale: 1 } },
};
const ENCHANT_COST = { coins: 300, essences: 3 };

const SKINS = {
  skin_crimson: { name: 'Crimson', emoji: '🔴' },
  skin_frost: { name: 'Frostbite', emoji: '🧊' },
  skin_gold: { name: 'Golden', emoji: '🌟' },
};

// Earned titles
const TITLES = {
  title_duelist: { name: 'the Duelist', desc: 'Win 10 duels' },
  title_unbroken: { name: 'the Unbroken', desc: 'Win 5 duels in a row' },
  title_gladiator: { name: 'the Gladiator', desc: 'Win 50 duels' },
  title_dragonslayer: { name: 'the Dragonslayer', desc: 'Help defeat an Ancient Dragon' },
  title_bosshunter: { name: 'the Boss Hunter', desc: 'Defeat 5 bosses' },
  title_forgemaster: { name: 'the Forgemaster', desc: 'Forge something Dragon-tier' },
};

// What battle supplies do (their shop info lives in items.js)
const BATTLE_ITEMS = {
  potion: { name: 'Health Potion', emoji: '🧪' },
  smoke: { name: 'Smoke Bomb', emoji: '💨' },
  bomb: { name: 'Bomb', emoji: '🧨' },
  antidote: { name: 'Antidote', emoji: '💊' },
  adrenaline: { name: 'Adrenaline', emoji: '💉' },
};

// ---------- Helpers ----------

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const weaponId = (type, tier) => `${type}_${tier}`;
const parseWeaponId = (id) => {
  const [type, tier] = id.split('_');
  return { type, tier: Number(tier) };
};
const weaponName = (id) => {
  const { type, tier } = parseWeaponId(id);
  return `${TIERS[tier].name} ${TYPES[type].name}`;
};

// Wooden weapons are free for everyone. Everything else has to be forged.
const owns = (u, id) => id.endsWith('_0') || (u.inventory[id] ?? 0) > 0;

// Makes sure a user has combat data (older users won't yet)
function ensureProfile(u) {
  u.loadout ??= { weapon: 'sword_0', armor: null, skin: null, items: [], class: 'warrior' };
  u.loadout.class ??= 'warrior';
  u.combat ??= { wins: 0, losses: 0, streak: 0, best: 0, damage: 0, moves: {}, bossKills: 0, bossDamage: 0, forged: 0 };
  u.enchants ??= {}; // weapon id -> element
  return u;
}

const standardGear = () => ({
  weapon: { id: 'sword_0', type: 'sword', tier: 0, bonus: 0, bossBonus: 0, crit: 0, bossCd: TYPES.sword.bossCd, element: null, emoji: TYPES.sword.emoji, name: 'Wooden Sword' },
  armor: { id: null, name: 'No armor', reduce: 0 },
});

// The weapon and armor a user has equipped, as numbers the fights can use
function playerGear(u) {
  ensureProfile(u);
  let wid = u.loadout.weapon;
  if (!owns(u, wid)) wid = 'sword_0';
  const { type, tier } = parseWeaponId(wid);
  const t = TYPES[type];
  const base = TIERS[tier].dmg * t.dmgMult;

  const skin = SKINS[u.loadout.skin] && u.inventory[u.loadout.skin] ? SKINS[u.loadout.skin] : null;
  const armorTier = u.loadout.armor ? Number(u.loadout.armor.split('_')[1]) : 0;
  const hasArmor = armorTier > 0 && (u.inventory[u.loadout.armor] ?? 0) > 0;

  return {
    weapon: {
      id: wid,
      type,
      tier,
      bonus: Math.round(base), // damage added in duels
      bossBonus: Math.round(base * 1.5), // damage added against bosses
      crit: t.crit,
      bossCd: t.bossCd,
      element: u.enchants[wid] ?? null,
      emoji: skin?.emoji ?? t.emoji,
      name: weaponName(wid),
    },
    armor: hasArmor ? { id: u.loadout.armor, name: ARMOR[armorTier].name, reduce: ARMOR[armorTier].reduce } : { id: null, name: 'No armor', reduce: 0 },
  };
}

// Finds a weapon the user owns from what they typed ("iron sword", "hammer"...). The best match wins.
function findWeapon(u, text) {
  const q = norm(text);
  if (!q) return null;
  const owned = [];
  for (const type of Object.keys(TYPES)) {
    for (let tier = 0; tier < TIERS.length; tier++) {
      const id = weaponId(type, tier);
      if (owns(u, id)) owned.push({ id, tier, name: norm(weaponName(id)) });
    }
  }
  const exact = owned.find((w) => w.name === q);
  if (exact) return exact.id;
  return owned.filter((w) => w.name.includes(q)).sort((a, b) => b.tier - a.tier)[0]?.id ?? null;
}

function findArmor(u, text) {
  const q = norm(text);
  for (let tier = 4; tier >= 1; tier--) {
    const id = `armor_${tier}`;
    if ((u.inventory[id] ?? 0) > 0 && (norm(ARMOR[tier].name).includes(q) || norm(TIERS[tier].name).includes(q))) return id;
  }
  return null;
}

// Gives a title if they don't have it. Returns true if it's new.
function awardTitle(u, id) {
  if (u.inventory[id]) return false;
  u.inventory[id] = 1;
  return true;
}

const titleName = (id) => TITLES[id]?.name ?? null;

// Updates a duelist's record after a match. Returns any new title ids.
function recordDuelStats(userId, { won, damage, moves }) {
  const u = ensureProfile(getUser(userId));
  const c = u.combat;
  c.damage += damage;
  for (const [move, n] of Object.entries(moves)) {
    if (move !== 'stunned') c.moves[move] = (c.moves[move] ?? 0) + n;
  }
  if (won) {
    c.wins++;
    c.streak++;
    c.best = Math.max(c.best, c.streak);
  } else {
    c.losses++;
    c.streak = 0;
  }

  const unlocked = [];
  if (c.wins >= 10 && awardTitle(u, 'title_duelist')) unlocked.push('title_duelist');
  if (c.streak >= 5 && awardTitle(u, 'title_unbroken')) unlocked.push('title_unbroken');
  if (c.wins >= 50 && awardTitle(u, 'title_gladiator')) unlocked.push('title_gladiator');
  markDirty();
  return unlocked;
}

// ---------- Forging ----------

const matsText = (mats) => Object.entries(mats).map(([id, n]) => `${n}× ${materialName(id)}`).join(', ');

// text like "iron sword" or "plate armor". Returns { error } or { text }.
function forgeItem(userId, text) {
  const u = ensureProfile(getUser(userId));
  const q = norm(text);

  let id = null;
  let tier = 0;
  let display = '';
  for (const type of Object.keys(TYPES)) {
    for (let t = 1; t < TIERS.length; t++) {
      if (norm(weaponName(weaponId(type, t))) === q) {
        id = weaponId(type, t);
        tier = t;
        display = `${TYPES[type].emoji} ${weaponName(id)}`;
      }
    }
  }
  for (let t = 1; t < ARMOR.length; t++) {
    if (norm(ARMOR[t].name) === q) {
      id = `armor_${t}`;
      tier = t;
      display = `🛡️ ${ARMOR[t].name}`;
    }
  }
  if (!id) return { error: "I don't know that recipe. Use the full name, like `iron sword` or `plate armor`. See `!!forge`." };
  if ((u.inventory[id] ?? 0) > 0) return { error: `You already own the ${display}.` };

  const recipe = RECIPES[tier];
  const missing = Object.entries(recipe.mats).filter(([mat, n]) => (u.inventory[mat] ?? 0) < n);
  if (missing.length) {
    return { error: `You're missing materials for the ${display}: ${missing.map(([mat, n]) => `${n - (u.inventory[mat] ?? 0)}× ${materialName(mat)}`).join(', ')}.` };
  }
  if (!spendCoins(userId, recipe.coins)) return { error: `Forging the ${display} costs **${fmt(recipe.coins)}**, and you don't have enough.` };

  for (const [mat, n] of Object.entries(recipe.mats)) {
    u.inventory[mat] -= n;
    if (!u.inventory[mat]) delete u.inventory[mat];
  }
  u.inventory[id] = 1;
  u.combat.forged++;
  let extra = '';
  if (tier === 4 && awardTitle(u, 'title_forgemaster')) extra = `\n🏷️ New title unlocked: **${TITLES.title_forgemaster.name}**! Equip it with \`!!loadout title forgemaster\`.`;
  markDirty();
  return { text: `⚒️ You forged the ${display} for **${fmt(recipe.coins)}** and ${matsText(recipe.mats)}! Equip it with \`!!loadout\`.${extra}` };
}

// Puts an element on the weapon you have equipped
function enchantWeapon(userId, element) {
  if (!ELEMENTS[element]) return { error: 'Choose an element: `fire`, `ice`, or `poison`.' };
  const u = ensureProfile(getUser(userId));
  const essence = `essence_${element}`;
  const wid = u.loadout.weapon;

  if ((u.inventory[essence] ?? 0) < ENCHANT_COST.essences) {
    return { error: `You need **${ENCHANT_COST.essences}× ${materialName(essence)}** (bosses drop them).` };
  }
  if (!spendCoins(userId, ENCHANT_COST.coins)) return { error: `Enchanting costs **${fmt(ENCHANT_COST.coins)}**, and you don't have enough.` };

  u.inventory[essence] -= ENCHANT_COST.essences;
  if (!u.inventory[essence]) delete u.inventory[essence];
  u.enchants[wid] = element;
  markDirty();
  return { text: `✨ Your ${weaponName(wid)} is now enchanted with ${ELEMENTS[element].emoji} **${ELEMENTS[element].name}**! It deals ×1.5 damage to bosses weak to it.` };
}

module.exports = {
  TIERS,
  TYPES,
  ARMOR,
  ELEMENTS,
  MATERIALS,
  RECIPES,
  ENCHANT_COST,
  SKINS,
  TITLES,
  BATTLE_ITEMS,
  norm,
  weaponId,
  weaponName,
  parseWeaponId,
  materialName,
  matsText,
  ensureProfile,
  playerGear,
  standardGear,
  findWeapon,
  findArmor,
  awardTitle,
  titleName,
  recordDuelStats,
  forgeItem,
  enchantWeapon,
};
