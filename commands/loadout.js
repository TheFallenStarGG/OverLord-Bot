const { EmbedBuilder } = require('discord.js');
const { getUser, markDirty } = require('../lib/economy');
const { findItem } = require('../lib/items');
const { CLASSES } = require('../lib/combat/classes');
const {
  TYPES, ELEMENTS, SKINS, TITLES, BATTLE_ITEMS, norm,
  ensureProfile, playerGear, findWeapon, findArmor, titleName,
} = require('../lib/combat/gear');

const MAX_ITEM_SLOTS = 3;

function showLoadout(u, username) {
  ensureProfile(u);
  const gear = playerGear(u);
  const cls = CLASSES[u.loadout.class] ?? CLASSES.warrior;
  const element = gear.weapon.element ? ` ${ELEMENTS[gear.weapon.element].emoji} ${ELEMENTS[gear.weapon.element].name}` : '';
  const skin = SKINS[u.loadout.skin] && u.inventory[u.loadout.skin] ? SKINS[u.loadout.skin].name : 'None';
  const items = u.loadout.items.length
    ? u.loadout.items.map((id, i) => `${i + 1}. ${BATTLE_ITEMS[id].emoji} ${BATTLE_ITEMS[id].name} (you have ${u.inventory[id] ?? 0})`).join('\n')
    : '*Empty. Add some with `!!loadout item add <item>`*';
  const title = titleName(u.title) ?? 'None';

  return new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle(`🎒 ${username}'s loadout`)
    .addFields(
      { name: `${cls.emoji} Class (for boss fights)`, value: `${cls.name}\nBoss special: **${cls.boss.name}**: ${cls.boss.desc}`, inline: true },
      { name: `${gear.weapon.emoji} Weapon`, value: `${gear.weapon.name}${element}\n+${gear.weapon.bonus} duel dmg · ${TYPES[gear.weapon.type].note}`, inline: true },
      { name: '🛡️ Armor', value: gear.armor.id ? `${gear.armor.name}\n−${gear.armor.reduce} damage per hit` : 'None', inline: true },
      { name: '🧰 Battle items (up to 3, used in casual duels)', value: items },
      { name: '🎨 Skin', value: skin, inline: true },
      { name: '🏷️ Title', value: title, inline: true }
    )
    .setFooter({ text: 'Change it with !!loadout weapon/armor/class/item/skin/title <name>. Forge gear with !!forge.' });
}

module.exports = {
  name: '!!loadout',
  usage: '!!loadout [weapon|armor|class|item|skin|title] <name>',
  description:
    'Shows or changes your gear. Examples: `!!loadout weapon iron sword`, `!!loadout armor chain`, `!!loadout class mage`, `!!loadout item add potion`, `!!loadout title duelist`.',
  access: 'free',

  async run(message, arg) {
    const u = ensureProfile(getUser(message.author.id));
    const [sub, ...rest] = arg.trim().split(/\s+/).filter(Boolean);
    const text = rest.join(' ');

    if (!sub) return message.reply({ embeds: [showLoadout(u, message.author.username)] });

    if (sub === 'weapon') {
      const id = findWeapon(u, text);
      if (!id) return message.reply("You don't own a weapon like that. Forge one with `!!forge`!");
      u.loadout.weapon = id;
    } else if (sub === 'armor') {
      if (['none', 'off', 'remove'].includes(text)) u.loadout.armor = null;
      else {
        const id = findArmor(u, text);
        if (!id) return message.reply("You don't own armor like that. Forge some with `!!forge`!");
        u.loadout.armor = id;
      }
    } else if (sub === 'class') {
      if (!CLASSES[text]) return message.reply(`Pick a class: ${Object.keys(CLASSES).map((c) => `\`${c}\``).join(', ')}.`);
      u.loadout.class = text;
    } else if (sub === 'skin') {
      if (['none', 'off', 'remove'].includes(text)) u.loadout.skin = null;
      else {
        const id = Object.keys(SKINS).find((k) => norm(SKINS[k].name).includes(norm(text)) && u.inventory[k]);
        if (!id) return message.reply("You don't own a skin like that. Boss fights sometimes drop them!");
        u.loadout.skin = id;
      }
    } else if (sub === 'title') {
      if (['none', 'off', 'remove'].includes(text)) u.title = null;
      else {
        const q = norm(text);
        const owned = Object.keys(u.inventory).filter((k) => k.startsWith('title_'));
        const id = owned.find((k) => norm(titleName(k) ?? '').includes(q)) ?? owned.find((k) => norm(findItem(k)?.def.name ?? '').includes(q));
        if (!id) return message.reply("You don't own a title like that. Earn them by playing, or buy some in `!!shop`!");
        u.title = id;
      }
    } else if (sub === 'item') {
      const [action, ...nameParts] = rest;
      const name = nameParts.join(' ');
      if (action === 'clear') u.loadout.items = [];
      else if (action === 'add') {
        const found = findItem(name);
        if (!found || !BATTLE_ITEMS[found.id]) return message.reply('That isn\'t a battle item. Check the Battle Supplies page of `!!shop`.');
        if (u.loadout.items.length >= MAX_ITEM_SLOTS) return message.reply(`All ${MAX_ITEM_SLOTS} slots are full. Remove one first with \`!!loadout item remove <slot>\`.`);
        if ((u.inventory[found.id] ?? 0) <= u.loadout.items.filter((i) => i === found.id).length) {
          return message.reply(`You don't have enough ${found.def.name}s. Buy more with \`!!buy ${found.def.name.toLowerCase()}\`.`);
        }
        u.loadout.items.push(found.id);
      } else if (action === 'remove') {
        const slot = Number(name) - 1;
        if (!(slot >= 0 && slot < u.loadout.items.length)) return message.reply('Give the slot number to remove, like `!!loadout item remove 1`.');
        u.loadout.items.splice(slot, 1);
      } else {
        return message.reply('Use `!!loadout item add <item>`, `remove <slot>`, or `clear`.');
      }
    } else {
      return message.reply('Use `!!loadout weapon|armor|class|item|skin|title <name>`.');
    }

    markDirty();
    await message.reply({ content: '✅ Loadout updated!', embeds: [showLoadout(u, message.author.username)] });
  },
};
