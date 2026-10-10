const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { data, saveNow } = require('./world');
const { activeList } = require('./modifiers');
const weather = require('./weather');
const { getActiveBounty, BOUNTY_TYPES } = require('./bounty');
const { fmt } = require('./economy');
const { meterInfo, currentUsurper } = require('./rebellion');
const { getNews } = require('./stocks');
const { logging } = require('./logging');

const unix = (ms) => Math.floor(ms / 1000);

function boardConfig() {
  data.settings ??= {};
  data.settings.realmBoard ??= { channelId: null, messageId: null };
  return data.settings.realmBoard;
}

function getBoardChannelId() {
  return boardConfig().channelId || null;
}

function setBoardChannel(channelId) {
  const b = boardConfig();
  b.channelId = channelId;
  b.messageId = null; // force a fresh message in the new channel
  saveNow();
}

function clearBoardChannel() {
  const b = boardConfig();
  b.channelId = null;
  b.messageId = null;
  saveNow();
}

function bountyLine() {
  const b = getActiveBounty();
  if (!b) return 'No active mark.';
  const t = BOUNTY_TYPES?.[b.type] || { emoji: '🎯', name: 'Bounty' };
  return (
    `${t.emoji} **${t.name}** on <@${b.targetId}> · reward **${fmt(b.reward)}** · ` +
    `ends <t:${unix(b.until)}:R>`
  );
}

function weatherLine() {
  const w = weather.current();
  return `${w.def.emoji} **${w.def.name}** — ${w.def.desc}\nEnds <t:${unix(w.until)}:R>. \`!!forecast\` for what's next.`;
}

function liveLines() {
  const live = activeList();
  if (!live.length) return '_No decrees or realm events running._';
  return live
    .map((e) => `${e.def.emoji} **${e.def.name}** — ends <t:${unix(e.until)}:R>`)
    .join('\n');
}

function throneLine() {
  const king = currentUsurper();
  const info = meterInfo();
  const throne = king
    ? `<@${king.id}> holds the throne until <t:${unix(king.until)}:R>`
    : 'The throne is empty.';
  return `${throne}\n🔥 Rebellion **${info.meter}/${info.goal}**${info.raid ? ' · **raid active**' : ''}`;
}

function recentLines() {
  const log = data.chronicle?.log || [];
  const recent = log.slice(-5).reverse();
  if (!recent.length) return '_Quiet so far._';
  return recent.map((e) => `<t:${unix(e.at)}:R> ${e.text}`).join('\n');
}

function marketLines() {
  const news = (getNews() || []).slice(0, 3);
  if (!news.length) return '_No headlines yet._';
  return news
    .map((n) => {
      const tag =
        n.kind === 'crash' ? '💥' :
        n.kind === 'buyout' ? '🤝' :
        n.kind === 'ipo' ? '🆕' :
        typeof n.pct === 'number' && n.pct < 0 ? '📉' :
        typeof n.pct === 'number' && n.pct > 0 ? '📈' : '•';
      return `${tag} <t:${unix(n.at)}:R> ${n.line}`;
    })
    .join('\n');
}

/** Build the single “Today in the Realm” embed (read-only snapshot). */
function buildBoardEmbed() {
  return new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle('🏰 Today in the Realm')
    .setDescription(
      'A living snapshot of the server — weather, law, marks, and recent headlines.\n' +
        'You don’t have to *play* anything to follow along.'
    )
    .addFields(
      { name: '🌤️ Weather', value: weatherLine() },
      { name: '📜 Decrees & events', value: liveLines() },
      { name: '🎯 Bounty', value: bountyLine() },
      { name: '👑 Throne & rebellion', value: throneLine() },
      { name: '📰 Market (latest)', value: marketLines() },
      { name: '📖 Recent chronicles', value: recentLines() }
    )
    .setFooter({
      text: 'This message updates itself · !!forecast · !!stocks news · !!bounty (if available)',
    })
    .setTimestamp(new Date());
}

/**
 * Ensure the board message exists and matches current state.
 * Creates the message if missing; otherwise edits it in place.
 */
async function refreshBoard(client) {
  const cfg = boardConfig();
  if (!cfg.channelId) return { ok: false, reason: 'unset' };

  let channel;
  try {
    channel = await client.channels.fetch(cfg.channelId);
  } catch {
    return { ok: false, reason: 'channel' };
  }
  if (!channel?.isTextBased()) return { ok: false, reason: 'channel' };

  const me = channel.guild?.members?.me ?? channel.permissionsFor?.(client.user);
  const perms = channel.permissionsFor(client.user);
  if (
    !perms?.has([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks,
    ])
  ) {
    return { ok: false, reason: 'perms' };
  }

  const embed = buildBoardEmbed();
  const payload = { embeds: [embed], content: null };

  // Try edit existing message
  if (cfg.messageId) {
    try {
      const msg = await channel.messages.fetch(cfg.messageId);
      await msg.edit(payload);
      return { ok: true, edited: true };
    } catch {
      cfg.messageId = null; // deleted or gone — post a new one
    }
  }

  // Need Manage Messages optional; posting always works with Send
  try {
    const msg = await channel.send(payload);
    cfg.messageId = msg.id;
    saveNow();
    // Optional: pin if we can (ignore failure)
    if (perms.has(PermissionFlagsBits.ManageMessages)) {
      await msg.pin().catch(() => {});
    }
    return { ok: true, edited: false, messageId: msg.id };
  } catch (err) {
    logging('warn', 'Realm board post failed', err.message || err);
    return { ok: false, reason: 'send', error: err.message };
  }
}

module.exports = {
  buildBoardEmbed,
  getBoardChannelId,
  setBoardChannel,
  clearBoardChannel,
  refreshBoard,
  boardConfig,
};
