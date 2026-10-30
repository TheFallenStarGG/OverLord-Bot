const { EmbedBuilder, PermissionFlagsBits: P, PermissionsBitField } = require('discord.js');
const mod = require('./moderation');
const antiraid = require('./antiraid');
const prefix = require('./prefix');
const blacklist = require('./blacklist');
const storage = require('./storage');

// Moderation from the website dashboard: settings (from !!modconfig, !!automod, !!antiraid, !!welcome,
// !!modlog, !!modrole, !!prefix) and member actions (!!warn, !!mute, !!ban...). The bot checks permissions
// itself, so the website can never give anyone more power than they have in Discord.

const ID = /^\d{17,20}$/;
const DAY = 24 * 60 * 60 * 1000;
const clip = (t, n = 400) => String(t ?? '').trim().slice(0, n);
const need = (cond, text) => {
  if (!cond) throw new Error(text);
};
const humanize = (n) => String(n).replace(/([a-z])([A-Z])/g, '$1 $2');
const permName = (flag) => humanize(new PermissionsBitField(flag).toArray()[0]);
const bool = (v, label) => {
  if (typeof v !== 'boolean') throw new Error(`${label}: bad value`);
  return v;
};
const whole = (v, min, max, label) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label} must be a whole number from ${min} to ${max}`);
  return n;
};
const idList = (list, max, label) => {
  if (!Array.isArray(list) || list.length > max) throw new Error(`${label}: up to ${max}`);
  const out = [...new Set(list.map(String))];
  if (!out.every((id) => ID.test(id))) throw new Error(`${label}: bad ID`);
  return out;
};
const isRuleable = (c) => Boolean(c && (c.type === 4 || (c.isTextBased() && !c.isThread())));

function sendable(guild, id, label, embeds) {
  need(ID.test(String(id)), `${label}: pick a channel`);
  const c = guild.channels.cache.get(String(id));
  need(c && c.isTextBased() && !c.isThread(), `${label}: pick a text channel`);
  const want = [P.ViewChannel, P.SendMessages, ...(embeds ? [P.EmbedLinks] : [])];
  need(c.permissionsFor(guild.members.me)?.has(want), `${label}: I need View Channel, Send Messages${embeds ? ' and Embed Links' : ''} in #${c.name}`);
  return c;
}

// ============================================================ Settings

