const conquest = require('../lib/conquest');
const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const { logging } = require('../lib/logging');
const storage = require('../lib/storage');

const CHECK_MS = 5 * 60 * 1000;

async function publishMap(client, guildId) {
  const snap = conquest.snapshot();
  if (!snap.channelId) return;
  const buffer = await conquest.buildMapBuffer();
  if (!buffer) return;

  const channel = await client.channels.fetch(snap.channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return;

  const file = new AttachmentBuilder(buffer, { name: 'campaign-map.png' });
  const embed = new EmbedBuilder()
    .setColor(0xc9a227)
    .setTitle(`Campaign · Turn ${snap.turn}`)
    .setDescription(snap.paused ? 'Paused' : `Next resolve <t:${Math.floor(snap.nextTickAt / 1000)}:R>`)
    .setImage('attachment://campaign-map.png');

  try {
    if (snap.mapMessageId) {
      const msg = await channel.messages.fetch(snap.mapMessageId).catch(() => null);
      if (msg) {
        await msg.edit({ embeds: [embed], files: [file] });
        return;
      }
    }
    const sent = await channel.send({ embeds: [embed], files: [file] });
    conquest.setMapMessageId(sent.id);
  } catch (err) {
    logging('warn', 'Campaign map update failed', err.message || err);
  }
}

module.exports = (client) => {
  const tickGuild = async (guildId) => {
    await storage.runIn(guildId, async () => {
      const snap = conquest.snapshot();
      if (!snap.active || snap.paused) return;
      if (Date.now() < (snap.nextTickAt || 0)) return;
      const result = conquest.resolveTick(guildId);
      if (result.skipped) return;
      logging('info', 'Campaign tick', `guild ${guildId} turn ${result.turn}`);
      await publishMap(client, guildId);
    });
  };

  const loop = async () => {
    for (const [guildId] of client.guilds.cache) {
      try {
        await tickGuild(guildId);
      } catch (err) {
        logging('error', 'Campaign tick error', err);
      }
    }
  };

  client.once('clientReady', () => setInterval(loop, CHECK_MS));
  client.once('ready', () => setInterval(loop, CHECK_MS));
};
