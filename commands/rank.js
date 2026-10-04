const { peekUser, levelFromXp, xpForLevel, rankOf } = require('../lib/economy');

module.exports = {
  name: '!!rank',
  usage: '!!rank [@user]',
  description: 'Shows your level and XP progress. You earn XP by chatting.',
  access: 'free',

  async run(message) {
    const target = message.mentions.users.first() ?? message.author;
    if (target.bot) return message.reply("Bots don't earn XP.");

    const xp = peekUser(target.id).xp;
    const level = levelFromXp(xp);
    const base = xpForLevel(level);
    const next = xpForLevel(level + 1);
    const filled = Math.floor(((xp - base) / (next - base)) * 10);
    const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);

    await message.reply(
      `📈 **${target.username}** — Level **${level}**\n${bar} ${xp - base} / ${next - base} XP to level ${level + 1}\n` +
      `-# ${xp.toLocaleString('en-US')} XP total · #${rankOf(target.id, 'xp')} on \`!!top\``
    );
  },
};