function build(guild, m) {
  const ops = [];
  const add = (run) => ops.push({ run });

  if ('modlog' in m) {
    if (m.modlog === null) {
      add(() => {
        mod.config().modlogChannelId = null;
        mod.saveNow();
        return 'Mod log off';
      });
    } else {
      const c = sendable(guild, m.modlog, 'Mod log', true);
      add(async () => {
        const changed = mod.config().modlogChannelId !== c.id;
        mod.config().modlogChannelId = c.id;
        mod.saveNow();
        if (changed) await c.send('📋 This is now the moderation log channel.').catch(() => {});
        return `Mod log → #${c.name}`;
      });
    }
  }

  if ('modRoles' in m) {
    const roles = idList(m.modRoles, 10, 'Moderator roles');
    for (const id of roles) need(guild.roles.cache.has(id) && id !== guild.id, 'One of the moderator roles no longer exists');
    add(() => {
      mod.config().modRoleIds = roles;
      mod.saveNow();
      return `${roles.length} moderator role${roles.length === 1 ? '' : 's'}`;
    });
  }

  if ('dmUsers' in m) {
    const v = bool(m.dmUsers, 'DM setting');
    add(() => {
      mod.config().dmUsers = v;
      mod.saveNow();
      return `DMs to actioned members ${v ? 'on' : 'off'}`;
    });
  }

  if (m.warnActions !== undefined) {
    need(m.warnActions && typeof m.warnActions === 'object' && !Array.isArray(m.warnActions), 'Bad automatic actions');
    const entries = Object.entries(m.warnActions);
    need(entries.length <= 20, 'Too many automatic actions');
    const rules = {};
    for (const [count, r] of entries) {
      const n = whole(count, 1, 20, 'Warning count');
      const action = String(r?.action || '');
      if (action === 'mute') {
        rules[String(n)] = { action, duration: whole(r.duration ?? 3600000, 60000, mod.MAX_TIMEOUT_MS, 'Mute length') };
      } else if (action === 'kick' || action === 'ban') {
        rules[String(n)] = { action };
      } else throw new Error('Automatic action must be mute, kick or ban');
    }
    add(() => {
      mod.config().warnActions = rules;
      mod.saveNow();
      return `${Object.keys(rules).length} automatic action${Object.keys(rules).length === 1 ? '' : 's'}`;
    });
  }

  const a = m.automod;
  if (a !== undefined) {
    need(a && typeof a === 'object', 'Bad automod settings');
    const patch = {};
    for (const k of ['invites', 'links', 'spam', 'caps', 'mentions', 'words']) if (k in a) patch[k] = bool(a[k], `Automod ${k}`);
    if ('punish' in a) {
      need(['delete', 'warn'].includes(a.punish), 'Automod punishment must be delete or warn');
      patch.punish = a.punish;
    }
    if ('spamMessages' in a) patch.spamMessages = whole(a.spamMessages, 3, 20, 'Spam messages');
    if ('spamSeconds' in a) patch.spamSeconds = whole(a.spamSeconds, 2, 60, 'Spam seconds');
    if ('maxMentions' in a) patch.maxMentions = whole(a.maxMentions, 2, 50, 'Mention limit');
    if ('capsPercent' in a) patch.capsPercent = whole(a.capsPercent, 40, 100, 'Caps percent');
    if ('badWords' in a) {
      need(Array.isArray(a.badWords) && a.badWords.length <= 100, 'Blocked words: up to 100');
      patch.badWords = [...new Set(a.badWords.map((w) => String(w).toLowerCase().trim().slice(0, 40)).filter(Boolean))];
    }
    if ('allowedDomains' in a) {
      need(Array.isArray(a.allowedDomains) && a.allowedDomains.length <= 50, 'Allowed domains: up to 50');
      patch.allowedDomains = [
        ...new Set(
          a.allowedDomains
            .map((d) => String(d).toLowerCase().trim().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0])
            .filter((d) => /^[a-z0-9.-]{1,100}$/.test(d))
        ),
      ];
    }
    if ('ignoredChannels' in a) {
      const list = idList(a.ignoredChannels, 50, 'Ignored channels');
      for (const id of list) need(isRuleable(guild.channels.cache.get(id)), 'One of the ignored channels no longer exists');
      patch.ignoredChannels = list;
    }
    if ('ignoredRoles' in a) {
      const list = idList(a.ignoredRoles, 50, 'Ignored roles');
      for (const id of list) need(guild.roles.cache.has(id), 'One of the ignored roles no longer exists');
      patch.ignoredRoles = list;
    }
    if (Object.keys(patch).length) {
      add(() => {
        Object.assign(mod.automod(), patch);
        mod.saveNow();
        return 'Automod updated';
      });
    }
  }

  const r = m.antiraid;
  if (r !== undefined) {
    need(r && typeof r === 'object', 'Bad anti-raid settings');
    const patch = {};
    if ('enabled' in r) patch.enabled = bool(r.enabled, 'Anti-raid');
    if ('joinThreshold' in r) patch.joinThreshold = whole(r.joinThreshold, 3, 50, 'Join threshold');
    if ('joinWindowSec' in r) patch.joinWindowSec = whole(r.joinWindowSec, 5, 120, 'Join window');
    if ('minAccountAgeHours' in r) patch.minAccountAgeHours = whole(r.minAccountAgeHours, 0, 720, 'Minimum account age');
    if ('action' in r) {
      need(['kick', 'ban', 'timeout'].includes(r.action), 'Anti-raid action must be kick, ban or timeout');
      patch.action = r.action;
    }
    if ('lockOnRaid' in r) patch.lockOnRaid = bool(r.lockOnRaid, 'Soft lock');
    if ('alertChannelId' in r) patch.alertChannelId = r.alertChannelId === null ? null : sendable(guild, r.alertChannelId, 'Alert channel', false).id;
    if (Object.keys(patch).length) {
      add(() => {
        Object.assign(antiraid.cfg(), patch);
        antiraid.save();
        return 'Anti-raid updated';
      });
    }
  }

  const w = m.welcome;
  if (w !== undefined) {
    need(w && typeof w === 'object', 'Bad welcome settings');
    const patch = {};
    if ('enabled' in w) patch.enabled = bool(w.enabled, 'Welcome messages');
    if ('channelId' in w) patch.channelId = w.channelId === null ? null : sendable(guild, w.channelId, 'Welcome channel', false).id;
    if ('message' in w) {
      const text = clip(w.message, 1800);
      need(text, 'Write a welcome message');
      patch.message = text;
    }
    const next = { ...antiraid.welcomeCfg(), ...patch };
    need(!next.enabled || next.channelId, 'Pick a welcome channel before turning welcome messages on');
    if (Object.keys(patch).length) {
      add(() => {
        Object.assign(antiraid.welcomeCfg(), patch);
        antiraid.save();
        return 'Welcome message updated';
      });
    }
  }

  if ('prefix' in m) {
    const text = String(m.prefix ?? '').trim();
    const reset = !text || text === prefix.DEFAULT;
    if (!reset) {
      const err = prefix.validate(text);
      if (err) throw new Error(err);
    }
    add(() => {
      prefix.set(reset ? null : text);
      return reset ? `Prefix reset to ${prefix.DEFAULT}` : `Prefix → ${text}`;
    });
  }

  return ops;
}

