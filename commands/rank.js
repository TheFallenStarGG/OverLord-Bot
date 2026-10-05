const { peekUser, levelFromXp, xpForLevel, rankOf } = require('../lib/economy');
const { ITEMS } = require('../lib/items');

module.exports = {
  name: '!!rank',
  usage: '!!rank [@user]',
  description: 'Shows your level, XP progress, prestige, and title. You earn XP by chatting.',
  access: 'free',

  async run(message) {
    const target = message.mentions.users.first() ?? message.author;
    if (target.bot) return message.reply("Bots don't earn XP.");

    const u = peekUser(target.id);
    const level = levelFromXp(u.xp);
    const base = xpForLevel(level);
    const next = xpForLevel(level + 1);
    const filled = Math.floor(((xp(u) - base) / (next - base)) * 10);
    const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);

    const badge = u.prestige ? ` ✨ Prestige ${u.prestige}` : '';
    const title = u.title && ITEMS[u.title] ? ` · ${ITEMS[u.title].name}` : '';

    await message.reply(
      `📈 **${target.username}**${badge}${title} — Level **${level}**\n${bar} ${xp(u) - base} / ${next - base} XP to level ${level + 1}\n` +
      `-# ${xp(u).toLocaleString('en-US')} XP total · #${rankOf(target.id, 'xp')} on \`!!leaderboard\``
    );
  },
};

function xp(user) {
  return user.xp;
}
