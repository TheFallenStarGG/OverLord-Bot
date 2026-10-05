const { peekUser, spendCoins, addCoins, fmt } = require('../lib/economy');

module.exports = {
  name: '!!give',
  usage: '!!give @user <amount>',
  description: 'Gives some of your coins to another member.',
  access: 'free',

  async run(message, arg, ctx) {
    const usage = 'Usage: `!!give @user <amount>`';
    const target = message.mentions.users.first();
    if (!target) return message.reply(`Who do you want to give coins to? ${usage}`);
    if (target.bot) return message.reply("Bots can't use coins.");
    if (target.id === message.author.id) return message.reply("You can't give coins to yourself.");

    const token = ctx.rawArg.split(/\s+/).find((t) => t && !/^<@!?\d+>$/.test(t));
    const balance = peekUser(message.author.id).coins;
    const amount = token?.toLowerCase() === 'all' ? balance : /^\d+$/.test(token ?? '') ? parseInt(token, 10) : null;

    if (!amount || amount < 1) return message.reply(`How many coins? ${usage}`);
    if (!spendCoins(message.author.id, amount)) return message.reply(`You only have ${fmt(balance)}.`);
    addCoins(target.id, amount);

    return message.reply({
      content: `🎁 <@${message.author.id}> gave **${fmt(amount)}** to <@${target.id}>!`,
      allowedMentions: { users: [target.id], repliedUser: false },
    });
  },
};
