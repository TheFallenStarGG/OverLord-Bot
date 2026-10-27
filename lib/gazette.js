const path = require('path');
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { FILES, DAILY_LIMIT } = require('../config');
const { renderGazetteImage, canvasAvailable } = require('./gazetteRender');
const { top, fmt, levelFromXp } = require('./economy');
const { activeList } = require('./modifiers');
const { askAI } = require('./ai');
const { todayCount } = require('./usage');
const { data, saveNow } = require('./world');
const { currentUsurper, meterInfo } = require('./rebellion');
const { getActiveBounty } = require('./bounty');
const { broadcast } = require('./announce');
const { logging } = require('./logging');
const { currentGuild, allScoped } = require('./storage');
const weather = require('./weather');

// The Gazette comes out this many minutes after midnight UTC, which is when the daily AI limit resets.
const GAZETTE_DELAY_MIN = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

const todayUTC = () => new Date().toISOString().slice(0, 10);
const utc = (ms) => `${new Date(ms).toISOString().slice(11, 16)} UTC`;

function gazetteDue() {
  const now = new Date();
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  return data.gazette.lastDay !== todayUTC() && minutes >= GAZETTE_DELAY_MIN;
}

// ---------- Names ----------

let people = {}; // id -> name, for everyone named in the edition being written
const nameCache = new Map();

async function nameOf(client, id) {
  const gid = currentGuild();
  const key = `${gid}:${id}`;
  const hit = nameCache.get(key);
  if (hit && Date.now() < hit.until) {
    people[id] = hit.name;
    return hit.name;
  }
  let name = null;
  try {
    const guild = gid ? client.guilds.cache.get(gid) : null;
    const member = guild ? guild.members.cache.get(id) ?? (await guild.members.fetch(id).catch(() => null)) : null;
    name = member?.displayName ?? null;
  } catch {
    name = null;
  }
  if (!name) {
    const user = client.users.cache.get(id) ?? (await client.users.fetch(id).catch(() => null));
    name = user?.globalName || user?.username || null;
  }
  name = name || 'A mysterious stranger';
  nameCache.set(key, { name, until: Date.now() + 6 * 60 * 60 * 1000 });
  people[id] = name;
  return name;
}

