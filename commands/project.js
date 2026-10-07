const { EmbedBuilder } = require('discord.js');
const { fmt, peekUser, getUser, markDirty, spendCoins } = require('../lib/economy');
const { FISH, ORE } = require('../lib/items');
const { parseAmount } = require('../lib/stocks');
const { PROJECTS, findProject, getProject, remaining, contribute, topContributors } = require('../lib/realm');
const { broadcast } = require('../lib/announce');
const { logEvent } = require('../lib/world');

const tableFor = (kind) => (kind === 'fish' ? FISH : ORE);
const bar = (have, need) => {
  const filled = Math.min(10, Math.floor((have / need) * 10));
  return `${'▰'.repeat(filled)}${'▱'.repeat(10 - filled)} ${Math.min(100, Math.floor((have / need) * 100))}%`;
};

function countGoods(userId, kind) {
  const u = peekUser(userId);
  return tableFor(kind).reduce((sum, item) => sum + (u.inventory[item.id] ?? 0), 0);
}

// Takes up to `wanted` fish or ores, cheapest first so you keep your rare finds
function takeGoods(userId, kind, wanted) {
  const u = getUser(userId);
  let taken = 0;
  for (const item of [...tableFor(kind)].sort((a, b) => a.value - b.value)) {
    const n = Math.min(u.inventory[item.id] ?? 0, wanted - taken);
    if (n <= 0) continue;
    u.inventory[item.id] -= n;
    if (!u.inventory[item.id]) delete u.inventory[item.id];
    taken += n;
  }
  if (taken) markDirty();
  return taken;
}

function overview() {
  const lines = Object.entries(PROJECTS).map(([id, def]) => {
    const p = getProject(id);
    if (p.done) return `${def.emoji} **${def.name}** ✅ **Built!** ${def.perk}`;
    return (
      `${def.emoji} **${def.name}** · ${def.perk}\n` +
      `💰 \`${bar(p.coins, def.coins)}\` ${fmt(p.coins)} / ${fmt(def.coins)}\n` +
      `${def.goods.kind === 'fish' ? '🐟' : '🪨'} \`${bar(p.goods, def.goods.amount)}\` ${p.goods} / ${def.goods.amount} ${def.goods.kind}`
    );
  });
  return new EmbedBuilder()
    .setColor(0xc0873f)
    .setTitle('🏗️ Realm Projects')
    .setDescription(`The whole realm builds these together. Once a project is finished, **everyone** gets its perk forever.\n\n${lines.join('\n\n')}`)
    .setFooter({ text: 'Help build with !!project give <name> <coins|goods> <amount|all> · see details with !!project <name>' });
}

function detail(id) {
  const def = PROJECTS[id];
  const p = getProject(id);
  const rem = remaining(id);
  const builders = topContributors(id, 5);
  const embed = new EmbedBuilder()
    .setColor(p.done ? 0x2ecc71 : 0xc0873f)
    .setTitle(`${def.emoji} ${def.name}${p.done ? ' (built)' : ''}`)
    .setDescription(`${def.blurb}\n\n**Perk:** ${def.perk}`)
    .addFields(
      { name: '💰 Coins', value: `\`${bar(p.coins, def.coins)}\`\n${fmt(p.coins)} / ${fmt(def.coins)}`, inline: true },
      {
        name: `${def.goods.kind === 'fish' ? '🐟 Fish' : '🪨 Ore'}`,
        value: `\`${bar(p.goods, def.goods.amount)}\`\n${p.goods} / ${def.goods.amount}`,
        inline: true,
      }
    );
  if (!p.done) {
    embed.addFields({
      name: 'Still needed',
      value: `${fmt(rem.coins)} and ${rem.goods} ${def.goods.kind}\nGive with \`!!project give ${def.name.toLowerCase()} coins 500\` or \`!!project give ${def.name.toLowerCase()} goods 20\``,
    });
  }
  if (builders.length) {
    embed.addFields({ name: '👷 Top builders', value: builders.map((b, i) => `${i + 1}. <@${b.userId}> · ${b.value.toLocaleString('en-US')} points`).join('\n') });
  }
  return embed;
}

