const { getActiveBoss, getLastDefeated } = require('../lib/boss');

module.exports = {
  name: '!!boss',
  usage: '!!boss',
  description: 'Checks if a raid boss is active. Bosses show up rarely while people chat, and everyone can fight them together.',
  access: 'free',

  async run(message) {
    if (!message.guild) return message.reply('Bosses only appear in servers.');

    const boss = getActiveBoss(message.guild.id);
    if (boss) {
      return message.reply(
        `${boss.emoji} A **${boss.name}** is attacking right now! ` +
        `https://discord.com/channels/${message.guild.id}/${boss.channelId}/${boss.message.id}\n` +
        `It has **${Math.max(boss.hp, 0).toLocaleString('en-US')}** HP left.`
      );
    }

    const last = getLastDefeated();
    await message.reply(
      'No boss right now. They appear rarely while people chat, so keep your eyes open! 👀' +
      (last ? `\n-# Last defeated: ${last.emoji} ${last.name} <t:${Math.floor(last.at / 1000)}:R>` : '')
    );
  },
};
