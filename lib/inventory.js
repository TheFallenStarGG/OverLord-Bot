const { getUser, spendCoins, markDirty, bonusMult, fmt } = require('./economy');
const { ITEMS, LOOT, currentPrice, findItem } = require('./items');
const { mult, isActive, DEFS } = require('./modifiers');

const count = (u, id) => u.inventory[id] ?? 0;

function addItem(u, id, n = 1) {
  u.inventory[id] = (u.inventory[id] ?? 0) + n;
}

function removeItem(u, id, n = 1) {
  const left = (u.inventory[id] ?? 0) - n;
  if (left > 0) u.inventory[id] = left;
  else delete u.inventory[id];
}

// "carp 3" -> { name: 'carp', amount: '3' }, "carp all" -> { name: 'carp', amount: 'all' }
function parseNameAndAmount(arg) {
  const parts = arg.trim().split(/\s+/).filter(Boolean);
  let amount = null;
  if (parts.length > 1 && /^(\d+|all)$/.test(parts[parts.length - 1])) amount = parts.pop();
  return { name: parts.join(' '), amount };
}

const rand = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const LOOTBOX_ITEMS = ['padlock', 'lockpick', 'workboost', 'xpboost', 'net', 'dynamite'];

// Worth about 440 coins on average (the box costs 500)
function rollLootBox() {
  const r = Math.random();
  if (r < 0.4) return { coins: rand(150, 350) };
  if (r < 0.7) return { coins: rand(350, 650) };
  if (r < 0.9) return { item: LOOTBOX_ITEMS[Math.floor(Math.random() * LOOTBOX_ITEMS.length)] };
  if (r < 0.99) return { coins: rand(800, 1500) };
  return { coins: 4000 };
}

// ---------- Buying ----------

function buyItem(userId, name, amountText) {
  const found = findItem(name);
  if (!found || found.kind !== 'shop') return { error: `I don't sell "${name}". Check \`!!shop\` to see what's available!` };

  const { id, def } = found;
  const u = getUser(userId);
  const price = currentPrice(id);
  const cantAfford = (total) => `That costs **${fmt(total)}** and you only have **${fmt(u.coins)}**.`;

  if (def.category === 'gear') {
    const have = u.gear[def.slot];
    if (have >= def.level) return { error: `You already own the ${def.name} or something better.` };
    if (have !== def.level - 1) return { error: `You need to buy the earlier ${def.slot === 'rod' ? 'rods' : 'pickaxes'} first.` };
    if (!spendCoins(userId, price)) return { error: cantAfford(price) };
    u.gear[def.slot] = def.level;
    markDirty();
    return { text: `🛒 You bought the ${def.emoji} **${def.name}** for **${fmt(price)}**! It's equipped automatically.` };
  }

  if (def.category === 'title') {
    if (count(u, id)) return { error: `You already own the title "${def.name}". Equip it with \`!!use ${def.name}\`.` };
    if (def.limited && !isActive(def.limited)) {
      return { error: `🏷️ **${def.name}** is a limited-time title, only sold during **${DEFS[def.limited].name}**. Keep an eye on \`!!event\`!` };
    }
    if (!spendCoins(userId, price)) return { error: cantAfford(price) };
    addItem(u, id);
    u.title = id;
    markDirty();
    return { text: `🏷️ You bought the title **${def.name}** for **${fmt(price)}** and equipped it!` };
  }

  // Consumables
  const amount = amountText ? parseInt(amountText, 10) : 1;
  if (!(amount >= 1)) return { error: 'The amount must be a whole number of at least 1.' };

  const room = def.max - count(u, id);
  if (room <= 0) return { error: `You can't carry more than ${def.max} ${def.name}s.` };
  if (amount > room) return { error: `You can only hold ${room} more ${def.name}${room === 1 ? '' : 's'}.` };

  const total = price * amount;
  if (!spendCoins(userId, total)) return { error: cantAfford(total) };
  addItem(u, id, amount);
  markDirty();
  return { text: `🛒 You bought **${amount}× ${def.emoji} ${def.name}** for **${fmt(total)}**.\nUse it with \`!!use ${def.name.toLowerCase()}\`.` };
}

// ---------- Using ----------

