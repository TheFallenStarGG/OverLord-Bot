const { EmbedBuilder } = require('discord.js');
const { peekUser } = require('../lib/economy');
const { CLASSES } = require('../lib/combat/classes');
const { ensureProfile, BATTLE_ITEMS, TITLES } = require('../lib/combat/gear');

// A readable name for any move you can make in a duel
function moveName(key) {
  if (['attack', 'defend', 'feint'].includes(key)) return key[0].toUpperCase() + key.slice(1);
  for (const c of Object.values(CLASSES)) {
    const s = c.specials.find((x) => x.id === key);
    if (s) return s.name;
  }
  return BATTLE_ITEMS[key]?.name ?? key;
}

module.exports = {
  name: '!!stats',
  usage: '!!stats [@user]',
  description: 'Shows a combat record: duel wins and losses, streaks, damage dealt, favorite move, boss kills, and titles.',
  access: 'free',

  async run(message) {
    const target = message.mentions.users.first() ?? message.author;
    if (target.bot) return message.reply("Bots don't fight.");

    const u = ensureProfile({ ...peekUser(target.id) });
    const c = u.combat;
    const total = c.wins + c.losses;
    const favorite = Object.entries(c.moves).sort((a, b) => b[1] - a[1])[0];
    const titles = Object.keys(u.inventory).filter((id) => TITLES[id]).map((id) => TITLES[id].name);

    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle(`📊 ${target.username}'s combat record`)
      .addFields(
        { name: '⚔️ Duels', value: `**${c.wins}**W - **${c.losses}**L${total ? ` (${Math.round((c.wins / total) * 100)}% wins)` : ''}`, inline: true },
        { name: '🔥 Win streak', value: `${c.streak} (best ${c.best})`, inline: true },
        { name: '💥 Damage dealt', value: c.damage.toLocaleString('en-US'), inline: true },
        { name: '⭐ Favorite move', value: favorite ? `${moveName(favorite[0])} (${favorite[1]}×)` : 'None yet', inline: true },
        { name: '🐉 Bosses', value: `${c.bossKills} defeated · ${c.bossDamage.toLocaleString('en-US')} total damage`, inline: true },
        { name: '⚒️ Items forged', value: String(c.forged), inline: true },
        { name: '🏷️ Earned titles', value: titles.join(', ') || '*None yet*' }
      );

    await message.reply({ embeds: [embed] });
  },
};
