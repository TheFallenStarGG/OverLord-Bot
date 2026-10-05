const { EmbedBuilder } = require('discord.js');
const { getUser, ensureQuests, markDirty, fmt } = require('./economy');
const { addItem } = require('./inventory');
const { ITEMS } = require('./items');
const { DAILY_QUESTS, WEEKLY_QUESTS } = require('./questDefs');

const bar = (progress, goal) => {
  const filled = Math.floor((progress / goal) * 10);
  return '▰'.repeat(filled) + '▱'.repeat(10 - filled);
};

function nextMondayTs() {
  const d = new Date();
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + (8 - day));
  d.setUTCHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

// Shows your quests. Any finished ones are claimed automatically when you look.
function buildQuests(userId) {
  const u = getUser(userId);
  const q = ensureQuests(u);
  const defs = new Map([...DAILY_QUESTS, ...WEEKLY_QUESTS].map((d) => [d.id, d]));

  const claimed = [];
  for (const entry of [...q.daily, ...q.weekly]) {
    const def = defs.get(entry.id);
    if (def && !entry.claimed && entry.progress >= def.goal) {
      entry.claimed = true;
      u.coins += def.coins;
      if (def.item) addItem(u, def.item);
      claimed.push(def);
    }
  }
  if (claimed.length) markDirty();

  const line = (entry) => {
    const def = defs.get(entry.id);
    const reward = `${fmt(def.coins)}${def.item ? ` + ${ITEMS[def.item].emoji} ${ITEMS[def.item].name}` : ''}`;
    const state = entry.claimed ? '✅' : '🔸';
    return `${state} **${def.text}**\n${bar(entry.progress, def.goal)} ${entry.progress}/${def.goal} · ${reward}`;
  };

  const midnight = new Date();
  midnight.setUTCHours(24, 0, 0, 0);

  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle('📜 Your quests')
    .addFields(
      { name: `Daily · resets <t:${Math.floor(midnight.getTime() / 1000)}:R>`, value: q.daily.map(line).join('\n\n') },
      { name: `Weekly · resets <t:${nextMondayTs()}:R>`, value: q.weekly.map(line).join('\n\n') }
    )
    .setFooter({ text: 'Rewards are claimed automatically when you check your quests.' });

  if (claimed.length) {
    embed.setDescription(
      `🎁 **Rewards claimed:** ${claimed.map((d) => `${d.text} (${fmt(d.coins)}${d.item ? ' + 🎁' : ''})`).join(', ')}`
    );
  }
  return { embeds: [embed] };
}

module.exports = { buildQuests };
