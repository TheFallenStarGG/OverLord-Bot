const { allow, deny, list } = require('../lib/redditAllow');

module.exports = {
  name: '!!allow-18',
  usage: '!!allow-18 [@user | remove @user | list]',
  description: 'Owner only. Who may use !!r, !!e621 and !!rule34.',
  access: 'owner',
  hidden: true,

  async run(message, arg, ctx) {
    if (!ctx.isOwner) return;

    const sub = (arg || '').trim().toLowerCase();
    const target = message.mentions.users.first();

    if (!sub || sub === 'list') {
      const ids = list();
      if (!ids.length) return message.reply('Nobody is on the `!!allow-18` list yet.');
      return message.reply(`\`!!allow-18\` list:\n${ids.map((id) => `• <@${id}> (\`${id}\`)`).join('\n')}`);
    }

    if (sub.startsWith('remove') || sub.startsWith('deny') || sub.startsWith('revoke')) {
      if (!target) return message.reply('Usage: `!!allow-18 remove @user`');
      const ok = deny(target.id);
      return message.reply(ok ? `Removed **${target.tag}** from the \`!!allow-18\` list.` : `**${target.tag}** was not on the list.`);
    }

    // !!allow-18 @user
    if (!target) return message.reply('Usage: `!!allow-18 @user` · `!!allow-18 remove @user` · `!!allow-18 list`');
    if (target.bot) return message.reply('Bots can’t be added.');

    const ok = allow(target.id);
    return message.reply(ok ? `**${target.tag}** can use \`!!r\`, \`!!e621\` and \`!!rule34\` now.` : `**${target.tag}** is already allowed.`);
  },
};
