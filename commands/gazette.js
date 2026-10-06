const { latestEmbed, publishGazette } = require('../lib/gazette');

module.exports = {
  name: '!!gazette',
  usage: '!!gazette',
  description: "Shows the latest edition of the Overlord's Gazette, the daily newspaper that comes out at 00:05 UTC.",
  access: 'free',

  async run(message, arg, ctx) {
    if (arg === 'test') {
      if (!ctx.isOwner) return message.reply('Only the bot owner can do that.');
      await message.channel.sendTyping().catch(() => {});
      await publishGazette(message.client, { force: true, channel: message.channel });
      return;
    }

    const embed = latestEmbed();
    if (!embed) return message.reply("📰 No edition has been printed yet. The first Gazette comes out at 00:05 UTC. (The owner can preview one with `!!gazette test`.)");
    return message.reply({ embeds: [embed] });
  },
};
