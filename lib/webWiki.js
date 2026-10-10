const { ITEMS, FISH, ORE, SHOP_PAGES } = require('./items');
const { RECIPES: CRAFT, matLabel } = require('./craft');
const gear = require('./combat/gear');
const { CLASSES, ARENAS } = require('./combat/classes');
const { SPECIES, PERK_TEXT, MAX_LEVEL, EVOLVE_LEVEL, perkValue, xpFor } = require('./petData');
const { CAREERS, PRESTIGE_BONUS, ROB } = require('./economy');
const { DEFS } = require('./modifiers');
const { DAILY_QUESTS, WEEKLY_QUESTS } = require('./questDefs');
const { BASE_STOCKS, CANDIDATE_STOCKS, TICK_MS, FEE } = require('./stocks');
const { BOSSES } = require('./boss');

const fmtN = (n) => Number(n).toLocaleString('en-US');
const coins = (n) => `${fmtN(n)} 🪙`;
const pct = (p) => `${Math.round(p * 1000) / 10}%`;
const hours = (ms) => {
  const h = ms / 3600000;
  return `${h} hour${h === 1 ? '' : 's'}`;
};
const risk = (vol) => (vol < 0.007 ? 'Low' : vol < 0.012 ? 'Medium' : 'High');

// One card on the wiki: { emoji, name, desc, tags: [], stats: [[label, value]] }
const entry = (emoji, name, desc = '', tags = [], stats = []) => ({
  emoji,
  name,
  desc,
  tags: tags.filter(Boolean),
  stats: stats.filter(Boolean),
});