// Needs the server attached because the checks read that server's current settings
const buildOps = (guild, m) => storage.runIn(guild.id, () => build(guild, m));

// ============================================================ Member actions

async function pickTarget(ctx, { inGuild = true } = {}) {
  const id = String(ctx.p.userId || '');
  need(ID.test(id), 'Pick a member first');
  const member = await ctx.guild.members.fetch(id).catch(() => null);
  const user = member?.user ?? (await ctx.client.users.fetch(id).catch(() => null));
  need(user, "I couldn't find that user");
  if (inGuild) need(member, 'That person is not in this server');
  return { id, member, user };
}

const hier = (ctx, t, verb, checkBot = true) => {
  const err = mod.hierarchyError({ guild: ctx.guild, author: ctx.actor.user, client: ctx.client, member: ctx.actor }, t.member ?? { id: t.id }, verb, checkBot);
  if (err) throw new Error(err);
};
const why = (ctx, text) => mod.auditReason({ username: `${ctx.actor.user.username} via website` }, text);
const reasonOf = (ctx, required) => {
  const r = clip(ctx.p.reason);
  if (required) need(r, 'Write a reason');
  return r || 'No reason provided';
};

function textChannel(ctx, id, perms = [P.ViewChannel]) {
  const c = ctx.guild.channels.cache.get(String(id));
  need(c && c.isTextBased() && !c.isThread(), 'Pick a text channel');
  need(c.permissionsFor(ctx.actor)?.has(P.ViewChannel), "You can't see that channel");
  need(c.permissionsFor(ctx.me)?.has(perms), `I'm missing permissions in #${c.name}`);
  return c;
}

async function setLock(ctx, lock) {
  const ch = textChannel(ctx, ctx.p.channelId, [P.ViewChannel, P.ManageChannels]);
  need(ch.permissionOverwrites, "I can't lock that kind of channel");
  const reason = reasonOf(ctx);
  const audit = why(ctx, reason);
  const everyone = ctx.guild.roles.everyone;
  if (lock) {
    await ch.permissionOverwrites.edit(ctx.me, { SendMessages: true }, { reason: audit });
    for (const roleId of mod.config().modRoleIds) {
      if (ctx.guild.roles.cache.has(roleId)) await ch.permissionOverwrites.edit(roleId, { SendMessages: true }, { reason: audit }).catch(() => {});
    }
    await ch.permissionOverwrites.edit(everyone, { SendMessages: false, SendMessagesInThreads: false }, { reason: audit });
  } else {
    await ch.permissionOverwrites.edit(everyone, { SendMessages: null, SendMessagesInThreads: null }, { reason: audit });
  }
  await mod.sendLog(ctx.guild, {
    embeds: [
      new EmbedBuilder()
        .setColor(lock ? 0xed4245 : 0x57f287)
        .setTitle(lock ? '🔒 Channel locked' : '🔓 Channel unlocked')
        .setDescription(`<#${ch.id}> by <@${ctx.actor.id}> (website)\n${reason}`)
        .setTimestamp(),
    ],
  });
  return lock ? `Locked #${ch.name}` : `Unlocked #${ch.name}`;
}

