const { EmbedBuilder } = require('discord.js');
const { peekUser, CAREERS, careerFor, nextCareer, bonusMult } = require('../lib/economy');

module.exports = {
  name: '!!career',
  usage: '!!career',
  description: 'Shows your job, your pay, and how close you are to a promotion. Every `!!work` counts.',
  access: 'free',

  async run(message) {
    const u = peekUser(message.author.id);
    const career = careerFor(u.works);
    const next = nextCareer(u.works);
    const bonus = bonusMult(u);

    const pay = (c) => `${Math.round(15 * c.mult * bonus)}-${Math.round(45 * c.mult * bonus)} 🪙`;
    const ladder = CAREERS.map((c) => {
      const mark = c === career ? '➡️' : u.works >= c.min ? '✅' : '🔒';
      return `${mark} ${c.emoji} **${c.name}** (${c.min} works) — ${pay(c)} per work`;
    }).join('\n');

    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle(`${career.emoji} ${message.author.username} is a ${career.name}`)
      .setDescription(
        `You've worked **${u.works}** time${u.works === 1 ? '' : 's'}. Current pay: **${pay(career)}** per work.\n` +
        (next ? `Next promotion: **${next.emoji} ${next.name}** in **${next.min - u.works}** more works.` : '👑 You\'re at the top of the ladder!')
      )
      .addFields({ name: 'Career ladder', value: ladder })
      .setFooter({ text: bonus > 1 ? `Includes your +${Math.round((bonus - 1) * 100)}% prestige bonus` : 'Prestige gives a permanent pay bonus: see !!prestige' });

    await message.reply({ embeds: [embed] });
  },
};
