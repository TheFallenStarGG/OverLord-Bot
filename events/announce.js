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
            .setDescription(
              'Thanks for adding me! Everything runs on `!!` commands. Start with `!!help`, `!!daily`, and `!!work`.\n\n' +
                '**Admins:** run `!!events-channel #channel` to get the daily Gazette, world events, boss fights, and update notes there. ' +
                'I won\'t post any of that until you pick a channel.'
            ),
        ],
      });
    } catch (err) {
      logging('warn', 'Could not send the welcome message', err.message);
    }
  });
};
