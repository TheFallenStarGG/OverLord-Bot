const { histories, lastAsked } = require('../lib/memory');
const { checkLimits } = require('../lib/usage');
const { respond } = require('../lib/chat');

module.exports = {
  name: '!!retry',
  usage: '!!retry',
  description: 'Answers the last question in this channel again with a different model.',
  access: 'free',

  async run(message, arg, ctx) {
    const channelId = message.channel.id;
    const last = lastAsked.get(channelId);
    const history = histories.get(channelId) ?? [];
    const n = history.length;

    if (!last || n < 2 || history[n - 1].role !== 'assistant' || history[n - 2].content !== last.savedUserMessage.content) {
      return message.reply('I have no recent question in this channel to retry.');
    }

    const blockedMsg = checkLimits(message.author.id, ctx.isOwner);
    if (blockedMsg) return message.reply(blockedMsg);

    return respond(message, {
      history: history.slice(0, -2), // the old answer is replaced by the new one
      userMessage: last.userMessage,
      savedUserMessage: last.savedUserMessage,
      hasImages: last.hasImages,
      exclude: [last.model],
    });
  },
};
