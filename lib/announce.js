const { PermissionFlagsBits } = require('discord.js');
const { FILES } = require('../config');
const { readJson, writeJson } = require('./storage');
const { ENTRIES, entryId, buildAnnouncement } = require('./changelog');
const { logging } = require('./logging');

// guildId -> { channelId, lastId }  (lastId = the newest update already announced there)
const guilds = readJson(FILES.announce, {});
const save = () => writeJson(FILES.announce, guilds);
const latestId = () => (ENTRIES[0] ? entryId(ENTRIES[0]) : null);

const getChannel = (guildId) => guilds[guildId]?.channelId ?? null;

// Marks the current newest update as already announced, so only FUTURE updates ping
function setChannel(guildId, channelId) {
  guilds[guildId] = { channelId, lastId: latestId() };
  save();
}

function clearChannel(guildId) {
  delete guilds[guildId];
  save();
}

// Runs once at startup: posts the newest update to every server that hasn't seen it yet
async function announceNewChangelog(client) {
  const latest = ENTRIES[0];
  if (!latest) return;
  const id = entryId(latest);

  for (const [guildId, cfg] of Object.entries(guilds)) {
    if (!cfg.channelId || cfg.lastId === id) continue;
    try {
      const channel = await client.channels.fetch(cfg.channelId);
      if (!channel?.isTextBased()) throw new Error('Channel is missing or not a text channel');

      const perms = channel.permissionsFor(client.user);
      if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
        throw new Error('Missing View Channel / Send Messages / Embed Links in that channel');
      }
      

      await channel.send({ embeds: [buildAnnouncement(latest)] });
      cfg.lastId = id;
      save();
      logging('info', 'Announced new update', `${latest.title} in ${channel.name} (${guildId})`);
    } catch (err) {
      logging('warn', 'Could not announce update', `${guildId}: ${err.message}`);
    }
  }
}

const channelIds = () => [...new Set(Object.values(guilds).map((g) => g.channelId).filter(Boolean))];

const failures = new Map(); // channelId -> failures in a row (resets on restart)

// Sends a message to every channel set with !!events-channel
async function broadcast(client, payload) {
  for (const [guildId, cfg] of Object.entries(guilds)) {
    if (!cfg.channelId) continue;
    try {
      const channel = await client.channels.fetch(cfg.channelId);
      if (!channel?.isTextBased()) throw new Error('Not a text channel');
      await channel.send(payload);
      failures.delete(cfg.channelId);
    } catch (err) {
      const count = (failures.get(cfg.channelId) ?? 0) + 1;
      failures.set(cfg.channelId, count);
      if (count >= 5) {
        delete guilds[guildId];
        save();
        failures.delete(cfg.channelId);
        logging('warn', 'Removed an unreachable events channel', `${guildId}: ${err.message}`);
      }
    }
  }
}

module.exports = { getChannel, setChannel, clearChannel, announceNewChangelog, channelIds, broadcast };
