const { EmbedBuilder } = require('discord.js');
const { claimVoteReward, VOTE_REWARD_COINS, TOPGG_VOTE_URL } = require('../lib/vote');

function fmtRemain(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

module.exports = {
  name: '!!vote',
  aliases: ['!!topgg'],
  usage: '!!vote',
  description: 'Vote for the bot on top.gg and claim a coin reward (once per 12 hours).',
  access: 'free',

  async run(message) {
    const r = await claimVoteReward(message.author.id);

    if (r.ok) {
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff73fa)
            .setTitle('Thanks for voting!')
            .setDescription(
              `You received **${r.amount}** coins.\nYou can vote again in **12 hours** for another reward.`
            ),
        ],
      });
    }

    if (r.reason === 'cooldown') {
      return message.reply(
        `You already claimed a vote reward recently. Try again in **${fmtRemain(r.remainingMs)}**.\nVote link: <${r.voteUrl}>`
      );
    }

    if (r.reason === 'novote') {
      return message.reply(
        `No recent top.gg vote found for you yet.\n1. Vote here: <${r.voteUrl}>\n2. Run \`!!vote\` again to claim **${r.reward}** coins.`
      );
    }

    // nocheck — token missing or API down
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xff73fa)
          .setTitle('Vote on top.gg')
          .setDescription(
            `Support The Overlord on top.gg (every 12 hours):\n**[Vote here](${TOPGG_VOTE_URL})**\n\n` +
              `When vote checking is configured, \`!!vote\` grants **${VOTE_REWARD_COINS}** coins after you vote.\n` +
              `Right now the bot could not verify votes automatically — the link still helps the bot grow.`
          ),
      ],
    });
  },
};
