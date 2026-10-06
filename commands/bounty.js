const { getActiveBounty, startBounty, endBounty, bountyEmbed } = require('../lib/bounty');
const { broadcast } = require('../lib/announce');

module.exports = {
  name: '!!bounty',
  usage: '!!bounty',
  description:
    'Shows the Overlord\'s current bounty. Beat the marked player in a `!!duel` to collect the reward. If they survive, they keep part of it.',
  access: 'free',

  async run(message, arg, ctx) {
    const [sub, ...rest] = arg.split(/\s+/).filter(Boolean);

    if (sub === 'start' || sub === 'end') {
      if (!ctx.isOwner) return message.reply('Only the bot owner can do that.');
      if (sub === 'end') return message.reply(endBounty() ? '🛑 The bounty was cancelled.' : 'There is no active bounty.');

      const target = message.mentions.users.first();
      const b = startBounty({ targetId: target?.id ?? null });
      if (!b) return message.reply('I could not start a bounty. There may already be one, or nobody active has enough coins.');
      const payload = {
        content: `<@${b.targetId}>`,
        embeds: [bountyEmbed(b, '🎯 **The Overlord has marked someone!**')],
        allowedMentions: { users: [b.targetId] },
      };
      await broadcast(message.client, payload);
      return message.reply(payload);
    }

    const b = getActiveBounty();
    if (!b) return message.reply('🎯 There is no bounty right now. The Overlord marks someone every few hours, so keep an eye out!');
    return message.reply({ embeds: [bountyEmbed(b, '🎯 **A bounty is active!**')] });
  },
};
