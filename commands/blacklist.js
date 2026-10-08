const blacklist = require('../lib/blacklist');
const { logging } = require('../lib/logging');

const parseId = (text) => {
  const t = String(text ?? '');
  return (t.match(/^<@!?(\d{17,20})>$/) ?? t.match(/^(\d{17,20})$/))?.[1] ?? null;
};

module.exports = {
  name: '!!blacklist',
  aliases: ['!!bl'],
  usage: '!!blacklist <add|remove|list> [user|server] [id] [reason]',
  description: 'Owner only. Blocks a user or a whole server from using the bot. Blocked servers are left right away.',
  access: 'owner',

  async run(message, arg, ctx) {
    if (!ctx.isOwner) return;
    const usage =
      'Usage: `!!blacklist add user <@user|id> [reason]` · `!!blacklist add server <id> [reason]` · `!!blacklist remove user|server <id>` · `!!blacklist list`';
    const [action = 'list', kind, rawId, ...rest] = ctx.rawArg.split(/\s+/).filter(Boolean);
    const act = action.toLowerCase();

    if (act === 'list') {
      const { users, guilds } = blacklist.list();
      const row = ([id, e]) => `\`${id}\` — ${e.reason}`;
      const text = [
        `**Blocked users (${users.length})**`,
        users.length ? users.slice(0, 25).map(row).join('\n') : 'None',
        '',
        `**Blocked servers (${guilds.length})**`,
        guilds.length ? guilds.slice(0, 25).map(row).join('\n') : 'None',
      ].join('\n');
      return message.reply(text.slice(0, 1900));
    }

    const type = (kind ?? '').toLowerCase();
    if (!['add', 'remove'].includes(act) || !['user', 'server'].includes(type)) return message.reply(usage);

    const id = parseId(rawId);
    if (!id) return message.reply(`I need a user mention or an ID. ${usage}`);
    if (id === process.env.OWNER_ID || id === message.client.user.id) {
      return message.reply("I won't block the owner or myself.");
    }

    if (act === 'remove') {
      const had = type === 'user' ? blacklist.unblockUser(id) : blacklist.unblockGuild(id);
      if (had) logging('warn', `${type === 'user' ? 'User' : 'Server'} un-blacklisted`, id);
      return message.reply(had ? `✅ Removed \`${id}\` from the blacklist.` : `\`${id}\` wasn't on the blacklist.`);
    }

    const reason = rest.join(' ').slice(0, 200) || 'No reason given';
    if (type === 'user') {
      blacklist.blockUser(id, reason, message.author.id);
      logging('warn', 'User blacklisted', `${id} · ${reason}`);
      return message.reply(`🚫 Blocked user \`${id}\`. They can no longer use any command or earn XP.`);
    }

    blacklist.blockGuild(id, reason, message.author.id);
    logging('warn', 'Server blacklisted', `${id} · ${reason}`);
    const guild = message.client.guilds.cache.get(id);
    if (guild) await guild.leave().catch(() => {});
    return message.reply(`🚫 Blocked server \`${id}\`.${guild ? ` I left **${guild.name}**.` : ' I will leave it if I am ever added again.'}`);
  },
};
