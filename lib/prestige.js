const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getUser, peekUser, levelFromXp, markDirty, PRESTIGE_BONUS, fmt } = require('./economy');

const MAX_PRESTIGE = 10;
const levelNeeded = (prestige) => 20 + 5 * prestige;

function buildPrestige(userId) {
  const u = peekUser(userId);
  const level = levelFromXp(u.xp);
  const need = levelNeeded(u.prestige);
  const maxed = u.prestige >= MAX_PRESTIGE;
  const eligible = !maxed && level >= need;

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`✨ Prestige${u.prestige ? ` ${u.prestige}` : ''}`)
    .setDescription(
      'Reset your **level and XP** to earn a permanent bonus. You keep your coins, items, gear, and career.\n' +
      `Each prestige gives **+${PRESTIGE_BONUS * 100}%** to coins from work, selling fish and ore, and \`!!daily\`, plus a coin reward.`
    )
    .addFields(
      { name: 'Your prestige', value: `${u.prestige} / ${MAX_PRESTIGE} (+${Math.round(u.prestige * PRESTIGE_BONUS * 100)}% bonus)`, inline: true },
      { name: 'Your level', value: String(level), inline: true },
      { name: 'Needed for next', value: maxed ? 'Max prestige reached!' : `Level ${need}`, inline: true }
    );

  if (maxed) embed.setFooter({ text: "You've reached the top. Legendary." });
  else if (!eligible) embed.setFooter({ text: `Keep chatting! You need level ${need} to prestige.` });
  else embed.setFooter({ text: `Reward: ${fmt(500 * (u.prestige + 1))}. This resets your level, so think it over!` });

  const components = eligible
    ? [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`prestige:confirm:${userId}`).setLabel('Prestige now').setEmoji('✨').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`prestige:cancel:${userId}`).setLabel('Not yet').setStyle(ButtonStyle.Secondary)
        ),
      ]
    : [];
  return { embeds: [embed], components };
}

function performPrestige(userId) {
  const u = getUser(userId);
  if (u.prestige >= MAX_PRESTIGE) return { error: "You're already at max prestige!" };
  if (levelFromXp(u.xp) < levelNeeded(u.prestige)) return { error: `You need level ${levelNeeded(u.prestige)} to prestige.` };

  u.prestige++;
  u.xp = 0;
  u.level = 0;
  u.lastXp = 0;
  const reward = 500 * u.prestige;
  u.coins += reward;
  markDirty();
  return { prestige: u.prestige, reward };
}

module.exports = { buildPrestige, performPrestige };
