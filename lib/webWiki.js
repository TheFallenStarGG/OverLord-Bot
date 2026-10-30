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
const robLib = require('./rob');
const conquest = require('./conquest');

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
  const { METHODS: ROB_METHODS, RANKS: ROB_RANKS, NPC_MARKS } = robLib;
  add(
    'Economy & pets',
    'robbery',
    '🥷',
    'Robbery',
    '`!!rob @user` opens a menu: pick a method, optionally play the lock minigame, then go. A win takes a share of THEIR coins; getting caught costs you the same stake, capped at a share of YOUR coins. `!!rob` on its own opens the Underworld (NPC marks).',
    [
      entry('🥷', 'The basics', '', [], [
        ['Both players need', coins(ROB.MIN_COINS)],
        ['Cooldown', `${ROB.COOLDOWN_MS / 60000} minutes (shorter at higher thief ranks)`],
        ['Victim protected for', `${ROB.PROTECTION_MS / 60000} minutes after being robbed`],
        ['Revenge', 'Robbed in the last 24 hours? Your next job on that thief gets +15% and ignores their protection.'],
        ['Chase', 'Victims of a big theft get 60 seconds to chase the thief and take 60% back.'],
      ]),
      ...Object.values(ROB_METHODS).map((m) =>
        entry(m.emoji, m.name, m.blurb, ['Method'], [
          ['Base success', pct(m.chance)],
          ['You take', `${m.lo}–${m.hi}% of their coins`],
          ['You risk', `up to ${m.cap}% of your coins`],
          ['Heat', `+${m.heat}`],
        ])
      ),
      entry('🔥', 'Heat', 'Every job adds Heat and every failure adds half as much. Heat makes you easier to catch and cools off on its own. At 75 you are Wanted (extra penalty). `!!rob bribe` wipes it for coins.', [], [
        ['Cools by', '12 per hour'],
        ['Success penalty', 'up to −15%, and −5% more while Wanted'],
      ]),
      ...ROB_RANKS.map((r) =>
        entry(r.emoji, r.name, '', ['Thief rank'], [
          ['Successful robberies', String(r.min)],
          ['Success bonus', `+${Math.round(r.chance * 100)}%`],
          ['Cooldown', r.cooldown < 1 ? `${Math.round((1 - r.cooldown) * 100)}% shorter` : 'Normal'],
          ['Extra stake room', `+${r.cap}%`],
        ])
      ),
      ...NPC_MARKS.map((m) =>
        entry(m.emoji, m.name, m.blurb, ['NPC mark'], [
          ['Base success', pct(m.chance)],
          ['Heat', `+${m.heat}`],
          ['Needs rank', ROB_RANKS[m.minRank].name],
        ])
      ),
      entry('🪛', 'Thief gear', 'Switch these on in the rob menu. They are used up when you use them.', [], [
        ['Lockpick', '+20% success'],
        ['Crowbar', 'Breaks open a Padlock so the job goes ahead'],
        ['Disguise', 'Much less Heat and half the fine'],
        ['Getaway Smoke', 'No fine if you are caught'],
      ]),
      entry('🔒', 'Defenses', 'Items in a victim’s inventory work automatically. A spy report (`!!spy`) reveals them.', [], [
        ['Padlock', 'Blocks one robbery completely'],
        ['Alarm System', '−12% success, and the fine is 50% bigger'],
        ['Decoy Wallet', 'The thief only gets 40% of the haul'],
        ['Insurance', 'Refunds 40% of what was stolen (up to 600)'],
        ['Hired guards', 'Lower the thief’s success (`!!muscle`)'],
      ]),
    ]
  );
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

  // ----- World Campaign -----
  try {
    const provs = conquest.listProvinces();
    const provName = (id) => conquest.getProvince(id)?.name || id;
    add('World & market', 'campaign', '🗺️', 'World Campaign', 'One shared map; every server is a house. Own every city in a province to control it. Start with `!!guide`.', [
      entry('📜', 'The rules', 'Orders (moves and sieges) resolve each turn. The bigger army in a city wins, the loser is wiped out, and a city with no troops goes neutral. Allies hold cities together. The Shadow Court is an AI house that stays small and sleeps when nobody is playing.', [], [
        ['Turn length', `${conquest.TICK_MS / 3600000} hours`],
        ['Recruit', `${coins(conquest.RECRUIT_COST)} per troop (1–${conquest.MAX_RECRUIT_PER_TICK} at a time)`],
        ['Siege needs', `${conquest.SIEGE_MIN_TROOPS}+ free troops (1 always stays in each city you hold)`],
        ['Fortify', `${coins(conquest.FORT_COST)} per level, up to level ${conquest.MAX_FORT}`],
        ['Invade (houses with no land)', `${coins(conquest.INVADE_COST)} for ${conquest.INVADE_TROOPS} troops`],
        ['Seasons', 'The map resets monthly. The top 3 houses win treasury prizes.'],
      ]),
      ...provs.map((p) =>
        entry('📍', p.name, '', [], [
          ['Cities', (p.cities || []).map((c) => `${c.name} (tax ${c.tax || 15})`).join(', ') || 'None'],
          ['Borders', (p.neighbors || []).map(provName).join(', ') || 'None'],
        ])
      ),
    ]);
  } catch {
    /* the campaign section is optional */
  }

  return { sections };
}

module.exports = { buildWiki };
