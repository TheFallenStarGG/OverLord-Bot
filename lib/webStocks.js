const path = require('path');
const { FILES } = require('../config');
const { allScoped } = require('./storage');
const { BASE_STOCKS, CANDIDATE_STOCKS, TICK_MS, FEE } = require('./stocks');

const MAX_SERVERS = 30; // markets shown on the website (keeps the file small)
const HOURS = 48;

const risk = (vol) => (vol < 0.007 ? 'Low' : vol < 0.012 ? 'Medium' : 'High');
const round4 = (n) => Math.round(n * 10000) / 10000;
const clean = (text) => String(text).replace(/<@!?\d+>/g, 'a player'); // mentions never go on the website

// Builds stocks.json: every listed server's market (prices, history, news)
function buildStocks(ctx, { slugOf, iconOf, isHidden, isBlocked }) {
  const companies = new Map(
    allScoped(path.basename(FILES.companies, '.json')).map((e) => [e.guildId, e.data?.list ?? {}])
  );

  const ranked = [...ctx.rows].sort((a, b) => b.score - a.score || b.guild.memberCount - a.guild.memberCount);
  const servers = [];

  for (const { guild } of ranked) {
    if (servers.length >= MAX_SERVERS) break;
    const market = ctx.stk.get(guild.id);
    if (!market?.prices) continue;

    const listed = companies.get(guild.id) ?? {};
    const skipped = new Set();
    const stocks = [];

    for (const [sym, price] of Object.entries(market.prices)) {
      const company = listed[sym];
      // Companies of hidden or blocked players stay off the website
      if (company && (isHidden(company.founder) || isBlocked(company.founder))) {
        skipped.add(sym);
        continue;
      }
      const def = company
        ? {
            name: company.name,
            emoji: '🏢',
            vol: 0.012,
            blurb: 'A company founded by a player. Its price follows how well the founder is doing.',
            movers: 'The founder\'s wealth and how active they are.',
          }
        : BASE_STOCKS[sym] ?? market.npcListings?.[sym] ?? CANDIDATE_STOCKS[sym];
      if (!def || !Number.isFinite(price)) continue;

      const history = (market.hist?.[sym] ?? [price]).slice(-HOURS);
      stocks.push({
        sym,
        name: def.name,
        emoji: def.emoji,
        blurb: def.blurb ?? '',
        movers: def.movers ?? '',
        risk: risk(def.vol),
        player: Boolean(company),
        price,
        change: round4(price / (history[0] || price) - 1),
        low: Math.min(...history),
        high: Math.max(...history),
        history,
      });
    }
    if (!stocks.length) continue;

    const news = (market.news ?? [])
      .filter((n) => !n.sym || !skipped.has(n.sym))
      .map((n) => ({
        at: new Date(n.at).toISOString(),
        text: clean(n.line),
        pct: n.pct ?? 0,
        major: Boolean(n.major),
        sym: n.sym ?? null,
      }));

    servers.push({
      slug: slugOf(guild.id),
      name: guild.name.slice(0, 60),
      icon: iconOf(guild),
      nextTick: new Date((market.lastTick ?? Date.now()) + TICK_MS).toISOString(),
      stocks,
      news,
    });
  }

  return { generatedAt: new Date().toISOString(), tickMs: TICK_MS, fee: FEE, servers };
}

module.exports = { buildStocks };