async function give(message, tokens) {
  const rest = tokens.slice(1); // everything after "give"
  const usage = 'Usage: `!!project give <name> <coins|goods> <amount|all>`, for example `!!project give lighthouse coins 1000`';
  if (rest.length < 3) return message.reply(usage);

  const amountText = rest.pop();
  const what = rest.pop();
  const id = findProject(rest.join(' '));
  if (!id) return message.reply(`I do not know that project. See them all with \`!!project\`.\n${usage}`);

  const def = PROJECTS[id];
  const p = getProject(id);
  if (p.done) return message.reply(`${def.emoji} The **${def.name}** is already built. Thank you!`);

  const userId = message.author.id;
  const rem = remaining(id);
  let coins = 0;
  let goods = 0;

  if (['coins', 'coin'].includes(what)) {
    if (rem.coins <= 0) return message.reply(`The **${def.name}** has all the coins it needs. It still needs **${rem.goods} ${def.goods.kind}** (\`!!project give ${def.name.toLowerCase()} goods <amount>\`).`);
    const wallet = peekUser(userId).coins;
    const want = parseAmount(amountText, wallet);
    if (want === null || want < 1) return message.reply(usage);
    coins = Math.min(want, rem.coins, wallet);
    if (coins < 1) return message.reply('You do not have any coins to give.');
    spendCoins(userId, coins);
  } else if (['goods', 'good', 'fish', 'ore', 'ores'].includes(what)) {
    if (rem.goods <= 0) return message.reply(`The **${def.name}** has all the ${def.goods.kind} it needs. It still needs **${fmt(rem.coins)}**.`);
    const have = countGoods(userId, def.goods.kind);
    const want = parseAmount(amountText, have);
    if (want === null || want < 1) return message.reply(usage);
    goods = takeGoods(userId, def.goods.kind, Math.min(want, rem.goods));
    if (goods < 1) return message.reply(`You do not have any ${def.goods.kind} to give. Go and find some with \`!!${def.goods.kind === 'fish' ? 'fish' : 'mine'}\`!`);
  } else {
    return message.reply(usage);
  }

  const { completed } = contribute(id, userId, { coins, goods });
  const given = coins ? fmt(coins) : `${goods} ${def.goods.kind}`;
  const now = getProject(id);

  if (!completed) {
    return message.reply(
      `${def.emoji} <@${userId}> gave **${given}** to the **${def.name}**!\n` +
        `💰 \`${bar(now.coins, def.coins)}\` · ${def.goods.kind === 'fish' ? '🐟' : '🪨'} \`${bar(now.goods, def.goods.amount)}\``
    );
  }

  const builders = topContributors(id, 3).map((b, i) => `${['🥇', '🥈', '🥉'][i]} <@${b.userId}>`).join('\n');
  logEvent(`${def.emoji} The realm finished building the **${def.name}**! ${def.perk}.`);
  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(`${def.emoji} The ${def.name} is finished!`)
    .setDescription(`The whole realm worked together, and now **everyone** benefits forever.\n\n**Perk:** ${def.perk}\n\n**Top builders**\n${builders}`);
  await broadcast(message.client, { embeds: [embed] });
  return message.reply({ content: `<@${userId}> gave **${given}** and finished the project!`, embeds: [embed] });
}

module.exports = {
  name: '!!project',
  aliases: ['!!projects', '!!realm'],
  usage: '!!project [name | give <name> <coins|goods> <amount|all>]',
  description: 'The whole server builds projects together with coins, fish, and ore. Finished projects give everyone a permanent perk.',
  access: 'free',

  async run(message, arg) {
    const tokens = arg.split(/\s+/).filter(Boolean);
    if (!tokens.length) return message.reply({ embeds: [overview()] });
    if (['give', 'donate', 'contribute', 'add'].includes(tokens[0])) return give(message, tokens);

    const id = findProject(tokens.join(' '));
    if (!id) return message.reply('I do not know that project. See them all with `!!project`.');
    return message.reply({ embeds: [detail(id)] });
  },
};
