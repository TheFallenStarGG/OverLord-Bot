const { EmbedBuilder } = require('discord.js');
const {
  claimVoteReward,
  VOTE_REWARD_COINS,
  TOPGG_VOTE_URL,
} = require('../lib/vote');

function fmtMs(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

module.exports = {
  name: '!!vote',
  aliases: [],
  usage: '!!vote',
  description: 'Claim coins after voting for the bot on top.gg (plus a short earn buff).',
  access: 'free',

  async run(message) {
    if (!message.guild) {
      return message.reply('Use `!!vote` in a server so coins can go on that server’s balance.');
    }

    try {
      require('../lib/activity').touch(
        message.author.id,
        message.guild.id,
        message.channel.id
      );
    } catch (_) {}

    const r = await claimVoteReward(message.author.id);

    if (r.ok) {
      const buffPct = Math.round(((r.buffMult || 1.1) - 1) * 100);
      const buffH = r.buffHours || 1;
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x57f287)
            .setTitle('Vote claimed')
            .setDescription(
              `**+${r.amount}** coins` +
                (r.weekend ? ' (**weekend 2×**)' : '') +
                `\n**+${buffPct}%** coin earnings for **${buffH} hour(s)**` +
                `\n\nYou can vote again in about 12 hours.`
            ),
        ],
      });
    }

    if (r.reason === 'cooldown') {
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xfaa61a)
            .setTitle('Already claimed')
            .setDescription(
              `You already claimed a vote reward recently.\n` +
                `Try again in **${fmtMs(r.remainingMs)}**.\n` +
                `[Vote on top.gg](${r.voteUrl || TOPGG_VOTE_URL}) (helps even on cooldown).`
            ),
        ],
      });
    }

  if (r.reason === 'novote' || r.reason === 'not_voted') {
    return message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('Vote on top.gg')
            .setDescription(
              `No recent vote found yet.\n` +
                `1. [Vote here](${r.voteUrl || TOPGG_VOTE_URL})\n` +
                `2. Run \`!!vote\` again (or wait for auto-reward if webhooks are up).\n\n` +
                `Reward: **${VOTE_REWARD_COINS}** coins (×2 on weekends) + **10%** earn buff for **1 hour**.`
            ),
        ],
      });
    }

    if (r.reason === 'nocheck') {
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xed4245)
            .setTitle('Could not check top.gg')
            .setDescription(
              `Reward is **${VOTE_REWARD_COINS}** coins (×2 on weekends) and a **10%** earn buff for **1h** after a successful claim.\n` +
                `Auto-check failed — [vote link](${TOPGG_VOTE_URL}) still helps the bot.`
            ),
        ],
      });
    }
    
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xed4245)
          .setTitle('Could not check top.gg')
          .setDescription(
            `Reward is **${VOTE_REWARD_COINS}** coins (+ weekend 2×) and a **10%** earn buff for **1h** after a successful claim.\n` +
              `Auto-check failed — [vote link](${TOPGG_VOTE_URL}) still helps the bot.`
          ),
      ],
    });
  },
};
