const { EmbedBuilder } = require('discord.js');
const { getUser, spendCoins, addCoins, applyDelta, peekUser, parseBet, fmt, markDirty } = require('../lib/economy');
const { addItem } = require('../lib/inventory');
const { ITEMS } = require('../lib/items');
const { addTreasury, getTreasury, issueDecree, decreeEmbed } = require('../lib/modifiers');

const MIN = 500;
const MAX = 25000;
const COOLDOWN_MS = 60 * 1000;
const lastTribute = new Map();

const pick = (list) => list[Math.floor(Math.random() * list.length)];

// back = how much of your tribute returns (×). Weights add up to 100.
const OUTCOMES = [
  { weight: 20, emoji: '😒', title: 'Disdain', color: 0x95a5a6, back: 0, lines: ['The Overlord does not even look up. Your tribute vanishes into the vault.', '"Is that all?" The Overlord yawns. Your coins are gone.'] },
  { weight: 25, emoji: '🙄', title: 'A grudging nod', color: 0xe67e22, back: 0.5, lines: ['The Overlord nods without enthusiasm and flicks some coins back to you.', '"Adequate." Half of your tribute is returned.'] },
  { weight: 25, emoji: '😌', title: 'Favor', color: 0x2ecc71, back: 1.2, lines: ['The Overlord is pleased. "You may keep a little extra, mortal."', 'A rare smile crosses the Overlord\'s face. Your tribute returns with interest.'] },
  { weight: 12, emoji: '✨', title: 'Blessing', color: 0xf1c40f, back: 0.5, boon: true, lines: ['The Overlord raises a hand and the heavens answer.', '"You amuse me. Take this."'] },
  { weight: 10, emoji: '🤩', title: 'Generosity', color: 0x1abc9c, back: 2, lines: ['The Overlord is in a magnificent mood. Your tribute is doubled!', '"Such devotion!" Gold rains down on you.'] },
  { weight: 6, emoji: '💀', title: 'Curse', color: 0x992d22, back: 0, fine: 0.25, lines: ['The Overlord is insulted by your tribute. You are fined for the audacity.', '"How dare you!" Your tribute is taken, and so is more.'] },
  { weight: 2, emoji: '👑', title: 'Ascension', color: 0x9b59b6, back: 5, lines: ['The Overlord elevates you to the inner circle. Your tribute is multiplied FIVEFOLD!', 'The sky splits open. "Rise, favored one."'] },
];

const BOONS = [
  { text: 'double XP for 1 hour', apply: (u) => { u.effects.xpUntil = Math.max(Date.now(), u.effects.xpUntil ?? 0) + 60 * 60 * 1000; } },
  { text: 'your next 5 `!!work`s pay double', apply: (u) => { u.effects.workBoostLeft = (u.effects.workBoostLeft ?? 0) + 5; } },
  { text: 'better fishing and mining luck for 30 minutes', apply: (u) => { u.effects.luckUntil = Math.max(Date.now(), u.effects.luckUntil ?? 0) + 30 * 60 * 1000; } },
  { text: 'a free 🔒 Padlock', can: (u) => (u.inventory.padlock ?? 0) < ITEMS.padlock.max, apply: (u) => addItem(u, 'padlock') },
];

function roll() {
  let r = Math.random() * 100;
  for (const o of OUTCOMES) {
    r -= o.weight;
    if (r < 0) return o;
  }
  return OUTCOMES[0];
}

module.exports = {
  name: '!!tribute',
  usage: '!!tribute <amount>',
  description: `Pay tribute to the Overlord (${MIN} to ${MAX.toLocaleString('en-US')} coins) and see how he feels: from disdain to blessings, curses, and rare jackpots. Every tribute also fills the shared treasury, and a full treasury earns the whole server a free decree. See \`!!decree\`.`,
  access: 'free',

  async run(message, arg) {
    const userId = message.author.id;
    const usage = `Usage: \`!!tribute <amount>\` (${MIN} to ${MAX.toLocaleString('en-US')} coins)`;

    const readyAt = (lastTribute.get(userId) ?? 0) + COOLDOWN_MS;
    if (Date.now() < readyAt) return message.reply(`The Overlord is tired of your face. Return <t:${Math.ceil(readyAt / 1000)}:R>.`);
    if (!arg) return message.reply(usage);

    const first = arg.split(/\s+/)[0];
    const coins = peekUser(userId).coins;
    let amount = parseBet(first, coins);
    if (amount !== null && first === 'all') amount = Math.min(amount, MAX);
    if (amount === null || !Number.isInteger(amount)) return message.reply(usage);
    if (amount < MIN) return message.reply(`The Overlord does not accept less than **${fmt(MIN)}**.`);
    if (amount > MAX) return message.reply(`The Overlord will not take more than **${fmt(MAX)}** at once.`);
    if (!spendCoins(userId, amount)) return message.reply(`You only have ${fmt(coins)}.`);

    lastTribute.set(userId, Date.now());
    const outcome = roll();
    const u = getUser(userId);

    const back = Math.floor(amount * outcome.back);
    if (back) addCoins(userId, back);
    const fine = outcome.fine ? -applyDelta(userId, -Math.floor(amount * outcome.fine)) : 0;

    let boonText = null;
    if (outcome.boon) {
      const boon = pick(BOONS.filter((b) => b.can?.(u) ?? true));
      boon.apply(u);
      boonText = boon.text;
      markDirty();
    }

    const net = back - amount - fine;
    const reached = addTreasury(amount);
    const t = getTreasury();
    const filled = Math.floor((t.amount / t.goal) * 10);

    const embed = new EmbedBuilder()
      .setColor(outcome.color)
      .setTitle(`${outcome.emoji} ${outcome.title}`)
      .setDescription(`${pick(outcome.lines)}${boonText ? `\n\n🎁 Boon: **${boonText}**` : ''}`)
      .addFields(
        { name: 'Tribute', value: fmt(amount), inline: true },
        { name: fine ? 'Fined extra' : 'Returned', value: fine ? fmt(fine) : fmt(back), inline: true },
        { name: 'Net', value: `${net >= 0 ? '+' : '−'}${fmt(Math.abs(net))}`, inline: true }
      )
      .setFooter({ text: `🏛️ Treasury ${'█'.repeat(filled)}${'░'.repeat(10 - filled)} ${t.amount.toLocaleString('en-US')} / ${t.goal.toLocaleString('en-US')} · Balance ${peekUser(userId).coins.toLocaleString('en-US')}` });

    await message.reply({ embeds: [embed] });

    if (reached) {
      const entry = issueDecree({ goodOnly: true });
      await message.channel.send({ embeds: [decreeEmbed(entry, '🏛️ **The treasury overflows!** The Overlord is pleased with your tributes and issues a decree.')] }).catch(() => {});
    }
  },
};
