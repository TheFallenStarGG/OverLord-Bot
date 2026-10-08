const { FILES } = require('../config');
const { readJson, writeJson } = require('./storage');
const { peekUser, spendCoins, addCoins, saveNow: saveEconomy, fmt } = require('./economy');
const { isActive, flag } = require('./modifiers');
const weather = require('./weather');
const { logEvent } = require('./world');
const { scoped, writeJson, currentGuild } = require('./storage');

const TICK_MS = 30 * 60 * 1000; // prices move this often
const HIST_LEN = 288; // 24 hours of prices
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
// Player companies are added per server, so every server's market has its own extra stocks
const extras = new Map(); // guildId -> { SYMBOL: definition }
const extraFor = () => {
  const id = currentGuild();
  if (!extras.has(id)) extras.set(id, Object.create(null));
  return extras.get(id);
};
const lookup = (sym) => (Object.hasOwn(BASE_STOCKS, sym) ? BASE_STOCKS[sym] : extraFor()[sym]);
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
  ownKeys: () => [...Object.keys(BASE_STOCKS), ...Object.keys(extraFor())],
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
];
const BAD_NEWS = [
  '{n} was hit by a scandal',
  '{n} missed its earnings targets',
  'A key executive at {n} quit in a huff',
  'Analysts downgraded {n} to "sell"',
  'A factory fire shut down production at {n}',
];
const CRASH_NEWS = ['Panic in the markets: stocks tumbled across the realm', 'The Overlord hinted at new taxes and investors ran for the exits'];
const BOOM_NEWS = ['A wave of optimism lifted every stock in the realm', 'Investors cheered as the realm had a record-breaking day'];

const data = scoped(FILES.stocks, (d) => {
  const fresh = d.prices === undefined;
  d.prices ??= {};
  d.fair ??= {}; // the hidden "fair value" that prices drift toward
  d.hist ??= {};
  d.users ??= {}; // userId -> { SYM: { shares, spent } }
  d.news ??= [];
  d.lastTick ??= Date.now();
  d.lastBroadcast ??= 0;
  for (const [sym, s] of Object.entries(BASE_STOCKS)) {
    d.prices[sym] ??= s.base;
    d.fair[sym] ??= s.base;
    d.hist[sym] ??= [d.prices[sym]];
  }
  hooks.restore?.(); // puts this server's player companies back on its market
  // A brand-new market starts with half a day of history so the charts are not flat
  if (fresh) {
    for (let i = 0; i < 144; i++) tickOnce(true);
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
  switch (sym) {
    case 'KRKN': return (isActive('fishfrenzy') ? 0.004 : 0) - (w === 'storm' ? 0.003 : 0);
    case 'DEEP': return (isActive('minerush') ? 0.004 : 0) - (w === 'heat' ? 0.002 : 0);
    case 'GILD': return isActive('goldrush') ? 0.004 : 0;
    case 'DRGN': return isActive('bossrush') ? 0.004 : 0;
    case 'ROGU': return (isActive('plunder') ? 0.003 : 0) + (w === 'fog' ? 0.002 : 0) - (flag('robBan') ? 0.004 : 0);
    default: return 0;
  }
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
  if (roll < 0.0007) {
    shock = -(0.07 + Math.random() * 0.08);
    events.push({ at: now, pct: shock, big: true, line: `📉 ${pick(CRASH_NEWS)} (${pctText(shock)})` });
  } else if (roll < 0.0014) {
    shock = 0.05 + Math.random() * 0.07;
    events.push({ at: now, pct: shock, big: true, line: `📈 ${pick(BOOM_NEWS)} (${pctText(shock)})` });
  }

  for (const [sym, s] of Object.entries(STOCKS)) {
    const logBase = Math.log(s.base);
    let logFair = Math.log(data.fair[sym]);
    let logPrice = Math.log(data.prices[sym]);

    // Company news: an occasional jump (riskier stocks swing harder)
    let jump = 0;
    if (Math.random() < 0.006) {
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
  for (const e of events) {
    data.news.unshift({ at: e.at, line: e.line, pct: e.pct });
    if (e.big) logEvent(e.line.replace(/\(.*\)$/, '').trim());
  }
  data.news.length = Math.min(data.news.length, NEWS_KEEP);
  return events;
}

// Runs any price updates that are due (also catches up after the bot was offline, up to 3 hours' worth)
function maybeTick() {
  const due = Math.floor((Date.now() - data.lastTick) / TICK_MS);
  if (due < 1) return [];
  const events = [];
  for (let i = 0; i < Math.min(due, 36); i++) events.push(...tickOnce());
  data.lastTick = due > 36 ? Date.now() : data.lastTick + due * TICK_MS;
  save();
  return events;
}

// Picks one big piece of news worth announcing (at most one every 30 minutes)
function pickBroadcast(events) {
  const big = events.filter((e) => e.big);
  if (!big.length || Date.now() - data.lastBroadcast < 30 * 60 * 1000) return null;
  data.lastBroadcast = Date.now();
  save();
  return big.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))[0];
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

function portfolio(userId) {
  const holdings = Object.entries(data.users[userId] ?? {})
    .filter(([sym]) => STOCKS[sym])
    .map(([sym, pos]) => {
      const value = pos.shares * data.prices[sym];
      return { sym, shares: pos.shares, spent: pos.spent, value, profit: value - pos.spent, pct: pos.spent ? value / pos.spent - 1 : 0 };
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
function delistStock(sym) {
  const finalPrice = data.prices[sym] ?? 0;
  let paid = 0;
  for (const [userId, holdings] of Object.entries(data.users)) {
    const pos = holdings[sym];
    if (!pos) continue;
    const payout = Math.floor(pos.shares * finalPrice);
    if (payout > 0) addCoins(userId, payout);
    paid += payout;
    delete holdings[sym];
    if (!Object.keys(holdings).length) delete data.users[userId];
  }
  delete STOCKS[sym];
  delete data.prices[sym];
  delete data.fair[sym];
  delete data.hist[sym];
  persist();
  return { paid, price: finalPrice };
}

module.exports = {
  STOCKS, FEE, MIN_INVEST, TICK_MS,
  maybeTick, pickBroadcast,
  price, change, range, spark, trend, fmtPrice, nextTickAt, getNews,
  resolveSym, parseAmount, positionOf,
  invest, cashout, cashoutAll, portfolio,
  setHooks, registerStock, delistStock,
};
