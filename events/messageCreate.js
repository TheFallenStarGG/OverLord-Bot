const { handleChat } = require('../lib/chat');
const { logging, whoWhere } = require('../lib/logging');
const { isChatThread } = require('../lib/threads');

module.exports = (client, ctx) => {
  // Lets a command have extra names, like !!lb for !!leaderboard
  const aliasMap = new Map();
  for (const command of ctx.commands.values()) {
    for (const alias of command.aliases ?? []) aliasMap.set(alias, command);
  }

  async function handleMessage(message) {
    if (message.author.bot) return;

    const trimmed = message.content.trim();
    const first = trimmed.split(/\s+/)[0];
    const cmdName = first.toLowerCase();
    const rawArg = trimmed.slice(first.length).trim(); // keeps original capitalization
    const arg = rawArg.toLowerCase();
    const content = trimmed.toLowerCase();

    // Optional: set OWNER_ID to restrict the owner commands to just you
    const isOwner = Boolean(process.env.OWNER_ID) && message.author.id === process.env.OWNER_ID;
    const msgCtx = { ...ctx, isOwner, rawArg };

    // Some commands watch for follow-up messages (like the "proceed" confirmation)
    for (const command of ctx.commands.values()) {
      if (command.intercept && (await command.intercept(message, content))) {
        logging('info', 'Confirmed action', `${command.name} by ${whoWhere(message)}`);
        return;
      }
    }

    // Run a command if the message starts with one
    const command = ctx.commands.get(cmdName) ?? aliasMap.get(cmdName);
    if (command) {
      if (command.access !== 'free') {
        if (!process.env.OWNER_ID) {
          if (command.access === 'owner-required') {
            return message.reply('Set the `OWNER_ID` environment variable to your user ID to use this command.');
          }
        } else if (!isOwner) {
          logging('warn', 'Blocked command attempt', `${command.name} by ${whoWhere(message)} (not the owner)`);
          return; // not the owner: ignore silently
        }
      }

      logging('info', 'Command used', `${command.name} by ${whoWhere(message)}`);
      try {
        return await command.run(message, arg, msgCtx);
      } catch (err) {
        logging('error', `Command ${command.name} failed`, err);
        return message.reply('Something went wrong running that command.').catch(() => {});
      }
    }

    // AI chat: when pinged, or for any message in a chat thread (start a message with // to skip the bot)
    const inChatThread = message.channel.isThread() && isChatThread(message.channel.id);
    if (message.mentions.users.has(client.user.id) || (inChatThread && !trimmed.startsWith('//'))) {
      return handleChat(message, msgCtx);
    }
  }

  client.on('messageCreate', async (message) => {
    try {
      await handleMessage(message);
    } catch (err) {
      logging('error', 'Unexpected error handling a message', err);
    }
  });
};