const HANDLERS = {
  async warn(ctx) {
    const t = await pickTarget(ctx);
    hier(ctx, t, 'warn', false);
    const reason = reasonOf(ctx, true);
    const res = await mod.warnUser({ guild: ctx.guild, client: ctx.client, target: t.member, modId: ctx.actor.id, reason });
    return `Warned ${t.user.username} (case #${res.c.id}, ${res.count} active)` + (res.escalation ? ' · automatic action triggered' : '');
  },

  async note(ctx) {
    const t = await pickTarget(ctx, { inGuild: false });
    const c = mod.createCase({ type: 'note', userId: t.id, modId: ctx.actor.id, reason: reasonOf(ctx, true) });
    await mod.record(ctx.guild, c);
    return `Note saved as case #${c.id}`;
  },

  async mute(ctx) {
    const t = await pickTarget(ctx);
    hier(ctx, t, 'mute');
    need(t.member.moderatable, "I can't time that member out (they may be an administrator)");
    const ms = whole(ctx.p.durationMs ?? 3600000, 60000, mod.MAX_TIMEOUT_MS, 'Mute length');
    const reason = reasonOf(ctx);
    await t.member.timeout(ms, why(ctx, reason));
    const c = mod.createCase({ type: 'mute', userId: t.id, modId: ctx.actor.id, reason, until: Date.now() + ms });
    await mod.dmUser(t.user, ctx.guild, c);
    await mod.record(ctx.guild, c);
    return `Muted ${t.user.username} for ${mod.formatDuration(ms)} (case #${c.id})`;
  },

  async unmute(ctx) {
    const t = await pickTarget(ctx);
    need(t.member.isCommunicationDisabled(), 'They are not muted');
    const reason = reasonOf(ctx);
    await t.member.timeout(null, why(ctx, reason));
    const c = mod.createCase({ type: 'unmute', userId: t.id, modId: ctx.actor.id, reason });
    await mod.record(ctx.guild, c);
    return `Unmuted ${t.user.username} (case #${c.id})`;
  },

  async kick(ctx) {
    const t = await pickTarget(ctx);
    hier(ctx, t, 'kick');
    need(t.member.kickable, "I can't kick that member");
    const reason = reasonOf(ctx);
    await mod.dmUser(t.user, ctx.guild, { type: 'kick', reason });
    await t.member.kick(why(ctx, reason));
    const c = mod.createCase({ type: 'kick', userId: t.id, modId: ctx.actor.id, reason });
    await mod.record(ctx.guild, c);
    return `Kicked ${t.user.username} (case #${c.id})`;
  },

  async ban(ctx) {
    const t = await pickTarget(ctx, { inGuild: false });
    hier(ctx, t, 'ban');
    need(!t.member || t.member.bannable, "I can't ban that member");
    const reason = reasonOf(ctx);
    const days = whole(ctx.p.deleteDays ?? 0, 0, 7, 'Message deletion');
    if (t.member) await mod.dmUser(t.user, ctx.guild, { type: 'ban', reason });
    await ctx.guild.members.ban(t.id, { reason: why(ctx, reason), deleteMessageSeconds: days * 86400 });
    const c = mod.createCase({ type: 'ban', userId: t.id, modId: ctx.actor.id, reason });
    await mod.record(ctx.guild, c);
    return `Banned ${t.user.username} (case #${c.id})`;
  },

  async tempban(ctx) {
    const t = await pickTarget(ctx, { inGuild: false });
    hier(ctx, t, 'ban');
    need(!t.member || t.member.bannable, "I can't ban that member");
    const ms = whole(ctx.p.durationMs, 60000, 365 * DAY, 'Ban length');
    const reason = reasonOf(ctx);
    const until = Date.now() + ms;
    if (t.member) await mod.dmUser(t.user, ctx.guild, { type: 'tempban', reason, until });
    await ctx.guild.members.ban(t.id, { reason: why(ctx, `${reason} (tempban ${mod.formatDuration(ms)})`) });
    const c = mod.createCase({ type: 'tempban', userId: t.id, modId: ctx.actor.id, reason, until });
    mod.setTimer(t.id, until, c.id);
    await mod.record(ctx.guild, c);
    return `Banned ${t.user.username} for ${mod.formatDuration(ms)} (case #${c.id})`;
  },

  async softban(ctx) {
    const t = await pickTarget(ctx, { inGuild: false });
    hier(ctx, t, 'softban');
    need(!t.member || t.member.bannable, "I can't ban that member");
    const reason = reasonOf(ctx);
    if (t.member) await mod.dmUser(t.user, ctx.guild, { type: 'softban', reason });
    const audit = why(ctx, `${reason} (softban)`);
    await ctx.guild.members.ban(t.id, { reason: audit, deleteMessageSeconds: 7 * 86400 });
    await ctx.guild.members.unban(t.id, audit);
    const c = mod.createCase({ type: 'softban', userId: t.id, modId: ctx.actor.id, reason });
    await mod.record(ctx.guild, c);
    return `Softbanned ${t.user.username} (case #${c.id})`;
  },

  async unban(ctx) {
    const id = String(ctx.p.userId || '');
    need(ID.test(id), 'Pick someone from the ban list');
    const ban = await ctx.guild.bans.fetch(id).catch(() => null);
    need(ban, 'That user is not banned (or I can’t see the ban list)');
    const reason = reasonOf(ctx);
    await ctx.guild.members.unban(id, why(ctx, reason));
    mod.clearTimer(id);
    const c = mod.createCase({ type: 'unban', userId: id, modId: ctx.actor.id, reason });
    await mod.record(ctx.guild, c);
    return `Unbanned ${ban.user.username} (case #${c.id})`;
  },

  async nick(ctx) {
    const t = await pickTarget(ctx);
    if (t.id !== ctx.actor.id) hier(ctx, t, 'rename');
    need(t.member.manageable, "I can't change that member's nickname");
    const name = clip(ctx.p.nick, 32);
    await t.member.setNickname(name || null, why(ctx, 'nickname change'));
    return name ? `${t.user.username} is now “${name}”` : `Reset ${t.user.username}'s nickname`;
  },

  async role(ctx) {
    const t = await pickTarget(ctx);
    const verb = ctx.p.mode === 'remove' ? 'remove' : 'add';
    const role = ctx.guild.roles.cache.get(String(ctx.p.roleId));
    need(role, "That role doesn't exist anymore");
    need(!role.managed && role.id !== ctx.guild.id, "That role can't be given or taken manually");
    need(role.position < ctx.me.roles.highest.position, 'That role is above mine, so I can’t hand it out');
    need(ctx.actor.id === ctx.guild.ownerId || role.position < ctx.actor.roles.highest.position, 'That role is the same as or above your highest role');
    if (verb === 'add') await t.member.roles.add(role, why(ctx, 'role add'));
    else await t.member.roles.remove(role, why(ctx, 'role remove'));
    return `${verb === 'add' ? 'Gave' : 'Took'} ${role.name} ${verb === 'add' ? 'to' : 'from'} ${t.user.username}`;
  },

  async delwarn(ctx) {
    const c = mod.getCase(Number(ctx.p.caseId));
    need(c && c.type === 'warn', 'No warning with that case number');
    need(!c.removed, 'That warning was already removed');
    c.removed = true;
    mod.saveNow();
    await mod.sendLog(ctx.guild, {
      embeds: [new EmbedBuilder().setColor(0x57f287).setTitle(`🗑️ Warning #${c.id} removed`).setDescription(`For <@${c.userId}> by <@${ctx.actor.id}> (website)`).setTimestamp()],
    });
    return `Removed warning #${c.id}`;
  },

  async clearwarns(ctx) {
    const id = String(ctx.p.userId || '');
    need(ID.test(id), 'Pick a member first');
    const list = mod.activeWarnings(id);
    need(list.length, 'They have no active warnings');
    for (const c of list) c.removed = true;
    mod.saveNow();
    await mod.sendLog(ctx.guild, {
      embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('🧼 Warnings cleared').setDescription(`${list.length} warning${list.length === 1 ? '' : 's'} cleared for <@${id}> by <@${ctx.actor.id}> (website)`).setTimestamp()],
    });
    return `Cleared ${list.length} warning${list.length === 1 ? '' : 's'}`;
  },

  async reason(ctx) {
    const c = mod.getCase(Number(ctx.p.caseId));
    need(c, 'No case with that number');
    c.reason = reasonOf(ctx, true).slice(0, 500);
    mod.saveNow();
    return `Updated the reason of case #${c.id}`;
  },

  async slowmode(ctx) {
    const ch = textChannel(ctx, ctx.p.channelId, [P.ViewChannel, P.ManageChannels]);
    need(typeof ch.setRateLimitPerUser === 'function', "I can't set slowmode there");
    const secs = whole(ctx.p.seconds, 0, 21600, 'Slowmode');
    await ch.setRateLimitPerUser(secs, why(ctx, 'slowmode'));
    return secs ? `Slowmode in #${ch.name}: ${mod.formatDuration(secs * 1000)}` : `Slowmode in #${ch.name} is off`;
  },

  lock: (ctx) => setLock(ctx, true),
  unlock: (ctx) => setLock(ctx, false),

  async purge(ctx) {
    const ch = textChannel(ctx, ctx.p.channelId, [P.ViewChannel, P.ManageMessages, P.ReadMessageHistory]);
    const n = whole(ctx.p.count, 1, 100, 'Message count');
    const fetched = await ch.messages.fetch({ limit: 100 });
    let list = [...fetched.values()].filter((m) => !m.pinned);
    if (ctx.p.filterUserId) list = list.filter((m) => m.author.id === String(ctx.p.filterUserId));
    if (ctx.p.bots) list = list.filter((m) => m.author.bot);
    list = list.slice(0, n);
    const deleted = list.length ? await ch.bulkDelete(list, true) : { size: 0 };
    await mod.sendLog(ctx.guild, {
      embeds: [new EmbedBuilder().setColor(0x95a5a6).setTitle('🧹 Purge').setDescription(`<@${ctx.actor.id}> deleted **${deleted.size}** messages in <#${ch.id}> (website).`).setTimestamp()],
    });
    return `Deleted ${deleted.size} message${deleted.size === 1 ? '' : 's'} in #${ch.name}`;
  },

  async welcomeTest(ctx) {
    const w = antiraid.welcomeCfg();
    need(w.enabled && w.channelId, 'Turn welcome messages on and pick a channel first');
    const ch = await ctx.guild.channels.fetch(w.channelId).catch(() => null);
    need(ch?.isTextBased?.(), 'The welcome channel is missing');
    const text = String(w.message || 'Welcome {user}!')
      .replaceAll('{user}', `<@${ctx.actor.id}>`)
      .replaceAll('{server}', ctx.guild.name)
      .replaceAll('{membercount}', String(ctx.guild.memberCount));
    await ch.send({ content: text.slice(0, 2000) });
    return `Test sent to #${ch.name}`;
  },
};

