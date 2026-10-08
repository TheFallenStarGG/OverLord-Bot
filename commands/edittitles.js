const { PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { getCustomTitles, setCustomTitle, removeCustomTitle } = require('../lib/serverSettings');
const { fmt } = require('../lib/economy');

function slug(name) {
  return (
    'title_custom_' +
    String(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 40)
  );
}

module.exports = {
  name: '!!edittitles',
  aliases: ['!!edittitle', '!!titleshop'],
  usage: '!!edittitles [list|add|price|role|remove] ...',
  description:
    'Admin (Manage Server): manage custom shop titles and optional Discord roles. Built-in items cannot be edited.',
  access: 'free',

  async run(message, arg, ctx) {
    if (!message.guild) return message.reply('This only works in a server.');
    if (!ctx.isOwner && !message.member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return message.reply('You need **Manage Server** to edit titles.');
    }

    const raw = (ctx.rawArg || '').trim();
    const parts = raw.split(/\s+/).filter(Boolean);
    const sub = (parts[0] || 'list').toLowerCase();
    const titles = getCustomTitles();

    if (sub === 'list' || !parts.length) {
      const lines = Object.entries(titles).map(
        ([id, t]) =>
          `• **${t.emoji} ${t.name}** — ${fmt(t.price)}` +
          (t.roleId ? ` · role <@&${t.roleId}>` : ' · no role') +
          `\n  id: \`${id}\``
      );
      const embed = new EmbedBuilder()
        .setColor(0xf1c40f)
        .setTitle('Custom shop titles')
        .setDescription(
          (lines.join('\n') || 'None yet.') +
            '\n\n' +
            '`!!edittitles add <name> <price> [@role]`\n' +
            '`!!edittitles price <id> <price>`\n' +
            '`!!edittitles role <id> [@role|off]`\n' +
            '`!!edittitles remove <id>`\n' +
            'Built-in titles/items cannot be changed.'
        );
      return message.reply({ embeds: [embed] });
    }

    if (sub === 'add') {
      // !!edittitles add the Champion 5000 @Role
      const role = message.mentions.roles.first();
      const priceToken = [...parts].reverse().find((p) => /^\d+$/.test(p));
      if (!priceToken) return message.reply('Usage: `!!edittitles add <name> <price> [@role]`');
      const price = parseInt(priceToken, 10);
      const nameParts = parts.slice(1).filter((p) => p !== priceToken && !p.startsWith('<@&'));
      const name = nameParts.join(' ').trim();
      if (!name) return message.reply('Give the title a name.');
      const id = slug(name);
      if (titles[id]) return message.reply('That title id already exists. Remove it first or pick another name.');
      setCustomTitle(id, {
        name,
        emoji: '🏷️',
        price,
        roleId: role?.id ?? null,
        desc: role
          ? `Server title. Buying it equips the name and grants the linked role.`
          : `Server title shown on !!rank.`,
      });
      return message.reply(
        `Added **${name}** for **${fmt(price)}**` +
          (role ? ` linked to ${role}` : '') +
          `. id: \`${id}\``
      );
    }

    if (sub === 'price') {
      const id = parts[1];
      const price = parseInt(parts[2], 10);
      if (!id || !titles[id] || !price) return message.reply('Usage: `!!edittitles price <id> <price>`');
      titles[id].price = price;
      setCustomTitle(id, titles[id]);
      return message.reply(`Updated price of **${titles[id].name}** to **${fmt(price)}**.`);
    }

    if (sub === 'role') {
      const id = parts[1];
      if (!id || !titles[id]) return message.reply('Usage: `!!edittitles role <id> [@role|off]`');
      if ((parts[2] || '').toLowerCase() === 'off') {
        titles[id].roleId = null;
        setCustomTitle(id, titles[id]);
        return message.reply(`Removed role link from **${titles[id].name}**.`);
      }
      const role = message.mentions.roles.first();
      if (!role) return message.reply('Mention a role, or use `off`.');
      titles[id].roleId = role.id;
      setCustomTitle(id, titles[id]);
      return message.reply(`**${titles[id].name}** now grants ${role} on buy/equip.`);
    }

    if (sub === 'remove') {
      const id = parts[1];
      if (!id || !titles[id]) return message.reply('Usage: `!!edittitles remove <id>`');
      const name = titles[id].name;
      removeCustomTitle(id);
      return message.reply(`Removed **${name}** (\`${id}\`) from the shop. People who already bought it keep the inventory flag.`);
    }

    return message.reply('Unknown subcommand. Try `!!edittitles list`.');
  },
};
