const { isHidden, setHidden } = require('../lib/webexport');

module.exports = {
  name: '!!webhide',
  aliases: ['!!hideme'],
  usage: '!!webhide [on|off]',
  description: 'Hides you from the public website leaderboards (`on`), or shows you again (`off`). With no option it flips your current choice.',
  access: 'free',

  async run(message, arg) {
    const choice = (arg || '').trim().toLowerCase().split(/\s+/)[0];
    const hide = choice === 'on' ? true : choice === 'off' ? false : !isHidden(message.author.id);
    setHidden(message.author.id, hide);
    return message.reply(
      hide
        ? '🙈 You are now **hidden** from the website leaderboards. It takes effect at the next update (within about 15 minutes). Undo it with `!!webhide off`.'
        : '👀 You are now **visible** on the website leaderboards (for servers that have it turned on). Hide again with `!!webhide on`.'
    );
  },
};
