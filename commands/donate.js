const { EmbedBuilder } = require('discord.js');
const { DAILY_LIMIT } = require('../config');
const { CASH_APP, CASH_APP_URL } = require('../lib/donate');

module.exports = {
  name: '!!donate',
  usage: '!!donate',
  description: 'Support the bot! Donations help keep it running.',
  access: 'free',

  async run(message) {
    const embed = new EmbedBuilder()
      .setColor(0xff69b4)
      .setTitle('💖 Support The Overlord')
      .setDescription(
        `Donations are always welcome, and they really help!\n\n` +
          `Donations help keep The Overlord online.\n\n` +
          `💸 **[${CASH_APP}](${CASH_APP_URL})**\n\n` +
          `Thank you for keeping the realm running :3`
      );
    await message.reply({ embeds: [embed] });
  },
};