// What each action needs: [Discord permission, can the moderator role do it?, permissions the bot needs]
const RULES = {
  warn: [P.ModerateMembers, true, []],
  note: [P.ModerateMembers, true, []],
  mute: [P.ModerateMembers, true, [P.ModerateMembers]],
  unmute: [P.ModerateMembers, true, [P.ModerateMembers]],
  kick: [P.KickMembers, false, [P.KickMembers]],
  ban: [P.BanMembers, false, [P.BanMembers]],
  tempban: [P.BanMembers, false, [P.BanMembers]],
  softban: [P.BanMembers, false, [P.BanMembers]],
  unban: [P.BanMembers, false, [P.BanMembers]],
  nick: [P.ManageNicknames, false, [P.ManageNicknames]],
  role: [P.ManageRoles, false, [P.ManageRoles]],
  delwarn: [P.ModerateMembers, true, []],
  clearwarns: [P.ModerateMembers, true, []],
  reason: [P.ModerateMembers, true, []],
  slowmode: [P.ManageChannels, true, [P.ManageChannels]],
  lock: [P.ManageChannels, true, [P.ManageChannels, P.ManageRoles]],
  unlock: [P.ManageChannels, true, [P.ManageChannels, P.ManageRoles]],
  purge: [P.ManageMessages, true, [P.ManageMessages, P.ReadMessageHistory]],
  welcomeTest: [P.ManageGuild, false, []],
};

