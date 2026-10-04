const { handleChat } = require('../lib/chat');

module.exports = (client, ctx) => {
  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const content = message.content.trim().toLowerCase();
    const cmdName = content.split(/\s+/)[0];
    const arg = content.slice(cmdName.length).trim();

    // Optional: set OWNER_ID to restrict the owner commands to just you
    const isOwner = Boolean(process.env.OWNER_ID) && message.author.id === process.env.OWNER_ID;
    const msgCtx = { ...ctx, isOwner };

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
      return command.run(message, arg, msgCtx);
    }

    // AI chat: only when pinged
    if (message.mentions.users.has(client.user.id)) return handleChat(message, msgCtx);
  });
};
