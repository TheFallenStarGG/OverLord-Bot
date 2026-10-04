const { handleChat } = require('../lib/chat');
const { logError } = require('../lib/errorLog');

module.exports = (client, ctx) => {
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
      if (command.intercept && (await command.intercept(message, content))) return;
    }

    // Run a command if the message starts with one
    const command = ctx.commands.get(cmdName);
    if (command) {
      if (command.access !== 'free') {
        if (!process.env.OWNER_ID) {
          if (command.access === 'owner-required') {
            return message.reply('Set the `OWNER_ID` environment variable to your user ID to use this command.');
          }
        } else if (!isOwner) {
          return; // not the owner: ignore silently
        }
      }

      try {
        return await command.run(message, arg, msgCtx);
      } catch (err) {
        await logError(`Command ${cmdName} failed`, err);
        return message.reply('Something went wrong running that command.').catch(() => {});
      }
    }

    // AI chat: only when pinged
    if (message.mentions.users.has(client.user.id)) return handleChat(message, msgCtx);
  }

  client.on('messageCreate', async (message) => {
    try {
      await handleMessage(message);
    } catch (err) {
      await logError('Unexpected error handling a message', err);
    }
  });
};
