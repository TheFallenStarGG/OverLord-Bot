const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const raid = require('../lib/raid');

module.exports = {
  name: '!!raid',
  usage: '!!raid [rules | status | top | optout | optin]',
  description:
    'Raid a random server! A live battle channel opens in both servers where players rob each other for 10 minutes. `!!raid rules` explains everything, `!!raid optout` removes you from raids.',
  access: 'free',

  async run(message, arg) {
    if (!message.guild) return message.reply('Raids only work in a server.');
    const sub = arg.split(/\s+/)[0];

    if (['rules', 'help', 'how'].includes(sub)) return message.reply({ embeds: [raid.rulesEmbed()] });
    if (sub === 'top') return message.reply({ embeds: [raid.topEmbed()] });
    if (sub === 'status') return message.reply({ embeds: [raid.statusEmbed(message.guild, message.author)] });

    if (sub === 'optout') {
      raid.setOptOut(message.author.id, true);
      return message.reply(
        "🚫 You're out. You can't join raids, nobody can target you, and your messages are never shared. Take part again any time with `!!raid optin`."
      );
    }
    if (sub === 'optin') {
      raid.setOptOut(message.author.id, false);
      return message.reply('✅ You can take part in raids again.');
    }

    const current = raid.raidOf(message.guild.id);
    if (current) return message.reply({ embeds: raid.boardPayload(current).embeds });

    const problem = raid.startProblem(message.guild, message.author);
    if (problem) return message.reply(problem);

    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('⚔️ Launch a cross-server raid?')
      .setDescription(
        'I will pick a **random rival server** and open a raid channel in both servers. Everyone who presses **Join Raid** can chat with the other server and rob (or be robbed by) the other side for 10 minutes.\n\n' +
          '• You can lose at most **20%** of your wallet in a raid\n' +
          '• This server can start one raid every 3 hours\n' +
          '• Messages in the raid channel are shared with the other server\n' +
          '• Read the full rules with `!!raid rules`'
      );
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`raid:launch:${message.author.id}`).setLabel('Launch raid').setEmoji('⚔️').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`raid:cancel:${message.author.id}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
    );
    return message.reply({ embeds: [embed], components: [row] });
  },
};
