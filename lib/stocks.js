const { FILES } = require('../config');
const { peekUser, spendCoins, addCoins, saveNow: saveEconomy, fmt } = require('./economy');
const { isActive, flag } = require('./modifiers');
const weather = require('./weather');
const { logEvent } = require('./world');
const { scoped, writeJson, currentGuild } = require('./storage');

const TICK_MS = 60 * 60 * 1000; // prices move once per hour (fewer reads/writes)
const HIST_LEN = 48; // 48 hours of hourly prices
const MAX_NPC = 14; // hard cap on non-player listings on the board
const FEE = 0.01; // charged on buying and on selling
const MIN_INVEST = 10;
const NEWS_KEEP = 12;

// Lets lib/companies.js plug player companies into the market
const hooks = { beforeTick: null, onFee: null };

// vol = typical move per update, beta = how strongly it follows the whole market, base = long-run value
// (optional: pull = how fast the hidden fair value moves toward base, founder = a player company)
const BASE_STOCKS = {
  OVLD: { name: 'Overlord Industries', emoji: '👑', base: 250, vol: 0.0035, beta: 0.8, blurb: 'The safest bet in the realm. Slow, steady, and always in fashion.', movers: 'Hardly reacts to anything. A calm blue chip.' },
  GILD: { name: 'Goldmaw Vaults', emoji: '🏦', base: 400, vol: 0.005, beta: 0.9, blurb: 'A dragon-guarded bank that grows with the realm\'s gold.', movers: 'Rises during a Gold Rush.' },
  KRKN: { name: 'Kraken Fisheries', emoji: '🎣', base: 80, vol: 0.008, beta: 1.0, blurb: 'Sells everything that bites. Good days and bad days.', movers: 'Rises during Fishing Frenzy and falls in thunderstorms.' },
  DEEP: { name: 'Deepdelve Mining', emoji: '⛏️', base: 120, vol: 0.009, beta: 1.1, blurb: 'Digs where nobody else dares.', movers: 'Rises during Mining Rush and falls in heatwaves.' },
  PAWS: { name: 'Paws & Claws Co.', emoji: '🐾', base: 60, vol: 0.007, beta: 0.9, blurb: 'Pet food, pet toys, and pet insurance.', movers: 'Follows the general mood of the market.' },
  DRGN: { name: 'Dragonfire Armaments', emoji: '🐉', base: 150, vol: 0.011, beta: 1.2, blurb: 'Swords, shields, and very hot sauce.', movers: 'Rises during Boss Rush.' },
  ROGU: { name: 'Shadow Syndicate', emoji: '🥷', base: 40, vol: 0.016, beta: 1.3, blurb: 'Risky business. Nobody knows what they actually sell.', movers: 'Rises under a Decree of Plunder and in fog, and falls under a Decree of Peace.' },
  MOON: { name: 'Moonshot Labs', emoji: '🚀', base: 25, vol: 0.022, beta: 1.5, blurb: 'Pure speculation. It might triple tomorrow, or vanish.', movers: 'Wild swings in both directions.' },
};

// Companies that are not always on the board — they can IPO later
const CANDIDATE_STOCKS = {
  BREW: { name: 'Foam & Fury Brewing', emoji: '🍺', base: 55, vol: 0.012, beta: 1.0, blurb: 'Tavern ale for adventurers.', movers: 'Rises when people are spending freely.' },
  RUNE: { name: 'Runescript Scrolls', emoji: '📜', base: 70, vol: 0.014, beta: 1.1, blurb: 'Magic stationery and spell ink.', movers: 'Choppy; loves XP surges.' },
  CART: { name: 'Caravan Collective', emoji: '🐪', base: 90, vol: 0.01, beta: 0.9, blurb: 'Moves goods between towns.', movers: 'Steady unless weather is awful.' },
  HEXA: { name: 'Hexagon Insurance', emoji: '🛡️', base: 110, vol: 0.007, beta: 0.7, blurb: 'Insures duelists and shopkeepers.', movers: 'Rises when crime is high.' },
  MYCO: { name: 'Mycelium Markets', emoji: '🍄', base: 45, vol: 0.015, beta: 1.2, blurb: 'Weird fungi. Weirder profits.', movers: 'Volatile with gathering events.' },
  CLOCK: { name: 'Clockwork Courier', emoji: '⏰', base: 65, vol: 0.011, beta: 1.0, blurb: 'Same-day parcel golems.', movers: 'Follows general market mood.' },
  SALT: { name: 'Saltspine Trading', emoji: '🧂', base: 50, vol: 0.013, beta: 1.1, blurb: 'Spice routes and sea salt.', movers: 'Tied to fishing weather.' },
  BELL: { name: 'Belltower Media', emoji: '🔔', base: 35, vol: 0.018, beta: 1.4, blurb: 'Gossip, gazettes, and attention.', movers: 'Spikes on big realm news.' },
};

