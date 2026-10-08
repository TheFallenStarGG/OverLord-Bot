const { PermissionFlagsBits } = require('discord.js');
const blacklist = require('./blacklist');
const abuse = require('./abuse');
const digest = require('./digest');
const { logging } = require('./logging');

const FLOOD_MS = 1000; // one command per person per second
const NOTICE_MS = 10 * 1000; // "slow down" is only said this often per person
const lastCommandAt = new Map();
const lastNotice = new Map();
const warnedPerms = new Map();

const isBlocked = (userId, guildId) =>
  Boolean(blacklist.isUserBlocked(userId) || (guildId && blacklist.isGuildBlocked(guildId)));

function floodCheck(userId) {
  const now = Date.now();
  const wait = FLOOD_MS - (now - (lastCommandAt.get(userId) ?? 0));
  if (wait > 0) {
    const notify = now - (lastNotice.get(userId) ?? 0) > NOTICE_MS;
    if (notify) lastNotice.set(userId, now);
    return { blocked: true, notify, waitMs: wait };
  }
  lastCommandAt.set(userId, now);
  if (lastCommandAt.size > 5000) lastCommandAt.clear();
  if (lastNotice.size > 5000) lastNotice.clear();
  return { blocked: false };
}

const humanize = (name) => String(name).replace(/([a-z])([A-Z])/g, '$1 $2');

function missingPermissions(message) {
  const { guild, channel } = message;
  if (!guild || !channel?.permissionsFor) return [];
  const me = guild.members.me;
  if (!me) return [];
  const perms = channel.permissionsFor(me);
  if (!perms) return [];
  return perms.missing([
    PermissionFlagsBits.ViewChannel,
    channel.isThread?.() ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.ReadMessageHistory,
  ]);
}

async function notifyMissing(message, missing) {
  const key = `${message.author.id}:${message.channel.id}`;
  const now = Date.now();
  if (now - (warnedPerms.get(key) ?? 0) < 5 * 60 * 1000) return;
  warnedPerms.set(key, now);
  if (warnedPerms.size > 2000) warnedPerms.clear();
  digest.bump('permWarnings');

  const list = missing.map(humanize).join(', ');
  const fix = `Ask a server admin to give me ${missing.length > 1 ? 'these permissions' : 'this permission'} in the channel (Channel settings → Permissions → my role).`;
  const cannotSend = missing.some((m) => m === 'SendMessages' || m === 'SendMessagesInThreads');

  if (!cannotSend) {
    const sent = await message.channel
      .send(`⚠️ I can't run commands properly here because I'm missing: **${list}**. ${fix}`)
      .catch(() => null);
    if (sent) return;
  }
  await message.author
    .send(`⚠️ I tried to answer you in **#${message.channel.name}** (${message.guild.name}), but I'm missing: **${list}**. ${fix}`)
    .catch(() => {});
}

/**
 * Runs before every command, prefix or slash.
 * Returns { ok: true } or { ok: false, reply } (reply is null when the bot should stay silent).
 */
async function preflight(message, command, { isOwner = false, viaSlash = false } = {}) {
  if (!isOwner) {
    if (isBlocked(message.author.id, message.guild?.id)) {
      digest.bump('blocked');
      return { ok: false, reply: viaSlash ? '🚫 You (or this server) are blocked from using this bot.' : null };
    }
    const flood = floodCheck(message.author.id);
    if (flood.blocked) {
      abuse.noteFlood(message);
      const reply = flood.notify || viaSlash ? `⏳ Slow down! Try again in ${Math.max(1, Math.ceil(flood.waitMs / 1000))}s.` : null;
      return { ok: false, reply };
    }
  }

  if (!viaSlash) {
    const missing = missingPermissions(message);
    if (missing.length) {
      await notifyMissing(message, missing);
      return { ok: false, reply: null };
    }
  }

  abuse.inspectCommand(message, command, isOwner);
  digest.recordCommand(command.name, message.author.id);
  return { ok: true };
}

// Logs the real error and returns a short, friendly message with an ID you can search for in the logs
function friendlyError(err, commandName) {
  const id = Math.random().toString(36).slice(2, 8);
  const text = String(err?.message ?? err);
  const code = err?.code;

  let reply = 'Something went wrong running that command.';
  if (code === 50013 || code === 50001) reply = "I don't have permission to do that here. Ask an admin to check my permissions in this channel.";
  else if (code === 50007) reply = "I couldn't send you a DM. Check that your DMs are open.";
  else if (code === 10008 || code === 10062 || code === 40060) reply = 'That took too long or was already handled. Please try the command again.';
  else if (/fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|libsql|SQLITE|database/i.test(text)) reply = "I'm having trouble reaching my database right now. Give it a moment and try again.";

  logging('error', `Command ${commandName} failed`, `${err?.stack ?? text}\n[error id: ${id}]`);
  return `${reply} (Error ID: \`${id}\`)`;
}

module.exports = { isBlocked, preflight, friendlyError };
