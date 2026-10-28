const { ChannelType, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { announceNewChangelog, clearChannel } = require('../lib/announce');
const { logging } = require('../lib/logging');

module.exports = (client) => {
  let ran = false;
  const onReady = () => {
    if (ran) return;
    ran = true;
    announceNewChangelog(client);
  };
  client.once('clientReady', onReady);
  client.once('ready', onReady);

  // Forget a server's settings when the bot is removed
  client.on('guildDelete', (guild) => clearChannel(guild.id));

  // Say hello in a new server
  client.on('guildCreate', async (guild) => {
    try {
      const me = guild.members.me ?? (await guild.members.fetchMe());
      const canSend = (c) =>
        c.type === ChannelType.GuildText &&
        c.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]);
      const channel = guild.systemChannel && canSend(guild.systemChannel) ? guild.systemChannel : guild.channels.cache.find(canSend);
      if (!channel) return;

      await channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0xd4af37)
            .setTitle('👑 The Overlord has arrived')
                'Thanks for the invite. Commands use `!!` (slash is experimental).\n\n' +
                '**New here:** `!!tutorial` · `!!help` · `!!daily` · `!!work`\n' +
                '**War gamemode:** `!!campaign` — shared world map across servers\n' +
                '**Free coins:** vote on top.gg then `!!vote` (every 12h)\n\n' +
                '**Admins:** `!!events-channel #channel` for Gazette, bosses, and world posts. ' +
                'Nothing posts until you set that.\n' +
                '`!!tutorial admin` for setup. Site: https://thefallenstargg.github.io/Overlord-Website/\n\n' +
                'Raids are on by default. Opt out: `!!raid-config optout`. Category: `!!raid-config category <name>`.'
        ],
      });
    } catch (err) {
      logging('warn', 'Could not send the welcome message', err.message);
    }
  });
};
