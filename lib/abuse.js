const { EmbedBuilder } = require('discord.js');
const { LOG_CHANNEL_ID } = require('../config');
const digest = require('./digest');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// Tweak these to make the detector stricter or looser
const LIMITS = {
  SPAM_WINDOW_MS: 10 * 1000,
  SPAM_MAX: 8, // this many commands in the window = spam
  FLOOD_WINDOW_MS: 30 * 1000,
  FLOOD_MAX: 8, // this many "too fast" hits in the window = flooding
  PAIR_WINDOW_MS: HOUR,
  PAIR_MAX: 10, // same person targeting the same other person this often
  GIVE_WINDOW_MS: DAY,
  GIVE_MAX_COINS: 25000, // coins from one person to one person in the window
  GIVE_MAX_YOUNG_SENDERS: 4, // brand-new accounts all feeding one person
  YOUNG_ACCOUNT_MS: 7 * DAY,
  FARM_WINDOW_MS: HOUR,
  FARM_MAX: 5, // brand-new accounts claiming !!daily in one server
  ALERT_COOLDOWN_MS: 15 * MIN, // the same alert is only posted this often
};

// Commands where one person targets another (used to spot alt feeding)
const PAIR_COMMANDS = new Set([
  '!!give', '!!rob', '!!duel', '!!trade', '!!tictactoe', '!!connect4', '!!battleship', '!!liarsdice', '!!tribute',
]);

const spamLog = new Map();
const floodLog = new Map();
const pairLog = new Map();
const transferLog = new Map();
const farmLog = new Map();
const alertedAt = new Map();

const createdAt = (id) => Number((BigInt(id) >> 22n) + 1420070400000n);
const ageMs = (id) => Date.now() - createdAt(id);
const ageText = (id) => {
  const days = Math.floor(ageMs(id) / DAY);
  return days < 1 ? 'under a day old' : `${days} day${days === 1 ? '' : 's'} old`;
};
const num = (n) => Number(n).toLocaleString('en-US');

// Adds an entry to a sliding window and returns everything still inside it
function slide(map, key, entry, windowMs) {
  const now = Date.now();
  const list = (map.get(key) ?? []).filter((e) => now - e.at < windowMs);
  list.push({ at: now, ...entry });
  map.set(key, list);
  return list;
}

function who(client, id) {
  const name = client.users.cache.get(id)?.username ?? 'unknown user';
  return `${name} · \`${id}\` · <@${id}> · account ${ageText(id)}`;
}

async function alert(client, key, title, { guild = null, lines = [], userIds = [] } = {}) {
  const now = Date.now();
  if (now - (alertedAt.get(key) ?? 0) < LIMITS.ALERT_COOLDOWN_MS) return;
  alertedAt.set(key, now);
  digest.bump('alerts');

  const detail = lines.join('\n');
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.warn(`${stamp} | ALERT | ${title} | ${detail.replace(/\n/g, ' ')}`);
  if (!LOG_CHANNEL_ID) return;

  try {
    const channel = await client.channels.fetch(LOG_CHANNEL_ID);
    const ownerId = process.env.OWNER_ID;
    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle(`🚨 ${title}`)
      .setDescription(detail.slice(0, 3500) || 'No details.')
      .setTimestamp();
    if (guild) embed.addFields({ name: 'Server', value: `${guild.name}\n\`${guild.id}\``, inline: true });
    if (userIds.length) {
      embed.addFields(
        { name: userIds.length > 1 ? 'Accounts' : 'Account', value: userIds.slice(0, 8).map((id) => who(client, id)).join('\n').slice(0, 1024) },
        { name: 'If it is abuse', value: `\`!!blacklist add user ${userIds[0]} reason\`` }
      );
    }
    await channel.send({
      content: ownerId ? `🚨 <@${ownerId}> possible abuse detected` : undefined,
      embeds: [embed],
      allowedMentions: ownerId ? { users: [ownerId] } : { parse: [] },
    });
  } catch (err) {
    console.error('Could not post an abuse alert:', err.message);
  }
}