function useItem(userId, name, amountText) {
  const found = findItem(name);
  if (!found) return { error: `I don't know an item called "${name}".` };
  if (found.kind === 'loot') return { error: `${found.def.emoji} ${found.def.name} can't be used. Sell it with \`!!sell ${found.def.name.toLowerCase()}\`.` };

  const { id, def } = found;
  const u = getUser(userId);
  const now = Date.now();

  if (def.category === 'gear') return { error: `Your ${def.slot === 'rod' ? 'rod' : 'pickaxe'} is used automatically.` };

  if (def.category === 'title') {
    if (!count(u, id)) return { error: `You don't own the title "${def.name}". Buy it from \`!!shop\`.` };
    u.title = id;
    markDirty();
    return { text: `🏷️ You're now known as **${def.name}**!` };
  }

  const have = count(u, id);
  if (!have) return { error: `You don't have any ${def.name}. Buy one with \`!!buy ${def.name.toLowerCase()}\`.` };

  if (id === 'padlock') return { error: 'Padlocks work automatically. Just keep one in your inventory and it will protect you.' };

  if (def.category === 'battle') return { error: 'Battle supplies are used inside duels. Add them to your loadout with `!!loadout item add <item>`.' };

  if (id === 'lootbox') {
    const wanted = amountText === 'all' ? 10 : parseInt(amountText ?? '1', 10) || 1;
    const n = Math.max(1, Math.min(wanted, have, 10));

    let coins = 0;
    const items = {};
    for (let i = 0; i < n; i++) {
      const prize = rollLootBox();
      if (prize.coins) coins += prize.coins;
      if (prize.item) {
        items[prize.item] = (items[prize.item] ?? 0) + 1;
        addItem(u, prize.item);
      }
    }
    removeItem(u, id, n);
    u.coins += coins;
    markDirty();

    const itemText = Object.entries(items).map(([k, v]) => `${v}× ${ITEMS[k].emoji} ${ITEMS[k].name}`);
    const prizes = [coins ? fmt(coins) : null, ...itemText].filter(Boolean).join(' + ');
    return { text: `🎁 You opened **${n}** Loot Box${n === 1 ? '' : 'es'} and got: **${prizes || 'nothing... better luck next time!'}**${coins >= 4000 ? '\n🎉 **JACKPOT!**' : ''}` };
  }

  if (id === 'lockpick') {
    if (u.effects.lockpick) return { error: 'You already have a lockpick ready for your next `!!rob`.' };
    removeItem(u, id);
    u.effects.lockpick = true;
    markDirty();
    return { text: '🪛 Lockpick ready! Your next `!!rob` has +20% success chance.' };
  }

  removeItem(u, id);
  if (id === 'workboost') {
    u.effects.workBoostLeft = (u.effects.workBoostLeft ?? 0) + 5;
    markDirty();
    return { text: `⚡ Your next **${u.effects.workBoostLeft}** works pay double!` };
  }
  if (id === 'xpboost') {
    u.effects.xpUntil = Math.max(now, u.effects.xpUntil ?? 0) + 60 * 60 * 1000;
    markDirty();
    return { text: `📈 Double XP until <t:${Math.floor(u.effects.xpUntil / 1000)}:t> (<t:${Math.floor(u.effects.xpUntil / 1000)}:R>)!` };
  }
  if (id === 'charm') {
    u.effects.luckUntil = Math.max(now, u.effects.luckUntil ?? 0) + 30 * 60 * 1000;
    markDirty();
    return { text: `🍀 You feel lucky! Better odds when fishing and mining until <t:${Math.floor(u.effects.luckUntil / 1000)}:R>.` };
  }
  if (id === 'net') {
    u.effects.netLeft = (u.effects.netLeft ?? 0) + 3;
    markDirty();
    return { text: `🕸️ Your next **${u.effects.netLeft}** casts roll twice!` };
  }
  if (id === 'dynamite') {
    u.effects.dynamiteLeft = (u.effects.dynamiteLeft ?? 0) + 3;
    markDirty();
    return { text: `💣 Your next **${u.effects.dynamiteLeft}** mining trips roll twice!` };
  }

  return { error: "That item can't be used." };
}

// ---------- Selling ----------

function sellItems(userId, name, amountText) {
  const u = getUser(userId);
  const sold = [];
  let total = 0;

  const sell = (id, n) => {
    const def = LOOT[id];
    total += def.value * n;
    removeItem(u, id, n);
    sold.push(`${def.emoji} ${def.name} ×${n}`);
  };

  if (!name || name === 'all') {
    for (const id of Object.keys(u.inventory)) if (LOOT[id]) sell(id, u.inventory[id]);
    if (!sold.length) return { error: 'You have nothing to sell. Try `!!fish` or `!!mine` first!' };
  } else {
    const found = findItem(name);
    if (!found || found.kind !== 'loot') return { error: `I only buy fish and ores. "${name}" isn't something I can buy from you.` };

    const have = count(u, found.id);
    if (!have) return { error: `You don't have any ${found.def.name}.` };
    const n = amountText === 'all' ? have : Math.min(parseInt(amountText ?? '1', 10) || 1, have);
    sell(found.id, n);
  }

  const multiplier = bonusMult(u);
  const rush = mult('sell');
  const payout = Math.round(total * multiplier * rush);
  u.coins += payout;
  markDirty();

  return {
    text:
      `💰 Sold ${sold.join(', ').slice(0, 1500)} for **${fmt(payout)}**${multiplier > 1 ? ' (includes your ✨ prestige bonus)' : ''}${rush > 1 ? ' 🎉 (event bonus!)' : ''}.\n` +
      `Balance: ${fmt(u.coins)}`,
  };
}

module.exports = { count, addItem, removeItem, parseNameAndAmount, buyItem, useItem, sellItems };
