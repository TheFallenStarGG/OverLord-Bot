const { EmbedBuilder, PermissionFlagsBits: P, PermissionsBitField } = require('discord.js');
const mod = require('../lib/moderation');

const humanize = (n) => String(n).replace(/([a-z])([A-Z])/g, '$1 $2');
const permName = (flag) => humanize(new PermissionsBitField(flag).toArray()[0]);
const NO_REASON = 'No reason provided';
const WHO = 'Tell me who: mention them, paste their ID, or reply to one of their messages.';
const clip = (text, n = 400) => String(text || '').trim().slice(0, n);
const grab = (re, text) => String(text || '').match(re)?.[1] ?? null;
const userIdFrom = (t) => grab(/^<@!?(\d{17,20})>$/, t) ?? grab(/^(\d{17,20})$/, t);
const ts = (ms) => Math.floor(ms / 1000);

function channelFrom(message, text) {
  const id = grab(/^<#(\d{17,20})>$/, text) ?? grab(/^(\d{17,20})$/, text);
  return id ? message.guild.channels.cache.get(id) ?? null : null;
}

function roleFrom(guild, text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const id = grab(/^<@&(\d{17,20})>$/, t) ?? grab(/^(\d{17,20})$/, t);
  if (id) return guild.roles.cache.get(id) ?? null;
  const lower = t.toLowerCase();
  return (
    guild.roles.cache.find((r) => r.name.toLowerCase() === lower) ??
    guild.roles.cache.find((r) => r.name.toLowerCase().includes(lower)) ??
    null
  );
}

// "@user reason...", "<id> reason...", or (when replying to someone) just "reason..."
async function parseTarget(message, raw) {
  const parts = String(raw || '').split(/\s+/).filter(Boolean);
  let id = userIdFrom(parts[0]);
  let rest = parts.slice(1).join(' ');
  if (!id && message.reference?.messageId) {
    const ref = await message.fetchReference().catch(() => null);
    if (ref) {
      id = ref.author.id;
      rest = parts.join(' ');
    }
  }
  if (!id) return null;
  const member = await message.guild.members.fetch(id).catch(() => null);
  const user = member?.user ?? (await message.client.users.fetch(id).catch(() => null));
  if (!user) return null;
  return { id, member, user, rest: rest.trim() };
}

const commands = [];

function add(o) {
  commands.push({
    name: `!!${o.name}`,
    aliases: (o.aliases || []).map((a) => `!!${a}`),
    usage: o.usage,
    description: o.description,
    access: 'free',
    noSlash: true, // moderation is prefix-only
    async run(message, arg, ctx) {
      if (!message.guild) return message.reply('Moderation commands only work in a server.');
      if (o.perm && !mod.canUse(message.member, o.perm, o.modRole !== false)) {
        return message.reply(
          `🔒 You need the **${permName(o.perm)}** permission${o.modRole !== false ? ' (or the moderator role)' : ''} for that.`
        );
      }
      const need = o.botPerms ?? (o.perm ? [o.perm] : []);
      const me = message.guild.members.me;
      const missing = need.filter((p) => !me.permissions.has(p));
      if (missing.length) {
        return message.reply(`I’m missing the **${missing.map(permName).join(', ')}** permission, so I can’t do that. Ask an admin to give it to my role.`);
      }
      return o.run(message, String(ctx.rawArg || '').trim(), ctx);
    },
  });
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ============================================================ Warnings

add({
  name: 'warn',
  usage: '!!warn <@user|id> <reason>',
  description: 'Warn a member. Warnings stack and can trigger automatic actions.',
  perm: P.ModerateMembers,
  botPerms: [],
  async run(message, raw) {
    const t = await parseTarget(message, raw);
    if (!t) return message.reply(WHO);
    if (!t.member) return message.reply('That person is not in this server.');
    const err = mod.hierarchyError(message, t.member, 'warn', false);
    if (err) return message.reply(err);
    if (!t.rest) return message.reply('Give a reason: `!!warn @user <reason>`.');
    const res = await mod.warnUser({
      guild: message.guild,
      client: message.client,
      target: t.member,
      modId: message.author.id,
      reason: clip(t.rest),
    });
    return message.reply(
      `⚠️ Warned <@${t.id}>, case **#${res.c.id}**. They now have **${plural(res.count, 'active warning')}**.` +
        (res.dmOk ? '' : '\n-# I couldn’t DM them.') +
        (res.escalation ? `\n${res.escalation}` : '')
    );
  },
});

add({
  name: 'warnings',
  aliases: ['warns'],
  usage: '!!warnings [@user|id]',
  description: 'List active warnings (yours, or anyone’s if you’re a moderator).',
  async run(message, raw) {
    const t = raw || message.reference ? await parseTarget(message, raw) : null;
    const id = t?.id ?? message.author.id;
    if (id !== message.author.id && !mod.canUse(message.member, P.ModerateMembers)) {
      return message.reply('🔒 Only moderators can look at other people’s warnings.');
    }
    const list = mod.activeWarnings(id);
    if (!list.length) return message.reply(`<@${id}> has no active warnings. ✨`);
    const lines = list
      .slice(-10)
      .reverse()
      .map((c) => `**#${c.id}** · <t:${ts(c.at)}:d> · by <@${c.modId}>\n${clip(c.reason, 200)}`);
    const embed = new EmbedBuilder()
      .setColor(0xfaa61a)
      .setTitle(`⚠️ Warnings (${list.length})`)
      .setDescription(`For <@${id}>\n\n${lines.join('\n\n')}`.slice(0, 4000));
    return message.reply({ embeds: [embed] });
  },
});

add({
  name: 'delwarn',
  usage: '!!delwarn <case#>',
  description: 'Remove one warning by its case number.',
  perm: P.ModerateMembers,
  botPerms: [],
  async run(message, raw) {
    const c = mod.getCase(Number(raw.replace('#', '').split(/\s+/)[0]));
    if (!c || c.type !== 'warn') return message.reply('No warning with that case number.');
    if (c.removed) return message.reply('That warning was already removed.');
    c.removed = true;
    mod.save();
    await mod.sendLog(message.guild, {
      embeds: [new EmbedBuilder().setColor(0x57f287).setTitle(`🗑️ Warning #${c.id} removed`).setDescription(`For <@${c.userId}> by <@${message.author.id}>`).setTimestamp()],
    });
    return message.reply(`🗑️ Removed warning **#${c.id}** for <@${c.userId}>.`);
  },
});

add({
  name: 'clearwarns',
  usage: '!!clearwarns <@user|id>',
  description: 'Remove ALL active warnings from someone.',
  perm: P.ModerateMembers,
  botPerms: [],
  async run(message, raw) {
    const t = await parseTarget(message, raw);
    if (!t) return message.reply(WHO);
    const list = mod.activeWarnings(t.id);
    if (!list.length) return message.reply('They have no active warnings.');
    for (const c of list) c.removed = true;
    mod.save();
    await mod.sendLog(message.guild, {
      embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('🧼 Warnings cleared').setDescription(`${plural(list.length, 'warning')} cleared for <@${t.id}> by <@${message.author.id}>`).setTimestamp()],
    });
    return message.reply(`🧼 Cleared **${plural(list.length, 'warning')}** for <@${t.id}>.`);
  },
});

add({
  name: 'note',
  usage: '!!note <@user|id> <text>',
  description: 'Add a private moderator note (shows in !!history, never counts as a warning).',
  perm: P.ModerateMembers,
  botPerms: [],
  async run(message, raw) {
    const t = await parseTarget(message, raw);
    if (!t) return message.reply(WHO);
    if (!t.rest) return message.reply('Write the note: `!!note @user <text>`.');
    const c = mod.createCase({ type: 'note', userId: t.id, modId: message.author.id, reason: clip(t.rest) });
    await mod.record(message.guild, c);
    return message.reply(`📝 Note saved as case **#${c.id}**.`);
  },
});

// ============================================================ Mute / kick / ban

add({
  name: 'mute',
  aliases: ['timeout'],
  usage: '!!mute <@user|id> [duration] [reason]',
  description: 'Time a member out (10m, 2h, 3d... max 28d, default 1h).',
  perm: P.ModerateMembers,
  async run(message, raw) {
    const t = await parseTarget(message, raw);
    if (!t) return message.reply(WHO);
    if (!t.member) return message.reply('That person is not in this server.');
    const err = mod.hierarchyError(message, t.member, 'mute');
    if (err) return message.reply(err);
    if (!t.member.moderatable) return message.reply('I can’t time that member out (they may be an administrator).');
    const words = t.rest.split(/\s+/).filter(Boolean);
    let ms = mod.parseDuration(words[0]);
    if (ms) words.shift();
    else ms = 60 * 60 * 1000;
    ms = Math.min(ms, mod.MAX_TIMEOUT_MS);
    const reason = clip(words.join(' ')) || NO_REASON;
    await t.member.timeout(ms, mod.auditReason(message.author, reason));
    const c = mod.createCase({ type: 'mute', userId: t.id, modId: message.author.id, reason, until: Date.now() + ms });
    const dmOk = await mod.dmUser(t.user, message.guild, c);
    await mod.record(message.guild, c);
    return message.reply(`🔇 Muted <@${t.id}> for **${mod.formatDuration(ms)}**, case **#${c.id}**.` + (dmOk ? '' : '\n-# I couldn’t DM them.'));
  },
});

add({
  name: 'unmute',
  aliases: ['untimeout'],
  usage: '!!unmute <@user|id> [reason]',
  description: 'End a timeout early.',
  perm: P.ModerateMembers,
  async run(message, raw) {
    const t = await parseTarget(message, raw);
    if (!t?.member) return message.reply(WHO);
    if (!t.member.isCommunicationDisabled()) return message.reply('They are not muted.');
    const reason = clip(t.rest) || NO_REASON;
    await t.member.timeout(null, mod.auditReason(message.author, reason));
    const c = mod.createCase({ type: 'unmute', userId: t.id, modId: message.author.id, reason });
    await mod.record(message.guild, c);
    return message.reply(`🔊 Unmuted <@${t.id}>, case **#${c.id}**.`);
  },
});

add({
  name: 'kick',
  usage: '!!kick <@user|id> [reason]',
  description: 'Kick a member from the server.',
  perm: P.KickMembers,
  modRole: false,
  async run(message, raw) {
    const t = await parseTarget(message, raw);
    if (!t) return message.reply(WHO);
    if (!t.member) return message.reply('That person is not in this server.');
    const err = mod.hierarchyError(message, t.member, 'kick');
    if (err) return message.reply(err);
    if (!t.member.kickable) return message.reply('I can’t kick that member.');
    const reason = clip(t.rest) || NO_REASON;
    const dmOk = await mod.dmUser(t.user, message.guild, { type: 'kick', reason });
    await t.member.kick(mod.auditReason(message.author, reason));
    const c = mod.createCase({ type: 'kick', userId: t.id, modId: message.author.id, reason });
    await mod.record(message.guild, c);
    return message.reply(`👢 Kicked <@${t.id}>, case **#${c.id}**.` + (dmOk ? '' : '\n-# I couldn’t DM them.'));
  },
});

add({
  name: 'ban',
  usage: '!!ban <@user|id> [reason]',
  description: 'Ban a member (or any user ID, even if they left).',
  perm: P.BanMembers,
  modRole: false,
  async run(message, raw) {
    const t = await parseTarget(message, raw);
    if (!t) return message.reply(WHO);
    const err = mod.hierarchyError(message, t.member ?? { id: t.id }, 'ban');
    if (err) return message.reply(err);
    if (t.member && !t.member.bannable) return message.reply('I can’t ban that member.');
    const reason = clip(t.rest) || NO_REASON;
    const dmOk = t.member ? await mod.dmUser(t.user, message.guild, { type: 'ban', reason }) : false;
    await message.guild.members.ban(t.id, { reason: mod.auditReason(message.author, reason) });
    const c = mod.createCase({ type: 'ban', userId: t.id, modId: message.author.id, reason });
    await mod.record(message.guild, c);
    return message.reply(`🔨 Banned <@${t.id}>, case **#${c.id}**.` + (t.member && !dmOk ? '\n-# I couldn’t DM them.' : ''));
  },
});

add({
  name: 'tempban',
  usage: '!!tempban <@user|id> <duration> [reason]',
  description: 'Ban for a while (e.g. 3d). They are unbanned automatically.',
  perm: P.BanMembers,
  modRole: false,
  async run(message, raw) {
    const t = await parseTarget(message, raw);
    if (!t) return message.reply(WHO);
    const words = t.rest.split(/\s+/).filter(Boolean);
    const ms = mod.parseDuration(words.shift());
    if (!ms || ms < 60 * 1000 || ms > 365 * 24 * 3600 * 1000) {
      return message.reply('Give a duration between 1 minute and 365 days, like `!!tempban @user 3d spamming`.');
    }
    const err = mod.hierarchyError(message, t.member ?? { id: t.id }, 'ban');
    if (err) return message.reply(err);
    if (t.member && !t.member.bannable) return message.reply('I can’t ban that member.');
    const reason = clip(words.join(' ')) || NO_REASON;
    const until = Date.now() + ms;
    if (t.member) await mod.dmUser(t.user, message.guild, { type: 'tempban', reason, until });
    await message.guild.members.ban(t.id, { reason: mod.auditReason(message.author, `${reason} (tempban ${mod.formatDuration(ms)})`) });
    const c = mod.createCase({ type: 'tempban', userId: t.id, modId: message.author.id, reason, until });
    mod.setTimer(t.id, until, c.id);
    await mod.record(message.guild, c);
    return message.reply(`⏳ Banned <@${t.id}> for **${mod.formatDuration(ms)}**, case **#${c.id}**.`);
  },
});

add({
  name: 'softban',
  usage: '!!softban <@user|id> [reason]',
  description: 'Ban and instantly unban: deletes their last 7 days of messages.',
  perm: P.BanMembers,
  modRole: false,
  async run(message, raw) {
    const t = await parseTarget(message, raw);
    if (!t) return message.reply(WHO);
    const err = mod.hierarchyError(message, t.member ?? { id: t.id }, 'softban');
    if (err) return message.reply(err);
    if (t.member && !t.member.bannable) return message.reply('I can’t ban that member.');
    const reason = clip(t.rest) || NO_REASON;
    if (t.member) await mod.dmUser(t.user, message.guild, { type: 'softban', reason });
    const audit = mod.auditReason(message.author, `${reason} (softban)`);
    await message.guild.members.ban(t.id, { reason: audit, deleteMessageSeconds: 7 * 24 * 3600 });
    await message.guild.members.unban(t.id, audit);
    const c = mod.createCase({ type: 'softban', userId: t.id, modId: message.author.id, reason });
    await mod.record(message.guild, c);
    return message.reply(`🧹 Softbanned <@${t.id}>, case **#${c.id}**. Their recent messages are gone.`);
  },
});

add({
  name: 'unban',
  usage: '!!unban <user id> [reason]',
  description: 'Lift a ban.',
  perm: P.BanMembers,
  modRole: false,
  async run(message, raw) {
    const parts = raw.split(/\s+/).filter(Boolean);
    const id = userIdFrom(parts[0]);
    if (!id) return message.reply('Usage: `!!unban <user id> [reason]` (the ID is in `!!history` or the ban list).');
    const ban = await message.guild.bans.fetch(id).catch(() => null);
    if (!ban) return message.reply('That user is not banned (or I can’t see the ban list).');
    const reason = clip(parts.slice(1).join(' ')) || NO_REASON;
    await message.guild.members.unban(id, mod.auditReason(message.author, reason));
    mod.clearTimer(id);
    const c = mod.createCase({ type: 'unban', userId: id, modId: message.author.id, reason });
    await mod.record(message.guild, c);
    return message.reply(`🕊️ Unbanned <@${id}>, case **#${c.id}**.`);
  },
});

// ============================================================ Channels

add({
  name: 'purge',
  aliases: ['clear', 'prune'],
  usage: '!!purge <1-100> [@user|bots]',
  description: 'Bulk-delete recent messages (not older than 14 days, pinned ones are kept).',
  perm: P.ManageMessages,
  botPerms: [P.ManageMessages, P.ReadMessageHistory],
  async run(message, raw) {
    const parts = raw.split(/\s+/).filter(Boolean);
    const n = Number(parts[0]);
    if (!Number.isInteger(n) || n < 1 || n > 100) return message.reply('Usage: `!!purge <1-100> [@user|bots]`.');
    let userId = null;
    let botsOnly = false;
    if (parts[1]) {
      if (/^bots?$/i.test(parts[1])) botsOnly = true;
      else {
        userId = userIdFrom(parts[1]);
        if (!userId) return message.reply('The filter must be a @user, an ID, or `bots`.');
      }
    }
    const fetched = await message.channel.messages.fetch({ limit: 100, before: message.id });
    let list = [...fetched.values()].filter((m) => !m.pinned);
    if (userId) list = list.filter((m) => m.author.id === userId);
    if (botsOnly) list = list.filter((m) => m.author.bot);
    list = list.slice(0, n);
    const deleted = list.length ? await message.channel.bulkDelete(list, true) : { size: 0 };
    await message.delete().catch(() => {});
    const note = await message.channel
      .send(`🧹 Deleted **${plural(deleted.size, 'message')}**.${deleted.size < list.length ? ' (Messages older than 14 days can’t be bulk deleted.)' : ''}`)
      .catch(() => null);
    if (note) setTimeout(() => note.delete().catch(() => {}), 5000);
    await mod.sendLog(message.guild, {
      embeds: [new EmbedBuilder().setColor(0x95a5a6).setTitle('🧹 Purge').setDescription(`<@${message.author.id}> deleted **${deleted.size}** messages in <#${message.channel.id}>.`).setTimestamp()],
    });
  },
});

add({
  name: 'slowmode',
  aliases: ['slow'],
  usage: '!!slowmode <seconds|10s|1m|off> [#channel]',
  description: 'Set a channel’s slowmode (max 6 hours).',
  perm: P.ManageChannels,
  async run(message, raw) {
    const parts = raw.split(/\s+/).filter(Boolean);
    const mention = parts.find((p) => /^<#\d{17,20}>$/.test(p));
    const ch = (mention && channelFrom(message, mention)) || message.channel;
    const val = (parts.find((p) => p !== mention) || '').toLowerCase();
    let secs = null;
    if (val === 'off' || val === '0') secs = 0;
    else if (/^\d+$/.test(val)) secs = Number(val);
    else {
      const ms = mod.parseDuration(val);
      if (ms) secs = Math.round(ms / 1000);
    }
    if (secs === null || secs < 0 || secs > 21600 || typeof ch.setRateLimitPerUser !== 'function') {
      return message.reply('Usage: `!!slowmode <seconds|10s|1m|off> [#channel]` (max 6 hours).');
    }
    await ch.setRateLimitPerUser(secs, mod.auditReason(message.author, 'slowmode'));
    return message.reply(secs ? `🐢 Slowmode in <#${ch.id}> set to **${mod.formatDuration(secs * 1000)}**.` : `⚡ Slowmode in <#${ch.id}> is off.`);
  },
});

async function setLock(message, raw, lock) {
  const parts = raw.split(/\s+/).filter(Boolean);
  const mention = parts.find((p) => /^<#\d{17,20}>$/.test(p));
  const ch = (mention && channelFrom(message, mention)) || message.channel;
  if (!ch?.permissionOverwrites) return message.reply('I can’t lock that kind of channel.');
  const reason = clip(parts.filter((p) => p !== mention).join(' ')) || NO_REASON;
  const audit = mod.auditReason(message.author, reason);
  const everyone = message.guild.roles.everyone;
  if (lock) {
    // Keep me (and the moderator roles) able to talk, then lock @everyone
    await ch.permissionOverwrites.edit(message.guild.members.me, { SendMessages: true }, { reason: audit });
    for (const roleId of mod.config().modRoleIds) {
      if (message.guild.roles.cache.has(roleId)) {
        await ch.permissionOverwrites.edit(roleId, { SendMessages: true }, { reason: audit }).catch(() => {});
      }
    }
    await ch.permissionOverwrites.edit(everyone, { SendMessages: false, SendMessagesInThreads: false }, { reason: audit });
  } else {
    await ch.permissionOverwrites.edit(everyone, { SendMessages: null, SendMessagesInThreads: null }, { reason: audit });
  }
  await mod.sendLog(message.guild, {
    embeds: [new EmbedBuilder().setColor(lock ? 0xed4245 : 0x57f287).setTitle(lock ? '🔒 Channel locked' : '🔓 Channel unlocked').setDescription(`<#${ch.id}> by <@${message.author.id}>\n${reason}`).setTimestamp()],
  });
  return message.reply(lock ? `🔒 Locked <#${ch.id}>. Only staff with a channel permission can talk.` : `🔓 Unlocked <#${ch.id}>.`);
}

add({
  name: 'lock',
  usage: '!!lock [#channel] [reason]',
  description: 'Stop @everyone from sending messages in a channel.',
  perm: P.ManageChannels,
  botPerms: [P.ManageChannels, P.ManageRoles],
  run: (message, raw) => setLock(message, raw, true),
});

add({
  name: 'unlock',
  usage: '!!unlock [#channel] [reason]',
  description: 'Let @everyone talk in the channel again.',
  perm: P.ManageChannels,
  botPerms: [P.ManageChannels, P.ManageRoles],
  run: (message, raw) => setLock(message, raw, false),
});

// ============================================================ Members

add({
  name: 'nick',
  usage: '!!nick <@user|id> <new nickname|reset>',
  description: 'Change or reset someone’s nickname.',
  perm: P.ManageNicknames,
  modRole: false,
  async run(message, raw) {
    const t = await parseTarget(message, raw);
    if (!t?.member) return message.reply(WHO);
    if (t.id !== message.author.id) {
      const err = mod.hierarchyError(message, t.member, 'rename');
      if (err) return message.reply(err);
    }
    if (!t.member.manageable) return message.reply('I can’t change that member’s nickname.');
    const name = clip(t.rest, 32);
    if (!name) return message.reply('Give a nickname, or `reset`.');
    const reset = /^reset$/i.test(name);
    await t.member.setNickname(reset ? null : name, mod.auditReason(message.author, 'nickname change'));
    return message.reply(reset ? `✏️ Reset <@${t.id}>’s nickname.` : `✏️ <@${t.id}> is now **${name}**.`);
  },
});

add({
  name: 'role',
  usage: '!!role <add|remove> <@user|id> <role name|@role>',
  description: 'Give or take a role.',
  perm: P.ManageRoles,
  modRole: false,
  async run(message, raw) {
    const [action, ...tail] = raw.split(/\s+/);
    const verb = (action || '').toLowerCase();
    if (!['add', 'remove'].includes(verb)) return message.reply('Usage: `!!role <add|remove> <@user|id> <role name|@role>`.');
    const t = await parseTarget(message, tail.join(' '));
    if (!t?.member) return message.reply(WHO);
    const role = roleFrom(message.guild, t.rest);
    if (!role) return message.reply('I couldn’t find that role.');
    if (role.managed || role.id === message.guild.id) return message.reply('That role can’t be given or taken manually.');
    if (role.position >= message.guild.members.me.roles.highest.position) return message.reply('That role is above mine, so I can’t hand it out.');
    if (message.author.id !== message.guild.ownerId && role.position >= message.member.roles.highest.position) {
      return message.reply('That role is the same as or above your highest role.');
    }
    const audit = mod.auditReason(message.author, `role ${verb}`);
    if (verb === 'add') await t.member.roles.add(role, audit);
    else await t.member.roles.remove(role, audit);
    return message.reply(`✅ ${verb === 'add' ? 'Gave' : 'Took'} **${role.name}** ${verb === 'add' ? 'to' : 'from'} <@${t.id}>.`);
  },
});

add({
  name: 'userinfo',
  aliases: ['whois'],
  usage: '!!userinfo [@user|id]',
  description: 'Account age, join date, roles and (for moderators) warnings.',
  async run(message, raw) {
    const t = raw ? await parseTarget(message, raw) : { id: message.author.id, member: message.member, user: message.author };
    if (!t) return message.reply(WHO);
    const roles = t.member
      ? [...t.member.roles.cache.values()]
          .filter((r) => r.id !== message.guild.id)
          .sort((a, b) => b.position - a.position)
          .slice(0, 10)
          .map((r) => `<@&${r.id}>`)
          .join(' ')
      : '';
    const fields = [
      { name: 'ID', value: `\`${t.id}\``, inline: true },
      { name: 'Account created', value: `<t:${ts(t.user.createdTimestamp)}:R>`, inline: true },
      t.member?.joinedTimestamp && { name: 'Joined', value: `<t:${ts(t.member.joinedTimestamp)}:R>`, inline: true },
      roles && { name: 'Roles', value: roles },
    ];
    if (mod.canUse(message.member, P.ModerateMembers)) {
      const muted = t.member?.isCommunicationDisabled?.();
      fields.push({ name: 'Active warnings', value: String(mod.activeWarnings(t.id).length), inline: true });
      if (muted) fields.push({ name: 'Muted until', value: `<t:${ts(t.member.communicationDisabledUntilTimestamp)}:R>`, inline: true });
    }
    const embed = new EmbedBuilder()
      .setColor(t.member?.displayColor || 0x5865f2)
      .setTitle(t.user.username + (t.member ? '' : ' (not in this server)'))
      .setThumbnail(t.user.displayAvatarURL())
      .addFields(fields.filter(Boolean));
    return message.reply({ embeds: [embed] });
  },
});

// ============================================================ Records

add({
  name: 'history',
  aliases: ['cases', 'modlogs'],
  usage: '!!history <@user|id>',
  description: 'Everything moderators did to someone (last 15 cases).',
  perm: P.ModerateMembers,
  botPerms: [],
  async run(message, raw) {
    const t = await parseTarget(message, raw);
    if (!t) return message.reply(WHO);
    const list = mod.allCases().filter((c) => c.userId === t.id);
    if (!list.length) return message.reply('No moderation history for that user.');
    const lines = list
      .slice(-15)
      .reverse()
      .map((c) => `**#${c.id}** ${mod.EMOJI[c.type] || ''} ${c.type}${c.removed ? ' (removed)' : ''} · <t:${ts(c.at)}:d>: ${clip(c.reason, 80)}`);
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`📚 History for ${t.user.username}`)
      .setDescription(lines.join('\n').slice(0, 4000))
      .setFooter({ text: `${list.length} case${list.length === 1 ? '' : 's'} in total · !!case <#> for details` });
    return message.reply({ embeds: [embed] });
  },
});

add({
  name: 'case',
  usage: '!!case <case#>',
  description: 'Show one moderation case.',
  perm: P.ModerateMembers,
  botPerms: [],
  async run(message, raw) {
    const c = mod.getCase(Number(raw.replace('#', '').split(/\s+/)[0]));
    if (!c) return message.reply('No case with that number.');
    return message.reply({ embeds: [mod.caseEmbed(c)] });
  },
});

add({
  name: 'reason',
  usage: '!!reason <case#> <new reason>',
  description: 'Edit the reason of a case.',
  perm: P.ModerateMembers,
  botPerms: [],
  async run(message, raw) {
    const [num, ...rest] = raw.split(/\s+/);
    const c = mod.getCase(Number(String(num).replace('#', '')));
    if (!c) return message.reply('No case with that number.');
    const reason = clip(rest.join(' '), 500);
    if (!reason) return message.reply('Usage: `!!reason <case#> <new reason>`.');
    c.reason = reason;
    mod.save();
    return message.reply(`✏️ Updated the reason of case **#${c.id}**.`);
  },
});

// ============================================================ Setup

add({
  name: 'modlog',
  usage: '!!modlog [#channel|off]',
  description: 'Choose where moderation actions are logged.',
  perm: P.ManageGuild,
  modRole: false,
  botPerms: [],
  async run(message, raw) {
    const arg = raw.split(/\s+/)[0] || '';
    const cfg = mod.config();
    if (!arg) return message.reply(cfg.modlogChannelId ? `Mod log channel: <#${cfg.modlogChannelId}>. Change it with \`!!modlog #channel\` or \`!!modlog off\`.` : 'No mod log set. Use `!!modlog #channel`.');
    if (/^(off|none|disable)$/i.test(arg)) {
      cfg.modlogChannelId = null;
      mod.saveNow();
      return message.reply('Mod log turned off.');
    }
    const ch = channelFrom(message, arg);
    if (!ch?.isTextBased?.()) return message.reply('Mention a text channel, like `!!modlog #mod-log`.');
    if (!ch.permissionsFor(message.guild.members.me)?.has([P.ViewChannel, P.SendMessages, P.EmbedLinks])) {
      return message.reply('I need **View Channel, Send Messages and Embed Links** in that channel first.');
    }
    cfg.modlogChannelId = ch.id;
    mod.saveNow();
    await ch.send('📋 This is now the moderation log channel.').catch(() => {});
    return message.reply(`✅ Mod log → <#${ch.id}>.`);
  },
});

add({
  name: 'modrole',
  usage: '!!modrole <add|remove|list> [@role]',
  description: 'Roles that count as moderators (can warn, mute, purge, lock, slowmode).',
  perm: P.ManageGuild,
  modRole: false,
  botPerms: [],
  async run(message, raw) {
    const [sub, ...tail] = raw.split(/\s+/);
    const cfg = mod.config();
    const s = (sub || 'list').toLowerCase();
    if (s === 'list') {
      return message.reply(cfg.modRoleIds.length ? `Moderator roles: ${cfg.modRoleIds.map((id) => `<@&${id}>`).join(' ')}` : 'No moderator roles yet. `!!modrole add @role`');
    }
    if (!['add', 'remove'].includes(s)) return message.reply('Usage: `!!modrole <add|remove|list> [@role]`.');
    const role = roleFrom(message.guild, tail.join(' '));
    if (!role) return message.reply('I couldn’t find that role.');
    if (s === 'add') {
      if (cfg.modRoleIds.length >= 10) return message.reply('That’s the maximum of 10 moderator roles.');
      if (!cfg.modRoleIds.includes(role.id)) cfg.modRoleIds.push(role.id);
    } else {
      cfg.modRoleIds = cfg.modRoleIds.filter((id) => id !== role.id);
    }
    mod.saveNow();
    return message.reply(`✅ ${s === 'add' ? 'Added' : 'Removed'} **${role.name}** ${s === 'add' ? 'as' : 'from'} moderator roles.`);
  },
});

add({
  name: 'modconfig',
  usage: '!!modconfig [dm on|off] [warnaction <count> <none|mute|kick|ban> [duration]]',
  description: 'DM settings and automatic actions at a warning count (e.g. 3 warnings → mute 1h).',
  perm: P.ManageGuild,
  modRole: false,
  botPerms: [],
  async run(message, raw) {
    const parts = raw.split(/\s+/).filter(Boolean);
    const cfg = mod.config();
    const sub = (parts[0] || '').toLowerCase();
    if (sub === 'dm') {
      const v = (parts[1] || '').toLowerCase();
      if (!['on', 'off'].includes(v)) return message.reply('Usage: `!!modconfig dm on|off`.');
      cfg.dmUsers = v === 'on';
      mod.saveNow();
    } else if (sub === 'warnaction') {
      const n = Number(parts[1]);
      const action = (parts[2] || '').toLowerCase();
      if (!Number.isInteger(n) || n < 1 || n > 20 || !['none', 'mute', 'kick', 'ban'].includes(action)) {
        return message.reply('Usage: `!!modconfig warnaction <1-20> <none|mute|kick|ban> [duration]`, e.g. `!!modconfig warnaction 3 mute 1h`.');
      }
      if (action === 'none') delete cfg.warnActions[String(n)];
      else if (action === 'mute') {
        cfg.warnActions[String(n)] = { action, duration: Math.min(mod.parseDuration(parts[3]) || 3600000, mod.MAX_TIMEOUT_MS) };
      } else cfg.warnActions[String(n)] = { action };
      mod.saveNow();
    } else if (sub) {
      return message.reply('Usage: `!!modconfig`, `!!modconfig dm on|off`, `!!modconfig warnaction <count> <action> [duration]`.');
    }
    const rules = Object.entries(cfg.warnActions)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([n, r]) => `**${n}** warnings → ${r.action}${r.duration ? ` (${mod.formatDuration(r.duration)})` : ''}`);
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('⚙️ Moderation settings')
      .addFields(
        { name: 'Mod log', value: cfg.modlogChannelId ? `<#${cfg.modlogChannelId}>` : 'Not set (`!!modlog #channel`)', inline: true },
        { name: 'DM people I act on', value: cfg.dmUsers ? 'On' : 'Off', inline: true },
        { name: 'Moderator roles', value: cfg.modRoleIds.length ? cfg.modRoleIds.map((id) => `<@&${id}>`).join(' ') : 'None (`!!modrole add @role`)' },
        { name: 'Automatic actions', value: rules.length ? rules.join('\n') : 'None. Example: `!!modconfig warnaction 3 mute 1h`' }
      );
    return message.reply({ embeds: [embed] });
  },
});

add({
  name: 'automod',
  usage: '!!automod [invites|links|spam|caps|mentions|words on|off] [punish delete|warn] [words add|remove|list <w>] [domains add|remove <site>] [ignore #channel|@role] [spam <msgs> <secs>] [mentions <n>] [caps <percent>]',
  description: 'Automatic moderation: invites, links, spam, caps, mass mentions, blocked words.',
  perm: P.ManageGuild,
  modRole: false,
  botPerms: [],
  async run(message, raw) {
    const a = mod.automod();
    const parts = raw.split(/\s+/).filter(Boolean);
    const sub = (parts[0] || '').toLowerCase();
    const arg1 = (parts[1] || '').toLowerCase();
    const FEATURES = ['invites', 'links', 'spam', 'caps', 'mentions', 'words'];
    const done = (text) => {
      mod.saveNow();
      return message.reply(text);
    };

    if (sub === 'words' && ['add', 'remove', 'list'].includes(arg1)) {
      const word = parts.slice(2).join(' ').toLowerCase().slice(0, 40);
      if (arg1 === 'list') return message.reply(a.badWords.length ? `Blocked words (${a.badWords.length}): ||${a.badWords.join(', ')}||` : 'No blocked words yet.');
      if (!word) return message.reply('Usage: `!!automod words add|remove <word or phrase>`.');
      if (arg1 === 'add') {
        if (a.badWords.length >= 100) return message.reply('That’s the maximum of 100 blocked words.');
        if (!a.badWords.includes(word)) a.badWords.push(word);
        await message.delete().catch(() => {}); // the word itself shouldn't stay visible
        return done('✅ Word added (I removed your message so the list stays private). Turn it on with `!!automod words on`.');
      }
      a.badWords = a.badWords.filter((w) => w !== word);
      return done('✅ Word removed.');
    }

    if (sub === 'domains' && ['add', 'remove'].includes(arg1)) {
      const domain = (parts[2] || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
      if (!domain) return message.reply('Usage: `!!automod domains add|remove <site.com>`.');
      if (arg1 === 'add' && !a.allowedDomains.includes(domain)) a.allowedDomains.push(domain);
      if (arg1 === 'remove') a.allowedDomains = a.allowedDomains.filter((d) => d !== domain);
      return done(`✅ Allowed domains: ${a.allowedDomains.join(', ') || 'none'}`);
    }

    if (FEATURES.includes(sub) && ['on', 'off'].includes(arg1)) {
      a[sub] = arg1 === 'on';
      return done(`${a[sub] ? '✅' : '❌'} Automod **${sub}** is now **${arg1}**.`);
    }

    if (sub === 'punish') {
      if (!['delete', 'warn'].includes(arg1)) return message.reply('Usage: `!!automod punish delete|warn` (warn also adds a warning and can trigger `!!modconfig warnaction`).');
      a.punish = arg1;
      return done(`✅ Automod will now **${arg1}** rule breakers.`);
    }

    if (sub === 'ignore') {
      const ch = grab(/^<#(\d{17,20})>$/, parts[1]);
      const role = grab(/^<@&(\d{17,20})>$/, parts[1]);
      if (!ch && !role) return message.reply('Usage: `!!automod ignore #channel` or `!!automod ignore @role` (run again to undo).');
      const list = ch ? a.ignoredChannels : a.ignoredRoles;
      const id = ch || role;
      const at = list.indexOf(id);
      if (at === -1) list.push(id);
      else list.splice(at, 1);
      return done(`✅ ${ch ? `<#${id}>` : `<@&${id}>`} is now ${at === -1 ? 'ignored by' : 'checked by'} automod.`);
    }

    if (sub === 'spam' && parts[1]) {
      const msgs = Number(parts[1]);
      const secs = Number(parts[2] || a.spamSeconds);
      if (!Number.isInteger(msgs) || msgs < 3 || msgs > 20 || !Number.isInteger(secs) || secs < 2 || secs > 60) {
        return message.reply('Usage: `!!automod spam <3-20 messages> <2-60 seconds>`.');
      }
      a.spamMessages = msgs;
      a.spamSeconds = secs;
      return done(`✅ Spam = **${msgs}** messages in **${secs}s** (mutes for 5 minutes).`);
    }

    if (sub === 'mentions' && parts[1]) {
      const n = Number(parts[1]);
      if (!Number.isInteger(n) || n < 2 || n > 50) return message.reply('Usage: `!!automod mentions <2-50>`.');
      a.maxMentions = n;
      return done(`✅ Messages with **${n}+** mentions are removed (when mentions is on).`);
    }

    if (sub === 'caps' && parts[1]) {
      const n = Number(parts[1]);
      if (!Number.isInteger(n) || n < 40 || n > 100) return message.reply('Usage: `!!automod caps <40-100>` (percent capital letters).');
      a.capsPercent = n;
      return done(`✅ Caps limit is **${n}%**.`);
    }

    if (sub) return message.reply('I didn’t understand that. Run `!!automod` to see the options.');

    const on = (v) => (v ? '✅ on' : '❌ off');
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🤖 Automod')
      .setDescription('Staff (Manage Messages / Moderate Members / mod role) are never checked. I need **Manage Messages** in the channel.')
      .addFields(
        { name: 'Rules', value: [`Invites: ${on(a.invites)}`, `Links: ${on(a.links)}`, `Spam: ${on(a.spam)} (${a.spamMessages} msgs / ${a.spamSeconds}s)`, `Caps: ${on(a.caps)} (${a.capsPercent}%)`, `Mass mentions: ${on(a.mentions)} (${a.maxMentions}+)`, `Blocked words: ${on(a.words)} (${a.badWords.length})`].join('\n') },
        { name: 'When someone breaks a rule', value: a.punish === 'warn' ? 'Delete + **warn**' : 'Delete + short notice' , inline: true },
        { name: 'Allowed domains', value: a.allowedDomains.join(', ') || 'none', inline: true },
        { name: 'Ignored', value: [...a.ignoredChannels.map((i) => `<#${i}>`), ...a.ignoredRoles.map((i) => `<@&${i}>`)].join(' ') || 'nothing' }
      );
    return message.reply({ embeds: [embed] });
  },
});

// ============================================================ Anti-raid & welcome

add({
  name: 'antiraid',
  usage: '!!antiraid [on|off|threshold <n>|window <sec>|age <hours>|action kick|ban|timeout|alert #channel|lock on|off]',
  description: 'Join-spike protection, young-account filter, optional soft lock.',
  perm: P.ManageGuild,
  modRole: false,
  botPerms: [],
  async run(message, raw) {
    let ar;
    try {
      ar = require('../lib/antiraid');
    } catch {
      return message.reply('Anti-raid module is missing (`lib/antiraid.js`).');
    }
    const c = ar.cfg();
    const parts = raw.split(/\s+/).filter(Boolean);
    const sub = (parts[0] || '').toLowerCase();

    const done = (text) => {
      ar.save();
      return message.reply(text);
    };

    if (sub === 'on' || sub === 'enable') {
      c.enabled = true;
      return done('✅ Anti-raid **on**.');
    }
    if (sub === 'off' || sub === 'disable') {
      c.enabled = false;
      return done('Anti-raid **off**.');
    }
    if (sub === 'threshold' && parts[1]) {
      const n = Number(parts[1]);
      if (!Number.isInteger(n) || n < 3 || n > 50) {
        return message.reply('Usage: `!!antiraid threshold <3-50>` (joins in the window).');
      }
      c.joinThreshold = n;
      return done(`✅ Raid threshold = **${n}** joins in the window.`);
    }
    if (sub === 'window' && parts[1]) {
      const n = Number(parts[1]);
      if (!Number.isInteger(n) || n < 5 || n > 120) {
        return message.reply('Usage: `!!antiraid window <5-120>` (seconds).');
      }
      c.joinWindowSec = n;
      return done(`✅ Join window = **${n}s**.`);
    }
    if (sub === 'age' && parts[1]) {
      const n = Number(parts[1]);
      if (!Number.isInteger(n) || n < 0 || n > 720) {
        return message.reply('Usage: `!!antiraid age <0-720>` (hours; **0** = off).');
      }
      c.minAccountAgeHours = n;
      return done(n === 0 ? '✅ Account-age filter **off**.' : `✅ Min account age = **${n}h**.`);
    }
    if (sub === 'action' && parts[1]) {
      const a = parts[1].toLowerCase();
      if (!['kick', 'ban', 'timeout'].includes(a)) {
        return message.reply('Usage: `!!antiraid action kick|ban|timeout`.');
      }
      c.action = a;
      return done(`✅ Anti-raid action = **${a}**.`);
    }
    if (sub === 'alert') {
      const arg = parts[1] || '';
      if (/^(off|none|disable)$/i.test(arg)) {
        c.alertChannelId = null;
        return done('Anti-raid alerts **off**.');
      }
      const ch = channelFrom(message, arg);
      if (!ch?.isTextBased?.()) {
        return message.reply('Usage: `!!antiraid alert #channel` or `!!antiraid alert off`.');
      }
      c.alertChannelId = ch.id;
      return done(`✅ Anti-raid alerts → <#${ch.id}>.`);
    }
    if (sub === 'lock' && parts[1]) {
      const v = parts[1].toLowerCase();
      if (v === 'on') {
        c.lockOnRaid = true;
        return done('✅ Soft-lock channels on raid spike **on**.');
      }
      if (v === 'off') {
        c.lockOnRaid = false;
        return done('Soft-lock on raid **off**.');
      }
      return message.reply('Usage: `!!antiraid lock on|off`.');
    }
    if (sub) {
      return message.reply('Run `!!antiraid` with no args for status, or see `!!modhelp`.');
    }

    const on = (v) => (v ? '✅ on' : '❌ off');
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xed4245)
          .setTitle('🛡️ Anti-raid')
          .setDescription(
            'Needs **Server Members Intent** and Kick/Ban/Timeout + Manage Channels for soft-lock.\n' +
              'Staff are not exempt from age checks if they *join* as new accounts.'
          )
          .addFields(
            { name: 'Enabled', value: on(c.enabled), inline: true },
            { name: 'Spike', value: `**${c.joinThreshold}** joins / **${c.joinWindowSec}s**`, inline: true },
            { name: 'Min account age', value: c.minAccountAgeHours ? `**${c.minAccountAgeHours}h**` : 'off', inline: true },
            { name: 'Action', value: `**${c.action}**`, inline: true },
            { name: 'Soft lock', value: on(c.lockOnRaid), inline: true },
            {
              name: 'Alert channel',
              value: c.alertChannelId ? `<#${c.alertChannelId}>` : 'none',
              inline: true,
            },
            {
              name: 'Commands',
              value:
                '`!!antiraid on|off`\n' +
                '`!!antiraid threshold <n>` · `window <sec>` · `age <hours>`\n' +
                '`!!antiraid action kick|ban|timeout`\n' +
                '`!!antiraid alert #channel|off` · `lock on|off`',
            }
          ),
      ],
    });
  },
});

