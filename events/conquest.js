const conquest = require('../lib/conquest');
const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const { logging } = require('../lib/logging');

const CHECK_MS = 5 * 60 * 1000;
let ticking = false;

async function publishAllMaps(client) {
  const snap = conquest.snapshot();
  const buffer = await conquest.buildMapBuffer();
  if (!buffer) return;

  const file = new AttachmentBuilder(buffer, { name: 'campaign-map.png' });
  const embed = new EmbedBuilder()
    .setColor(0xc9a227)
    .setTitle(`World Campaign · Turn ${snap.turn}`)
    .setDescription(snap.paused ? 'Paused' : `Next resolve <t:${Math.floor(snap.nextTickAt / 1000)}:R>`)
    .setImage('attachment://campaign-map.png');

  for (const [guildId, channelId] of Object.entries(snap.channels || {})) {
    try {
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel?.isTextBased?.()) continue;
      const mid = snap.mapMessages?.[guildId];
      if (mid) {
        const msg = await channel.messages.fetch(mid).catch(() => null);
        if (msg) {
          await msg.edit({ embeds: [embed], files: [file] });
          continue;
        }
      }
      const sent = await channel.send({ embeds: [embed], files: [file] });
      conquest.setMapMessageId(guildId, sent.id);
    } catch (err) {
      logging('warn', 'Campaign map update failed', `${guildId}: ${err.message || err}`);
    }
  }
}

module.exports = (client) => {
  const loop = async () => {
    if (ticking) return;
    ticking = true;
    try {
      const snap = conquest.snapshot();
      if (!snap.active || snap.paused) return;
      if (Date.now() < (snap.nextTickAt || 0)) return;
      const result = conquest.resolveTick();
      if (result.skipped) return;
      logging('info', 'Campaign tick', `world turn ${result.turn}`);
      await publishAllMaps(client);
    } catch (err) {
      logging('error', 'Campaign tick error', err);
    } finally {
      ticking = false;
    }
  };

  client.once('clientReady', () => setInterval(loop, CHECK_MS));
  client.once('ready', () => setInterval(loop, CHECK_MS));
};