// Player companies are added per server, so every server's market has its own extra stocks
const extras = new Map(); // guildId -> { SYMBOL: definition }
const extraFor = () => {
  const id = currentGuild();
  if (!extras.has(id)) extras.set(id, Object.create(null));
  return extras.get(id);
};
const lookup = (sym) => {
  if (data?.suspended?.[sym]) return undefined;
  if (Object.hasOwn(BASE_STOCKS, sym)) return BASE_STOCKS[sym];
  if (data?.npcListings?.[sym]) return data.npcListings[sym];
  return extraFor()[sym];
};
const STOCKS = new Proxy({}, {
  get: (_, sym) => lookup(sym),
  has: (_, sym) => lookup(sym) !== undefined,
  set: (_, sym, def) => {
    extraFor()[sym] = def;
    return true;
  },
  deleteProperty: (_, sym) => {
    delete extraFor()[sym];
    return true;
  },
  ownKeys: () => {
    const base = Object.keys(BASE_STOCKS).filter((s) => !data?.suspended?.[s]);
    const npc = Object.keys(data?.npcListings || {});
    const player = Object.keys(extraFor());
    return [...new Set([...base, ...npc, ...player])];
  },
  getOwnPropertyDescriptor: (_, sym) => {
    const value = lookup(sym);
    return value ? { value, enumerable: true, configurable: true, writable: true } : undefined;
  },
});

const GOOD_NEWS = [
  '{n} announced record profits',
  '{n} landed a huge contract with the Overlord',
  '{n} unveiled a surprise new product',
  'Analysts upgraded {n} to "buy"',
  'Rumors of a buyout sent {n} soaring',
  '{n} beat earnings expectations by a mile',
  '{n} opened three new branches in one week',
  'The Overlord publicly praised {n}',
  '{n} won an exclusive royal supply contract',
  '{n} discovered a valuable new resource vein',
  'Foreign investors poured gold into {n}',
  '{n} cut costs without cutting quality',
  'A celebrity endorsement boosted {n}',
  '{n} patented a breakthrough process',
  'Short sellers got crushed as {n} rallied',
  '{n} raised its dividend (in spirit, if not in coins)',
  'Workers at {n} reported record productivity',
  '{n} secured a long-term deal with the army',
  'Insider buying at {n} sparked optimism',
  '{n} cleared a major regulatory hurdle',
  'A rival of {n} stumbled, and customers switched',
  '{n} launched a wildly popular limited drop',
  'Guilds across the realm endorsed {n}',
  '{n} posted its best quarter in years',
  'Whispers of an IPO spin-off lifted {n}',
];

const BAD_NEWS = [
  '{n} was hit by a scandal',
  '{n} missed its earnings targets',
  'A key executive at {n} quit in a huff',
  'Analysts downgraded {n} to "sell"',
  'A factory fire shut down production at {n}',
  '{n} is under investigation by the Overlord\'s auditors',
  'Customers boycotted {n} after a PR disaster',
  '{n} recalled a defective product line',
  'A rival undercut {n} on every price',
  'Debt collectors were seen at {n} headquarters',
  '{n} lost its biggest client overnight',
  'Flooding ruined a major warehouse of {n}',
  'Leadership at {n} is fighting in public',
  '{n} delayed a critical product launch again',
  'Accounting "irregularities" were found at {n}',
  'Workers walked out at {n}',
  '{n} faces a crushing lawsuit',
  'Pirates raided a shipment belonging to {n}',
  'A failed expansion drained {n}\'s coffers',
  'Rumors of insolvency circled {n}',
  '{n} issued a grim outlook for the season',
  'Key suppliers cut ties with {n}',
  'A cursed artifact incident hurt {n}\'s brand',
  'Tax agents raided the books of {n}',
  'Short sellers piled onto {n}',
];

