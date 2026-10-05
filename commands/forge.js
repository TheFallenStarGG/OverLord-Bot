const { EmbedBuilder } = require('discord.js');
const { peekUser, fmt } = require('../lib/economy');
const {
  TIERS, TYPES, ARMOR, RECIPES, ENCHANT_COST, ELEMENTS, MATERIALS,
  ensureProfile, forgeItem, enchantWeapon, matsText, materialName,
} = require('../lib/combat/gear');
const { LOOT } = require('../lib/items');

module.exports = {
  name: '!!forge',
  usage: '!!forge [item | enchant <element>]',
  description:
    'Forge weapons and armor from ore, coal, and boss drops. `!!forge` shows the recipes, `!!forge iron sword` crafts one, and `!!forge enchant fire` enchants your weapon.',
  access: 'free',

  async run(message, arg) {
    const text = arg.trim();

    if (text.startsWith('enchant')) {
      const result = enchantWeapon(message.author.id, text.replace('enchant', '').trim());
      return message.reply(result.error ?? result.text);
    }
    if (text) {
      const result = forgeItem(message.author.id, text);
      return message.reply(result.error ?? result.text);
    }

    const u = ensureProfile(peekUser(message.author.id));
    const recipes = [1, 2, 3, 4].map(
      (t) => `⚒️ **${TIERS[t].name}** (${ARMOR[t].name}): ${fmt(RECIPES[t].coins)} + ${matsText(RECIPES[t].mats)}`
    );
    const owned = Object.keys({ ...MATERIALS, ...LOOT })
      .filter((id) => u.inventory[id] && (MATERIALS[id] || ['iron', 'coal', 'gold', 'ruby', 'diamond'].includes(id)))
      .map((id) => `${u.inventory[id]}× ${materialName(id)}`);

    const embed = new EmbedBuilder()
      .setColor(0xe67e22)
      .setTitle('⚒️ The Forge')
      .setDescription(
        'Craft weapons and armor from the **ores** you mine and the **materials** bosses drop.\n' +
        `Weapon types: ${Object.values(TYPES).map((t) => `${t.emoji} ${t.name}`).join(', ')}. Each tier has all four.`
      )
      .addFields(
        { name: 'Recipes (same for every weapon type and armor of that tier)', value: recipes.join('\n') },
        { name: '✨ Enchanting', value: `\`!!forge enchant <${Object.keys(ELEMENTS).join('|')}>\`: ${fmt(ENCHANT_COST.coins)} + ${ENCHANT_COST.essences}× the matching essence. Matching a boss's weakness deals ×1.5 damage.` },
        { name: 'Your materials', value: owned.join('\n') || '*None yet. Try `!!mine`, or fight a boss!*' }
      )
      .setFooter({ text: 'Example: !!forge steel dagger · !!forge plate armor · Dragon gear needs a Dragon Scale from the Ancient Dragon' });

    await message.reply({ embeds: [embed] });
  },
};
