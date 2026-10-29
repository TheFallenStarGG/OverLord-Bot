const { PermissionFlagsBits } = require('discord.js');
const { FILES } = require('../config');
const { scoped, writeJson } = require('./storage');
const { logging } = require('./logging');

const joins = new Map(); // guildId -> number[] timestamps

const data = scoped(FILES.antiraid || 'antiraid.json', (d) => {
  d.config ??= {};
  d.config.enabled ??= true;
  d.config.joinWindowSec ??= 20;
  d.config.joinThreshold ??= 8;
  d.config.minAccountAgeHours ??= 24;
  d.config.action ??= 'kick'; // kick | ban | timeout
  d.config.lockOnRaid ??= true;
  d.config.alertChannelId ??= null;
  d.welcome ??= {};
  d.welcome.enabled ??= false;
  d.welcome.channelId ??= null;
  d.welcome.message ??= 'Welcome {user} to **{server}**!';
});

function save() {
  writeJson(FILES.antiraid || 'antiraid.json', data);
}

function cfg() {
  return data.config;
}

function welcomeCfg() {
  return data.welcome;
}

function recordJoin(guildId) {
  const now = Date.now();
  const windowMs = (cfg().joinWindowSec || 20) * 1000;
  let arr = joins.get(guildId) || [];
  arr = arr.filter((t) => now - t < windowMs);
  arr.push(now);
  joins.set(guildId, arr);
  return arr.length;
}

async function handleMemberAdd(member) {
  if (!member.guild || member.user.bot) return;
  const c = cfg();
  if (!c.enabled) return;

  const ageH = (Date.now() - member.user.createdTimestamp) / 3600000;
  if (c.minAccountAgeHours > 0 && ageH < c.minAccountAgeHours) {
    await punish(member, `Account age ${ageH.toFixed(1)}h < ${c.minAccountAgeHours}h`);
    return;
  }

  const n = recordJoin(member.guild.id);
  if (n >= (c.joinThreshold || 8)) {
    logging('warn', 'Anti-raid trigger', `${member.guild.name}: ${n} joins`);
    if (c.lockOnRaid) await softLock(member.guild);
    await alert(member.guild, `Raid-like joins: **${n}** in ${c.joinWindowSec}s`);
    await punish(member, `Join spike (${n} in window)`);
  }
}

async function punish(member, reason) {
  const c = cfg();
  const why = `Anti-raid: ${reason}`.slice(0, 500);
  try {
    if (c.action === 'ban') await member.ban({ reason: why, deleteMessageSeconds: 0 });
    else if (c.action === 'timeout') {
      await member.timeout(60 * 60 * 1000, why);
    } else {
      await member.kick(why);
    }
  } catch (err) {
    logging('warn', 'Anti-raid punish failed', err.message);
  }
}

async function softLock(guild) {
  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) return;
  for (const ch of guild.channels.cache.values()) {
    if (!ch.isTextBased?.() || ch.isThread?.()) continue;
    try {
      await ch.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false }, { reason: 'Anti-raid lock' });
    } catch (_) {}
  }
}

async function alert(guild, text) {
  const id = cfg().alertChannelId;
  if (!id) return;
  const ch = await guild.channels.fetch(id).catch(() => null);
  if (ch?.isTextBased?.()) await ch.send({ content: `🛡️ **Anti-raid:** ${text}` }).catch(() => {});
}

async function sendWelcome(member) {
  const w = welcomeCfg();
  if (!w.enabled || !w.channelId) return;
  const ch = await member.guild.channels.fetch(w.channelId).catch(() => null);
  if (!ch?.isTextBased?.()) return;
  const text = String(w.message || 'Welcome {user}!')
    .replaceAll('{user}', `<@${member.id}>`)
    .replaceAll('{server}', member.guild.name)
    .replaceAll('{membercount}', String(member.guild.memberCount));
  await ch.send({ content: text.slice(0, 2000) }).catch(() => {});
}

module.exports = {
  data,
  save,
  cfg,
  welcomeCfg,
  handleMemberAdd,
  sendWelcome,
};
