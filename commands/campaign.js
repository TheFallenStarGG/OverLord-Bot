const { EmbedBuilder, PermissionFlagsBits, AttachmentBuilder } = require('discord.js');
const conquest = require('../lib/conquest');
const { canvasAvailable } = require('../lib/conquest/render');

function overviewEmbed(snap) {
  const houses = Object.values(snap.houses || {});
  const top = houses
    .slice()
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 8)
    .map((h, i) => `${i + 1}. **${h.name}** — ${h.score || 0} pts`)
    .join('\n');

  const held = Object.values(snap.owner || {}).filter(Boolean).length;
  const total = conquest.listProvinces().length;

  return new EmbedBuilder()
    .setColor(0xc9a227)
    .setTitle('World Campaign')
    .setDescription(
      snap.active
        ? snap.paused
          ? 'The **global** campaign is paused.'
          : 'The **global** campaign is active — every server is one house on the same map.'
        : 'Campaign offline. Bot owner: `!!campaign start`.'
    )
    .addFields(
      { name: 'Season', value: `${snap.seasonKey || '—'} · Turn **${snap.turn || 0}**`, inline: true },
      { name: 'Map', value: `${held}/${total} held` + (snap.full ? ' · **FULL**' : ` · ${snap.neutral} neutral`), inline: true },
      {
        name: 'Next resolve',
        value: snap.nextTickAt ? `<t:${Math.floor(snap.nextTickAt / 1000)}:R>` : '—',
        inline: true,
      },
      { name: 'Houses (servers)', value: top || 'None yet — run a command in your server to register it.' }
    )
    .setFooter({ text: 'One house per server (server name) · !!campaign help' });
}

async function postMap(message, client) {
  const snap = conquest.snapshot();
  const buffer = await conquest.buildMapBuffer();
  const embed = overviewEmbed(snap);

  if (!buffer) {
    embed.addFields({
      name: 'Map',
      value: canvasAvailable()
        ? 'Could not render.'
        : 'Install `@napi-rs/canvas` on the host.',
    });
    return message.reply({ embeds: [embed] });
  }

  const file = new AttachmentBuilder(buffer, { name: 'campaign-map.png' });
  embed.setImage('attachment://campaign-map.png');

  const guildId = message.guild?.id;
  const channelId = guildId ? snap.channels?.[guildId] : null;
  if (channelId && client) {
    try {
      const ch = await client.channels.fetch(channelId);
      if (ch?.isTextBased?.()) {
        const mid = snap.mapMessages?.[guildId];
        if (mid) {
          const msg = await ch.messages.fetch(mid).catch(() => null);
          if (msg) {
            await msg.edit({ embeds: [embed], files: [file] });
            return message.reply(`Map updated in <#${channelId}>.`);
          }
        }
        const sent = await ch.send({ embeds: [embed], files: [file] });
        conquest.setMapMessageId(guildId, sent.id);
        return message.reply(`Map posted in <#${channelId}>.`);
      }
    } catch {
      /* reply below */
    }
  }

  return message.reply({ embeds: [embed], files: [file] });
}

