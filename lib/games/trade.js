const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { registerModule, endGame, privateReply } = require('./common');
const { getUser, transferUpTo, markDirty, fmt } = require('../economy');
const { ITEMS, LOOT } = require('../items');
const { addItem, removeItem } = require('../inventory');
const { TYPES, TIERS, ARMOR, MATERIALS, weaponId, weaponName, norm, ensureProfile } = require('../combat/gear');

const MAX_ITEMS = 8; // different items per side

// Everything that can be traded
const TRADEABLE = [];
for (const [id, d] of Object.entries(LOOT)) TRADEABLE.push({ id, name: d.name, emoji: d.emoji });
for (const [id, d] of Object.entries(ITEMS)) {
  if (d.category === 'consumable' || d.category === 'battle') TRADEABLE.push({ id, name: d.name, emoji: d.emoji });
}
for (const [id, d] of Object.entries(MATERIALS)) TRADEABLE.push({ id, name: d.name, emoji: d.emoji });
for (const type of Object.keys(TYPES)) {
  for (let t = 1; t < TIERS.length; t++) TRADEABLE.push({ id: weaponId(type, t), name: weaponName(weaponId(type, t)), emoji: TYPES[type].emoji });
}
for (let t = 1; t < ARMOR.length; t++) TRADEABLE.push({ id: `armor_${t}`, name: ARMOR[t].name, emoji: '🛡️' });

const nameOf = (id) => {
  const e = TRADEABLE.find((x) => x.id === id);
  return e ? `${e.emoji} ${e.name}` : id;
};
const isGear = (id) => /^(sword|dagger|hammer|bow)_\d$/.test(id) || /^armor_\d$/.test(id);

// Equipped gear and loadout items are kept out of trades
function reserved(u, id) {
  const l = u.loadout;
  if (!l) return 0;
  return (l.weapon === id ? 1 : 0) + (l.armor === id ? 1 : 0) + (l.items ?? []).filter((i) => i === id).length;
}
const available = (u, id) => Math.max(0, (u.inventory[id] ?? 0) - reserved(u, id));

function resolveItem(text) {
  const q = norm(text);
  const exact = TRADEABLE.find((e) => norm(e.id) === q || norm(e.name) === q);
  if (exact) return { id: exact.id };
  const partial = TRADEABLE.filter((e) => norm(e.name).includes(q));
  if (partial.length === 1) return { id: partial[0].id };
  if (partial.length > 1) return { error: `Be more specific. That could be: ${partial.slice(0, 4).map((e) => e.name).join(', ')}.` };
  return { error: `"${text}" can't be traded. You can trade fish, ores, materials, supplies, and forged weapons or armor.` };
}

const describe = (o) =>
  [o.coins ? fmt(o.coins) : null, ...Object.entries(o.items).map(([id, n]) => `${n}× ${nameOf(id)}`)].filter(Boolean).join(', ') || 'nothing';

// Re-checks everything right before the trade happens. Returns a problem or null.
function checkTrade(game) {
  for (let i = 0; i < 2; i++) {
    const from = game.players[i];
    const to = game.players[1 - i];
    const fu = ensureProfile(getUser(from));
    const tu = getUser(to);
    const offer = game.offers[from];

    if (offer.coins > fu.coins) return `<@${from}> doesn't have ${fmt(offer.coins)} anymore.`;
    for (const [id, n] of Object.entries(offer.items)) {
      if (available(fu, id) < n) return `<@${from}> no longer has ${n}× ${nameOf(id)} to trade.`;
      if (isGear(id) && (tu.inventory[id] ?? 0) > 0) return `<@${to}> already owns the ${nameOf(id)}.`;
      const cap = ITEMS[id]?.max;
      if (cap && (tu.inventory[id] ?? 0) + n > cap) return `<@${to}> can't carry that many (max ${cap}).`;
    }
  }
  return null;
}

function execute(game) {
  for (let i = 0; i < 2; i++) {
    const from = game.players[i];
    const to = game.players[1 - i];
    const fu = ensureProfile(getUser(from));
    const tu = ensureProfile(getUser(to));
    const offer = game.offers[from];

    if (offer.coins) transferUpTo(from, to, offer.coins);
    for (const [id, n] of Object.entries(offer.items)) {
      removeItem(fu, id, n);
      addItem(tu, id, n);
      if (fu.enchants[id]) { // enchantments travel with the weapon
        tu.enchants[id] = fu.enchants[id];
        delete fu.enchants[id];
      }
    }
  }
  markDirty();
}

function tradeModal(game) {
  const input = (id, label, placeholder) =>
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId(id).setLabel(label).setPlaceholder(placeholder).setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(30)
    );
  return new ModalBuilder()
    .setCustomId(`game:tr:${game.id}:modal`)
    .setTitle('Edit your offer')
    .addComponents(
      input('coins', 'Coins you offer (total)', 'e.g. 500'),
      input('item', 'Item to add or change', 'e.g. carp, iron sword, potion'),
      input('amount', 'How many? (0 removes it, "all" works)', 'default: 1')
    );
}

const resetReady = (game) => {
  for (const p of game.players) game.ready[p] = false;
  game.version++;
};

