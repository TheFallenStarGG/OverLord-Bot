const { EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const blacklist = require('./blacklist');
const { FILES } = require('../config');
const { readJson, writeJson } = require('./storage');

// Used the first time (and anytime the list is empty)
const DEFAULT_GIFS = [
  'https://klipy.com/gifs/ban-you',
  'https://klipy.com/gifs/ur-banned-1',
  'https://klipy.com/gifs/trump-donaldtrump-11',
  'https://klipy.com/gifs/i-fear-youve-been-blacklisted-kate',
  'https://klipy.com/gifs/rowan-banned',
  'https://klipy.com/gifs/you-are-banned-ban-him',
  'https://klipy.com/gifs/you-are-banned-jeremy-clarkson',
  'https://klipy.com/gifs/emoji-emojidie',
  'https://klipy.com/gifs/ban-yuzufei',
  'https://klipy.com/gifs/c00kie-get-banned',
  'https://klipy.com/gifs/banned-thor-banned',
];

const TITLE_USER = "You've been banned from using this bot";
const TITLE_GUILD = 'This server has been banned from using this bot';

const isDirectImage = (url) => /\.(gif|png|jpe?g|webp)(\?.*)?$/i.test(url);

function loadList() {
  const d = readJson(FILES.banGifs, null);
  if (d && Array.isArray(d.urls) && d.urls.length) {
    return d.urls.map(String).filter(Boolean);
  }
  return DEFAULT_GIFS.slice();
}

function saveList(urls) {
  writeJson(FILES.banGifs, { urls });
}

function listGifs() {
  return loadList();
}

function addGif(url) {
  const u = String(url || '').trim();
  if (!/^https?:\/\//i.test(u)) return { error: 'That does not look like a URL.' };
  const list = loadList();
  if (list.includes(u)) return { error: 'That GIF is already on the list.' };
  list.push(u);
  saveList(list);
  return { ok: true, count: list.length };
}

function removeGif(which) {
  const list = loadList();
  const q = String(which || '').trim();
  let idx = -1;
  if (/^\d+$/.test(q)) {
    idx = parseInt(q, 10) - 1; // 1-based for humans
  } else {
    idx = list.findIndex((u) => u === q || u.includes(q));
  }
  if (idx < 0 || idx >= list.length) return { error: 'Could not find that GIF. Use `!!bangifs list`.' };
  const removed = list.splice(idx, 1)[0];
  if (!list.length) {
    // never leave empty — fall back to defaults
    saveList(DEFAULT_GIFS.slice());
    return { ok: true, removed, count: DEFAULT_GIFS.length, reset: true };
  }
  saveList(list);
  return { ok: true, removed, count: list.length };
}

function pickGif() {
  const list = loadList();
  return list[Math.floor(Math.random() * list.length)] || DEFAULT_GIFS[0];
}

function payload(title, reason) {
  const gif = pickGif();
  if (isDirectImage(gif)) {
    const embed = new EmbedBuilder().setColor(0xe74c3c).setTitle(title).setImage(gif);
    if (reason) embed.setDescription(`**Reason:** ${reason}`);
    return { embeds: [embed] };
  }
  return {
    content: `🚫 **${title}**${reason ? `\n**Reason:** ${reason}` : ''}\n${gif}`,
  };
}

function canEmbed(channel) {
  if (!channel?.guild) return true; // DMs
  const me = channel.guild.members.me;
  return Boolean(me && channel.permissionsFor(me)?.has(PermissionFlagsBits.EmbedLinks));
}

const lastUserNotice = new Map();
const lastGuildNotice = new Map();

async function dmBannedUser(client, userId, reason) {
  try {
    const user = await client.users.fetch(userId);
    await user.send(payload(TITLE_USER, reason));
    return true;
  } catch {
    return false;
  }
}

async function replyToBannedUser(message) {
  const now = Date.now();
  if (now - (lastUserNotice.get(message.author.id) ?? 0) < 3000) return;
  lastUserNotice.set(message.author.id, now);
  if (lastUserNotice.size > 2000) lastUserNotice.clear();

  const body = canEmbed(message.channel)
    ? payload(TITLE_USER)
    : { content: "🚫 You've been banned from using the bot." };
  await message.reply(body).catch(() => {});
}

async function pickChannel(guild) {
  const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
  if (!me) return null;
  const ok = (c) =>
    c &&
    [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(c.type) &&
    c.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]);
  if (ok(guild.systemChannel)) return guild.systemChannel;
  return (
    guild.channels.cache
      .filter(ok)
      .sort((a, b) => a.rawPosition - b.rawPosition)
      .first() ?? null
  );
}

async function noticeAndLeave(guild, reason) {
  try {
    const channel = await pickChannel(guild);
    if (channel) {
      const body = canEmbed(channel)
        ? payload(TITLE_GUILD, reason)
        : {
            content: `🚫 This server has been banned from using the bot.${reason ? ` Reason: ${reason}` : ''}`,
          };
      await channel.send(body).catch(() => {});
    }
  } catch {
    /* still leave */
  }
  await guild.leave().catch(() => {});
}

async function noticeBannedGuild(guild, reason) {
  const now = Date.now();
  if (now - (lastGuildNotice.get(guild.id) ?? 0) < 30_000) return;
  lastGuildNotice.set(guild.id, now);
  await noticeAndLeave(guild, reason);
}

function slashReply(guildId) {
  const gif = pickGif();
  const g = guildId ? blacklist.isGuildBlocked(guildId) : null;
  if (g) return `🚫 This server has been banned from using the bot.\n**Reason:** ${g.reason}\n${gif}`;
  return `🚫 You've been banned from using the bot.\n${gif}`;
}

module.exports = {
  dmBannedUser,
  replyToBannedUser,
  noticeAndLeave,
  noticeBannedGuild,
  slashReply,
  listGifs,
  addGif,
  removeGif,
  pickGif,
  DEFAULT_GIFS,
};
