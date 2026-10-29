const { EmbedBuilder, PermissionFlagsBits, AttachmentBuilder } = require('discord.js');
const conquest = require('../lib/conquest');
const { canvasAvailable } = require('../lib/conquest/render');

function overviewEmbed(snap, client) {
  let houses = conquest.visibleHouses
    ? conquest.visibleHouses(client)
    : Object.values(snap.houses || {});

  // Fallback if export missing
  if (!conquest.visibleHouses) {
    houses = houses.filter((h) => {
      if (h.ai) return true;
      return (h.score || 0) > 0;
    });
  }

  const top = houses
    .slice(0, 8)
    .map((h, i) => `${i + 1}. **${h.name}** — ${h.score || 0} pts`)
    .join('\n');

  const held = Object.values(snap.owner || {}).filter(Boolean).length;
  const total = conquest.listProvinces().length;
  const claimedCities =
    snap.claimedCities != null
      ? snap.claimedCities
      : Object.values(snap.cityOwner || {}).filter(Boolean).length;
  const totalCities =
    snap.totalCities != null
      ? snap.totalCities
      : conquest.listProvinces().reduce((n, p) => n + (p.cities?.length || 0), 0);

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
      {
        name: 'Map',
        value:
          `${held}/${total} provinces controlled · ${claimedCities}/${totalCities} cities claimed` +
          (snap.full ? ' · **FULL**' : ''),
        inline: true,
      },
      {
        name: 'Next resolve',
        value: snap.nextTickAt ? `<t:${Math.floor(snap.nextTickAt / 1000)}:R>` : '—',
        inline: true,
      },
      {
        name: 'Houses (servers)',
        value: top || 'None active yet — recruit or score points to show up here.',
      }
    )
    .setFooter({ text: 'One house per server · left servers and 0-pt ghosts hidden · !!campaign help' });
}

async function postMap(message, client) {
  const snap = conquest.snapshot();
  const buffer = await conquest.buildMapBuffer();
  const embed = overviewEmbed(snap, message.client);

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
          '• **The Shadow Court** (AI) only grows while players are active, never holds more than a quarter of the map',
          '• Troops hold cities: rival armies in one city fight, an empty city goes neutral',
          '',
          '`!!campaign map` · `me` · `province <name>`',
          '`!!campaign recruit <city or province> <n>` — claims/reinforces ONE city (instant)',
          '`!!campaign move <from> <to> <n>`',
          '`!!campaign siege <fromProvince> <city>` — take one city (tick)',
          '`!!campaign attack <from> <to>` — siege first open city there',
          '`!!campaign invade <province>` — landless foothold (one city)',
          '`!!campaign fortify <city>` — harder to siege (−80 coins)',
          '`!!campaign collect` — treasury → your coins',
          '`!!campaign color #hex` · `orders` · `cancel` · `houses`',
          '`!!campaign ally <server name>` · `unally` — seasonal alliance (no sieging each other)',
          'Seasons reset the map; top houses get treasury prizes automatically',
          'Admin: `channel #ch` · Owner: `start` `pause` `tick` `reset`',
        ].join('\n')
      );
    }

    if (s === 'map') return postMap(message, ctx.client);

    if (s === 'me' || s === 'holdings' || s === 'my') {
      const r = conquest.holdingsSummary(message.guild.id);
      if (r.error) return message.reply(r.error);
      if (!r.rows.length) {
        return message.reply(
          `**${r.house.name}** holds no cities.\n` +
            (r.mapFull
              ? `Map is full → \`!!campaign invade <province>\` (costs ${conquest.INVADE_COST} coins).`
              : '`!!campaign recruit <city or province> <amount>` (e.g. `recruit frostmere 10`).')
        );
      }
      return message.reply(
        `**${r.house.name}** · treasury **${r.treasury}** coins\n` +
          r.rows
            .map(
              (x) =>
                `• **${x.name}** — ${x.troops} troops · cities ${x.citiesHeld}/${x.citiesTotal}` +
                (x.controlled ? ' · **controlled**' : ' · contested')
            )
            .join('\n')
      );
    }

    if (s === 'recruit') {
      if (rest.length < 2) {
        return message.reply('Usage: `!!campaign recruit <city or province> <amount>` e.g. `recruit Sandholt 10`.');
      }
      const amt = rest[rest.length - 1];
      const target = rest.slice(0, -1).join(' ');
      const r = conquest.recruit(message.guild, message.author.id, target, amt);
      if (r.error) return message.reply(r.error);
      return message.reply(
        `✅ **${r.house}** ${r.claimed ? 'claimed' : 'reinforced'} **${r.city}** (${r.province}) with **${r.size}** troops (−${r.cost} coins).` +
          (r.controlled
            ? `\n🏰 You now control all of **${r.province}**.`
            : r.open.length
              ? `\nStill open in ${r.province}: ${r.open.join(', ')} — \`!!campaign recruit <city> <n>\`.`
              : '')
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

    if (s === 'ally') {
      const name = rest.join(' ').trim();
      if (!name) {
        return message.reply('Usage: `!!campaign ally <other server name>` (must already be on the map).');
      }
      const snap = conquest.snapshot();
      const match = Object.values(snap.houses || {}).find(
        (h) => !h.ai && h.name.toLowerCase().includes(name.toLowerCase()) && h.id !== message.guild.id
      );
      if (!match) return message.reply('No matching house on the map. They need to run a campaign command first.');
      const r = conquest.allyWith(message.guild, match.id);
      if (r.error) return message.reply(r.error);
      return message.reply(`Allied with **${r.ally}** for this season. You cannot siege each other.`);
    }

    if (s === 'unally' || s === 'breakally') {
      const r = conquest.clearAlly(message.guild);
      if (r.error) return message.reply(r.error);
      return message.reply(r.was ? `Alliance with **${r.was}** broken.` : 'You had no alliance.');
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
      const armyTotals = {};
      for (const c of p.cities || []) {
        for (const a of snap.armies?.[c.id] || []) {
          armyTotals[a.houseId] = (armyTotals[a.houseId] || 0) + a.size;
        }
      }
      const armies = Object.entries(armyTotals)
        .map(([hid, n]) => `${snap.houses[hid]?.name || hid}: **${n}**`)
        .join('\n');
      const cities = (p.cities || [])
        .map((c) => {
          const co = snap.cityOwner?.[c.id];
          const fort = snap.forts?.[c.id] || 0;
          const who = co ? snap.houses[co]?.name || co : 'Neutral';
          const stacks = (snap.armies?.[c.id] || [])
            .map((a) => {
              const hn = snap.houses[a.houseId]?.name || a.houseId;
              return `${hn} ${a.size}`;
            })
            .join(', ');
          return (
            `• **${c.name}** — ${who} · tax ${c.tax || 0}` +
            (fort ? ` · fort ${fort}` : '') +
            (stacks ? ` · troops: ${stacks}` : ' · troops: —')
          );
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
