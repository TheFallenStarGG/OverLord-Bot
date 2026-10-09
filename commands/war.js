const { EmbedBuilder, PermissionFlagsBits, escapeMarkdown } = require('discord.js');
const seasons = require('../lib/seasons');
const war = require('../lib/war');
const { fmt } = require('../lib/economy');

const MEDALS = ['🥇', '🥈', '🥉'];
const place = (i) => MEDALS[i] ?? `**${i + 1}.**`;

module.exports = {
  name: '!!war',
  aliases: ['!!serverwar'],
  usage: '!!war [join|leave]',
  description: 'The weekly Server War: servers compete on how much profit their top players make. Admins can opt this server out with `!!war leave` and back in with `!!war join`.',
  access: 'free',

  async run(message, arg, ctx) {
    if (!message.guild) return message.reply('This only works in a server.');
    const sub = arg.split(/\s+/)[0];
    const meta = seasons.meta();

    if (sub === 'join' || sub === 'leave') {
      if (!ctx.isOwner && !message.member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return message.reply('You need the **Manage Server** permission to change this.');
      }
      if (sub === 'leave') meta.warOut = true;
      else delete meta.warOut;
      seasons.save();
      return message.reply(sub === 'leave' ? '🏳️ This server is out of the Server War and is hidden from the rankings. Rejoin with `!!war join`.' : '⚔️ This server is back in the Server War!');
    }

    const key = seasons.weekKey();
    const endsTs = Math.floor(seasons.weekEnd(key) / 1000);
    const standings = war.standingsFor(ctx.client, key);
    const here = message.guild.id;
    const myIndex = standings.findIndex((s) => s.guildId === here);
    const progress = war.guildProgress(here, key);

    const clean = (name) => escapeMarkdown(String(name)).slice(0, 40);
    const rows =
      standings
        .slice(0, 10)
        .map((s, i) => `${place(i)} ${s.guildId === here ? '➤ ' : ''}**${clean(s.name)}**\n┗ ${fmt(s.score)} · ${s.players} players`)
        .join('\n') || `*No server is ranked yet. A server needs ${war.MIN_CONTRIBUTORS} players with ${fmt(war.MIN_PROFIT)}+ profit.*`;

    let yours;
    if (meta.warOut) yours = 'This server is sitting out. An admin can rejoin with `!!war join`.';
    else if (myIndex >= 0) yours = `#${myIndex + 1} of ${standings.length}\n${fmt(progress.score)} · ${progress.players} players`;
    else yours = `Not ranked yet: ${progress.players}/${war.MIN_CONTRIBUTORS} players have ${fmt(war.MIN_PROFIT)}+ profit this week.\nWar score so far: ${fmt(progress.score)}`;

    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('⚔️ Server War')
      .setDescription(
        `Ends <t:${endsTs}:R>. A server's **war score** is the weekly profit (coins earned minus coins lost or spent) of its top ${war.TOP_N} players. Just play normally to help your server!`
      )
      .addFields(
        { name: 'Standings', value: rows },
        { name: 'Your server', value: yours, inline: true },
        {
          name: 'Prizes',
          value: `${MEDALS.map((m, i) => `${m} ${fmt(war.PRIZES[i])}`).join(' · ')}\nfor every player with ${fmt(war.MIN_PROFIT)}+ profit in the top 3 servers`,
          inline: true,
        }
      );

    const last = war.state.history[0];
    const wins = war.state.wins[here] ?? 0;
    const bits = [];
    if (last?.top?.[0]) bits.push(`Last week: **${clean(last.top[0].name)}** won with ${fmt(last.top[0].score)}`);
    if (wins) bits.push(`This server has won **${wins}** war${wins === 1 ? '' : 's'} 🏆`);
    if (bits.length) embed.addFields({ name: 'History', value: bits.join('\n') });

    embed.setFooter({ text: 'Server names are shown to other servers. Admins can opt out with !!war leave.' });
    return message.reply({ embeds: [embed] });
  },
};
