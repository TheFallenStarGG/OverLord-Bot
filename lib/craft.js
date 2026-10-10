const { getUser, spendCoins, markDirty, fmt } = require('./economy');
const { MATERIALS, materialName } = require('./combat/gear');

// Craftable goods (also registered into LOOT / ITEMS via items.js patches)
const CRAFT_ITEMS = {
  grilled_carp: { name: 'Grilled Carp', emoji: '🍳', value: 70, category: 'craft', desc: 'Cooked fish. Sells for more than raw carp.' },
  fish_stew: { name: 'Fish Stew', emoji: '🍲', value: 120, category: 'craft', desc: 'Hearty stew. Use for a short Work Boost (2 works).' },
  shark_steak: { name: 'Shark Steak', emoji: '🥩', value: 550, category: 'craft', desc: 'Luxury meal. Use for Work Boost (5 works).' },
  bait: { name: 'Homemade Bait', emoji: '🪱', value: 15, category: 'craft', desc: 'Use before fishing: +1 free luckier cast (like a mini net).' },
  torch: { name: 'Miner\'s Torch', emoji: '🔦', value: 20, category: 'craft', desc: 'Use before mining: better luck on your next 3 trips.' },
  iron_nails: { name: 'Iron Nails', emoji: '📌', value: 40, category: 'craft', desc: 'Crafting part. Used in higher recipes.' },
  gold_ring: { name: 'Gold Ring', emoji: '💍', value: 400, category: 'craft', desc: 'Pretty trinket. Sells well.' },
  ruby_pendant: { name: 'Ruby Pendant', emoji: '📿', value: 900, category: 'craft', desc: 'Fancy jewelry. High sell value.' },
  field_ration: { name: 'Field Ration', emoji: '🥪', value: 50, category: 'craft', desc: 'Use to restore a bit of duel-ready grit (small coin refund flavor + 1 work boost charge).' },
  smoke_bomb: { name: 'Smoke Bomb', emoji: '💨', value: 80, category: 'craft', desc: 'Use: next !!rob gets a small success boost (like a weak lockpick).' },
  repair_kit: { name: 'Repair Kit', emoji: '🧰', value: 100, category: 'craft', desc: 'Sells okay. Mostly a sink for stone/iron/coal.' },
  lucky_broth: { name: 'Lucky Broth', emoji: '🥣', value: 90, category: 'craft', desc: 'Use for 15 minutes of fishing/mining luck.' },
};

const RECIPES = [
  {
    id: 'grilled_carp',
    name: 'Grilled Carp',
    emoji: '🍳',
    mats: { carp: 2, coal: 1 },
    coins: 0,
    out: { grilled_carp: 1 },
    blurb: 'Turn cheap fish into something worth selling.',
  },
  {
    id: 'fish_stew',
    name: 'Fish Stew',
    emoji: '🍲',
    mats: { carp: 3, tropical: 1, coal: 1 },
    coins: 25,
    out: { fish_stew: 1 },
    blurb: 'Eat for a short work boost.',
  },
  {
    id: 'shark_steak',
    name: 'Shark Steak',
    emoji: '🥩',
    mats: { shark: 1, coal: 3 },
    coins: 50,
    out: { shark_steak: 1 },
    blurb: 'Big meal, bigger work boost.',
  },
  {
    id: 'bait',
    name: 'Homemade Bait',
    emoji: '🪱',
    mats: { boot: 1, carp: 1 },
    coins: 0,
    out: { bait: 3 },
    blurb: 'Trash + fish → three baits.',
  },
  {
    id: 'torch',
    name: 'Miner\'s Torch',
    emoji: '🔦',
    mats: { coal: 2, stone: 1 },
    coins: 0,
    out: { torch: 2 },
    blurb: 'Light the shafts. Better mining luck.',
  },
  {
    id: 'iron_nails',
    name: 'Iron Nails',
    emoji: '📌',
    mats: { iron: 2, coal: 1 },
    coins: 10,
    out: { iron_nails: 4 },
    blurb: 'Basic parts for other crafts.',
  },
  {
    id: 'repair_kit',
    name: 'Repair Kit',
    emoji: '🧰',
    mats: { iron_nails: 2, stone: 5, coal: 2 },
    coins: 30,
    out: { repair_kit: 1 },
    blurb: 'Busywork craft; decent sell.',
  },
  {
    id: 'smoke_bomb',
    name: 'Smoke Bomb',
    emoji: '💨',
    mats: { coal: 3, puffer: 1 },
    coins: 40,
    out: { smoke_bomb: 1 },
    blurb: 'For a slightly safer robbery.',
  },
  {
    id: 'field_ration',
    name: 'Field Ration',
    emoji: '🥪',
    mats: { tropical: 2, iron_nails: 1 },
    coins: 20,
    out: { field_ration: 1 },
    blurb: 'Travel food with a tiny boost.',
  },
  {
    id: 'lucky_broth',
    name: 'Lucky Broth',
    emoji: '🥣',
    mats: { squid: 1, tropical: 2, coal: 2 },
    coins: 60,
    out: { lucky_broth: 1 },
    blurb: 'Short luck buff for gatherers.',
  },
  {
    id: 'gold_ring',
    name: 'Gold Ring',
    emoji: '💍',
    mats: { gold: 3, iron_nails: 1 },
    coins: 100,
    out: { gold_ring: 1 },
    blurb: 'Jewelry — made to sell.',
  },
  {
    id: 'ruby_pendant',
    name: 'Ruby Pendant',
    emoji: '📿',
    mats: { ruby: 1, gold: 2, iron_nails: 2 },
    coins: 250,
    out: { ruby_pendant: 1 },
    blurb: 'High-end craft for the market.',
  },
];

