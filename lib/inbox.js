const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { FILES } = require('../config');
const { readJson, writeJson } = require('./storage');
const { logging } = require('./logging');

const KINDS = {
  report: { label: 'Report', emoji: '🐞', color: 0xe74c3c, prefix: 'R', cooldownMs: 2 * 60 * 1000 },
  feedback: { label: 'Feedback', emoji: '💡', color: 0x2ecc71, prefix: 'F', cooldownMs: 60 * 1000 },
};
const MIN_LEN = 10;
const MAX_LEN = 1500;

const cfg = readJson(FILES.inbox, {}); // { report: channelId, feedback: channelId }
const save = () => writeJson(FILES.inbox, cfg);
const lastSent = new Map(); // "kind:userId" -> time

const getChannelId = (kind) => cfg[kind] ?? null;
function setChannelId(kind, id) {
  cfg[kind] = id;
  save();
}
function clearChannelId(kind) {
  delete cfg[kind];
  save();
}

// Sends a report or feedback to the owner's channel. Returns { id } or { error }.
async function submit(client, kind, message, text) {
  const k = KINDS[kind];
  const body = String(text ?? '').trim();
  if (body.length < MIN_LEN) return { error: `Please write a little more (at least ${MIN_LEN} characters) so the owner can understand it.` };
  if (body.length > MAX_LEN) return { error: `That's too long. Please keep it under ${MAX_LEN} characters (yours is ${body.length}).` };

  const channelId = cfg[kind];
  if (!channelId) return { error: `${k.label}s aren't being collected right now. Try \`!!support\` to reach the support server instead.` };

  const key = `${kind}:${message.author.id}`;
  const wait = k.cooldownMs - (Date.now() - (lastSent.get(key) ?? 0));
  if (wait > 0) return { error: `⏳ Please wait ${Math.ceil(wait / 1000)}s before sending another ${kind}.` };

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased()) throw new Error('Not a text channel');
    const perms = channel.guild ? channel.permissionsFor(channel.guild.members.me) : null;
    if (perms && !perms.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
      throw new Error('Missing permissions in the inbox channel');
    }

    const id = `${k.prefix}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const embed = new EmbedBuilder()
      .setColor(k.color)
      .setTitle(`${k.emoji} New ${k.label.toLowerCase()} · ${id}`)
      .setDescription(body)
      .addFields(
        { name: 'From', value: `${message.author.username}\n<@${message.author.id}>\n\`${message.author.id}\``, inline: true },
        { name: 'Server', value: `${message.guild?.name ?? 'Unknown'}\n\`${message.guild?.id ?? '?'}\``, inline: true },
        { name: 'Context', value: message.url ? `[Jump to message](${message.url})` : 'No link', inline: true }
      )
      .setTimestamp();

    await channel.send({ embeds: [embed] });
    lastSent.set(key, Date.now());
    if (lastSent.size > 5000) lastSent.clear();
    logging('info', `${k.label} received`, `${id} from ${message.author.username}`);
    return { id };
  } catch (err) {
    logging('error', `Could not deliver a ${kind}`, err);
    return { error: `I couldn't deliver that right now. Try \`!!support\` instead.` };
  }
}

module.exports = { KINDS, getChannelId, setChannelId, clearChannelId, submit };
