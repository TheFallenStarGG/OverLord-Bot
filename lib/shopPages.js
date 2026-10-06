const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { peekUser, fmt } = require('./economy');
const { ITEMS, SHOP_PAGES, idsIn, dealId, currentPrice } = require('./items');
const { activeList } = require('./modifiers');

function buildShop(requested, userId) {
  const u = peekUser(userId);
  const page = Math.min(Math.max(Number(requested) || 0, 0), SHOP_PAGES.length - 1);
  const current = SHOP_PAGES[page];
  const deal = dealId();

  const tabs = SHOP_PAGES.map((p, i) => (i === page ? `**${p.emoji} ${p.title}**` : p.emoji)).join('  ·  ');
  const dealDef = ITEMS[deal];
  const dealLine =
    `⭐ **Deal of the day:** ${dealDef.emoji} ${dealDef.name} for **${fmt(currentPrice(deal))}** ` +
    `(normally ${fmt(dealDef.price)})`;

  const live = activeList()
    .filter((e) => e.def.event)
    .map((e) => `${e.def.emoji} **${e.def.name}** (ends <t:${Math.floor(e.until / 1000)}:R>)`);
  const eventLine = live.length ? `\n🎪 **Live now:** ${live.join(' · ')}` : '';

  const fields = idsIn(current.category).map((id) => {
    const def = ITEMS[id];

    let status;
    if (def.category === 'consumable' || def.category === 'battle') {
      status = `You own: **${u.inventory[id] ?? 0}** / ${def.max}`;
    } else if (def.category === 'gear') {
      const have = u.gear[def.slot];
      status = have >= def.level ? '✅ Owned' : have === def.level - 1 ? '🛒 Next upgrade' : '🔒 Buy the earlier ones first';
    } else {
      status = u.inventory[id] ? '✅ Owned' : 'Not owned';
    }

    const label = def.category === 'title' ? `Title: ${def.name}` : def.name;
    const sale = id === deal ? ' ⭐ -20%' : '';
    const tag = def.limited ? ' ⏳ Limited' : '';
    return { name: `${def.emoji} ${label} — ${fmt(currentPrice(id))}${sale}${tag}`, value: `${def.desc}\n${status}` };
  });

  const embed = new EmbedBuilder()
    .setColor(current.color)
    .setTitle(`🛒 Shop — ${current.title}`)
    .setDescription(`${tabs}\n\n${current.intro}\n\n${dealLine}${eventLine}\n💰 Your balance: **${fmt(u.coins)}**`)
    .addFields(fields)
    .setFooter({ text: `Page ${page + 1} of ${SHOP_PAGES.length} · Buy with !!buy <item> [amount]` });

  const id = (action) => `shop:${action}:${page}:${userId}`;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(id('prev')).setEmoji('◀️').setLabel('Back').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
    new ButtonBuilder().setCustomId(id('noop')).setLabel(`${page + 1} / ${SHOP_PAGES.length}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId(id('next')).setEmoji('▶️').setLabel('Next').setStyle(ButtonStyle.Primary).setDisabled(page === SHOP_PAGES.length - 1),
    new ButtonBuilder().setCustomId(id('close')).setEmoji('✖️').setLabel('Close').setStyle(ButtonStyle.Danger)
  );

  return { embeds: [embed], components: [row] };
}

module.exports = { buildShop };