function matLabel(id) {
  // Loaded lazily: items.js and craft.js require each other, so LOOT isn't ready at load time
  const { LOOT } = require('./items');
  if (CRAFT_ITEMS[id]) return `${CRAFT_ITEMS[id].emoji} ${CRAFT_ITEMS[id].name}`;
  if (LOOT[id]) return `${LOOT[id].emoji} ${LOOT[id].name}`;
  if (MATERIALS[id]) return materialName(id);
  return id;
}

function recipeLines() {
  return RECIPES.map((r) => {
    const need = Object.entries(r.mats)
      .map(([id, n]) => `${n}× ${matLabel(id)}`)
      .join(', ');
    const coin = r.coins ? ` + ${fmt(r.coins)}` : '';
    const out = Object.entries(r.out)
      .map(([id, n]) => `${n}× ${matLabel(id)}`)
      .join(', ');
    return `${r.emoji} **${r.name}** → ${out}\nRequires: ${need}${coin}\n_${r.blurb}_`;
  });
}

function findRecipe(text) {
  const q = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim();
  if (!q) return null;
  return (
    RECIPES.find((r) => r.id === q || r.name.toLowerCase() === q) ||
    RECIPES.find((r) => r.name.toLowerCase().includes(q) || r.id.includes(q.replace(/\s+/g, '_')))
  );
}

function craftItem(userId, text) {
  const recipe = findRecipe(text);
  if (!recipe) {
    return { error: `Unknown recipe. Use \`!!craft\` to see the list, e.g. \`!!craft grilled carp\`.` };
  }

  const u = getUser(userId);
  for (const [id, n] of Object.entries(recipe.mats)) {
    if ((u.inventory[id] ?? 0) < n) {
      return { error: `You need **${n}× ${matLabel(id)}** (you have ${u.inventory[id] ?? 0}).` };
    }
  }
  if (recipe.coins && u.coins < recipe.coins) {
    return { error: `That recipe costs **${fmt(recipe.coins)}** and you only have **${fmt(u.coins)}**.` };
  }

  for (const [id, n] of Object.entries(recipe.mats)) {
    u.inventory[id] -= n;
    if (u.inventory[id] <= 0) delete u.inventory[id];
  }
  if (recipe.coins) spendCoins(userId, recipe.coins);

  const gained = [];
  for (const [id, n] of Object.entries(recipe.out)) {
    u.inventory[id] = (u.inventory[id] ?? 0) + n;
    gained.push(`**${n}× ${matLabel(id)}**`);
  }
  markDirty();

  return {
    text: `🧪 Crafted ${gained.join(', ')}!\nUse \`!!inventory\` / \`!!sell\` / \`!!use\` depending on the item.`,
  };
}

module.exports = {
  CRAFT_ITEMS,
  RECIPES,
  recipeLines,
  craftItem,
  findRecipe,
  matLabel,
};