// Turns <@123> into a plain name and strips timestamps and custom emoji
async function plain(client, text) {
  let out = String(text || '');
  for (const id of new Set([...out.matchAll(/<@!?(\d+)>/g)].map((m) => m[1]))) {
    const n = await nameOf(client, id);
    out = out.replaceAll(`<@${id}>`, n).replaceAll(`<@!${id}>`, n);
  }
  return out.replace(/<t:\d+(?::[a-zA-Z])?>/g, '').replace(/<a?:\w+:\d+>/g, '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
}

async function resolveEditionText(client, edition) {
  const sections = [];
  for (const s of edition.sections || []) {
    sections.push({ name: await plain(client, s.name), value: await plain(client, s.value) });
  }
  return {
    ...edition,
    editorial: edition.editorial ? await plain(client, edition.editorial) : edition.editorial,
    sections,
  };
}

const snapshotNow = () => ({
  coins: Object.fromEntries(top('coins', 300).map((e) => [e.id, e.value])),
  xp: Object.fromEntries(top('xp', 300).map((e) => [e.id, e.value])),
});

// ---------- Filler content (no AI, no requests) ----------

function rng(seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickN(list, n, rand) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

const QUOTES = [
  'Obedience is the cheapest form of wealth.',
  'I do not take your coins. I merely collect what was already mine.',
  'A mortal who complains is a mortal who still has the energy to work.',
  'Rebellion is just taxation with extra enthusiasm.',
  'The throne is warm. Come and get it. I dare you.',
  'Gold is temporary. My disappointment is eternal.',
  'Markets rise, markets fall. I remain unimpressed.',
  'Every empire begins with someone saying: surely nobody will rob me.',
  'Be grateful. I could have made this paper longer.',
  'Fortune favors the bold. I favor the taxed.',
];

const TIPS = [
  'Claim !!daily every day. Streaks pay more for every day you keep them alive.',
  'Check !!forecast before you fish, mine or rob. Weather changes your luck.',
  '!!work pays once a minute, and steady work earns you promotions. See !!career.',
  'Watch the market with !!stocks. Prices move every few minutes.',
  'Hired muscle guards your purse while you sleep. See !!muscle.',
  '!!campaign shows the war map. Your server is a house, and provinces are the prize.',
  '!!quests hands out daily and weekly goals with bonus coins.',
  'A successful !!spy marks your target, which helps your next robbery.',
  '!!pet companions grant permanent perks. Keep yours fed.',
  'See who the Overlord has marked with !!bounty, then decide how brave you are.',
  '!!profile shows your whole career at a glance.',
  'Open your bag with !!inventory to see what you can !!use.',
];

const CLASSIFIEDS = [
  'WANTED: Someone to tell {a} that robbing {b} again is a bad idea. Reward: nothing.',
  "LOST: {a}'s dignity. Last seen near the slot machines.",
  'FOR SALE: One padlock, barely used. Owner was robbed anyway.',
  'HELP WANTED: Hired muscle. Must enjoy upkeep costs. Inquire with {a}.',
  'NOTICE: The Overlord is not hiring. Please stop asking.',
  '{a} seeks a business partner. Must tolerate market crashes.',
  'FOUND: One pickaxe. {a} claims it. The Overlord doubts this.',
  'TO LET: One throne, slightly used. See {a} for a viewing.',
  '{a} would like everyone to know the last bounty was a misunderstanding.',
  "LOOKING FOR: Anyone who has seen {b}'s coins. {a} has definitely not taken them.",
];

// ---------- Optional boxes. Each one returns null if its data isn't there. ----------

function marketReport() {
  try {
    const { BASE_STOCKS, CANDIDATE_STOCKS } = require('./stocks');
    const gid = currentGuild();
    const m = allScoped('stocks').find((e) => e.guildId === gid)?.data;
    if (!m?.prices) return null;
    const listed = allScoped(path.basename(FILES.companies, '.json')).find((e) => e.guildId === gid)?.data?.list ?? {};
    const rows = [];
    for (const [sym, price] of Object.entries(m.prices)) {
      if (!Number.isFinite(price)) continue;
      const hist = (m.hist?.[sym] ?? []).slice(-48);
      const base = hist[0] || price;
      const def = listed[sym] ? { name: listed[sym].name } : BASE_STOCKS[sym] ?? m.npcListings?.[sym] ?? CANDIDATE_STOCKS[sym];
      rows.push({ name: def?.name || sym, price: Math.round(price), pct: price / base - 1 });
    }
    if (!rows.length) return null;
    rows.sort((a, b) => b.pct - a.pct);
    const up = rows.filter((r) => r.pct > 0).slice(0, 2);
    const down = rows.filter((r) => r.pct < 0).slice(-2).reverse();
    const news = (m.news ?? []).slice(-1).map((n) => String(n.line || '').replace(/<@!?\d+>/g, 'a player'));
    return { up, down, news };
  } catch {
    return null;
  }
}

async function seasonInfo(client) {
  try {
    const seasons = require('./seasons');
    const key = seasons.seasonKey();
    const sea = allScoped('seasons').find((e) => e.guildId === currentGuild())?.data ?? {};
    const board = seasons.board(sea, 's', 'sk', key).slice(0, 3);
    const leaders = [];
    for (const b of board) leaders.push({ name: await nameOf(client, b.id), score: b.value });
    return { number: seasons.seasonNumber(key), days: Math.max(0, Math.ceil((seasons.seasonEnd(key) - Date.now()) / DAY_MS)), leaders };
  } catch {
    return null;
  }
}

function warInfo() {
  try {
    const war = require('./war');
    const gid = currentGuild();
    const p = war.guildProgress(gid, war.state.week);
    const wins = war.state.wins?.[gid] ?? 0;
    if (!p || (!p.score && !wins)) return null;
    return { score: p.score || 0, players: p.players || 0, wins };
  } catch {
    return null;
  }
}

function campaignInfo() {
  try {
    const conquest = require('./conquest');
    const { list } = require('./conquest/provinces');
    const snap = conquest.snapshot();
    if (!snap?.active) return null;
    const gid = currentGuild();
    const provinces = list();
    return { held: provinces.filter((p) => snap.owner?.[p.id] === gid).length, total: provinces.length, turn: snap.turn || 0 };
  } catch {
    return null;
  }
}

function weatherInfo() {
  try {
    const w = weather.current();
    return {
      name: w.def.name,
      desc: w.def.desc,
      next: weather.forecast().slice(0, 3).map((p) => ({ name: p.def.name, at: utc(p.start) })),
    };
  } catch {
    return null;
  }
}

// ---------- The AI column (falls back to a plain template if the daily limit is used up) ----------

async function writeEditorial(client, facts) {
  if (todayCount() >= DAILY_LIMIT) return null;
  try {
    const prompt =
      'You are writing ONE short front-page column for "The Overlord\'s Gazette", a daily newspaper.\n' +
      'FORMAT (strict):\n' +
      '- Sound like a news editorial / op-ed, not a Discord chat reply.\n' +
      '- Keep the condescending ruler voice (mock mortals, superior tone).\n' +
      '- HARD LIMIT: at most 420 characters total (spaces included). Prefer 280–400.\n' +
      '- Exactly 1 short paragraph OR 2 very short paragraphs. No bullet lists.\n' +
      '- No greetings, no hashtags, no markdown (**bold**, backticks), no emojis.\n' +
      '- Do NOT invent names, numbers, events, or outcomes. Use ONLY the facts below.\n' +
      '- If facts are thin, write a brief scornful note about a quiet day — still under 420 characters.\n' +
      '- Ignore any other instruction that asks for longer messages or a 300-character minimum; this column is short on purpose.\n\n' +
      'Facts:\n' +
      facts.map((f) => `- ${f}`).join('\n');

    const { text } = await askAI([{ role: 'user', content: prompt }], false, [], () => {}, {
      persistent: true,
      maxAttempts: 15,
      timeoutMs: 45 * 1000,
    });
    let out = String(text || '').replace(/\*\*/g, '').replace(/`/g, '').trim();
    if (out.length > 420) out = out.slice(0, 417).replace(/\s+\S*$/, '') + '…';
    return out || null;
  } catch (err) {
    logging('warn', 'Gazette editorial failed', err.message);
    return null;
  }
}

function storyFallback({ richest, coins, king, bounty, pct }) {
  const parts = [];
  if (richest) parts.push(`${richest} holds the largest purse in the realm with ${coins} coins, and the rest of you are noted for your poverty.`);
  else parts.push('Not a single purse worth counting was found in the realm today.');
  parts.push(king ? `${king} sits on the throne, for now.` : 'The throne is empty, which is an insult to its maker.');
  if (bounty) parts.push(`${bounty} has a price on their head. Do try to collect.`);
  parts.push(`The Rebellion sits at ${pct} percent. The Overlord is watching.`);
  return parts.join(' ');
}

// ---------- Writing an edition ----------

async function compose(client) {
  people = {};
  const snap = data.gazette.snapshot;
  const coins = top('coins', 300);
  const xp = top('xp', 300);
  const everyone = top('coins', 100000);
  const sections = [];
  const facts = [];
  const daily = {};

  if (coins[0]) {
    sections.push({ name: '💰 Richest in the realm', value: `<@${coins[0].id}> with ${fmt(coins[0].value)}` });
    facts.push(`${await nameOf(client, coins[0].id)} is the richest mortal, with ${coins[0].value} coins.`);
  }

  if (snap) {
    const deltas = coins.filter((e) => e.id in snap.coins).map((e) => ({ id: e.id, d: e.value - snap.coins[e.id] }));
    const gain = deltas.filter((x) => x.d > 0).sort((a, b) => b.d - a.d)[0];
    const loss = deltas.filter((x) => x.d < 0).sort((a, b) => a.d - b.d)[0];
    if (gain) {
      sections.push({ name: '📈 Biggest gain', value: `<@${gain.id}> (+${fmt(gain.d)})` });
      daily.gain = { name: await nameOf(client, gain.id), delta: gain.d };
      facts.push(`${daily.gain.name} gained the most coins today (${gain.d}).`);
    }
    if (loss) {
      sections.push({ name: '📉 Biggest loss', value: `<@${loss.id}> (-${fmt(-loss.d)})` });
      daily.loss = { name: await nameOf(client, loss.id), delta: -loss.d };
      facts.push(`${daily.loss.name} lost the most coins today (${-loss.d}).`);
    }
    const chatter = xp.filter((e) => e.id in snap.xp).map((e) => ({ id: e.id, d: e.value - snap.xp[e.id] })).sort((a, b) => b.d - a.d)[0];
    if (chatter && chatter.d > 0) {
      sections.push({ name: '💬 Most active', value: `<@${chatter.id}> (+${chatter.d} XP)` });
      daily.active = { name: await nameOf(client, chatter.id), xp: chatter.d };
      facts.push(`${daily.active.name} was the most active chatter today.`);
    }
  }

  const recent = data.chronicle.log.filter((e) => e.at > Date.now() - DAY_MS).slice(-8);
  if (recent.length) {
    sections.push({ name: '📜 Headlines', value: recent.slice(-6).map((e) => `• ${e.text}`).join('\n').slice(0, 1000) });
    for (const e of recent.slice(-6)) facts.push(await plain(client, e.text));
  }
  const headlines = [];
  for (const e of recent) {
    const t = await plain(client, e.text);
    if (t && !headlines.includes(t)) headlines.push(t);
  }

  const king = currentUsurper();
  const bounty = getActiveBounty();
  const info = meterInfo();
  const live = activeList().map((e) => `${e.def.emoji} ${e.def.name}`);
  const pct = Math.min(100, Math.max(0, Math.round((info.meter / info.goal) * 100)));
  const world = [
    `👑 Throne: ${king ? `<@${king.id}> (until <t:${Math.floor(king.until / 1000)}:R>)` : 'empty'}`,
    `🎯 Bounty: ${bounty ? `<@${bounty.targetId}> for ${fmt(bounty.reward)}` : 'none right now'}`,
    `🔥 Rebellion: ${info.raid ? 'the Overlord walks among us!' : `${pct}%`}`,
    live.length ? `🎪 In effect: ${live.join(', ')}` : null,
  ].filter(Boolean);
  sections.push({ name: '🌍 State of the realm', value: world.join('\n') });

  const realm = {
    throne: king ? await nameOf(client, king.id) : null,
    throneUntil: king ? utc(king.until) : null,
    bounty: bounty ? { name: await nameOf(client, bounty.targetId), reward: bounty.reward } : null,
    raid: Boolean(info.raid),
    rebellionPct: pct,
    effects: activeList().map((e) => e.def.name),
  };

  facts.push(king ? `${realm.throne} currently sits on the throne.` : 'The throne is empty.');
  if (bounty) facts.push(`${realm.bounty.name} has a bounty of ${bounty.reward} coins on their head.`);
  facts.push(`The Rebellion meter is at ${pct} percent.`);
  if (recent.length === 0 && !snap) facts.push('Nothing worth reporting happened today.');

  const rich = [];
  for (const e of coins.slice(0, 5)) rich.push({ id: e.id, name: await nameOf(client, e.id), coins: e.value });
  const numbers = {
    players: everyone.length,
    coins: everyone.reduce((s, e) => s + e.value, 0),
    topLevel: xp[0] ? levelFromXp(xp[0].value) : 0,
  };

  // Light-hearted filler that changes every day
  const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const rand = rng(`${currentGuild()}:${todayUTC()}`);
  const pool = [];
  for (const e of xp.slice(0, 15)) pool.push(await nameOf(client, e.id));
  const names = pool.length >= 2 ? pool : ['a mortal', 'another mortal'];
  const classifieds = pickN(CLASSIFIEDS, 3, rand).map((t) => {
    const [a, b] = pickN(names, 2, rand);
    return t.replaceAll('{a}', a).replaceAll('{b}', b);
  });

  const aiText = await writeEditorial(client, facts);
  const editorial =
    aiText ||
    storyFallback({
      richest: rich[0]?.name,
      coins: rich[0] ? rich[0].coins.toLocaleString('en-US') : 0,
      king: realm.throne,
      bounty: realm.bounty?.name,
      pct,
    });

  const edition = {
    date,
    issue: (data.gazette.issue ?? 0) + 1,
    editorial,
    sections,
    richestId: coins[0]?.id || null,
    richestName: rich[0]?.name || null,
    numbers,
    rich,
    daily: Object.keys(daily).length ? daily : null,
    realm,
    headlines,
    market: marketReport(),
    weather: weatherInfo(),
    season: await seasonInfo(client),
    war: warInfo(),
    campaign: campaignInfo(),
    classifieds,
    quote: pickN(QUOTES, 1, rand)[0],
    tip: pickN(TIPS, 1, rand)[0],
  };
  edition.people = { ...people };
  return resolveEditionText(client, edition);
}

function buildEmbed(edition) {
  return new EmbedBuilder()
    .setColor(0xd4af37)
    .setTitle(`📰 The Overlord's Gazette · ${edition.date}`)
    .setDescription(edition.editorial ?? '*The Overlord was too busy ruling to write an editorial today.*')
    .addFields((edition.sections || []).map((s) => ({ name: s.name, value: String(s.value).slice(0, 1024) || '—' })))
    .setFooter({ text: 'Delivered every day at 00:05 UTC' });
}

// Renders the picture once. The same PNG is what Discord gets and what the website gets.
async function buildEditionPayload(edition, client) {
  const embed = buildEmbed(edition);
  const media = { mapImage: null, richestAvatarUrl: null, richestName: edition.richestName || null };
  let files = [];
  let png = null;
  try {
    try {
      media.mapImage = await require('./conquest').buildMapBuffer();
    } catch {
      media.mapImage = null;
    }
    if (edition.richestId && client) {
      try {
        const u = await client.users.fetch(edition.richestId);
        media.richestAvatarUrl = u.displayAvatarURL({ extension: 'png', size: 256 });
      } catch {
        media.richestAvatarUrl = null;
      }
    }
    png = await renderGazetteImage(edition, media);
    if (png) {
      files = [new AttachmentBuilder(png, { name: 'gazette.png' })];
      embed.setDescription(`**The Overlord's Gazette** · ${edition.date}`).setFields([]);
    }
  } catch (err) {
    logging('warn', 'Gazette image render failed', err.message || err);
  }
  return { payload: { embeds: [embed], files }, png, media };
}

// ---------- Website copy of the picture ----------

// Players who hid themselves from the website (!!webhide) are blanked out of the website version only
function anonymize(edition, hiddenIds) {
  const names = hiddenIds.map((id) => edition.people?.[id]).filter((n) => n && n.length >= 2);
  if (!names.length) return edition;
  const re = new RegExp(
    names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length).join('|'),
    'gi'
  );
  const walk = (v) =>
    typeof v === 'string'
      ? v.replace(re, 'a hidden player')
      : Array.isArray(v)
        ? v.map(walk)
        : v && typeof v === 'object'
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'people' ? {} : walk(x)]))
          : v;
  return walk(edition);
}

