const { EmbedBuilder } = require('discord.js');
const { toggleLegacy } = require('../lib/legacyMode');

module.exports = {
  name: '!!legacy-commands',
  aliases: ['!!legacy', '!!classic'],
  usage: '!!legacy-commands',
  description:
    'Toggle classic mode for !!work, !!rob, !!fish, and !!mine. When on, those commands use the old simple one-message versions with no menus or minigames.',
  access: 'free',

  async run(message) {
    const on = toggleLegacy(message.author.id);
    const embed = new EmbedBuilder()
      .setColor(on ? 0x95a5a6 : 0x2ecc71)
      .setTitle(on ? '📜 Legacy commands: ON' : '✨ Legacy commands: OFF')
      .setDescription(
        on
          ? '**!!work**, **!!rob**, **!!fish**, and **!!mine** now use the old simple versions (no menus / minigames).\n\nRun this again any time to switch back.'
          : '**!!work**, **!!rob**, **!!fish**, and **!!mine** use the interactive versions again.\n\nRun this again to go classic.'
      );
    return message.reply({ embeds: [embed] });
  },
};
