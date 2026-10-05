const { EmbedBuilder } = require('discord.js');
const { peekUser, fmt } = require('../lib/economy');
const { ITEMS, LOOT, ROD_NAMES, PICK_NAMES, idsIn } = require('../lib/items');

module.exports = {
  name: '!!inventory',
  aliases: ['!!inv'],
  usage: '!!inventory',
  description: 'Shows your items, catch, gear, titles, and any boosts you have running.',
  access: 'free',

  async run(message) {
    const u = peekUser(message.author.id);
    const now = Date.now();

    const supplies = [...idsIn('consumable'), ...idsIn('battle')]
      .filter((id) => u.inventory[id])
      .map((id) => `${ITEMS[id].emoji} ${ITEMS[id].name} ×${u.inventory[id]}`);

    const loot = Object.keys(u.inventory).filter((id) => LOOT[id]);
    const lootValue = loot.reduce((sum, id) => sum + LOOT[id].value * u.inventory[id], 0);
    const lootLines = loot.map((id) => `${LOOT[id].emoji} ${LOOT[id].name} ×${u.inventory[id]}`);

    const titles = idsIn('title').filter((id) => u.inventory[id]).map((id) => (u.title === id ? `**${ITEMS[id].name}** (equipped)` : ITEMS[id].name));

    const effects = [];
    if (u.effects.lockpick) effects.push('🪛 Lockpick ready for your next `!!rob`');
    if ((u.effects.workBoostLeft ?? 0) > 0) effects.push(`⚡ Work Boost: ${u.effects.workBoostLeft} works left`);
    if ((u.effects.xpUntil ?? 0) > now) effects.push(`📈 Double XP until <t:${Math.floor(u.effects.xpUntil / 1000)}:R>`);
    if ((u.effects.luckUntil ?? 0) > now) effects.push(`🍀 Lucky until <t:${Math.floor(u.effects.luckUntil / 1000)}:R>`);
    if ((u.effects.netLeft ?? 0) > 0) effects.push(`🕸️ Fishing Net: ${u.effects.netLeft} casts left`);
    if ((u.effects.dynamiteLeft ?? 0) > 0) effects.push(`💣 Dynamite: ${u.effects.dynamiteLeft} trips left`);

    const embed = new EmbedBuilder()
      .setColor(0xe67e22)
      .setTitle(`🎒 ${message.author.username}'s inventory`)
      .setDescription(`💰 Balance: **${fmt(u.coins)}**`)
      .addFields(
        { name: '🧰 Supplies', value: supplies.join('\n') || '*Nothing. Visit `!!shop`!*', inline: true },
        {
          name: `🐟 Catch (worth ${fmt(lootValue)})`,
          value: lootLines.join('\n').slice(0, 1000) || '*Nothing. Try `!!fish` or `!!mine`!*',
          inline: true,
        },
        { name: '🎣 Gear', value: `${ROD_NAMES[u.gear.rod]}\n${PICK_NAMES[u.gear.pick]}`, inline: true },
        { name: '🏷️ Titles', value: titles.join('\n') || '*None yet*', inline: true },
        { name: '✨ Active boosts', value: effects.join('\n') || '*None*', inline: true }
      );

    await message.reply({ embeds: [embed] });
  },
};
