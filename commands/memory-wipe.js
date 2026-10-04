const { CONFIRM_WINDOW_MS } = require('../config');
const { histories, saveHistories } = require('../lib/memory');

const pending = new Map(); // "channelId:userId" -> expiry timestamp
const keyFor = (message) => `${message.channel.id}:${message.author.id}`;

module.exports = {
  name: '!!memory-wipe',
  usage: '!!memory-wipe',
  description: 'Erases my memory of this channel. Asks you to reply `proceed` to confirm.',
  access: 'owner',

  // Watches the follow-up message: "proceed" confirms, anything else cancels
  async intercept(message, content) {
    const key = keyFor(message);
    if (!pending.has(key)) return false;

    const expiresAt = pending.get(key);
    pending.delete(key); // any message uses up the pending request

    if (Date.now() <= expiresAt && content === 'proceed') {
      histories.delete(message.channel.id);
      saveHistories();
      await message.reply('Memory for this channel has been wiped.');
      return true;
    }
    return false; // cancelled: the message is then handled normally
  },

  async run(message) {
    const stored = histories.get(message.channel.id)?.length ?? 0;
    if (!stored) return message.reply('There is no saved memory in this channel to wipe.');

    pending.set(keyFor(message), Date.now() + CONFIRM_WINDOW_MS);
    return message.reply(
      `⚠️ **Warning:** this will permanently erase my memory of this channel (${stored} saved messages). ` +
      `This cannot be undone.\nReply **proceed** within ${CONFIRM_WINDOW_MS / 1000} seconds to confirm. ` +
      `Anything else cancels it.`
    );
  },
};
