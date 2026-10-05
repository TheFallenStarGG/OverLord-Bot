const { joinTournament, leaveTournament, tournamentInfo, startTournament, cancelTournament } = require('../lib/tournament');

module.exports = {
  name: '!!tournament',
  usage: '!!tournament [join|leave]',
  description: 'A weekly single-elimination bracket every Saturday at 18:00 UTC. Entry costs 200 coins, there are no gear or items, and the winner takes 70% of the prize pool.',
  access: 'free',

  async run(message, arg, ctx) {
    const sub = arg.trim();

    if (!sub) return message.reply(tournamentInfo());
    if (sub === 'join') {
      const result = joinTournament(message.author.id, message.channel.id);
      return message.reply(result.error ?? result.text);
    }
    if (sub === 'leave') {
      const result = leaveTournament(message.author.id);
      return message.reply(result.error ?? result.text);
    }

    // Owner controls (needs OWNER_ID)
    if (sub === 'start' || sub === 'cancel') {
      if (!ctx.isOwner) return message.reply('Only the bot owner can do that.');
      const result = sub === 'start' ? await startTournament(ctx.client) : await cancelTournament();
      return message.reply(result.error ?? result.text);
    }
    await message.reply('Use `!!tournament`, `!!tournament join`, or `!!tournament leave`.');
  },
};
