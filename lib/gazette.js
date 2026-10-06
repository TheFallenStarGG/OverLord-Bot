const { EmbedBuilder } = require('discord.js');
const { DAILY_LIMIT } = require('../config');
const { top, fmt } = require('./economy');
const { activeList } = require('./modifiers');
const { askAI } = require('./ai');
const { todayCount } = require('./usage');
const { data, saveNow } = require('./world');
const { currentUsurper, meterInfo } = require('./rebellion');
const { getActiveBounty } = require('./bounty');
const { broadcast } = require('./announce');
const { logging } = require('./logging');

// The Gazette comes out this many minutes after midnight UTC, which is when the daily AI limit resets.
// The small delay means the editorial request never hits a limit that's about to reset.
const GAZETTE_DELAY_MIN = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

const todayUTC = () => new Date().toISOString().slice(0, 10);

// The first edition comes out at the next midnight, not the moment this is installed
if (!data.gazette.lastDay) {
  data.gazette.lastDay = todayUTC();
  saveNow();
}

function gazetteDue() {
  const now = new Date();
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  return data.gazette.lastDay !== todayUTC() && minutes >= GAZETTE_DELAY_MIN;
}

const nameCache = new Map();
async function nameOf(client, id) {
  if (!nameCache.has(id)) {
    const user = await client.users.fetch(id).catch(() => null);
    nameCache.set(id, user?.username ?? 'Someone');
  }
  return nameCache.get(id);
}

// Turns <@123> into a plain name, for the AI
async function plain(client, text) {
  let out = text;
  for (const id of new Set([...text.matchAll(/<@!?(\d+)>/g)].map((m) => m[1]))) {
    out = out.replaceAll(`<@${id}>`, await nameOf(client, id));
  }
  return out;
}

const snapshotNow = () => ({
  coins: Object.fromEntries(top('coins', 300).map((e) => [e.id, e.value])),
  xp: Object.fromEntries(top('xp', 300).map((e) => [e.id, e.value])),
});

const bar = (value, max) => '█'.repeat(Math.round((value / max) * 10)) + '░'.repeat(10 - Math.round((value / max) * 10));

async function writeEditorial(client, facts) {
  if (todayCount() >= DAILY_LIMIT) return null; // no requests left, so skip the editorial
  try {
    const prompt =
      'Write today\'s front-page editorial for "The Overlord\'s Gazette", the daily newspaper of your realm, in your usual arrogant voice. ' +
      'Mock the mortals, but base it ONLY on these facts, and do not invent any names, numbers, or events:\n' +
      facts.map((f) => `- ${f}`).join('\n');
    const { text } = await askAI([{ role: 'user', content: prompt }], false);
    return text.trim().slice(0, 1500);
  } catch (err) {
    logging('warn', 'Gazette editorial failed', err.message);
    return null;
  }
}

async function compose(client) {
  const snap = data.gazette.snapshot;
  const coins = top('coins', 300);
  const xp = top('xp', 300);
  const sections = [];
  const facts = [];

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
      facts.push(`${await nameOf(client, gain.id)} gained the most coins today (${gain.d}).`);
    }
    if (loss) {
      sections.push({ name: '📉 Biggest loss', value: `<@${loss.id}> (−${fmt(-loss.d)})` });
      facts.push(`${await nameOf(client, loss.id)} lost the most coins today (${-loss.d}).`);
    }
    const chatter = xp.filter((e) => e.id in snap.xp).map((e) => ({ id: e.id, d: e.value - snap.xp[e.id] })).sort((a, b) => b.d - a.d)[0];
    if (chatter && chatter.d > 0) {
      sections.push({ name: '💬 Most active', value: `<@${chatter.id}> (+${chatter.d} XP)` });
      facts.push(`${await nameOf(client, chatter.id)} was the most active chatter today.`);
    }
  }

  const headlines = data.chronicle.log.filter((e) => e.at > Date.now() - DAY_MS).slice(-6);
  if (headlines.length) {
    sections.push({ name: '📜 Headlines', value: headlines.map((e) => `• ${e.text}`).join('\n').slice(0, 1000) });
    for (const e of headlines) facts.push(await plain(client, e.text.replace(/\*\*/g, '')));
  }

  const king = currentUsurper();
  const bounty = getActiveBounty();
  const info = meterInfo();
  const live = activeList().map((e) => `${e.def.emoji} ${e.def.name}`);
  const world = [
    `👑 Throne: ${king ? `<@${king.id}> (until <t:${Math.floor(king.until / 1000)}:R>)` : 'empty'}`,
    `🎯 Bounty: ${bounty ? `<@${bounty.targetId}> for ${fmt(bounty.reward)}` : 'none right now'}`,
    `🔥 Rebellion: ${info.raid ? 'the Overlord walks among us!' : `${bar(info.meter, info.goal)} ${Math.round((info.meter / info.goal) * 100)}%`}`,
    live.length ? `🎪 In effect: ${live.join(', ')}` : null,
  ].filter(Boolean);
  sections.push({ name: '🌍 State of the realm', value: world.join('\n') });

  facts.push(king ? `${await nameOf(client, king.id)} currently sits on the throne.` : 'The throne is empty.');
  if (bounty) facts.push(`${await nameOf(client, bounty.targetId)} has a bounty of ${bounty.reward} coins on their head.`);
  facts.push(`The Rebellion meter is at ${Math.round((info.meter / info.goal) * 100)} percent.`);
  if (headlines.length === 0 && !snap) facts.push('Nothing worth reporting happened today.');

  const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  return { date, editorial: await writeEditorial(client, facts), sections };
}

function buildEmbed(edition) {
  return new EmbedBuilder()
    .setColor(0xd4af37)
    .setTitle(`📰 The Overlord's Gazette · ${edition.date}`)
    .setDescription(edition.editorial ?? '*The Overlord was too busy ruling to write an editorial today.*')
    .addFields(edition.sections.map((s) => ({ name: s.name, value: s.value.slice(0, 1024) })))
    .setFooter({ text: 'Delivered every day at 00:05 UTC' });
}

// Posts today's edition. force = a test run (doesn't count as the daily edition).
// channel = send it there instead of the events channels.
async function publishGazette(client, { force = false, channel = null } = {}) {
  if (!force) {
    data.gazette.lastDay = todayUTC(); // marked first, so a failure can never post it twice
    saveNow();
  }

  const edition = await compose(client);
  const embed = buildEmbed(edition);
  data.gazette.latest = edition;
  if (!force) data.gazette.snapshot = snapshotNow();
  saveNow();

  if (channel) await channel.send({ embeds: [embed] });
  else await broadcast(client, { embeds: [embed] });
  logging('info', 'Gazette published', force ? 'test edition' : edition.date);
  return embed;
}

const latestEmbed = () => (data.gazette.latest ? buildEmbed(data.gazette.latest) : null);

module.exports = { gazetteDue, publishGazette, latestEmbed };