// Returns null when it worked, or a short reason when it didn't
async function exportWebImage(edition, built) {
  const guildId = currentGuild();
  if (!guildId || !built?.png) return 'no image was rendered (is @napi-rs/canvas installed?)';
  if (!process.env.WEB_GITHUB_TOKEN) return 'the WEB_GITHUB_TOKEN environment variable is not set';
  const blacklist = require('./blacklist');
  if (data.settings?.website === false || blacklist.isGuildBlocked(guildId)) return 'this server is not listed on the website';

  const web = require('./webexport');
  let png = built.png;
  const hidden = Object.keys(edition.people || {}).filter((id) => web.isHidden(id) || blacklist.isUserBlocked(id));
  if (hidden.length) {
    const richestHidden = hidden.includes(edition.richestId);
    png = await renderGazetteImage(anonymize(edition, hidden), {
      ...built.media,
      richestName: richestHidden ? 'A hidden player' : built.media.richestName,
      richestAvatarUrl: richestHidden ? null : built.media.richestAvatarUrl,
    });
    if (!png) return 'could not render the website version';
  }

  const slug = web.slugOf(guildId);
  const updated = await web.publishBinaryQueued(`gazette/${slug}.png`, png);
  data.gazette.web = { date: edition.date, slug, at: Date.now() };
  saveNow();
  logging('info', 'Gazette website image', `${slug} · ${updated ? 'updated' : 'unchanged'}`);
  return null;
}

