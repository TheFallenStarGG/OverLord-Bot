const { logging, whoWhere } = require('../lib/logging');
const { maybeNudge } = require('../lib/donate');
const { handleConfirm } = require('../lib/confirm');
const guard = require('../lib/guard');
const blacklist = require('../lib/blacklist');
const banNotice = require('../lib/banNotice');
const prefixLib = require('../lib/prefix');

const lastOwnerOnlyNotice = new Map();

module.exports = (client, ctx) => {
  // Lets a command have extra names, like !!lb for !!leaderboard
  const aliasMap = new Map();
  for (const command of ctx.commands.values()) {
    for (const alias of command.aliases ?? []) aliasMap.set(alias, command);
  }

  async function handleMessage(message) {
    if (message.author.bot) return;

    const original = message.content.trim();
    const prefix = message.guild ? prefixLib.get() : prefixLib.DEFAULT;
    const isBangHelp = /^!!help(\s|$)/i.test(original);

    // Servers with their own prefix: "<prefix>daily" is treated as "!!daily" internally.
    // "!!anything" (except !!help) is ignored there so it can't clash with other bots.
    let trimmed = original;
    let foreignBang = false;
    if (prefix !== prefixLib.DEFAULT && !isBangHelp) {
      if (original.toLowerCase().startsWith(prefix.toLowerCase())) {
        trimmed = prefixLib.DEFAULT + original.slice(prefix.length);
      } else if (original.startsWith(prefixLib.DEFAULT)) {
        foreignBang = true;
      }
    }

    const first = trimmed.split(/\s+/)[0];
    const cmdName = first.toLowerCase();
    const rawArg = trimmed.slice(first.length).trim(); // keeps original capitalization
    const arg = rawArg.toLowerCase();
    const content = original.toLowerCase(); // confirmations and follow-ups use the text as typed

    const isOwner = Boolean(process.env.OWNER_ID) && message.author.id === process.env.OWNER_ID;
    const command = foreignBang ? undefined : ctx.commands.get(cmdName) ?? aliasMap.get(cmdName);
    const msgCtx = { ...ctx, isOwner, rawArg, prefix, usedName: command?.name };

    if (command && trimmed !== original) {
      message.content = trimmed; // commands that re-read message.content see the "!!" form
    }
    if (command && prefix !== prefixLib.DEFAULT) {
      // Hints in replies ("try !!daily") show this server's prefix
      const sendReply = message.reply.bind(message);
      message.reply = (payload) => sendReply(prefixLib.localize(payload, prefix));
    }

    // Banned servers and users: ignored, except that a command attempt gets the ban message
    if (!isOwner) {
      const guildBan = message.guild ? blacklist.isGuildBlocked(message.guild.id) : null;
      const userBan = blacklist.isUserBlocked(message.author.id);
      if (guildBan || userBan) {
        if (command) {
          if (guildBan) await banNotice.noticeBannedGuild(message.guild, guildBan.reason);
          else await banNotice.replyToBannedUser(message);
        }
        return;
      }
    }

    // Opted out: only !!optin works (including the bot owner)
    if (message.guild) {
      const optOutLib = require('../lib/optOut');
      if (optOutLib.isOptedOut(message.author.id)) {
        const isOptIn =
          command &&
          (command.name === '!!optin' ||
            command.name === '!!opt-in' ||
            (command.aliases || []).includes('!!optin') ||
            (command.aliases || []).includes('!!opt-in'));
        if (!isOptIn) {
          if (command) {
            await message
              .reply('You opted out of this bot in this server. Use `!!optin` to come back (you start from zero).')
              .catch(() => {});
          }
          return;
        }
      }
    }

    // Pending yes/no confirms (large give, cashout, deletedata, etc.)
    if (await handleConfirm(message, content)) return;

    // Some commands watch for follow-up messages (like confirmations)
    for (const c of ctx.commands.values()) {
      if (c.intercept && (await c.intercept(message, content))) {
        logging('info', 'Confirmed action', `${c.name} by ${whoWhere(message)}`);
        return;
      }
    }

    if (!command) return;

    // Owner commands: if OWNER_ID isn't set, nobody gets them
    if (command.access !== 'free' && !isOwner) {
      logging('warn', 'Blocked command attempt', `${command.name} by ${whoWhere(message)} (not the owner)`);
      const now = Date.now();
      if (!command.hidden && now - (lastOwnerOnlyNotice.get(message.author.id) ?? 0) > 5000) {
        lastOwnerOnlyNotice.set(message.author.id, now);
        if (lastOwnerOnlyNotice.size > 2000) lastOwnerOnlyNotice.clear();
        await message.reply('🔒 That command is owner-only.').catch(() => {});
      }
      return;
    }

    // Flood limit, missing permissions, and abuse tracking
    const check = await guard.preflight(message, command, { isOwner });
    if (!check.ok) {
      if (check.reply) await message.reply(check.reply).catch(() => {});
      return;
    }

    logging('info', 'Command used', `${command.name} by ${whoWhere(message)}`);
    try {
      await command.run(message, arg, msgCtx);
      if (message.guild) {
        try {
          require('../lib/activity').touch(
            message.author.id,
            message.guild.id,
            message.channel.id
          );
        } catch (_) {}
      }
      if (command.name !== '!!donate') maybeNudge(message);
    } catch (err) {
      message.reply(guard.friendlyError(err, command.name)).catch(() => {});
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
