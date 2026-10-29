const { EmbedBuilder, PermissionFlagsBits: P } = require('discord.js');
const { FILES } = require('../config');
const { scoped, writeJson, forEachGuild } = require('./storage');
const { logging } = require('./logging');

const MAX_CASES = 3000;
const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;

// One copy per server. Each case is its own database row ("case_<id>").
const data = scoped(FILES.moderation, (d) => {
  d.config ??= {};
  const c = d.config;
  c.modlogChannelId ??= null;
  c.modRoleIds ??= [];
  c.dmUsers ??= true;
  c.warnActions ??= {};
  c.automod ??= {};
  const a = c.automod;
  for (const k of ['invites', 'links', 'spam', 'caps', 'mentions', 'words']) a[k] ??= false;
  a.punish ??= 'delete'; // 'delete' or 'warn'
  a.spamMessages ??= 6;
  a.spamSeconds ??= 8;
  a.maxMentions ??= 5;
  a.capsPercent ??= 70;
  a.capsMinLength ??= 12;
  a.badWords ??= [];
  a.allowedDomains ??= [];
  a.ignoredChannels ??= [];
  a.ignoredRoles ??= [];
  d.meta ??= { nextCase: 1 };
  d.timers ??= {}; // userId -> { at, caseId } for temporary bans
});

let timer = null;
function saveNow() {
  if (timer) clearTimeout(timer);
  timer = null;
  writeJson(FILES.moderation, data);
}
function save() {
  if (!timer) timer = setTimeout(saveNow, 3000);
}

const config = () => data.config;
const automod = () => data.config.automod;

// ---------- Display ----------
const COLORS = {
  ban: 0xed4245, tempban: 0xed4245, softban: 0xe67e22, unban: 0x57f287, kick: 0xe67e22,
  mute: 0xfee75c, unmute: 0x57f287, warn: 0xfaa61a, note: 0x95a5a6,
};
const EMOJI = { ban: '🔨', tempban: '⏳', softban: '🧹', unban: '🕊️', kick: '👢', mute: '🔇', unmute: '🔊', warn: '⚠️', note: '📝' };
const VERB = { warn: 'warned', mute: 'muted', kick: 'kicked', softban: 'kicked', ban: 'banned', tempban: 'temporarily banned' };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function parseDuration(text) {
  const t = String(text || '').trim().toLowerCase().replace(/\s+/g, '');
  if (!/^(\d+(s|m|h|d|w))+$/.test(t)) return null;
  const unit = { s: 1e3, m: 6e4, h: 36e5, d: 864e5, w: 6048e5 };
  let ms = 0;
  for (const [, n, u] of t.matchAll(/(\d+)(s|m|h|d|w)/g)) ms += Number(n) * unit[u];
  return ms > 0 ? ms : null;
}

function formatDuration(ms) {
  let s = Math.round(ms / 1000);
  const parts = [];
  for (const [name, sec] of [['d', 86400], ['h', 3600], ['m', 60], ['s', 1]]) {
    const n = Math.floor(s / sec);
    if (n) {
      parts.push(`${n}${name}`);
      s -= n * sec;
    }
  }
  return parts.join(' ') || '0s';
}

const auditReason = (user, reason) => `[${user.username}] ${reason}`.slice(0, 500);

function caseEmbed(c) {
  const fields = [
    c.userId && { name: 'User', value: `<@${c.userId}> (\`${c.userId}\`)`, inline: true },
    { name: 'Moderator', value: c.modId ? `<@${c.modId}>` : 'Unknown', inline: true },
    c.until && { name: c.type === 'mute' ? 'Muted until' : 'Ban ends', value: `<t:${Math.floor(c.until / 1000)}:R>`, inline: true },
    { name: 'Reason', value: String(c.reason).slice(0, 1000) },
  ].filter(Boolean);
  return new EmbedBuilder()
    .setColor(COLORS[c.type] ?? 0x95a5a6)
    .setTitle(`${EMOJI[c.type] || '🔨'} ${cap(c.type)} · Case #${c.id}${c.removed ? ' (removed)' : ''}`)
    .addFields(fields)
    .setTimestamp(c.at);
}

// ---------- Cases ----------
const caseKey = (id) => `case_${id}`;
const getCase = (id) => data[caseKey(id)] || null;
const allCases = () =>
  Object.keys(data)
    .filter((k) => k.startsWith('case_'))
    .map((k) => data[k])
    .sort((a, b) => a.id - b.id);
const activeWarnings = (userId) => allCases().filter((c) => c.type === 'warn' && c.userId === userId && !c.removed);

function prune() {
  const all = allCases();
  let extra = all.length - MAX_CASES;
  if (extra <= 0) return;
  const order = [...all.filter((c) => c.type !== 'warn'), ...all.filter((c) => c.type === 'warn')];
  for (const c of order) {
    if (extra-- <= 0) break;
    delete data[caseKey(c.id)];
  }
}

function createCase({ type, userId = null, modId = null, reason, until = null }) {
  const id = data.meta.nextCase++;
  const c = { id, type, userId, modId, reason: String(reason || 'No reason provided').slice(0, 500), at: Date.now(), until, removed: false };
  data[caseKey(id)] = c;
  prune();
  save();
  return c;
}

function setTimer(userId, at, caseId) {
  data.timers[userId] = { at, caseId };
  save();
}
function clearTimer(userId) {
  delete data.timers[userId];
  save();
}

// ---------- Permissions ----------
const hasModRole = (member) => data.config.modRoleIds.some((id) => member.roles.cache.has(id));

