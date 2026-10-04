const { getChatThread, removeChatThread } = require('../lib/threads');
const { histories, lastAsked, saveHistories } = require('../lib/memory');
const { logging, whoWhere } = require('../lib/logging');

module.exports = {
  name: '!!endchat',
  usage: '!!endchat',
  description: 'Closes the chat thread you are in (only the person who started it, or the bot owner can). Archives the thread and forgets its memory.',
  access: 'free',

  async run(message, arg, ctx) {
    const thread = message.channel;
    const info = thread.isThread() ? getChatThread(thread.id) : null;

    if (!info) return message.reply('This only works inside a chat thread started with `!!chat`.');
    if (message.author.id !== info.creatorId && !ctx.isOwner) {
      return message.reply('Only the person who started this chat (or the bot owner) can close it.');
    }

    removeChatThread(thread.id);
    histories.delete(thread.id);
    lastAsked.delete(thread.id);
    saveHistories();

    await message.reply('Chat closed. 👋');
    logging('info', 'Chat thread closed', `${thread.name} by ${whoWhere(message)}`);
    await thread.setArchived(true).catch(() => {});
  },
};
