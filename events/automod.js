const { EmbedBuilder, PermissionFlagsBits: P } = require('discord.js');
const mod = require('../lib/moderation');
const { logging } = require('../lib/logging');

const INVITE_RE = /(?:discord(?:app)?\.com\/invite|discord\.gg|discord\.me|discord\.link|invite\.gg)\/[\w-]+/i;
const URL_RE = /https?:\/\/[^\s<>"']+/gi;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const recent = new Map(); // guildId:userId -> message timestamps

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
};

function findViolation(message, a) {
  const text = message.content || '';

  if (a.invites && INVITE_RE.test(text)) return { rule: 'invites', why: 'Discord invite links are not allowed here.' };

  if (a.links) {
    for (const url of text.match(URL_RE) || []) {
      const host = hostOf(url);
      if (!host) continue;
      if (a.invites && INVITE_RE.test(url)) continue;
      const allowed = a.allowedDomains.some((d) => host === d || host.endsWith(`.${d}`));
      if (!allowed) return { rule: 'links', why: 'Links are not allowed here.' };
    }
  }

  if (a.mentions) {
    const count = message.mentions.users.size + message.mentions.roles.size;
    if (count >= a.maxMentions) return { rule: 'mentions', why: `Too many mentions (${count}).` };
  }

  if (a.words) {
    for (const word of a.badWords) {
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(word)}(?![\\p{L}\\p{N}])`, 'iu');
      if (re.test(text)) return { rule: 'words', why: 'That message contains a blocked word.' };
    }
  }

  if (a.caps) {
    const letters = text.replace(/[^a-zA-Z]/g, '');
    if (letters.length >= a.capsMinLength) {
      const upper = letters.replace(/[^A-Z]/g, '').length;
      if ((upper / letters.length) * 100 >= a.capsPercent) return { rule: 'caps', why: 'Please don’t shout (too many capital letters).' };
    }
  }

  if (a.spam) {
    const key = `${message.guild.id}:${message.author.id}`;
    const now = Date.now();
    const list = (recent.get(key) || []).filter((t) => now - t < a.spamSeconds * 1000);
    list.push(now);
    recent.set(key, list);
    if (recent.size > 5000) recent.clear();
    if (list.length >= a.spamMessages) {
      recent.delete(key);
      return { rule: 'spam', why: 'Slow down, that looks like spam.', mute: 5 * 60 * 1000 };
    }
  }

  return null;
}

async function check(message) {
  if (!message.guild || message.author.bot || message.system || !message.member) return;
  const a = mod.automod();
  if (!(a.invites || a.links || a.spam || a.caps || a.mentions || a.words)) return;
  if (mod.isStaff(message.member) || mod.isAutomodExempt(message)) return;
  if (!message.channel.permissionsFor(message.guild.members.me)?.has(P.ManageMessages)) return;

  const hit = findViolation(message, a);
  if (!hit) return;

  await message.delete().catch(() => {});
  const reason = `Automod (${hit.rule}): ${hit.why}`;
  if (hit.mute && message.member.moderatable) await message.member.timeout(hit.mute, reason).catch(() => {});

  let notice = `${message.author}, your message was removed. ${hit.why}`;
  if (a.punish === 'warn') {
    const res = await mod.warnUser({
      guild: message.guild,
      client: message.client,
      target: message.member,
      modId: message.client.user.id,
      reason,
    });
    notice += ` (warning ${res.count})`;
  } else {
    await mod.sendLog(message.guild, {
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle('🤖 Automod removed a message')
          .addFields(
            { name: 'User', value: `<@${message.author.id}> (\`${message.author.id}\`)`, inline: true },
            { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
            { name: 'Rule', value: hit.rule, inline: true },
            { name: 'Message', value: (message.content || '(no text)').slice(0, 900) }
          )
          .setTimestamp(),
      ],
    });
  }

  const sent = await message.channel.send(notice).catch(() => null);
  if (sent) setTimeout(() => sent.delete().catch(() => {}), 6000);
}

module.exports = (client) => {
  client.on('messageCreate', async (message) => {
    try {
      await check(message);
    } catch (err) {
      logging('error', 'Automod failed', err);
    }
  });
};
