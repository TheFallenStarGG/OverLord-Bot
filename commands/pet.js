const { getUser, peekUser, fmt } = require('../lib/economy');
const { parseNameAndAmount } = require('../lib/inventory');
const { ADOPT_COST, adopt, feed, play, rename, release, petEmbed, speciesEmbed } = require('../lib/pets');

module.exports = {
  name: '!!pet',
  usage: '!!pet [adopt | feed [fish] | play | name <name> | release confirm | list | @user]',
  description:
    `Adopt a pet (${ADOPT_COST.toLocaleString('en-US')} coins) that gives you a small perk. Feed it fish from \`!!fish\` to level it up and evolve it at level 10, but a starving pet's perks switch off. \`!!pet list\` shows what you can get.`,
  access: 'free',

  async run(message, arg, ctx) {
    const userId = message.author.id;
    const [sub = '', ...rest] = ctx.rawArg.trim().split(/\s+/);
    const cmd = sub.toLowerCase();
    const restText = rest.join(' ');
    const reply = (result) => message.reply(result.error ?? result.text);

    if (cmd === 'adopt') {
      const result = adopt(userId);
      if (result.error) return message.reply(result.error);
      return message.reply({ embeds: [petEmbed(getUser(userId), message.author.username, '🎉 **You adopted a new friend!**')] });
    }
    if (cmd === 'feed') {
      const { name, amount } = parseNameAndAmount(restText);
      return reply(feed(userId, name, amount));
    }
    if (cmd === 'play') return reply(play(userId));
    if (cmd === 'name' || cmd === 'rename') {
      if (!restText) return message.reply('What should it be called? Try `!!pet name Fluffy`.');
      return reply(rename(userId, restText));
    }
    if (cmd === 'release') {
      if (rest[0]?.toLowerCase() !== 'confirm') {
        return message.reply('Are you sure? Your pet and all its levels will be gone for good. Type `!!pet release confirm` to say goodbye.');
      }
      return reply(release(userId));
    }
    if (cmd === 'list' || cmd === 'species') return message.reply({ embeds: [speciesEmbed()] });

    if (cmd && !message.mentions.users.size) {
      return message.reply(`I don't know that one. Try: \`${module.exports.usage}\``);
    }

    // Show a pet card (yours, or someone else's if you mention them)
    const target = message.mentions.users.first() ?? message.author;
    const u = peekUser(target.id);
    if (!u.pet) {
      return message.reply(
        target.id === userId
          ? `You don't have a pet yet! Adopt one for **${fmt(ADOPT_COST)}** with \`!!pet adopt\`, or see \`!!pet list\` to find out what you could get.`
          : `${target.username} doesn't have a pet yet.`
      );
    }
    return message.reply({ embeds: [petEmbed(u, target.username)] });
  },
};
