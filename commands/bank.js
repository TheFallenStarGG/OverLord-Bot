const { EmbedBuilder } = require('discord.js');
const bank = require('../lib/bank');
const heist = require('../lib/bankHeist');
const { fmt, peekUser } = require('../lib/economy');

module.exports = {
  name: '!!bank',
  aliases: ['!!vault'],
  usage: '!!bank [deposit|withdraw|heist] [amount|@user]',
  description:
    'Pocket vs bank. Deposit (1% fee). Withdraw up to 750/day free; larger amounts unlock after 3 hours. Weekly 1% bank upkeep. `!!bank heist @user` starts a long vault-heist minigame. Normal `!!rob` only hits pocket cash.',
  access: 'free',

  async run(message, arg, ctx) {
    if (!message.guild) return message.reply('This only works in a server.');
    const parts = String(arg || '').trim().split(/\s+/).filter(Boolean);
    const sub = (parts[0] || '').toLowerCase();

    bank.applyUpkeep(message.author.id);
    bank.settleUnlock(message.author.id);

    if (sub === 'heist' || sub === 'rob') {
      const target = message.mentions.users.first();
      if (!target) {
        return message.reply(
          `Usage: \`!!bank heist @user\`\n` +
            `They need at least **${fmt(heist.MIN_BANK)}** in the bank. Hard minigame: map, guards, drill, escape. 3h cooldown.`
        );
      }
      return heist.start(message, target);
    }

    if (sub === 'deposit' || sub === 'dep' || sub === 'put') {
      let amount = parts[1];
      if (!amount) return message.reply('Usage: `!!bank deposit <amount|all>`');
      if (amount.toLowerCase() === 'all') amount = peekUser(message.author.id).coins;
      const r = bank.deposit(message.author.id, amount);
      if (r.error) return message.reply(r.error);
      return message.reply(
        `🏦 Deposited **${fmt(r.deposited)}**` +
          (r.fee ? ` (fee **${fmt(r.fee)}**)` : '') +
          `.\nPocket **${fmt(r.pocket)}** · Bank **${fmt(r.bank)}**`
      );
    }

    if (sub === 'withdraw' || sub === 'with' || sub === 'take') {
      let amount = parts[1];
      if (!amount) return message.reply('Usage: `!!bank withdraw <amount|all>`');
      if (amount.toLowerCase() === 'all') amount = bank.bankOf(message.author.id);
      const r = bank.withdraw(message.author.id, amount);
      if (r.error) return message.reply(r.error);
      if (r.instant) {
        return message.reply(
          `🏦 Withdrew **${fmt(r.amount)}** (instant).\nPocket **${fmt(r.pocket)}** · Bank **${fmt(r.bank)}** · Free left today **${fmt(r.freeLeft)}**`
        );
      }
      return message.reply(
        `🏦 **${fmt(r.amount)}** is unlocking <t:${Math.floor(r.unlockAt / 1000)}:R> (large withdraw).\n` +
          `Pocket **${fmt(r.pocket)}** · Bank **${fmt(r.bank)}**\n` +
          `Run \`!!bank\` again after the timer to claim it into your pocket.`
      );
    }

    const s = bank.status(message.author.id);
    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle('🏦 Bank')
      .setDescription(
        `**Pocket:** ${fmt(s.pocket)} (robbable with \`!!rob\`)\n` +
          `**Bank:** ${fmt(s.bank)}\n` +
          (s.pending
            ? `**Unlocking:** ${fmt(s.pending)} <t:${Math.floor(s.unlockAt / 1000)}:R>\n`
            : '') +
          `\nFree withdraw left today: **${fmt(s.freeLeft)}** / ${fmt(bank.FREE_WITHDRAW_DAILY)}\n` +
          `Deposit fee **1%** · Large withdraw **3h lock** · Upkeep **1%/week** on bank balance`
      )
      .addFields({
        name: 'Commands',
        value:
          '`!!bank deposit <amount|all>`\n' +
          '`!!bank withdraw <amount|all>`\n' +
          '`!!bank heist @user` — full vault minigame (map, guards, drill, getaway)',
      });
    return message.reply({ embeds: [embed] });
  },
};
