const { MAX_HISTORY } = require('../config');
const { isChatThread, addChatThread } = require('../lib/threads');
const { logging, whoWhere } = require('../lib/logging');

const COOLDOWN_MS = 30 * 1000;
const cooldowns = new Map(); // userId -> last time they started a chat

module.exports = {
  name: '!!chat',
  usage: '!!chat <topic>',
  description:
    'Starts a chat thread where I answer every message without needing a ping. The topic becomes the thread name. Start a message with `//` to talk without me answering, and use `!!endchat` to close it.',
  access: 'free',

  async run(message, arg, ctx) {
    if (!message.guild) return message.reply('Chat threads only work in servers.');

    if (message.channel.isThread()) {
      return message.reply(
        isChatThread(message.channel.id)
          ? "You're already in a chat thread, so just type!"
          : "I can't start a chat inside another thread. Use this in a normal channel."
      );
    }

    const wait = (cooldowns.get(message.author.id) ?? 0) + COOLDOWN_MS - Date.now();
    if (wait > 0 && !ctx.isOwner) {
      return message.reply(`Slow down! You can start another chat in ${Math.ceil(wait / 1000)}s.`);
    }

    const topic = ctx.rawArg.trim();
    const name = (topic || `Chat with ${message.member?.displayName ?? message.author.username}`).slice(0, 90);

    try {
      const thread = await message.startThread({ name, autoArchiveDuration: 1440 });
      cooldowns.set(message.author.id, Date.now());
      addChatThread(thread.id, message.author.id);

      await thread.send(
        `👋 Chat started! Just type here and I'll answer every message. ` +
        `Start a message with \`//\` to talk without me answering, and use \`!!endchat\` to close this thread. ` +
        `I remember the last ${MAX_HISTORY} messages in here.`
      );
      logging('info', 'Chat thread created', `${thread.name} by ${whoWhere(message)}`);
    } catch (err) {
      logging('error', 'Could not create a chat thread', err);
      return message.reply(
        "I couldn't create a thread here. I need the **Create Public Threads** and **Send Messages in Threads** permissions in this channel."
      );
    }
  },
};