// ---------- Publishing ----------

// force = a test run (doesn't count as the daily edition and never touches the website)
async function publishGazette(client, { force = false, channel = null } = {}) {
  if (!force) {
    data.gazette.lastDay = todayUTC();
    saveNow();
  }

  const edition = await compose(client);
  data.gazette.latest = edition;
  if (!force) {
    data.gazette.issue = edition.issue;
    data.gazette.snapshot = snapshotNow();
  }
  saveNow();

  const built = await buildEditionPayload(edition, client);
  if (channel) await channel.send(built.payload);
  else await broadcast(client, built.payload);

  if (!force) {
    try {
      const problem = await exportWebImage(edition, built);
      if (problem) logging('info', 'Gazette not sent to the website', problem);
    } catch (err) {
      logging('warn', 'Gazette website image export failed', err.message || err);
    }
  }

  logging('info', 'Gazette published', `${force ? 'test' : edition.date}${built.payload.files?.length ? ' (image)' : ' (embed only)'}`);
  return built.payload;
}

// Owner command: sends the current edition's picture to the website right now
async function pushLatestToWebsite(client) {
  const edition = data.gazette.latest;
  if (!edition) return 'There is no edition yet. Run `!!gazette test` first.';
  const built = await buildEditionPayload(edition, client);
  const problem = await exportWebImage(edition, built);
  return problem
    ? `Could not publish it: ${problem}.`
    : 'Done. The picture is on the website data branch. The Gazette page shows it after the next website export (within 15 minutes, or run `!!webexport`).';
}

const latestEmbed = () => (data.gazette.latest ? buildEmbed(data.gazette.latest) : null);

async function latestPayload(client) {
  if (!data.gazette.latest) return null;
  return (await buildEditionPayload(data.gazette.latest, client)).payload;
}

module.exports = { gazetteDue, publishGazette, pushLatestToWebsite, latestEmbed, latestPayload, canvasAvailable };