// Called right before a command runs
function inspectCommand(message, command, isOwner) {
  if (isOwner || !message.author) return;
  const client = message.client;
  const guild = message.guild ?? null;
  const guildId = guild?.id ?? null;
  const userId = message.author.id;

  // 1. Command spam
  const recent = slide(spamLog, userId, { cmd: command.name }, LIMITS.SPAM_WINDOW_MS);
  if (recent.length >= LIMITS.SPAM_MAX) {
    alert(client, `spam:${userId}`, 'Command spam', {
      guild,
      userIds: [userId],
      lines: [`Ran **${recent.length}** commands in ${LIMITS.SPAM_WINDOW_MS / 1000}s.`, `Latest: ${[...new Set(recent.map((e) => e.cmd))].slice(0, 5).join(', ')}`],
    });
  }

  // 2. Same person targeting the same other person again and again (alt feeding)
  const target = message.mentions?.users?.first?.();
  if (guildId && target && !target.bot && target.id !== userId && PAIR_COMMANDS.has(command.name)) {
    const key = `${guildId}:${userId}:${target.id}`;
    const list = slide(pairLog, key, { cmd: command.name }, LIMITS.PAIR_WINDOW_MS);
    if (list.length >= LIMITS.PAIR_MAX) {
      alert(client, `pair:${key}`, 'Repeated one-on-one activity (possible alt feeding)', {
        guild,
        userIds: [userId, target.id],
        lines: [`<@${userId}> used commands on <@${target.id}> **${list.length}** times in the last hour.`, `Commands: ${[...new Set(list.map((e) => e.cmd))].join(', ')}`],
      });
    }
  }

  // 3. Lots of brand-new accounts claiming daily rewards in one server
  if (guildId && command.name === '!!daily' && ageMs(userId) < LIMITS.YOUNG_ACCOUNT_MS) {
    const list = slide(farmLog, guildId, { id: userId }, LIMITS.FARM_WINDOW_MS);
    const ids = [...new Set(list.map((e) => e.id))];
    if (ids.length >= LIMITS.FARM_MAX) {
      alert(client, `farm:${guildId}`, 'Many brand-new accounts claiming daily rewards', {
        guild,
        userIds: ids,
        lines: [`**${ids.length}** accounts under 7 days old claimed \`!!daily\` in this server within an hour.`],
      });
    }
  }
}

// Called when a command is dropped for being too fast
function noteFlood(message) {
  digest.bump('floods');
  const list = slide(floodLog, message.author.id, {}, LIMITS.FLOOD_WINDOW_MS);
  if (list.length >= LIMITS.FLOOD_MAX) {
    alert(message.client, `flood:${message.author.id}`, 'Command flooding', {
      guild: message.guild ?? null,
      userIds: [message.author.id],
      lines: [`Was rate limited **${list.length}** times in ${LIMITS.FLOOD_WINDOW_MS / 1000}s.`],
    });
  }
}

// Called by !!give after coins actually move
function noteTransfer(message, toId, amount) {
  const guild = message.guild;
  if (!guild) return;
  const fromId = message.author.id;
  const list = slide(transferLog, `${guild.id}:${toId}`, { from: fromId, amount }, LIMITS.GIVE_WINDOW_MS);

  const totals = new Map();
  for (const t of list) totals.set(t.from, (totals.get(t.from) ?? 0) + t.amount);
  const young = [...totals.keys()].filter((id) => ageMs(id) < LIMITS.YOUNG_ACCOUNT_MS);

  const lines = [];
  if ((totals.get(fromId) ?? 0) >= LIMITS.GIVE_MAX_COINS) {
    lines.push(`<@${fromId}> sent <@${toId}> **${num(totals.get(fromId))}** coins in 24h.`);
  }
  if (young.length >= LIMITS.GIVE_MAX_YOUNG_SENDERS) {
    lines.push(`**${young.length}** accounts under 7 days old all sent coins to <@${toId}> in 24h.`);
  }
  if (lines.length) {
    alert(message.client, `give:${guild.id}:${toId}`, 'Suspicious coin transfers (possible alt farming)', {
      guild,
      userIds: [toId, ...new Set([fromId, ...young])].slice(0, 8),
      lines,
    });
  }
}

// Keeps memory small
setInterval(() => {
  const now = Date.now();
  for (const map of [spamLog, floodLog, pairLog, transferLog, farmLog]) {
    for (const [key, list] of map) {
      const fresh = list.filter((e) => now - e.at < DAY);
      if (fresh.length) map.set(key, fresh);
      else map.delete(key);
    }
  }
  for (const [key, at] of alertedAt) if (now - at > LIMITS.ALERT_COOLDOWN_MS) alertedAt.delete(key);
}, 10 * MIN).unref();

module.exports = { inspectCommand, noteFlood, noteTransfer };