const trade = {
  type: 'tr',

  create({ challenger, opponent }) {
    const [a, b] = [challenger.id, opponent.id];
    return {
      type: 'tr',
      players: [a, b],
      names: { [a]: challenger.username, [b]: opponent.username },
      offers: { [a]: { coins: 0, items: {} }, [b]: { coins: 0, items: {} } },
      ready: { [a]: false, [b]: false },
      version: 0, // goes up on every change so old Confirm buttons stop working
      note: '',
      over: false,
      success: false,
      result: null,
    };
  },

  render(game) {
    const side = (id) => {
      const o = game.offers[id];
      const lines = [];
      if (o.coins) lines.push(fmt(o.coins));
      for (const [item, n] of Object.entries(o.items)) lines.push(`${n}× ${nameOf(item)}`);
      return { name: `${game.ready[id] ? '✅' : '⏳'} ${game.names[id]}'s offer`, value: lines.join('\n') || '*Nothing yet*', inline: true };
    };

    const embed = new EmbedBuilder()
      .setColor(game.over ? (game.success ? 0x2ecc71 : 0x95a5a6) : 0x5865f2)
      .setTitle('🤝 Trade')
      .setDescription(
        game.over
          ? game.result
          : `Use **Edit offer** to add coins or items. Both players press **Confirm** to finish. Any change resets the confirmations.${game.note ? `\n${game.note}` : ''}`
      )
      .addFields(side(game.players[0]), side(game.players[1]));

    if (game.over) return { content: '', embeds: [embed], components: [] };

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`game:tr:${game.id}:edit`).setEmoji('✏️').setLabel('Edit offer').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`game:tr:${game.id}:confirm:${game.version}`).setEmoji('✅').setLabel('Confirm').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`game:tr:${game.id}:cancel`).setEmoji('✖️').setLabel('Cancel').setStyle(ButtonStyle.Danger)
    );
    return { content: '', embeds: [embed], components: [row] };
  },

  async handleButton(interaction, game, action, arg) {
    const uid = interaction.user.id;
    if (!game.players.includes(uid)) return privateReply(interaction, "This isn't your trade.");
    const otherId = game.players.find((p) => p !== uid);

    if (action === 'cancel') {
      game.over = true;
      game.result = `🚫 <@${uid}> cancelled the trade. Nothing was exchanged.`;
      endGame(game);
      return interaction.update(trade.render(game));
    }

    if (action === 'edit') return interaction.showModal(tradeModal(game));

    if (action === 'confirm') {
      if (arg !== String(game.version)) return privateReply(interaction, 'The offer just changed. Look it over again, then press Confirm.');
      if (game.ready[uid]) return privateReply(interaction, "You've already confirmed. Waiting for the other player!");
      if (game.players.every((p) => !game.offers[p].coins && !Object.keys(game.offers[p].items).length)) {
        return privateReply(interaction, 'Add something to the trade first.');
      }

      game.ready[uid] = true;
      if (game.players.every((p) => game.ready[p])) {
        const problem = checkTrade(game);
        if (problem) {
          resetReady(game);
          game.note = `⚠️ ${problem}`;
        } else {
          execute(game);
          game.over = true;
          game.success = true;
          game.result = `✅ **Trade complete!**\n${game.players.map((p) => `<@${p}> gave: ${describe(game.offers[p])}`).join('\n')}`;
          endGame(game);
        }
      }
      return interaction.update(trade.render(game));
    }

    if (action !== 'modal') return;

    const read = (key) => interaction.fields.getTextInputValue(key).trim();
    const coinsText = read('coins');
    const itemText = read('item');
    const amountText = read('amount').toLowerCase();
    if (!coinsText && !itemText) return privateReply(interaction, 'Fill in coins, an item, or both.');

    const me = ensureProfile(getUser(uid));
    const other = getUser(otherId);
    const offer = game.offers[uid];

    // Check everything first, then apply, so a mistake changes nothing
    let newCoins = null;
    if (coinsText) {
      if (!/^\d+$/.test(coinsText)) return privateReply(interaction, 'Coins must be a whole number.');
      newCoins = parseInt(coinsText, 10);
      if (newCoins > me.coins) return privateReply(interaction, `You only have ${fmt(me.coins)}.`);
    }

    let itemId = null;
    let itemAmount = 0;
    if (itemText) {
      const found = resolveItem(itemText);
      if (found.error) return privateReply(interaction, found.error);
      itemId = found.id;

      const have = available(me, itemId);
      if (amountText === 'all') itemAmount = have;
      else if (!amountText) itemAmount = 1;
      else if (/^\d+$/.test(amountText)) itemAmount = parseInt(amountText, 10);
      else return privateReply(interaction, 'The amount must be a number, or `all`.');

      if (itemAmount > have) {
        return privateReply(interaction, have ? `You only have ${have}× ${nameOf(itemId)} you can trade.` : `You don't have any ${nameOf(itemId)} to trade. (Equipped gear and loadout items are kept out of trades.)`);
      }
      if (itemAmount > 0) {
        if (isGear(itemId) && (other.inventory[itemId] ?? 0) > 0) return privateReply(interaction, `They already own the ${nameOf(itemId)}.`);
        const cap = ITEMS[itemId]?.max;
        if (cap && (other.inventory[itemId] ?? 0) + itemAmount > cap) return privateReply(interaction, `They can only carry ${cap} of those.`);
        if (!offer.items[itemId] && Object.keys(offer.items).length >= MAX_ITEMS) return privateReply(interaction, `You can offer up to ${MAX_ITEMS} different items.`);
      }
    }

    if (newCoins !== null) offer.coins = newCoins;
    if (itemId) {
      if (itemAmount === 0) delete offer.items[itemId];
      else offer.items[itemId] = itemAmount;
    }
    resetReady(game);
    game.note = `✏️ <@${uid}> updated their offer.`;
    return interaction.update(trade.render(game));
  },

  async onExpire(game) {
    if (game.over) return;
    game.over = true;
    game.result = '⌛ The trade expired. Nothing was exchanged.';
    await game.message?.edit(trade.render(game)).catch(() => {});
  },
};

registerModule('tr', trade);
module.exports = trade;
