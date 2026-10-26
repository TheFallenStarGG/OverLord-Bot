const banNotice = require('../lib/banNotice');

module.exports = {
  name: '!!bangifs',
  aliases: ['!!bangif', '!!ban-gifs'],
  description: 'Owner only: list / add / remove ban GIFs.',
  usage: '!!bangifs [list|add <url>|remove <number|url>]',
  access: 'owner',
  async run(message, arg, ctx) {
    const raw = (ctx.rawArg || '').trim();
    const [action, ...rest] = raw.split(/\s+/);
    const a = (action || 'list').toLowerCase();

    if (a === 'list' || a === 'view' || a === 'show' || !action) {
      const list = banNotice.listGifs();
      const lines = list.map((u, i) => `**${i + 1}.** ${u}`);
      const text =
        `🎬 **Ban GIFs** (${list.length})\n` +
        lines.join('\n') +
        `\n\n\`!!bangifs add <url>\` · \`!!bangifs remove <number>\``;
      return message.reply(text.slice(0, 1900));
    }

    if (a === 'add') {
      const url = rest.join(' ').trim();
      if (!url) return message.reply('Usage: `!!bangifs add https://klipy.com/gifs/...`');
      const r = banNotice.addGif(url);
      if (r.error) return message.reply(r.error);
      return message.reply(`✅ Added. List now has **${r.count}** GIF(s).`);
    }

    if (a === 'remove' || a === 'rm' || a === 'del') {
      const which = rest.join(' ').trim();
      if (!which) return message.reply('Usage: `!!bangifs remove 3` or `!!bangifs remove klipy.com/gifs/rowan-banned`');
      const r = banNotice.removeGif(which);
      if (r.error) return message.reply(r.error);
      return message.reply(
        `✅ Removed:\n${r.removed}\n**${r.count}** left.` +
          (r.reset ? '\n(List was empty, restored the default set.)' : '')
      );
    }

    return message.reply('Usage: `!!bangifs list` · `!!bangifs add <url>` · `!!bangifs remove <number|url>`');
  },
};
