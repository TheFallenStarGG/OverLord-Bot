const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
  name: '!!support',
  usage: '!!support',
  description: 'Gets help, report a bug, or ask a question about the bot.',
  access: 'free',

  async run(message) {
    const url = process.env.SUPPORT_URL;
    const tips = 'New here? Try `!!tutorial`. Browse everything with `!!help`.';
    if (!url) return message.reply(`💬 There's no support server set up yet. ${tips}`);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('Join the support server').setStyle(ButtonStyle.Link).setURL(url)
    );
    return message.reply({ content: `💬 Need help or found a bug? Join the support server!\n${tips}`, components: [row] });
  },
};
