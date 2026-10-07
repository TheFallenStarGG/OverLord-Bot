const { FILES } = require('../config');
const { readJson, writeJson } = require('./storage');
const { peekUser, spendCoins, addCoins, saveNow: saveEconomy, fmt } = require('./economy');
const { STOCKS, registerStock, delistStock, setHooks, price, portfolio } = require('./stocks');
const { logEvent } = require('./world');

const MIN_LEVEL = 5; // level needed to take a company public
const LISTING_FEE = 3000;
const IPO_PRICE = 50;
const MAX_COMPANIES = 6; // on the whole exchange
const GRACE_HOURS = 24; // the founder can be away this long before the price starts to suffer
const ABANDON_HOURS = 7 * 24; // after this long away the company is delisted
const MIN_PRICE = 2; // below this price the company goes bankrupt

const data = readJson(FILES.companies, null) ?? {};
data.list ??= {}; // symbol -> { sym, name, founder, listedAt, ipoPrice, listWorth, fees }
const save = () => writeJson(FILES.companies, data);

// Coins in the wallet plus everything invested in stocks
const netWorth = (userId) => peekUser(userId).coins + portfolio(userId).value;

function activity(userId) {
  const u = peekUser(userId);
  const lastSeen = Math.max(u.lastXp ?? 0, u.lastWork ?? 0, u.lastRob ?? 0, u.lastFish ?? 0, u.lastMine ?? 0);
  const idleHours = (Date.now() - lastSeen) / 3600000;
  const factor = idleHours <= GRACE_HOURS ? 1 : Math.max(0.25, 1 - (idleHours - GRACE_HOURS) * 0.012);
  return { factor, idleHours };
}

// What the company is "really" worth: the IPO price, scaled by how much richer or poorer the founder is
// than on listing day, and by whether they still play.
function fairValue(c) {
  const growth = Math.max(1000, netWorth(c.founder)) / c.listWorth;
  return c.ipoPrice * Math.min(25, Math.max(0.15, growth ** 0.6)) * activity(c.founder).factor;
}

function stockDef(c) {
  return {
    name: c.name,
    emoji: '🏢',
    base: c.ipoPrice,
    vol: 0.012,
    beta: 0.7,
    pull: 0.02, // the fair value follows the founder quickly
    founder: c.founder,
    blurb: `Founded by <@${c.founder}>. The price follows how much richer (or poorer) the founder gets, and drops if they stop playing.`,
    movers: 'The founder\'s net worth compared to the IPO, and how active they are. Trading fees go to the founder.',
  };
}

const registerCompany = (c) => registerStock(c.sym, stockDef(c), c.ipoPrice);

function closeCompany(sym, why) {
  const c = data.list[sym];
  const { paid } = delistStock(sym); // shareholders are paid out at the final price
  delete data.list[sym];
  save();
  logEvent(`🏢 **${c.name}** (${sym}) ${why} and was delisted. Shareholders were paid ${fmt(paid)}.`);
}

// Runs before every price update
function beforeTick() {
  for (const [sym, c] of Object.entries(data.list)) {
    if (!STOCKS[sym]) registerCompany(c);
    const { idleHours } = activity(c.founder);
    if (idleHours >= ABANDON_HOURS) {
      closeCompany(sym, 'was abandoned by its founder');
    } else if (price(sym) < MIN_PRICE) {
      closeCompany(sym, 'went bankrupt');
    } else {
      STOCKS[sym].base = Math.max(1, fairValue(c));
    }
  }
}

// Trading fees on a company go to its founder
function onFee(sym, fee) {
  const c = data.list[sym];
  if (!c || !fee) return;
  addCoins(c.founder, fee);
  c.fees = (c.fees ?? 0) + fee;
  save();
}

const companyOf = (userId) => Object.values(data.list).find((c) => c.founder === userId) ?? null;
const all = () => Object.values(data.list);

function found(userId, symText, nameText) {
  const name = (nameText ?? '').trim().replace(/\s+/g, ' ');
  if (companyOf(userId)) return { error: 'You already run a public company.' };
  if (all().length >= MAX_COMPANIES) return { error: `The exchange is full (at most ${MAX_COMPANIES} player companies). Wait for one to close.` };

  const u = peekUser(userId);
  if ((u.level ?? 0) < MIN_LEVEL) return { error: `You need to be level ${MIN_LEVEL} to take a company public.` };
  if (!/^[A-Za-z]{3,4}$/.test(symText ?? '')) return { error: 'The symbol must be 3 or 4 letters, like `BOBB`.' };
  const sym = symText.toUpperCase();
  if (STOCKS[sym]) return { error: `The symbol **${sym}** is already taken.` };
  if (!/^[A-Za-z0-9][A-Za-z0-9 &'.-]{2,23}$/.test(name)) {
    return { error: 'The company name must be 3-24 characters, using letters, numbers, spaces, and & \' . -' };
  }
  if (u.coins < LISTING_FEE) return { error: `Listing costs **${fmt(LISTING_FEE)}**, but you only have ${fmt(u.coins)}.` };

  spendCoins(userId, LISTING_FEE);
  const c = { sym, name, founder: userId, listedAt: Date.now(), ipoPrice: IPO_PRICE, listWorth: Math.max(1000, netWorth(userId)), fees: 0 };
  data.list[sym] = c;
  registerCompany(c);
  save();
  saveEconomy();
  logEvent(`🏢 <@${userId}> took **${name}** (${sym}) public on the Realm Stock Exchange!`);
  return { ok: true, company: c };
}

function info(sym) {
  const c = data.list[sym];
  if (!c) return null;
  const worth = netWorth(c.founder);
  return { ...c, price: price(sym), worth, growth: worth / c.listWorth - 1, ...activity(c.founder) };
}

// Put saved companies back on the market after a restart, and hook into price updates
for (const c of Object.values(data.list)) registerCompany(c);
setHooks({ beforeTick, onFee });

module.exports = { MIN_LEVEL, LISTING_FEE, IPO_PRICE, MAX_COMPANIES, ABANDON_HOURS, found, info, all, companyOf };