const CRASH_NEWS = [
  'Panic in the markets: stocks tumbled across the realm',
  'The Overlord hinted at new taxes and investors ran for the exits',
  'A credit freeze froze trading floors from coast to coast',
  'War drums on the border sent every portfolio into freefall',
  'A bank run sparked a realm-wide selloff',
  'Contagion: one default dragged the whole exchange down',
  'The royal treasury closed its doors for "review" and markets panicked',
  'Overnight margin calls forced mass liquidations',
];

const BOOM_NEWS = [
  'A wave of optimism lifted every stock in the realm',
  'Investors cheered as the realm had a record-breaking day',
  'Peace talks sent risk appetite soaring across the board',
  'The Overlord cut tariffs and markets roared',
  'A gold discovery in the hills flooded the exchange with cash',
  'Foreign caravans arrived heavy with coin — everything rallied',
  'Easy credit from the Vaults fueled a buying frenzy',
  'Festival season spending lifted the entire market',
];
  
const data = scoped(FILES.stocks, (d) => {
  const fresh = d.prices === undefined;
  d.prices ??= {};
  d.fair ??= {}; // the hidden "fair value" that prices drift toward
  d.hist ??= {};
  d.users ??= {}; // userId -> { SYM: { shares, spent } }
  d.news ??= [];
  d.lastTick ??= Date.now();
  d.lastBroadcast ??= 0;
  d.suspended ??= {}; // base symbols that crashed / were bought out (not tradeable)
  d.npcListings ??= {}; // symbol -> def for NPC companies that IPOd in
  d.lastMajorAt ??= 0; // last IPO / buyout / bankruptcy (per server)
  for (const [sym, s] of Object.entries(BASE_STOCKS)) {
    d.prices[sym] ??= s.base;
    d.fair[sym] ??= s.base;
    d.hist[sym] ??= [d.prices[sym]];
  }
  hooks.restore?.(); // puts this server's player companies back on its market
  // A brand-new market starts with half a day of history so the charts are not flat
  if (fresh) {
    for (let i = 0; i < 24; i++) tickOnce(true);
    d.lastTick = Date.now();
    }
});

const save = () => writeJson(FILES.stocks, data);
// Trades save both files straight away so a crash can never duplicate or lose coins
const persist = () => {
  saveEconomy();
  save();
};

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// A random number from a bell curve (mean 0, spread 1)
function randn() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Things happening in the realm nudge the companies they affect
function sectorDrift(sym, w) {
  let d = 0;
  switch (sym) {
    case 'KRKN': // fishing
      if (isActive('fishfrenzy') || isActive('deepveins')) d += 0.004;
      if (w === 'rain' || w === 'thunderstorm' || w === 'monsoon') d += 0.003;
      if (w === 'heatwave' || w === 'sandstorm') d -= 0.002;
      break;
    case 'DEEP': // mining
      if (isActive('minerush') || isActive('deepveins')) d += 0.004;
      if (w === 'sandstorm' || w === 'eclipse') d += 0.002;
      if (w === 'heatwave') d -= 0.003;
      break;
    case 'GILD':
      if (isActive('goldrush') || isActive('jackpotsky')) d += 0.004;
      break;
    case 'DRGN':
      if (isActive('bossrush') || isActive('bloodmoon')) d += 0.004;
      if (w === 'bloodmoon' || w === 'eclipse') d += 0.002;
      break;
    case 'ROGU':
      if (isActive('plunder') || isActive('blackmarket') || isActive('shadow')) d += 0.003;
      if (w === 'fog' || w === 'bloodmoon' || w === 'eclipse') d += 0.002;
      if (flag('robBan') || isActive('peace') || isActive('quietrealm')) d -= 0.004;
      break;
    case 'MOON':
      if (w === 'aurora' || w === 'eclipse' || w === 'bloodmoon') d += 0.004;
      if (isActive('xpsurge')) d += 0.002;
      break;
    case 'PAWS':
      if (isActive('doubletime') || isActive('feast')) d += 0.002;
      break;
    case 'OVLD':
      if (isActive('drills') || isActive('bossrush')) d += 0.001;
      break;
    default:
      break;
  }
  // Shared mood from dramatic skies
  if (w === 'aurora' || w === 'rainbow') d += 0.001;
  if (w === 'bloodmoon') d += 0.001;
  return d;
}

