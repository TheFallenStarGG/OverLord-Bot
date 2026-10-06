const { EmbedBuilder } = require('discord.js');
const { currentUsurper, useDecree, claimStipend } = require('../lib/rebellion');
const { challengeUsurper } = require('../lib/throne');
const { decreeEmbed } = require('../lib/modifiers');
const { broadcast } = require('../lib/announce');

module.exports = {
  name: '!!usurper',
  usage: '!!usurper [decree <name> | stipend | challenge]',
  description:
    'Shows who holds the throne. The Usurper can command one decree per reign and collect a royal stipend every 2 hours. Anyone can challenge them with `!!usurper challenge` (best of 3, equal gear).',
  access: 'free',

  async run(message, arg, ctx) {
    const userId = message.author.id;
    const [sub = '', ...rest] = ctx.rawArg.trim().split(/\s+/);
    const cmd = sub.toLowerCase();

    if (cmd === 'challenge') return challengeUsurper(message);

    if (cmd === 'stipend') {
      const result = claimStipend(userId);
      return message.reply(result.error ?? result.text);
    }

    if (cmd === 'decree') {
      const result = useDecree(userId, rest.join(' '));
      if (result.error) return message.reply(result.error);
      const embed = decreeEmbed(result.entry, `👑 **${message.author.username}**, the Usurper, commands it!`);
      await broadcast(message.client, { embeds: [embed] });
      return message.reply({ embeds: [embed] });
    }

    const king = currentUsurper();
    if (!king) {
      return message.reply('The throne is empty. Fill the Rebellion meter (`!!rebellion`), then defeat the Overlord to claim it!');
    }
    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle(`👑 ${king.name}, the Usurper`)
      .setDescription(`Rules until <t:${Math.floor(king.until / 1000)}:R>.`)
      .addFields(
        { name: '📜 Decree', value: king.decreeUsed ? 'Already used this reign.' : 'Available: `!!usurper decree <name>`' },
        { name: '💰 Royal stipend', value: '400 coins every 2 hours with `!!usurper stipend`.' },
        { name: '⚔️ Challenge', value: 'Anyone can try to take the throne with `!!usurper challenge`.' }
      );
    return message.reply({ embeds: [embed] });
  },
};