module.exports = {
  name: '!!campaign',
  aliases: ['!!conquest', '!!warroom'],
  description: 'Global world campaign — one house per server on a shared map.',
  usage: '!!campaign [map|me|recruit|move|attack|invade|color|orders|cancel|houses|province|channel|start|pause|tick|reset|help]',
  access: 'free',
  async run(message, arg, ctx) {
    if (!message.guild) return message.reply('Campaign only works in a server.');

    const raw = (ctx.rawArg || '').trim();
    const [sub, ...rest] = raw.split(/\s+/);
    const s = (sub || '').toLowerCase();
    const isOwner = ctx.isOwner;
    const isAdmin =
      isOwner || message.member?.permissions?.has(PermissionFlagsBits.ManageGuild);

    // Register this server as a house named after the guild
    conquest.ensureHouse(message.guild);

    if (!s || s === 'status') {
      return message.reply({ embeds: [overviewEmbed(conquest.snapshot())] });
    }

    if (s === 'help') {
      return message.reply(
        [
          '**World Campaign** — shared map · cities · AI rival',
          '• Your **server = one house** (server name)',
          '• Own **all cities** in a province to control it',
          '• City **taxes** fill the house treasury each tick',
          '• **The Shadow Court** (AI) expands every tick',
          '',
          '`!!campaign map` · `me` · `province <name>`',
          '`!!campaign recruit <province> <n>` — neutral land (instant)',
          '`!!campaign move <from> <to> <n>`',
          '`!!campaign siege <fromProvince> <city>` — take one city (tick)',
          '`!!campaign attack <from> <to>` — siege first open city there',
          '`!!campaign invade <province>` — landless foothold (one city)',
          '`!!campaign fortify <city>` — harder to siege (−80 coins)',
          '`!!campaign collect` — treasury → your coins',
          '`!!campaign color #hex` · `orders` · `cancel` · `houses`',
          'Admin: `channel #ch` · Owner: `start` `pause` `tick` `reset`',
        ].join('\n')
      );
    }

    if (s === 'map') return postMap(message, ctx.client);

    if (s === 'me' || s === 'holdings' || s === 'my') {
      const r = conquest.holdingsOf(message.guild.id);
      if (r.error) return message.reply(r.error);
      if (!r.rows.length) {
        return message.reply(
          `**${r.house.name}** holds no provinces.\n` +
            (r.mapFull
              ? `Map is full → \`!!campaign invade <province>\` (costs ${conquest.INVADE_COST} coins).`
              : '`!!campaign recruit <province> <amount>` (e.g. `recruit frostmere 10`).')
        );
      }
      return message.reply(
        `**${r.house.name}**\n` + r.rows.map((x) => `• **${x.name}** — ${x.troops} troops`).join('\n')
      );
    }

    if (s === 'recruit') {
      const [prov, amt] = rest;
      const r = conquest.recruit(message.guild, message.author.id, prov, amt);
      if (r.error) return message.reply(r.error);
      return message.reply(
        `✅ **${r.house}** holds **${r.province}** with **${r.size}** troops (−${r.cost} coins). Immediate.`
      );
    }

    if (s === 'move') {
      const [from, to, amt] = rest;
      const r = conquest.move(message.guild, message.author.id, from, to, amt);
      if (r.error) return message.reply(r.error);
      return message.reply(`Queued move: **${r.size}** ${r.from} → ${r.to} (next tick).`);
    }

    if (s === 'attack') {
      const [from, to] = rest;
      const r = conquest.attack(message.guild, message.author.id, from, to);
      if (r.error) return message.reply(r.error);
      return message.reply(
        `Queued siege: **${r.city}** via **${r.from}** → **${r.to}** (power ${r.power}).\n${r.note || ''}`
      );
    }

    if (s === 'siege') {
      const from = rest[0];
      const city = rest.slice(1).join(' ');
      const r = conquest.siege(message.guild, message.author.id, from, city);
      if (r.error) return message.reply(r.error);
      return message.reply(
        `Queued siege: **${r.city}** (${r.province}) from **${r.from}** (power ${r.power}). Resolves next tick.`
      );
    }

    if (s === 'fortify') {
      const r = conquest.fortify(message.guild, message.author.id, rest.join(' '));
      if (r.error) return message.reply(r.error);
      return message.reply(`Fortified **${r.city}** to level **${r.level}** (−${r.cost} coins).`);
    }

    if (s === 'collect' || s === 'treasury' || s === 'tax') {
      const r = conquest.collectTax(message.guild, message.author.id);
      if (r.error) return message.reply(r.error);
      return message.reply(`Collected **${r.amount}** coins from **${r.house}** treasury.`);
    }

    if (s === 'invade') {
      const r = conquest.invade(message.guild, message.author.id, rest.join(' '));
      if (r.error) return message.reply(r.error);
      return message.reply(
        `Invasion of **${r.province}** queued (−${r.cost} coins, power ${r.power}). Resolves on next tick.`
      );
    }

    if (s === 'color' || s === 'tint') {
      const r = conquest.setHouseColor(message.guild.id, rest.join(' '));
      if (r.error) return message.reply(r.error);
      return message.reply(`**${r.name}** tint → \`${r.color}\``);
    }

    if (s === 'orders') {
      const list = conquest.listOrders(message.guild.id);
      if (!list.length) return message.reply('No queued orders for this server.');
      return message.reply(
        list
          .map((o) => {
            if (o.type === 'move') return `• move ${o.size} ${o.fromId} → ${o.toId}`;
            if (o.type === 'attack') return `• attack ${o.fromId} → ${o.toId}`;
            if (o.type === 'invade') return `• invade ${o.toId}`;
            return `• ${o.type}`;
          })
          .join('\n')
      );
    }

    if (s === 'cancel') {
      const n = conquest.cancelOrders(message.guild.id);
      return message.reply(n ? `Cancelled **${n}** order(s).` : 'Nothing to cancel.');
    }

    if (s === 'houses') {
      const houses = Object.values(conquest.snapshot().houses || {});
      if (!houses.length) return message.reply('No houses yet.');
      return message.reply(
        houses
          .map((h) => `**${h.name}** — ${h.score || 0} pts`)
          .join('\n')
          .slice(0, 1900)
      );
    }

    if (s === 'province') {
      const p = conquest.resolveName(rest.join(' '));
      if (!p) return message.reply('Unknown province.');
      const snap = conquest.snapshot();
      const owner = snap.owner[p.id];
      const house = owner ? snap.houses[owner] : null;
      const armies = (snap.armies[p.id] || [])
        .map((a) => `${snap.houses[a.houseId]?.name || a.houseId}: **${a.size}**`)
        .join('\n');
      const cities = (p.cities || [])
        .map((c) => {
          const co = snap.cityOwner?.[c.id];
          return `• ${c.name} — ${co ? snap.houses[co]?.name || co : 'Neutral'}`;
        })
        .join('\n');
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(p.name)
        .addFields(
          { name: 'Owner', value: house ? house.name : 'Neutral', inline: true },
          {
            name: 'Borders',
            value: p.neighbors.map((id) => conquest.getProvince(id)?.name || id).join(', ') || '—',
          },
          { name: 'Cities', value: cities || '—' },
          { name: 'Armies', value: armies || 'None' }
        );
      return message.reply({ embeds: [embed] });
    }

    if (s === 'channel') {
      if (!isAdmin) return message.reply('Manage Server required.');
      const target = rest[0];
      if (!target || target.toLowerCase() === 'off') {
        conquest.setChannel(message.guild.id, null);
        conquest.setMapMessageId(message.guild.id, null);
        return message.reply('Campaign channel cleared for this server.');
      }
      const id = (target.match(/^<#(\d+)>$/) || target.match(/^(\d{17,20})$/))?.[1];
      if (!id) return message.reply('Mention a channel or paste its ID.');
      conquest.setChannel(message.guild.id, id);
      return message.reply(`This server’s campaign map channel → <#${id}>.`);
    }

    if (s === 'start') {
      if (!isOwner) return message.reply('Bot owner only (global campaign).');
      conquest.startCampaign();
      return message.reply('Global campaign **started**.');
    }

    if (s === 'pause') {
      if (!isOwner) return message.reply('Bot owner only.');
      const snap = conquest.snapshot();
      conquest.pauseCampaign(!snap.paused);
      return message.reply(conquest.snapshot().paused ? 'Paused.' : 'Resumed.');
    }

    if (s === 'tick') {
      if (!isOwner) return message.reply('Bot owner only.');
      const result = conquest.resolveTick();
      if (result.skipped) return message.reply('Nothing to resolve (inactive/paused).');
      const lines = (result.reports || []).slice(0, 15).join('\n') || 'Quiet tick.';
      await message.reply(`**Turn ${result.turn}**\n${lines}`.slice(0, 1900));
      return postMap(message, ctx.client);
    }

    if (s === 'reset') {
      if (!isOwner) return message.reply('Bot owner only.');
      conquest.resetWorld();
      return message.reply('World campaign **reset** (global). Run `!!campaign start` if needed.');
    }

    return message.reply('Unknown subcommand. `!!campaign help`');
  },
};