async function run(client, userId, p) {
  const guildId = String(p?.guildId || '');
  need(ID.test(guildId) && ID.test(String(userId)), 'Bad request');
  need(!blacklist.isUserBlocked(userId) && !blacklist.isGuildBlocked(guildId), 'You or that server are blocked from using the bot');
  const guild = client.guilds.cache.get(guildId);
  need(guild, "I'm not in that server");
  const handler = HANDLERS[p.action];
  const rule = RULES[p.action];
  need(handler && rule, 'Unknown moderation action');
  const actor = await guild.members.fetch(userId).catch(() => null);
  need(actor, "You're not in that server");
  const me = guild.members.me ?? (await guild.members.fetchMe());

  const result = await storage.runIn(guildId, async () => {
    const [perm, modRoleOk, botPerms] = rule;
    need(mod.canUse(actor, perm, modRoleOk), `You need the ${permName(perm)} permission${modRoleOk ? ' (or the moderator role)' : ''} in that server`);
    const missing = botPerms.filter((x) => !me.permissions.has(x));
    need(!missing.length, `I'm missing the ${missing.map(permName).join(', ')} permission, so I can't do that. Ask an admin to give it to my role.`);
    return handler({ client, guild, actor, me, p });
  });
  await storage.flush(); // write to the database now so the dashboard shows it
  return result;
}

module.exports = { buildOps, run };
