const { forecastEmbed } = require('../lib/weather');

module.exports = {
  name: '!!forecast',
  aliases: ['!!weather'],
  usage: '!!forecast',
  description: 'See the current weather and what is coming next. Weather changes fishing, mining, and robberies.',
  access: 'free',

  async run(message) {
    await message.reply({ embeds: [forecastEmbed()] });
  },
};
