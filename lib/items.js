const { mult, isActive } = require('./modifiers');

const GATHER_COOLDOWN_MS = 3 * 60 * 1000; // for !!fish and !!mine
const GEAR_LUCK = [0, 0.35, 0.8, 1.5]; // rare-find bonus for each rod/pickaxe level
const ROD_NAMES = ['Basic Rod', 'Sturdy Rod', 'Pro Rod', 'Master Rod'];
const PICK_NAMES = ['Basic Pickaxe', 'Iron Pickaxe', 'Steel Pickaxe', 'Diamond Pickaxe'];

// What you can find, from common to rare. p = chance of each (they add up to 1).
const FISH = [
  { id: 'boot', name: 'Old Boot', emoji: '👢', value: 3, p: 0.2 },
  { id: 'carp', name: 'Carp', emoji: '🐟', value: 25, p: 0.35 },
  { id: 'tropical', name: 'Tropical Fish', emoji: '🐠', value: 45, p: 0.22 },
  { id: 'puffer', name: 'Pufferfish', emoji: '🐡', value: 80, p: 0.12 },
  { id: 'squid', name: 'Squid', emoji: '🦑', value: 150, p: 0.07 },
  { id: 'shark', name: 'Shark', emoji: '🦈', value: 400, p: 0.035 },
  { id: 'chest', name: 'Treasure Chest', emoji: '🧰', value: 1000, p: 0.005 },
];
const ORE = [
  { id: 'stone', name: 'Stone', emoji: '🪨', value: 4, p: 0.25 },
  { id: 'coal', name: 'Coal', emoji: '⚫', value: 12, p: 0.3 },
  { id: 'iron', name: 'Iron Ore', emoji: '🔩', value: 35, p: 0.25 },
  { id: 'gold', name: 'Gold Ore', emoji: '🥇', value: 90, p: 0.12 },
  { id: 'ruby', name: 'Ruby', emoji: '♦️', value: 300, p: 0.06 },
  { id: 'diamond', name: 'Diamond', emoji: '💎', value: 900, p: 0.02 },
];
const LOOT = Object.fromEntries([...FISH, ...ORE].map((e) => [e.id, e]));

// Shop items. category: consumable (single use) | gear (permanent) | title (cosmetic)
const ITEMS = {
  padlock: { name: 'Padlock', emoji: '🔒', price: 400, category: 'consumable', max: 5, desc: 'Automatically blocks the next robbery against you. The lock breaks when it works.' },
  lockpick: { name: 'Lockpick', emoji: '🪛', price: 350, category: 'consumable', max: 5, desc: 'Use it before `!!rob` for +20% success on that attempt. Best against rich targets.' },
  workboost: { name: 'Work Boost', emoji: '⚡', price: 250, category: 'consumable', max: 10, desc: 'Use it to double your pay for your next 5 works. Pays off more at higher career ranks.' },
  xpboost: { name: 'XP Boost', emoji: '📈', price: 300, category: 'consumable', max: 5, desc: 'Use it to earn double XP from chatting for 1 hour.' },
  charm: { name: 'Lucky Charm', emoji: '🍀', price: 500, category: 'consumable', max: 5, desc: 'Use it for 30 minutes of better luck when fishing and mining.' },
  net: { name: 'Fishing Net', emoji: '🕸️', price: 150, category: 'consumable', max: 10, desc: 'Use it to roll twice on your next 3 casts.' },
  dynamite: { name: 'Dynamite', emoji: '💣', price: 150, category: 'consumable', max: 10, desc: 'Use it to roll twice on your next 3 mining trips.' },
  lootbox: { name: 'Loot Box', emoji: '🎁', price: 500, category: 'consumable', max: 20, desc: 'A mystery prize: usually coins, sometimes items, and rarely a jackpot.' },
  potion: { name: 'Health Potion', emoji: '🧪', price: 150, category: 'battle', max: 10, desc: 'Heals 35 HP during a duel.' },
  smoke: { name: 'Smoke Bomb', emoji: '💨', price: 200, category: 'battle', max: 10, desc: 'Dodges every attack that round, but you can\'t do anything else.' },
  bomb: { name: 'Bomb', emoji: '🧨', price: 250, category: 'battle', max: 10, desc: 'Deals 30 damage that ignores blocks and armor.' },
  antidote: { name: 'Antidote', emoji: '💊', price: 100, category: 'battle', max: 10, desc: 'Cures poison and burn during a duel.' },
  adrenaline: { name: 'Adrenaline', emoji: '💉', price: 200, category: 'battle', max: 10, desc: '+2 energy, and your next hit deals 50% more damage.' },

  rod1: { name: 'Sturdy Rod', emoji: '🎣', price: 800, category: 'gear', slot: 'rod', level: 1, desc: 'Better odds of rare catches when fishing.' },
  rod2: { name: 'Pro Rod', emoji: '🎣', price: 3000, category: 'gear', slot: 'rod', level: 2, desc: 'Much better odds of rare catches.' },
  rod3: { name: 'Master Rod', emoji: '🎣', price: 10000, category: 'gear', slot: 'rod', level: 3, desc: 'The best rod money can buy. Sharks and treasure galore.' },
  pick1: { name: 'Iron Pickaxe', emoji: '⛏️', price: 800, category: 'gear', slot: 'pick', level: 1, desc: 'Better odds of rare ores when mining.' },
  pick2: { name: 'Steel Pickaxe', emoji: '⛏️', price: 3000, category: 'gear', slot: 'pick', level: 2, desc: 'Much better odds of rare ores.' },
  pick3: { name: 'Diamond Pickaxe', emoji: '⛏️', price: 10000, category: 'gear', slot: 'pick', level: 3, desc: 'The best pickaxe there is. Rubies and diamonds galore.' },

  title_angler: { name: 'the Angler', emoji: '🏷️', price: 1000, category: 'title', desc: 'Shown next to your name on `!!rank`.' },
  title_gambler: { name: 'the Gambler', emoji: '🏷️', price: 2500, category: 'title', desc: 'Shown next to your name on `!!rank`.' },
  title_tycoon: { name: 'the Tycoon', emoji: '🏷️', price: 7500, category: 'title', desc: 'Shown next to your name on `!!rank`.' },
  title_legend: { name: 'the Legend', emoji: '🏷️', price: 20000, category: 'title', desc: 'Shown next to your name on `!!rank`. Only for the truly dedicated.' },
  
  title_frenzy: { name: 'the Frenzied Angler', emoji: '🏷️', price: 2000, category: 'title', limited: 'fishfrenzy', desc: 'Limited-time: only sold during Fishing Frenzy. Yours forever once bought.' },
  title_delver: { name: 'the Deep Delver', emoji: '🏷️', price: 2000, category: 'title', limited: 'minerush', desc: 'Limited-time: only sold during Mining Rush. Yours forever once bought.' },
  title_prodigy: { name: 'the Prodigy', emoji: '🏷️', price: 2000, category: 'title', limited: 'xpsurge', desc: 'Limited-time: only sold during XP Surge. Yours forever once bought.' },
  title_prospector: { name: 'the Prospector', emoji: '🏷️', price: 2000, category: 'title', limited: 'goldrush', desc: 'Limited-time: only sold during Gold Rush. Yours forever once bought.' },
  title_bargain: { name: 'the Bargain Hunter', emoji: '🏷️', price: 2000, category: 'title', limited: 'flashsale', desc: 'Limited-time: only sold during Flash Sale. Yours forever once bought.' },
  title_relentless: { name: 'the Relentless', emoji: '🏷️', price: 2000, category: 'title', limited: 'bossrush', desc: 'Limited-time: only sold during Boss Rush. Yours forever once bought.' },
};

