const { EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const blacklist = require('./blacklist');

// Change this one line to change the ban GIF everywhere.
// A direct image link (ends in .gif) is shown inside an embed.
// A page link (like klipy.com/...) is posted as a link and Discord turns it into the GIF.
const BAN_GIF = 'https://klipy.com/gifs/ban-you';

const TITLE_USER = "You've been banned from using this bot";
const TITLE_GUILD = 'This server has been banned from using this bot';

const isDirectImage = (url) => /\.(gif|png|jpe?g|webp)(\?.*)?$/i.test(url);

function payload(title, reason) {
  if (isDirectImage(BAN_GIF)) {
    const embed = new EmbedBuilder().setColor(0xe74c3c).setTitle(title).setImage(BAN_GIF);
    if (reason) embed.setDescription(`**Reason:** ${reason}`);
    return { embeds: [embed] };
  }
  return { content: `🚫 **${title}**${reason ? `\n**Reason:** ${reason}` : ''}\n${BAN_GIF}` };
}

function canEmbed(channel) {
  if (!channel?.guild) return true; // DMs
  const me = channel.guild.members.me;
  return Boolean(me && channel.permissionsFor(me)?.has(PermissionFlagsBits.EmbedLinks));
}

const lastUserNotice = new Map();
const lastGuildNotice = new Map();

// DMs a freshly banned user. Returns true if the DM went through.
async function dmBannedUser(client, userId, reason) {
  try {
    const user = await client.users.fetch(userId);
    await user.send(payload(TITLE_USER, reason));
    return true;
  } catch {
    return false;
  }
}

// Said every time a banned user runs a command (no reason, to keep it short)
async function replyToBannedUser(message) {
  const now = Date.now();
  if (now - (lastUserNotice.get(message.author.id) ?? 0) < 3000) return;
  lastUserNotice.set(message.author.id, now);
  if (lastUserNotice.size > 2000) lastUserNotice.clear();

  const body = canEmbed(message.channel) ? payload(TITLE_USER) : { content: "🚫 You've been banned from using the bot." };
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
  return guild.channels.cache.filter(ok).sort((a, b) => a.rawPosition - b.rawPosition).first() ?? null;
}

// Posts the ban message (GIF + reason) in the server, then leaves it
async function noticeAndLeave(guild, reason) {
  try {
    const channel = await pickChannel(guild);
    if (channel) {
      const body = canEmbed(channel)
        ? payload(TITLE_GUILD, reason)
        : { content: `🚫 This server has been banned from using the bot.${reason ? ` Reason: ${reason}` : ''}` };
      await channel.send(body).catch(() => {});
    }
  } catch {
    /* still leave below */
  }
  await guild.leave().catch(() => {});
}

// A command was run in a server that is banned but the bot is still in
async function noticeBannedGuild(guild, reason) {
  const now = Date.now();
  if (now - (lastGuildNotice.get(guild.id) ?? 0) < 30_000) return;
  lastGuildNotice.set(guild.id, now);
  await noticeAndLeave(guild, reason);
}

// For slash commands (the reply is a plain message)
function slashReply(guildId) {
  const g = guildId ? blacklist.isGuildBlocked(guildId) : null;
  if (g) return `🚫 This server has been banned from using the bot.\n**Reason:** ${g.reason}\n${BAN_GIF}`;
  return `🚫 You've been banned from using the bot.\n${BAN_GIF}`;
}

module.exports = { BAN_GIF, dmBannedUser, replyToBannedUser, noticeAndLeave, noticeBannedGuild, slashReply };