const pctText = (pct) => `${pct > 0 ? '+' : '-'}${(Math.abs(pct) * 100).toFixed(1)}%`;

// Moves every price by one step. Returns the news that happened (none when quiet).
function tickOnce(quiet = false) {
  if (!quiet && hooks.beforeTick) hooks.beforeTick();

  const now = Date.now();
  const events = [];
  const w = weather.current().id;
  const mood = randn(); // shared by the whole market

  // Rare market-wide swings
  let shock = 0;
  const roll = Math.random();
  if (roll < 0.012) {
    shock = -(0.08 + Math.random() * 0.1);
    events.push({ at: now, pct: shock, big: true, line: `📉 ${pick(CRASH_NEWS)} (${pctText(shock)})` });
  } else if (roll < 0.024) {
    shock = 0.06 + Math.random() * 0.09;
    events.push({ at: now, pct: shock, big: true, line: `📈 ${pick(BOOM_NEWS)} (${pctText(shock)})` });
  }
    
  for (const [sym, s] of Object.entries(STOCKS)) {
    const logBase = Math.log(s.base);
    let logFair = Math.log(data.fair[sym]);
    let logPrice = Math.log(data.prices[sym]);

    // Company news: an occasional jump (riskier stocks swing harder)
    let jump = 0;
    if (Math.random() < 0.04) {
      const up = Math.random() < 0.5;
      const size = (0.03 + Math.random() * 0.06) * (0.6 + s.vol * 40);
      jump = up ? size : -size;
      const text = pick(up ? GOOD_NEWS : BAD_NEWS).replace('{n}', s.name);
      events.push({ at: now, sym, pct: jump, big: Math.abs(jump) >= 0.08, line: `${up ? '📈' : '📉'} ${s.emoji} ${text} (${pctText(jump)})` });
    }

    // The fair value wanders slowly, drifts back toward the base, and reacts to the world
    logFair += (s.pull ?? 0.0008) * (logBase - logFair) + s.vol * 0.25 * randn() + sectorDrift(sym, w) + jump * 0.6 + shock * 0.5;
    logFair = clamp(logFair, logBase + Math.log(0.4), logBase + Math.log(3));

    // The price chases the fair value, plus random noise (part of it shared by the whole market)
    logPrice += 0.004 * (logFair - logPrice) + s.vol * (0.85 * randn() + 0.5 * s.beta * mood) + jump + shock * s.beta;

    data.fair[sym] = Math.exp(logFair);
    data.prices[sym] = Math.max(1, Math.round(Math.exp(logPrice) * 100) / 100);
    const h = data.hist[sym];
    h.push(data.prices[sym]);
    if (h.length > HIST_LEN) h.shift();
  }

if (quiet) return [];

  corporateActions(now, events);

  for (const e of events) {
    data.news.unshift({
      at: e.at,
      line: e.line,
      pct: e.pct,
      kind: e.kind || null,
      major: Boolean(e.major),
    });
    if (e.big) logEvent(e.line.replace(/\(.*\)$/, '').trim());
    }
  data.news.length = Math.min(data.news.length, NEWS_KEEP);
  return events;
  }

function isPlayerStock(sym) {
  return Boolean(STOCKS[sym]?.founder);
}

function activeNpc() {
  return Object.keys(STOCKS).filter((s) => STOCKS[s] && !isPlayerStock(s));
}

const DAY_MS = 24 * 60 * 60 * 1000;

function canDoMajor(now) {
  return now - (data.lastMajorAt || 0) >= DAY_MS;
}

function markMajor(now) {
  data.lastMajorAt = now;
}

