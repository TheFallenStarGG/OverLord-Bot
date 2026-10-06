const { EmbedBuilder } = require('discord.js');
const { peekUser, levelFromXp, xpForLevel, rankOf, careerFor, fmt } = require('../lib/economy');
const { ITEMS, ROD_NAMES, PICK_NAMES } = require('../lib/items');
const { TITLES, ELEMENTS, ensureProfile, playerGear } = require('../lib/combat/gear');
const { CLASSES } = require('../lib/combat/classes');
const { getRatings } = require('../lib/ranked');
const { SPECIES, levelOf, looks } = require('../lib/petData');

module.exports = {
  name: '!!profile',
  aliases: ['!!me'],
  usage: '!!profile [@user]',
  description: 'Shows a full profile card: level, coins, career, gear, pet, combat record, and ranked ratings.',
  access: 'free',

  async run(message) {
    const target = message.mentions.users.first() ?? message.author;
    if (target.bot) return message.reply("Bots don't have profiles.");

    const u = ensureProfile(peekUser(target.id));
    const level = levelFromXp(u.xp);
    const base = xpForLevel(level);
    const next = xpForLevel(level + 1);
    const filled = Math.floor(((u.xp - base) / (next - base)) * 10);
    const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);

    const gear = playerGear(u);
    const cls = CLASSES[u.loadout.class] ?? CLASSES.warrior;
    const element = gear.weapon.element ? ` ${ELEMENTS[gear.weapon.element].emoji}` : '';
    const career = careerFor(u.works);
    const c = u.combat;
    const games = c.wins + c.losses;
    const record = games ? `${c.wins}W-${c.losses}L (${Math.round((c.wins / games) * 100)}%)` : 'No duels yet';

    const title = TITLES[u.title]?.name ?? ITEMS[u.title]?.name;
    const titlesOwned = Object.keys(u.inventory).filter((k) => k.startsWith('title_')).length;

    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const streak = u.lastDaily === today || u.lastDaily === yesterday ? u.streak : 0;

    const ratings = getRatings(target.id);
    const ranked = ratings.length ? ratings.map((r) => `${r.emoji} ${r.elo} ${r.tier.emoji} (${r.wins}W-${r.losses}L)`).join('\n') : 'Unranked';

    const pet = u.pet && SPECIES[u.pet.species] ? u.pet : null;
    const petText = pet ? `${looks(pet).emoji} **${pet.name}**\n${looks(pet).name} · Level ${levelOf(pet)}` : 'No pet yet';

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setAuthor({ name: `${target.username}${u.prestige ? ` · ✨ Prestige ${u.prestige}` : ''}`, iconURL: target.displayAvatarURL({ size: 64 }) })
      .setTitle(title ? `${title}` : 'Profile')
      .setThumbnail(target.displayAvatarURL({ size: 128 }))
      .addFields(
        { name: `📈 Level ${level}`, value: `${bar}\n${u.xp - base} / ${next - base} XP\n#${rankOf(target.id, 'xp')} in XP`, inline: true },
        { name: '🪙 Wealth', value: `${fmt(u.coins)}\n#${rankOf(target.id, 'coins')} richest\n🔥 Daily streak: ${streak}`, inline: true },
        { name: '💼 Career', value: `${career.emoji} ${career.name}\n${u.works} jobs done`, inline: true },
        {
          name: `${cls.emoji} Combat`,
          value: `${cls.name} · ${gear.weapon.emoji} ${gear.weapon.name}${element}\n🛡️ ${gear.armor.name}\n${record}\n🐉 Boss kills: ${c.bossKills ?? 0}`,
          inline: true,
        },
        { name: '🏅 Ranked', value: ranked, inline: true },
        { name: '🎒 Collection', value: `🎣 ${ROD_NAMES[u.gear.rod]}\n⛏️ ${PICK_NAMES[u.gear.pick]}\n🏷️ ${titlesOwned} title${titlesOwned === 1 ? '' : 's'} owned`, inline: true },
        { name: '🐾 Pet', value: petText, inline: true }
      );

    return message.reply({ embeds: [embed] });
  },
};
