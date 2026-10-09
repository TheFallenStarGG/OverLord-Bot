const { allow, deny, list } = require('../lib/redditAllow');

module.exports = {
  name: '!!allow-r',
  usage: '!!allow-r [@user | remove @user | list]',
  description: 'Owner only. Who may use !!r.',
  access: 'owner', // or 'owner-required' if that's what your other owner cmds use
  hidden: true,

  async run(message, arg, ctx) {
    if (!ctx.isOwner) return;

    const sub = (arg || '').trim().toLowerCase();
    const target = message.mentions.users.first();

    if (!sub || sub === 'list') {
      const ids = list();
      if (!ids.length) return message.reply('Nobody is on the `!!r` allowlist yet.');
      return message.reply(`\`!!r\` allowlist:\n${ids.map((id) => `• <@${id}> (\`${id}\`)`).join('\n')}`);
    }

    if (sub.startsWith('remove') || sub.startsWith('deny') || sub.startsWith('revoke')) {
      if (!target) return message.reply('Usage: `!!allow-r remove @user`');
      const ok = deny(target.id);
      return message.reply(ok ? `Removed **${target.tag}** from \`!!r\`.` : `**${target.tag}** was not on the list.`);
    }

    // !!allow-r @user
    if (!target) return message.reply('Usage: `!!allow-r @user` · `!!allow-r remove @user` · `!!allow-r list`');
    if (target.bot) return message.reply('Bots can’t use `!!r`.');

    const ok = allow(target.id);
    return message.reply(ok ? `**${target.tag}** can use \`!!r\` now.` : `**${target.tag}** is already allowed.`);
  },
};