function canUse(member, perm, modRoleOk = true) {
  if (!member) return false;
  if (member.guild.ownerId === member.id || member.permissions.has(P.Administrator)) return true;
  if (perm && member.permissions.has(perm)) return true;
  return Boolean(modRoleOk && hasModRole(member));
}

// People who are never touched by automod
function isStaff(member) {
  if (!member) return false;
  if (member.guild.ownerId === member.id) return true;
  const p = member.permissions;
  return p.has(P.Administrator) || p.has(P.ManageGuild) || p.has(P.ManageMessages) || p.has(P.ModerateMembers) || hasModRole(member);
}

function isAutomodExempt(message) {
  const a = data.config.automod;
  const ch = message.channel;
  const chain = [ch?.id, ch?.parentId, ch?.parent?.parentId].filter(Boolean);
  if (chain.some((id) => a.ignoredChannels.includes(id))) return true;
  return a.ignoredRoles.some((id) => message.member.roles.cache.has(id));
}

// target can be a GuildMember or just { id } (someone who left the server)
function hierarchyError(message, target, verb, checkBot = true) {
  const { guild, author, client } = message;
  if (target.id === author.id) return `You can’t ${verb} yourself.`;
  if (target.id === client.user.id) return `I’m not going to ${verb} myself.`;
  if (target.id === guild.ownerId) return `You can’t ${verb} the server owner.`;
  const theirs = target.roles?.highest;
  if (!theirs) return null;
  if (author.id !== guild.ownerId && message.member.roles.highest.position <= theirs.position) {
    return `Their highest role is the same as or above yours, so you can’t ${verb} them.`;
  }
  if (checkBot && guild.members.me.roles.highest.position <= theirs.position) {
    return `Their highest role is above mine, so I can’t ${verb} them. Move my role higher in Server Settings → Roles.`;
  }
  return null;
}

// ---------- Logging & DMs ----------
async function sendLog(guild, payload) {
  const id = data.config.modlogChannelId;
  if (!id) return;
  const ch = guild.channels.cache.get(id) ?? (await guild.channels.fetch(id).catch(() => null));
  if (!ch?.isTextBased?.()) return;
  await ch.send(payload).catch(() => {});
}

const record = (guild, c) => sendLog(guild, { embeds: [caseEmbed(c)] });

async function dmUser(user, guild, info) {
  if (!user || !data.config.dmUsers) return false;
  const embed = new EmbedBuilder()
    .setColor(COLORS[info.type] ?? 0x95a5a6)
    .setTitle(`You were ${VERB[info.type] || 'actioned'} in ${guild.name}`)
    .addFields({ name: 'Reason', value: String(info.reason).slice(0, 1000) });
  if (info.until) {
    embed.addFields({ name: info.type === 'mute' ? 'Muted until' : 'Ban ends', value: `<t:${Math.floor(info.until / 1000)}:f>` });
  }
  try {
    await user.send({ embeds: [embed] });
    return true;
  } catch {
    return false;
  }
}

// ---------- Warnings & automatic punishments ----------
async function escalate(guild, member, count, client) {
  const rule = data.config.warnActions[String(count)];
  if (!rule || !member) return null;
  const reason = `Reached ${count} warnings (automatic)`;
  let c = null;
  try {
    if (rule.action === 'mute' && member.moderatable) {
      const ms = Math.min(rule.duration || 3600000, MAX_TIMEOUT_MS);
      await member.timeout(ms, reason);
      c = createCase({ type: 'mute', userId: member.id, modId: client.user.id, reason, until: Date.now() + ms });
    } else if (rule.action === 'kick' && member.kickable) {
      await dmUser(member.user, guild, { type: 'kick', reason });
      await member.kick(reason);
      c = createCase({ type: 'kick', userId: member.id, modId: client.user.id, reason });
    } else if (rule.action === 'ban' && member.bannable) {
      await dmUser(member.user, guild, { type: 'ban', reason });
      await guild.members.ban(member.id, { reason });
      c = createCase({ type: 'ban', userId: member.id, modId: client.user.id, reason });
    }
  } catch {
    return null;
  }
  if (!c) return null;
  if (c.type === 'mute') await dmUser(member.user, guild, c);
  await record(guild, c);
  return `⚡ Automatic action: **${c.type}** (${count} warnings), case **#${c.id}**.`;
}

async function warnUser({ guild, client, target, modId, reason }) {
  const c = createCase({ type: 'warn', userId: target.id, modId, reason });
  const dmOk = await dmUser(target.user, guild, c);
  await record(guild, c);
  const count = activeWarnings(target.id).length;
  const escalation = await escalate(guild, target, count, client);
  return { c, count, dmOk, escalation };
}

// ---------- Temporary bans ----------
async function processTimers(client) {
  await forEachGuild(
    client,
    async (guild) => {
      const now = Date.now();
      for (const [userId, t] of Object.entries(data.timers)) {
        if (t.at > now) continue;
        try {
          await guild.members.unban(userId, 'Temporary ban expired');
        } catch (err) {
          if (err.code !== 10026) logging('warn', 'Could not lift a temporary ban', `${guild.name}: ${err.message}`);
        }
        delete data.timers[userId];
        const c = createCase({ type: 'unban', userId, modId: client.user.id, reason: `Temporary ban expired (case #${t.caseId})` });
        await record(guild, c);
      }
      save();
    },
    'moderation'
  );
}

module.exports = {
  MAX_TIMEOUT_MS, EMOJI, config, automod, save, saveNow,
  parseDuration, formatDuration, auditReason, caseEmbed,
  getCase, allCases, activeWarnings, createCase, setTimer, clearTimer,
  canUse, isStaff, isAutomodExempt, hierarchyError,
  sendLog, record, dmUser, warnUser, processTimers,
};