// IPO, bankruptcy, or buyout — at most one major action per server per day
function corporateActions(now, events) {
  if (!canDoMajor(now)) return;

  const listed = activeNpc();

  // --- Bankruptcy: only if basically dead (no random healthy victims) ---
  // Must be under ~8% of fair base, or under 3 coins absolute
  if (listed.length > 4 && Math.random() < 0.04) {
    const weak = listed
      .map((sym) => ({
        sym,
        price: data.prices[sym] ?? 0,
        base: STOCKS[sym]?.base ?? 1,
      }))
      .filter((x) => x.price <= 3 || x.price < x.base * 0.08)
      .sort((a, b) => a.price / a.base - b.price / b.base);

    if (weak.length) {
      const sym = weak[0].sym;
      const name = STOCKS[sym]?.name || sym;
      const emoji = STOCKS[sym]?.emoji || '📉';
      const { wipedShares } = delistStock(sym, {
        suspendBase: true,
        clearNpc: true,
        wipe: true,
      });
      const line =
        `💥 ${emoji} **${name}** (${sym}) went **bankrupt** and was delisted. ` +
        `Shareholders were wiped out` +
        (wipedShares > 0 ? ` (**${wipedShares.toFixed(2)}** shares → **0** 🪙)` : '') +
        `.`;
      events.push({ at: now, sym, pct: -1, big: true, major: true, kind: 'crash', line });
      logEvent(line);
      markMajor(now);
      return; // one major per day
    }
  }

  // --- Buyout: can happen while still alive (sell before you die) ---
  if (listed.length > 4 && Math.random() < 0.05) {
    const shuffled = listed.slice().sort(() => Math.random() - 0.5);
    // Prefer buying a softer name, not only corpses
    const ranked = shuffled
      .map((sym) => ({
        sym,
        ratio: (data.prices[sym] ?? 0) / (STOCKS[sym]?.base ?? 1),
      }))
      .sort((a, b) => a.ratio - b.ratio);

    const target = ranked[0]?.sym;
    const buyer = shuffled.find((s) => s !== target);
    if (buyer && target) {
      const b = STOCKS[buyer];
      const t = STOCKS[target];
      // Don't buy out the rock-solid leader every time: skip if target is still very strong
      const targetRatio = (data.prices[target] ?? 0) / (t.base || 1);
      if (targetRatio < 1.4) {
        const premium = 1.12 + Math.random() * 0.25; // 12–37% over last price
        const buyPrice = Math.max(1, Math.round(data.prices[target] * premium * 100) / 100);

        data.prices[target] = buyPrice;
        const { paid } = delistStock(target, {
          suspendBase: true,
          clearNpc: true,
          wipe: false,
        });

        data.prices[buyer] = Math.round(data.prices[buyer] * (1.03 + Math.random() * 0.05) * 100) / 100;
        data.fair[buyer] = Math.max(data.fair[buyer], data.prices[buyer]);

        const line =
          `🤝 **${b.name}** (${buyer}) **acquired** **${t.name}** (${target}) ` +
          `at **${fmtPrice(buyPrice)}** 🪙/share. Target shareholders received **${fmt(paid)}**.`;
        events.push({ at: now, sym: buyer, pct: 0.08, big: true, major: true, kind: 'buyout', line });
        logEvent(line);
        markMajor(now);
        return;
      }
    }
  }

  // --- New NPC IPO ---
  const npcCount = listed.length;
  if (npcCount < MAX_NPC && Math.random() < 0.05) {
    const used = new Set([
      ...Object.keys(BASE_STOCKS),
      ...Object.keys(data.npcListings || {}),
      ...Object.keys(extraFor()),
    ]);
    const pool = Object.entries(CANDIDATE_STOCKS).filter(
      ([sym]) => !used.has(sym) && !data.suspended?.[sym]
    );
    if (pool.length) {
      const [sym, def] = pick(pool);
      data.npcListings[sym] = { ...def };
      delete data.suspended[sym];
      registerStock(sym, def, def.base * (0.9 + Math.random() * 0.2));
      const open = data.prices[sym];
      const line = `🆕 ${def.emoji} **${def.name}** (${sym}) went public at **${fmtPrice(open)}** 🪙/share!`;
      events.push({ at: now, sym, pct: 0.05, big: true, major: true, kind: 'ipo', line });
      logEvent(line);
      markMajor(now);
    }
  }
                     }
  
// Runs any price updates that are due (also catches up after the bot was offline, up to 3 hours' worth)
function maybeTick() {
  const due = Math.floor((Date.now() - data.lastTick) / TICK_MS);
  if (due < 1) return [];
  const events = [];
  // At most 24 hourly ticks of catch-up (1 day), not days of spam writes
  const steps = Math.min(due, 24);
  for (let i = 0; i < steps; i++) events.push(...tickOnce());
  data.lastTick = due > 24 ? Date.now() : data.lastTick + due * TICK_MS;
  save();
  return events;
}

