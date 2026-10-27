const { latestEmbed, latestPayload, publishGazette, canvasAvailable } = require('../lib/gazette');

module.exports = {
  name: '!!gazette',
  usage: '!!gazette',
  description: "Shows the latest Overlord's Gazette (newspaper image + caption).",
  access: 'free',

  async run(message, arg, ctx) {
    if (arg === 'test') {
      if (!ctx.isOwner) return message.reply('Only the bot owner can do that.');
      await message.channel.sendTyping().catch(() => {});
      await publishGazette(message.client, { force: true, channel: message.channel });
      return;
    }

    await message.channel.sendTyping().catch(() => {});
    const payload = await latestPayload();
    if (!payload) {
      return message.reply(
        "No edition yet. First print is **00:05 UTC**. Owner: `!!gazette test`." +
          (canvasAvailable() ? '' : ' (Image renderer: install `@napi-rs/canvas`.)')
      );
    }
    return message.reply(payload);
  },
};
