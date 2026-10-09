const { ActionRowBuilder, ButtonBuilder, ButtonStyle, OAuth2Scopes, PermissionFlagsBits } = require('discord.js');

module.exports = {
  name: '!!invite',
  usage: '!!invite',
  description: 'Gets the link to add this bot to your own server.',
  access: 'free',

  async run(message) {
    const url = message.client.generateInvite({
      scopes: [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands],
      permissions: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.SendMessagesInThreads,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AddReactions,
        PermissionFlagsBits.UseExternalEmojis,
        PermissionFlagsBits.ManageRoles,
      ],
    });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('Add me to your server').setStyle(ButtonStyle.Link).setURL(url)
    );
    return message.reply({ content: '🤖 Want me in your own server? Use the button below!', components: [row] });
  },
};
