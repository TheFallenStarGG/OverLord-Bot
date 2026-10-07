const { EmbedBuilder } = require('discord.js');
const { DAILY_LIMIT } = require('../config');
const { CASH_APP, CASH_APP_URL } = require('../lib/donate');

module.exports = {
  name: '!!donate',
  usage: '!!donate',
  description: 'Support the bot! Donations help raise the AI usage limit.',
  access: 'free',

  async run(message) {
    const embed = new EmbedBuilder()
      .setColor(0xff69b4)
      .setTitle('💖 Support The Overlord')
      .setDescription(
        `Donations are always welcome, and they really help!\n\n` +
          `Every donation helps increase the AI usage limit, so more people can chat with me each day (it is currently **${DAILY_LIMIT}** requests per day).\n\n` +
          `💸 **[${CASH_APP}](${CASH_APP_URL})**\n\n` +
          `Thank you for keeping the realm running :3`
      );
    await message.reply({ embeds: [embed] });
  },
};
