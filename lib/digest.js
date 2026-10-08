const { EmbedBuilder } = require('discord.js');
const { FILES, LOG_CHANNEL_ID } = require('../config');
const { readJson, writeJson } = require('./storage');

const todayUTC = () => new Date().toISOString().slice(0, 10);
const fresh = () => ({
  day: todayUTC(),
  commands: {},
  errors: {},
  joined: 0,
  left: 0,
  blocked: 0,
  floods: 0,
  alerts: 0,
  permWarnings: 0,
});

const activeUsers = new Set(); // only counts since the last restart
let saveTimer = null;

function stats() {
  let s = readJson(FILES.digest, null);
  if (!s) {
    s = fresh();
    writeJson(FILES.digest, s);
  }
  return s;
}

// Counters are saved a little later in one go, so busy chats don't hammer the database
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    writeJson(FILES.digest, stats());
  }, 30 * 1000);
  saveTimer.unref?.();
}

function bump(name, amount = 1) {
  const s = stats();
  s[name] = (s[name] ?? 0) + amount;
  save();
}

function recordCommand(name, userId) {
  const s = stats();
  s.commands[name] = (s.commands[name] ?? 0) + 1;
  if (activeUsers.size > 20000) activeUsers.clear();
  activeUsers.add(userId);
  save();
}

// Called for every logged error (see lib/logging.js)
function noteError(title, text) {
  if (/^Database save failed/.test(title)) return; // avoid a loop when the database is the problem
  const s = stats();
  const firstLine = String(text ?? '').split('\n')[0].slice(0, 80);
  const key = `${title}${firstLine ? ` — ${firstLine}` : ''}`.slice(0, 140);
  const entry = (s.errors[key] ??= { count: 0, last: 0 });
  entry.count++;
  entry.last = Date.now();

  const keys = Object.keys(s.errors);
  if (keys.length > 60) {
    keys.sort((a, b) => s.errors[a].last - s.errors[b].last);
    for (const k of keys.slice(0, keys.length - 60)) delete s.errors[k];
  }
  save();
}

async function send(client, s, active) {
  if (!LOG_CHANNEL_ID) return;
  const channel = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
  if (!channel?.send) return;

  const total = Object.values(s.commands).reduce((a, b) => a + b, 0);
  const errorTotal = Object.values(s.errors).reduce((a, e) => a + e.count, 0);
  const topCommands =
    Object.entries(s.commands)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => `\`${name}\` ×${count}`)
      .join('\n') || 'None';
  const topErrors =
    Object.entries(s.errors)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 6)
      .map(([key, e]) => `**${e.count}×** ${key}`)
      .join('\n') || 'No errors 🎉';

  const embed = new EmbedBuilder()
    .setColor(errorTotal ? 0xe67e22 : 0x2ecc71)
    .setTitle(`📊 Daily digest — ${s.day}`)
    .addFields(
      { name: 'Commands', value: total.toLocaleString('en-US'), inline: true },
      { name: 'Active users*', value: String(active), inline: true },
      { name: 'Servers', value: `${client.guilds.cache.size} (+${s.joined} / −${s.left})`, inline: true },
      { name: 'Top commands', value: topCommands.slice(0, 1024) },
      { name: `Errors (${errorTotal})`, value: topErrors.slice(0, 1024) },
      {
        name: 'Protection',
        value: `Blocked attempts: ${s.blocked} · Flood hits: ${s.floods} · Abuse alerts: ${s.alerts} · Permission warnings: ${s.permWarnings}`,
      }
    )
    .setFooter({ text: '*Active users counts people since the last restart' })
    .setTimestamp();

  await channel.send({ embeds: [embed] }).catch(() => {});
}

async function check(client) {
  const s = stats();
  if (s.day === todayUTC()) return;

  const finished = JSON.parse(JSON.stringify(s));
  const active = activeUsers.size;
  for (const key of Object.keys(s)) delete s[key];
  Object.assign(s, fresh());
  activeUsers.clear();
  save();

  await send(client, finished, active);
}

// Posts yesterday's digest shortly after midnight (UTC)
function start(client) {
  check(client).catch(() => {});
  setInterval(() => check(client).catch(() => {}), 60 * 1000).unref();
}

module.exports = { bump, recordCommand, noteError, start };
