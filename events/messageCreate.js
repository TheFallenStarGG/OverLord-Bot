const { logging, whoWhere } = require('../lib/logging');
const { maybeNudge } = require('../lib/donate');

const FLOOD_MS = 1000; // one command per person per second
const lastCommandAt = new Map();

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

    const isOwner = Boolean(process.env.OWNER_ID) && message.author.id === process.env.OWNER_ID;
    const msgCtx = { ...ctx, isOwner, rawArg };

    // Some commands watch for follow-up messages (like confirmations)
    for (const command of ctx.commands.values()) {
      if (command.intercept && (await command.intercept(message, content))) {
        logging('info', 'Confirmed action', `${command.name} by ${whoWhere(message)}`);
        return;
      }
    }

    const command = ctx.commands.get(cmdName) ?? aliasMap.get(cmdName);
    if (!command) return;

    // Owner commands: if OWNER_ID isn't set, nobody gets them
    if (command.access !== 'free' && !isOwner) {
      logging('warn', 'Blocked command attempt', `${command.name} by ${whoWhere(message)} (not the owner)`);
      return;
    }

    // Simple flood guard
    if (!isOwner) {
      const now = Date.now();
      if (now - (lastCommandAt.get(message.author.id) ?? 0) < FLOOD_MS) return;
      lastCommandAt.set(message.author.id, now);
      if (lastCommandAt.size > 5000) lastCommandAt.clear();
    }

    logging('info', 'Command used', `${command.name} by ${whoWhere(message)}`);
    try {
      await command.run(message, arg, msgCtx);
      if (command.name !== '!!donate') maybeNudge(message);
    } catch (err) {
      logging('error', `Command ${command.name} failed`, err);
      message.reply('Something went wrong running that command.').catch(() => {});
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