function buildWiki() {
  const sections = [];
  const add = (group, id, emoji, title, intro, entries) => {
    if (entries.length) sections.push({ group, id, emoji, title, intro, entries });
  };

  // ----- Shop & items -----
  for (const page of SHOP_PAGES) {
    add(
      'Shop & items',
      `shop-${page.key}`,
      page.emoji,
      page.title,
      page.intro,
      Object.values(ITEMS)
        .filter((d) => d.category === page.category)
        .map((d) =>
          entry(d.emoji, d.name, d.desc, [d.limited ? `Limited: ${DEFS[d.limited]?.name ?? d.limited}` : null], [
            ['Price', coins(d.price)],
            d.max ? ['Carry up to', String(d.max)] : null,
          ])
        )
    );
  }

  // ----- Gathering & crafting -----
  const loot = (list) => list.map((x) => entry(x.emoji, x.name, '', [], [['Sells for', coins(x.value)], ['Base chance', pct(x.p)]]));
  add('Gathering & crafting', 'fish', '🎣', 'Fishing catches', 'What `!!fish` can pull up. Better rods and luck boosts shift the odds toward the rarer catches.', loot(FISH));
  add('Gathering & crafting', 'ore', '⛏️', 'Mining finds', 'What `!!mine` can dig up. Better pickaxes and luck boosts shift the odds toward the rarer finds.', loot(ORE));
  add(
    'Gathering & crafting',
    'craft',
    '🧪',
    'Crafting recipes',
    'Turn what you gather into food, tools and jewelry with `!!craft`.',
    CRAFT.map((r) => {
      const list = (obj) => Object.entries(obj).map(([id, n]) => `${n}× ${matLabel(id)}`).join(', ');
      return entry(r.emoji, r.name, r.blurb, [], [['Needs', list(r.mats)], r.coins ? ['Costs', coins(r.coins)] : null, ['Makes', list(r.out)]]);
    })
  );

  // ----- Combat & gear -----
  add(
    'Combat & gear',
    'weapons',
    '🗡️',
    'Weapons',
    'Forge better ones with `!!forge`. Wooden weapons are free for everyone.',
    Object.values(gear.TYPES).map((t) =>
      entry(t.emoji, t.name, t.note, [], [
        ...gear.TIERS.map((tier) => [
          tier.name,
          `+${Math.round(tier.dmg * t.dmgMult)} duel · +${Math.round(tier.dmg * t.dmgMult * 1.5)} boss damage`,
        ]),
        ['Boss swing', `every ${t.bossCd / 1000}s`],
        t.crit ? ['Extra crit chance', `+${Math.round(t.crit * 100)}%`] : null,
      ])
    )
  );
  add(
    'Combat & gear',
    'armor',
    '🛡️',
    'Armor',
    'Armor blocks damage in duels and shortens boss stuns.',
    gear.ARMOR.map((a, tier) => a && entry('🛡️', a.name, '', [], [['Blocks', `${a.reduce} damage per hit`], ['Tier', gear.TIERS[tier].name]])).filter(Boolean)
  );
  add(
    'Combat & gear',
    'forge',
    '⚒️',
    'Forge recipes',
    'One recipe per tier. It makes every weapon type of that tier, and the armor of that tier.',
    Object.entries(gear.RECIPES).map(([tier, r]) =>
      entry('⚒️', `${gear.TIERS[tier].name} tier`, '', [], [['Cost', coins(r.coins)], ['Materials', gear.matsText(r.mats)]])
    )
  );
  add(
    'Combat & gear',
    'elements',
    '✨',
    'Enchantments',
    'Enchant your equipped weapon with an element. Enchanted weapons deal ×1.5 damage to bosses that are weak to it.',
    Object.entries(gear.ELEMENTS).map(([id, e]) =>
      entry(e.emoji, e.name, '', [], [['Cost', `${coins(gear.ENCHANT_COST.coins)} + ${gear.ENCHANT_COST.essences}× ${gear.materialName(`essence_${id}`)}`]])
    )
  );
  add(
    'Combat & gear',
    'materials',
    '🧱',
    'Boss materials',
    'Dropped by bosses and used for forging and enchanting.',
    Object.entries(gear.MATERIALS).map(([id, m]) =>
      entry(m.emoji, m.name, '', [], [
        ['Dropped by', BOSSES.filter((b) => b.drop === id || b.special === id).map((b) => `${b.emoji} ${b.name}`).join(', ') || 'Bosses'],
      ])
    )
  );
  add(
    'Combat & gear',
    'classes',
    '🎭',
    'Duel classes',
    'Choose one with `!!loadout`. Specials cost energy in duels, and your boss ability is the Special button in boss fights.',
    Object.values(CLASSES).map((c) =>
      entry(c.emoji, c.name, c.blurb, [], [
        ['Health', String(c.hp)],
        ['Basic attack', `${c.atk[0]}–${c.atk[1]} damage`],
        ['Crit chance', `${Math.round(c.crit * 100)}%`],
        ...c.specials.map((s) => [`${s.emoji} ${s.name}`, `${s.cost} energy · ${s.desc}`]),
        ['Boss ability', `${c.boss.emoji} ${c.boss.name}: ${c.boss.desc}`],
      ])
    )
  );
  add('Combat & gear', 'arenas', '🏟️', 'Duel arenas', 'Every duel is fought in a random arena.', ARENAS.map((a) => entry(a.emoji, a.name, a.desc)));
  add(
    'Combat & gear',
    'bosses',
    '🐉',
    'Bosses',
    'Bosses show up in chat from time to time. Hit them, use your Special, and press Block when they charge.',
    BOSSES.map((b) =>
      entry(b.emoji, b.name, '', [], [
        ['Weak to', `${gear.ELEMENTS[b.weak].emoji} ${gear.ELEMENTS[b.weak].name}`],
        ['Drops', gear.materialName(b.drop)],
        b.special ? ['Rare drop', gear.materialName(b.special)] : null,
      ])
    )
  );

  // ----- Economy & pets -----
  add('Economy & pets', 'careers', '💼', 'Careers & prestige', '`!!work` gets you promoted as you go.', [
    ...CAREERS.map((c) => entry(c.emoji, c.name, '', [], [['Jobs needed', fmtN(c.min)], ['Pay', `×${c.mult}`]])),
    entry('🌟', 'Prestige', `Each prestige level adds +${Math.round(PRESTIGE_BONUS * 100)}% to your coin earnings. See \`!!prestige\`.`),
  ]);
  add('Economy & pets', 'robbery', '🥷', 'Robbery', '`!!rob @user` is a gamble. Win and you take the coins. Get caught and you pay the same amount to them.', [
    entry('🥷', 'The odds', '', [], [
      ['Base success', pct(ROB.SUCCESS_CHANCE)],
      ['At stake', `${ROB.MIN_PERCENT}–${ROB.MAX_PERCENT}% of their coins`],
      ['Both need', coins(ROB.MIN_COINS)],
      ['Cooldown', `${ROB.COOLDOWN_MS / 60000} minutes`],
      ['Victim protected for', `${ROB.PROTECTION_MS / 60000} minutes`],
    ]),
  ]);
  add('Economy & pets', 'quests', '📋', 'Quests', 'You get 3 random daily quests and 2 weekly ones. See `!!quests`.', [
    ...DAILY_QUESTS.map((q) => entry('📅', q.text, '', ['Daily'], [['Reward', coins(q.coins)]])),
    ...WEEKLY_QUESTS.map((q) => entry('🗓️', q.text, '', ['Weekly'], [['Reward', `${coins(q.coins)}${q.item ? ' + a ' + (ITEMS[q.item]?.name ?? q.item) : ''}`]])),
  ]);
  const totalWeight = Object.values(SPECIES).reduce((sum, p) => sum + p.weight, 0);
  const perks = (species, xp) =>
    Object.keys(SPECIES[species].perks)
      .map((k) => PERK_TEXT[k](perkValue({ species, xp }, k)))
      .join(' · ');
  add(
    'Economy & pets',
    'pets',
    '🐾',
    'Pets',
    'A pet gives you a permanent perk while it is fed. See `!!pet`.',
    Object.entries(SPECIES).map(([key, p]) =>
      entry(p.emoji, p.name, '', [p.rarity], [
        ['Chance', pct(p.weight / totalWeight)],
        ['Evolves into', `${p.evolved.emoji} ${p.evolved.name} at level ${EVOLVE_LEVEL}`],
        ['Perks at level 1', perks(key, 0)],
        [`Perks at level ${MAX_LEVEL}`, perks(key, xpFor(MAX_LEVEL))],
      ])
    )
  );

  // ----- World & market -----
  const stockIntro = `Prices move every ${TICK_MS / 3600000} hour. Buying and selling each cost a ${Math.round(FEE * 100)}% fee. Trade with \`!!invest\` and \`!!cashout\`.`;
  add(
    'World & market',
    'stocks',
    '📈',
    'Stocks',
    stockIntro,
    Object.entries(BASE_STOCKS).map(([sym, s]) =>
      entry(s.emoji, s.name, s.blurb, [sym], [['Starts around', coins(s.base)], ['Risk', risk(s.vol)], ['Reacts to', s.movers]])
    )
  );
  add(
    'World & market',
    'ipos',
    '🆕',
    'Companies that may IPO',
    'These are not always on the market, but they can go public later.',
    Object.entries(CANDIDATE_STOCKS).map(([sym, s]) =>
      entry(s.emoji, s.name, s.blurb, [sym], [['Starts around', coins(s.base)], ['Risk', risk(s.vol)], ['Reacts to', s.movers]])
    )
  );
  const defs = Object.values(DEFS);
  add(
    'World & market',
    'decrees',
    '📜',
    'Decrees',
    'Issued by the Overlord (or a Usurper). They last a few hours.',
    defs.filter((d) => d.decree).map((d) => entry(d.emoji, d.name, d.desc, [d.good ? 'Boon' : 'Burden'], [['Lasts', hours(d.ms)]]))
  );
  add(
    'World & market',
    'events',
    '🎉',
    'Server events',
    'Random events that shake up a server for a few hours.',
    defs.filter((d) => d.event).map((d) => entry(d.emoji, d.name, d.desc, [], [['Lasts', hours(d.ms)], d.titleName ? ['Limited title', d.titleName] : null]))
  );
  add(
    'World & market',
    'titles',
    '🏷️',
    'Earned titles',
    'Titles you unlock by playing. Equip them with `!!loadout`.',
    Object.values(gear.TITLES).map((t) => entry('🏷️', t.name, t.desc))
  );

  return { sections };
}

module.exports = { buildWiki };