// Picks one big piece of news worth announcing (at most one every 30 minutes)
// Major corporate actions always announce. Other "big" news at most once per hour.
function pickBroadcast(events) {
  const major = events.filter((e) => e.major);
  const otherBig = events.filter((e) => e.big && !e.major);

  let filler = null;
  if (otherBig.length && Date.now() - data.lastBroadcast >= 60 * 60 * 1000) {
    filler = otherBig.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))[0];
    data.lastBroadcast = Date.now();
    save();
  }

  return { major, filler };
}

// ---------- Reading prices ----------

const price = (sym) => data.prices[sym];
const nextTickAt = () => data.lastTick + TICK_MS;
const getNews = () => data.news;
const fmtPrice = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const trend = (pct) => `${pct >= 0 ? '🟢 ▲' : '🔴 ▼'} ${(Math.abs(pct) * 100).toFixed(1)}%`;

function change(sym) {
  const h = data.hist[sym];
  return h.length > 1 ? data.prices[sym] / h[0] - 1 : 0;
}

function range(sym) {
  const h = data.hist[sym];
  return { low: Math.min(...h), high: Math.max(...h) };
}

const BLOCKS = '▁▂▃▄▅▆▇█';
// A tiny chart of the last `span` updates, shown with about `points` characters
function spark(sym, points = 24, span = 72) {
  const h = data.hist[sym].slice(-span);
  const step = Math.max(1, Math.floor(h.length / points));
  const picked = [];
  for (let i = h.length - 1; i >= 0 && picked.length < points; i -= step) picked.unshift(h[i]);
  const min = Math.min(...picked);
  const max = Math.max(...picked);
  if (max === min) return BLOCKS[3].repeat(picked.length);
  return picked.map((v) => BLOCKS[Math.round(((v - min) / (max - min)) * (BLOCKS.length - 1))]).join('');
}

const norm = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
// "krkn", "kraken", "Kraken Fisheries" -> "KRKN"
function resolveSym(text) {
  const q = norm(text ?? '');
  if (!q) return null;
  if (STOCKS[q]) return q;
  if (q.length < 3) return null;
  return Object.keys(STOCKS).find((sym) => norm(STOCKS[sym].name).includes(q)) ?? null;
}

// Turns "500", "2k", "1.5m", or "all" into a whole number (or null if it is not an amount)
function parseAmount(text, all) {
  if (!text) return null;
  const t = text.toLowerCase().replace(/,/g, '');
  if (t === 'all') return all;
  const m = /^(\d+(?:\.\d+)?)([km])?$/.exec(t);
  if (!m) return null;
  return Math.floor(Number(m[1]) * ({ k: 1e3, m: 1e6 }[m[2]] ?? 1));
}

// ---------- Trading ----------

const positionOf = (userId, sym) => data.users[userId]?.[sym] ?? null;

function invest(userId, sym, coins) {
  if (!STOCKS[sym]) return { error: 'That stock does not exist.' };
  if (STOCKS[sym].founder === userId) return { error: 'You cannot trade shares of your own company.' };
  if (!Number.isInteger(coins) || coins < MIN_INVEST) return { error: `The minimum investment is ${fmt(MIN_INVEST)}.` };
  const have = peekUser(userId).coins;
  if (coins > have) return { error: `You only have ${fmt(have)}.` };

  spendCoins(userId, coins);
  const fee = Math.max(1, Math.round(coins * FEE));
  if (hooks.onFee) hooks.onFee(sym, fee); // player companies pay their fees to the founder
  const shares = (coins - fee) / data.prices[sym];
  const mine = (data.users[userId] ??= {});
  const pos = (mine[sym] ??= { shares: 0, spent: 0 });
  pos.shares += shares;
  pos.spent += coins;
  persist();
  return { ok: true, price: data.prices[sym], shares, fee };
}

// fraction = how much of the position to sell (1 = all of it)
function cashout(userId, sym, fraction = 1) {
  const pos = data.users[userId]?.[sym];
  if (!pos || pos.shares <= 0) return { error: `You do not own any ${sym}.` };

  const sell = fraction >= 0.9999 ? pos.shares : pos.shares * fraction;
  const gross = sell * data.prices[sym];
  const net = Math.floor(gross * (1 - FEE));
  if (net < 1) return { error: 'That amount is too small to cash out.' };

  const basis = pos.spent * (sell / pos.shares);
  pos.shares -= sell;
  pos.spent -= basis;
  if (pos.shares < 1e-9) delete data.users[userId][sym];
  if (!Object.keys(data.users[userId]).length) delete data.users[userId];

  addCoins(userId, net);
  if (hooks.onFee) hooks.onFee(sym, Math.round(gross) - net);
  persist();
  return { ok: true, sym, price: data.prices[sym], net, fee: Math.round(gross) - net, profit: net - Math.round(basis) };
}