add({
  name: 'welcome',
  usage: '!!welcome [#channel] [message…] | !!welcome off | !!welcome test',
  description: 'Join message in a channel. Tokens: {user} {server} {membercount}',
  perm: P.ManageGuild,
  modRole: false,
  botPerms: [],
  async run(message, raw) {
    let ar;
    try {
      ar = require('../lib/antiraid');
    } catch {
      return message.reply('Welcome module is missing (`lib/antiraid.js`).');
    }
    const w = ar.welcomeCfg();
    const parts = raw.split(/\s+/).filter(Boolean);
    const head = (parts[0] || '').toLowerCase();

    if (head === 'off' || head === 'disable' || head === 'none') {
      w.enabled = false;
      w.channelId = null;
      ar.save();
      return message.reply('Welcome messages **off**.');
    }

    if (head === 'test') {
      if (!w.enabled || !w.channelId) {
        return message.reply('Welcome is not set. `!!welcome #channel Welcome {user}!`');
      }
      const text = String(w.message || 'Welcome {user}!')
        .replaceAll('{user}', `<@${message.author.id}>`)
        .replaceAll('{server}', message.guild.name)
        .replaceAll('{membercount}', String(message.guild.memberCount));
      const ch = await message.guild.channels.fetch(w.channelId).catch(() => null);
      if (!ch?.isTextBased?.()) return message.reply('Welcome channel is missing.');
      await ch.send({ content: text.slice(0, 2000) }).catch(() => {});
      return message.reply(`Test sent to <#${w.channelId}>.`);
    }

    if (!parts.length) {
      return message.reply(
        w.enabled && w.channelId
          ? `Welcome **on** in <#${w.channelId}>:\n\`\`\`\n${w.message}\n\`\`\`\n` +
              `Change: \`!!welcome #channel your text\` · off: \`!!welcome off\` · \`!!welcome test\``
          : 'Welcome **off**. Example: `!!welcome #general Welcome {user} to **{server}**!`'
      );
    }

    const ch = channelFrom(message, parts[0]);
    if (!ch?.isTextBased?.()) {
      return message.reply('First argument must be a channel: `!!welcome #general Welcome {user}!`');
    }
    if (!ch.permissionsFor(message.guild.members.me)?.has([P.ViewChannel, P.SendMessages])) {
      return message.reply('I need **View Channel** and **Send Messages** there.');
    }

    const msg = parts.slice(1).join(' ').trim() || 'Welcome {user} to **{server}**!';
    w.enabled = true;
    w.channelId = ch.id;
    w.message = msg.slice(0, 1800);
    ar.save();
    return message.reply(
      `✅ Welcome → <#${ch.id}>\nMessage:\n\`\`\`\n${w.message}\n\`\`\`\nTokens: \`{user}\` \`{server}\` \`{membercount}\``
    );
  },
});


// ============================================================ Overview

add({
  name: 'modhelp',
  aliases: ['moderation'],
  usage: '!!modhelp',
  description: 'Every moderation command, with usage.',
  async run(message) {
    const lines = commands.filter((c) => c.name !== '!!modhelp').map((c) => `**${c.usage.split(' [')[0].split(' <')[0]}** · ${c.description}\n\`${c.usage}\``);
    const embeds = [];
    let chunk = '';
    for (const line of lines) {
      if ((chunk + '\n\n' + line).length > 3500) {
        embeds.push(chunk);
        chunk = line;
      } else chunk = chunk ? `${chunk}\n\n${line}` : line;
    }
    if (chunk) embeds.push(chunk);
    return message.reply({
      embeds: embeds.map((text, i) => new EmbedBuilder().setColor(0xed4245).setTitle(i === 0 ? '🔨 Moderation commands' : '🔨 Moderation (cont.)').setDescription(text)),
    });
  },
});

module.exports = commands;