const SHOP_PAGES = [
  { key: 'supplies', emoji: '🧰', title: 'Supplies', color: 0xe67e22, category: 'consumable', intro: 'Single-use goods. Activate them with `!!use <item>`.' },
  { key: 'battle', emoji: '⚔️', title: 'Battle Supplies', color: 0xe74c3c, category: 'battle', intro: 'Bring up to 3 into a duel with `!!loadout item add <item>`. They\'re used up when you use them.' },
  { key: 'gear', emoji: '🎣', title: 'Gear', color: 0x3498db, category: 'gear', intro: 'Permanent upgrades for fishing and mining. Buy each tier in order.' },
  { key: 'titles', emoji: '🏷️', title: 'Titles', color: 0xf1c40f, category: 'title', intro: 'Cosmetic titles, shown on your `!!rank`. Buying one equips it.' },
];

// Limited-time items only show up in the shop while their event is running
const idsIn = (category) => {
  const base = Object.keys(ITEMS).filter(
    (id) => ITEMS[id].category === category && (!ITEMS[id].limited || isActive(ITEMS[id].limited))
  );
  if (category !== 'title') return base;
  return base.concat(getCustomTitleEntries().map(([id]) => id));
};

// One item is 20% off each day (changes at midnight UTC). Limited items are never the deal.
const DEAL_POOL = Object.keys(ITEMS).filter((id) => !ITEMS[id].limited);
const dealId = () => DEAL_POOL[Math.floor(Date.now() / 86400000) % DEAL_POOL.length];
const currentPrice = (id) => {
  const def = itemDef(id);
  if (!def) return 1;
  return Math.max(1, Math.round(def.price * (id === dealId() ? 0.8 : 1) * mult('shop')));
};

// Finds an item from what someone typed ("rod", "sturdy rod", "padlock", "carp"...)
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
function findItem(text) {
  const q = norm(text ?? '');
  if (!q) return null;

  const all = [
    ...Object.entries(ITEMS).map(([id, def]) => ({ id, def, kind: 'shop' })),
    ...Object.entries(LOOT).map(([id, def]) => ({ id, def, kind: 'loot' })),
  ];
  return (
    all.find((e) => norm(e.id) === q || norm(e.def.name) === q) ??
    all.find((e) => norm(e.def.name).includes(q) || norm(e.id).includes(q)) ??
    null
  );
}

// Picks something from a table. Luck pushes results toward the rarer entries at the end.
function rollLoot(table, luck) {
  const u = Math.random() ** (1 / (1 + luck));
  let acc = 0;
  for (const entry of table) {
    acc += entry.p;
    if (u < acc) return entry;
  }
  return table[table.length - 1];
}

module.exports = {
  GATHER_COOLDOWN_MS,
  GEAR_LUCK,
  ROD_NAMES,
  PICK_NAMES,
  FISH,
  ORE,
  LOOT,
  ITEMS,
  SHOP_PAGES,
  idsIn,
  dealId,
  currentPrice,
  findItem,
  rollLoot,
};