function cashoutAll(userId) {
  const results = Object.keys(data.users[userId] ?? {}).map((sym) => cashout(userId, sym, 1)).filter((r) => r.ok);
  return {
    results,
    net: results.reduce((sum, r) => sum + r.net, 0),
    profit: results.reduce((sum, r) => sum + r.profit, 0),
  };
}

// Drop positions in delisted / missing tickers so portfolios stay clean after crashes
function scrubHoldings(userId) {
  const mine = data.users[userId];
  if (!mine) return;
  for (const sym of Object.keys(mine)) {
    if (!STOCKS[sym] || data.prices[sym] == null || mine[sym].shares <= 0) {
      delete mine[sym];
    }
  }
  if (!Object.keys(mine).length) delete data.users[userId];
}

function scrubAllHoldings() {
  for (const userId of Object.keys(data.users)) scrubHoldings(userId);
}

function portfolio(userId) {
  scrubHoldings(userId);
  const holdings = Object.entries(data.users[userId] ?? {})
    .filter(([sym, pos]) => STOCKS[sym] && data.prices[sym] != null && pos.shares > 0)
    .map(([sym, pos]) => {
      const value = pos.shares * data.prices[sym];
      return {
        sym,
        shares: pos.shares,
        spent: pos.spent,
        value,
        profit: value - pos.spent,
        pct: pos.spent ? value / pos.spent - 1 : 0,
      };
    })
    .sort((a, b) => b.value - a.value);
  const value = holdings.reduce((sum, h) => sum + h.value, 0);
  const spent = holdings.reduce((sum, h) => sum + h.spent, 0);
  return { holdings, value, spent, profit: value - spent };
}

// ---------- Player companies ----------

function setHooks(h) {
  Object.assign(hooks, h);
}

// Adds a stock to the market (or re-adds it after a restart)
function registerStock(sym, def, startPrice) {
  STOCKS[sym] = def;
  data.prices[sym] ??= startPrice;
  data.fair[sym] ??= startPrice;
  data.hist[sym] ??= [data.prices[sym]];
}

// Removes a stock and pays every shareholder the final price (no fee)
// wipe: true  → bankruptcy: investors lose everything (no payout)
// wipe: false → buyout / orderly close: pay final price, no fee
function delistStock(sym, { suspendBase = false, clearNpc = false, wipe = false } = {}) {
  const finalPrice = wipe ? 0 : data.prices[sym] ?? 0;
  let paid = 0;
  let wipedShares = 0;

  for (const [userId, holdings] of Object.entries(data.users)) {
    const pos = holdings[sym];
    if (!pos) continue;

    if (wipe) {
      wipedShares += pos.shares;
      // no coins returned
    } else {
      const payout = Math.floor(pos.shares * finalPrice);
      if (payout > 0) {
        addCoins(userId, payout);
        paid += payout;
      }
    }

    delete holdings[sym];
    if (!Object.keys(holdings).length) delete data.users[userId];
  }

  try {
    delete STOCKS[sym];
  } catch (_) {
    /* ignore */
  }
  if (data.npcListings) delete data.npcListings[sym];
  if (suspendBase && Object.hasOwn(BASE_STOCKS, sym)) {
    data.suspended[sym] = true;
  }
  if (clearNpc && data.npcListings) {
    delete data.npcListings[sym];
  }

  delete data.prices[sym];
  delete data.fair[sym];
  delete data.hist[sym];
  scrubAllHoldings();
  persist();
  return { paid, wipedShares, price: finalPrice, wiped: wipe };
}

module.exports = {
  STOCKS, BASE_STOCKS, CANDIDATE_STOCKS, FEE, MIN_INVEST, TICK_MS,
  maybeTick, pickBroadcast,
  price, change, range, spark, trend, fmtPrice, nextTickAt, getNews,
  resolveSym, parseAmount, positionOf,
  invest, cashout, cashoutAll, portfolio,
  setHooks, registerStock, delistStock,
};
