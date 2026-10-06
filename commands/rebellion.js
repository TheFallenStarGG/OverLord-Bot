const { EmbedBuilder } = require('discord.js');
const { meterInfo, currentUsurper } = require('../lib/rebellion');
const { channelIds } = require('../lib/announce');

module.exports = {
  name: '!!rebellion',
  usage: '!!rebellion',
  description:
    'Shows the Rebellion meter. Everyone running commands and fighting bosses fills it. When it\'s full, the Overlord himself descends, and whoever lands the final blow becomes the Usurper.',
  access: 'free',

  async run(message) {
    const { meter, goal, raid } = meterInfo();
    const filled = Math.floor((meter / goal) * 10);
    const king = currentUsurper();

    const lines = [
      raid
        ? '👑 **THE OVERLORD IS AMONG US!** Go fight him in the events channel!'
        : `${'█'.repeat(filled)}${'░'.repeat(10 - filled)} **${meter.toLocaleString('en-US')} / ${goal.toLocaleString('en-US')}**`,
      '',
      'Every command you run (once a minute) and every boss fight you join feeds the Rebellion. When it fills, the Overlord descends. Whoever strikes the final blow becomes the **Usurper**.',
    ];
    if (meter >= goal && !raid && !channelIds().length) {
      lines.push('', '⚠️ The Overlord needs somewhere to appear. Someone with Manage Server should run `!!events-channel #channel`.');
    }

    const embed = new EmbedBuilder()
      .setColor(0xc0392b)
      .setTitle('🔥 The Rebellion')
      .setDescription(lines.join('\n'))
      .addFields({
        name: '👑 The throne',
        value: king ? `<@${king.id}> rules until <t:${Math.floor(king.until / 1000)}:R>. Challenge them with \`!!usurper challenge\`.` : 'Empty. Fill the meter and defeat the Overlord to claim it!',
      });

    return message.reply({ embeds: [embed] });
  },
};
