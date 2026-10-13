const {
  getActiveBounty,
  startBounty,
  endBounty,
  bountyEmbed,
  playerBountyEmbed,
  listPlayerBounties,
  postPlayerBounty,
  cancelPlayerBounty,
  PLAYER_MIN_REWARD,
  overlordRobMin,
} = require('../lib/bounty');
const { broadcast } = require('../lib/announce');
const { fmt } = require('../lib/economy');

module.exports = {
  name: '!!bounty',
  usage: '!!bounty [post @user <amount> [hours] | cancel <id> | list]',
  description:
    'Overlord bounty (duel or rob to claim) and player-posted bounties. ' +
    '`!!bounty post @user <amount> [hours]` holds your coins as a reward; others claim by winning a duel vs the target or robbing enough from them.',
  access: 'free',

  async run(message, arg, ctx) {
    const parts = arg.split(/\s+/).filter(Boolean);
    const sub = (parts[0] || '').toLowerCase();

    if (sub === 'start' || sub === 'end') {
      if (!ctx.isOwner) return message.reply('Only the bot owner can do that.');
      if (sub === 'end') return message.reply(endBounty() ? '🛑 The Overlord bounty was cancelled.' : 'There is no active Overlord bounty.');

      const target = message.mentions.users.first();
      const b = startBounty({ targetId: target?.id ?? null });
      if (!b) {
        return message.reply('I could not start a bounty. There may already be one, or nobody active has enough coins.');
      }
      const payload = {
        content: `<@${b.targetId}>`,
        embeds: [bountyEmbed(b, '🎯 **The Overlord has marked someone!**')],
        allowedMentions: { users: [b.targetId] },
      };
      await broadcast(message.client, payload);
      return message.reply(payload);
    }

    if (sub === 'post' || sub === 'add' || sub === 'place') {
      const target = message.mentions.users.first();
      if (!target || target.bot) {
        return message.reply(
          `Usage: \`!!bounty post @user <amount> [hours]\`\n` +
            `Min reward **${fmt(PLAYER_MIN_REWARD)}**. Hours optional (1–48, default 12).\n` +
            `Claimed by **dueling** them or **robbing** enough coins in one successful \`!!rob\`.`
        );
      }
      // amount = first numeric arg that isn't the mention
      const nums = parts.slice(1).map((p) => p.replace(/,/g, '')).filter((p) => /^\d+$/.test(p));
      const reward = nums[0];
      const hours = nums[1];
      const result = postPlayerBounty(message.author.id, target.id, reward, hours);
      if (result.error) return message.reply(result.error);
      const p = result.bounty;
      const embed = {
        embeds: [
          {
            color: 0xf1c40f,
            title: `💰 Bounty #${p.id} posted`,
            description:
              `<@${message.author.id}> put **${fmt(p.reward)}** on <@${p.targetId}>'s head.\n\n` +
              `**Claim by:**\n` +
              `• Winning a \`!!duel\` against them, or\n` +
              `• Successfully \`!!rob\`bing at least **${fmt(p.robMin)}** from them in one go.\n\n` +
              `Expires <t:${Math.floor(p.until / 1000)}:R>. Coins are held until claim, cancel, or expiry.`,
          },
        ],
        allowedMentions: { users: [target.id] },
      };
      return message.reply(embed);
    }

    if (sub === 'cancel') {
      const id = parts[1];
      if (!id) return message.reply('Usage: `!!bounty cancel <id>` (id from `!!bounty list`).');
      const result = cancelPlayerBounty(message.author.id, id);
      if (result.error) return message.reply(result.error);
      return message.reply(
        `Cancelled bounty **#${result.bounty.id}**. Refunded **${fmt(result.refund)}` +
          (result.fee ? `** (5% cancel fee: ${fmt(result.fee)}).` : '**.')
      );
    }

    if (sub === 'list' || sub === 'player' || sub === 'players') {
      return message.reply({ embeds: [playerBountyEmbed(listPlayerBounties())] });
    }

    // Default: show Overlord + player list
    const b = getActiveBounty();
    const players = listPlayerBounties();
    const embeds = [];
    if (b) {
      embeds.push(bountyEmbed(b, '🎯 **A bounty is active!**'));
    }
    embeds.push(playerBountyEmbed(players));

    if (!b && !players.length) {
      return message.reply({
        content:
          '🎯 No Overlord bounty right now (they appear every few hours).\n' +
          `💰 No player bounties either — post one with \`!!bounty post @user <${PLAYER_MIN_REWARD}+>\`.`,
        embeds: [playerBountyEmbed([])],
      });
    }

    return message.reply({ embeds });
  },
};
