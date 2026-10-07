const { EmbedBuilder, MessageFlags } = require('discord.js');
const { fmt } = require('../lib/economy');
const { getReport } = require('../lib/spy');
const { logging } = require('../lib/logging');

const unix = (ms) => Math.floor(ms / 1000);
const pct = (n) => `${Math.round(n * 100)}%`;

function intelEmbed(report) {
  const i = report.intel;
  const now = Date.now();
  return new EmbedBuilder()
    .setColor(0x2c3e50)
    .setTitle('🕵️ Spy report')
    .setDescription(`Intel on <@${report.targetId}>`)
    .addFields(
      { name: '💰 Wallet', value: fmt(i.coins), inline: true },
      { name: '📈 Invested', value: i.invested ? `${fmt(i.invested)} (cannot be robbed)` : 'Nothing', inline: true },
      { name: '💼 Thief stash', value: fmt(i.stash), inline: true },
      {
        name: '🛡️ Guards',
        value: i.guards.length ? `${i.guards.map((g) => `${g.emoji} ${g.name}`).join(', ')}\n${pct(i.guardPower)} harder to rob` : 'None',
      },
      {
        name: '🥷 Thieves',
        value: i.thieves.length ? i.thieves.map((t) => `${t.def.emoji} ${t.def.name}, next job <t:${unix(Math.max(t.nextAt, now))}:R>`).join('\n') : 'None',
      },
      { name: '🔒 Padlocks', value: String(i.padlocks), inline: true },
      { name: '⏱️ Robbery protection', value: i.protectedUntil > now ? `Until <t:${unix(i.protectedUntil)}:R>` : 'None', inline: true }
    )
    .setFooter({ text: 'This is a snapshot from when your spy reported back' });
}

module.exports = (client) => {
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton() || !interaction.customId.startsWith('spy:')) return;
    try {
      const [, action, reportId] = interaction.customId.split(':');
      if (action !== 'reveal') return;

      const report = getReport(reportId);
      if (!report) {
        return interaction.reply({ content: 'That intel is too old. Send another spy!', flags: MessageFlags.Ephemeral });
      }
      if (interaction.user.id !== report.spyId) {
        return interaction.reply({ content: 'This intel is not for you. Send your own spy with `!!spy @user`.', flags: MessageFlags.Ephemeral });
      }
      return interaction.reply({ embeds: [intelEmbed(report)], flags: MessageFlags.Ephemeral });
    } catch (err) {
      logging('error', 'Spy button failed', err);
    }
  });
};
