const { runChallengeCommand } = require('../lib/games/common');
const duelGame = require('../lib/games/duel');

module.exports = {
  name: '!!duel',
  usage: '!!duel @user [bet] [ranked] [bo3]',
  description:
    'Challenges someone to a duel. Pick a class, then choose moves in secret each round. Your gear and battle items count! ' +
    'Add `ranked` for equal gear with no bets (the only mode that counts for the ladder), or `bo3` for best of 3.',
  access: 'free',

  async run(message, arg, ctx) {
    const tokens = ctx.rawArg.split(/\s+/).filter(Boolean);
    const options = ['ranked', 'bo3', 'bestof3'];
    const ranked = tokens.some((t) => t.toLowerCase() === 'ranked');
    const bo3 = tokens.some((t) => ['bo3', 'bestof3'].includes(t.toLowerCase()));
    const rest = tokens.filter((t) => !options.includes(t.toLowerCase()));

    const opponent = message.mentions.users.first();
    if (ranked && rest.some((t) => !/^<@!?\d+>$/.test(t))) {
      return message.reply('Ranked duels have no bets, since everyone fights with equal gear. Leave out the bet!');
    }
    if (opponent) duelGame.setOptions(message.author.id, opponent.id, { ranked, bestOf: bo3 ? 3 : 1 });

    const extra = `${ranked ? ' 🏅 *Ranked: equal gear, no bets*' : ''}${bo3 ? ' · best of 3' : ''}`;
    return runChallengeCommand(message, { ...ctx, rawArg: rest.join(' ') }, {
      type: 'duel',
      title: `⚔️ **Duel challenge**${extra}`,
      usage: 'Usage: `!!duel @user [bet] [ranked] [bo3]`',
    });
  },
};
