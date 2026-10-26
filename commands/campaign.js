const {
  EmbedBuilder,
  PermissionFlagsBits,
  AttachmentBuilder,
} = require('discord.js');
const conquest = require('../lib/conquest');
const { canvasAvailable } = require('../lib/conquest/render');

function overviewEmbed(snap) {
  const houses = Object.values(snap.houses || {});
  const top = houses
    .slice()
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 5)
    .map((h, i) => `${i + 1}. **${h.name}** — ${h.score || 0} pts · ${h.members.length} members`)
    .join('\n');

  const held = Object.values(snap.owner || {}).filter(Boolean).length;
  const total = conquest.listProvinces().length;

  return new EmbedBuilder()
    .setColor(0xc9a227)
    .setTitle('Campaign')
    .setDescription(
      snap.active
        ? snap.paused
          ? 'The campaign is **paused**.'
          : 'The campaign is **active**.'
        : 'No campaign is running. An admin can start one with `!!campaign start`.'
    )
    .addFields(
      {
        name: 'Season',
        value: `${snap.seasonKey || '—'} · Turn **${snap.turn || 0}**`,
        inline: true,
      },
      {
        name: 'Map',
        value: `${held}/${total} provinces claimed`,
        inline: true,
      },
      {
        name: 'Next resolve',
        value: snap.nextTickAt ? `<t:${Math.floor(snap.nextTickAt / 1000)}:R>` : '—',
        inline: true,
      },
      {
        name: 'Houses',
        value: top || 'None yet. `!!campaign create <name>`',
      }
    )
    .setFooter({ text: '!!campaign help · map updates on each resolve' });
}

async function postMap(message, client) {
  const snap = conquest.snapshot();
  const buffer = await conquest.buildMapBuffer();
  const embed = overviewEmbed(snap);

  if (!buffer) {
    embed.addFields({
      name: 'Map render',
      value: canvasAvailable()
        ? 'Could not build the image this time.'
        : 'Map images need `@napi-rs/canvas` installed on the host (`npm install @napi-rs/canvas`).',
    });
    return message.reply({ embeds: [embed] });
  }

  const file = new AttachmentBuilder(buffer, { name: 'campaign-map.png' });
  embed.setImage('attachment://campaign-map.png');

  const channelId = snap.channelId;
  if (channelId && client) {
    try {
      const ch = await client.channels.fetch(channelId);
      if (ch?.isTextBased?.()) {
        if (snap.mapMessageId) {
          const msg = await ch.messages.fetch(snap.mapMessageId).catch(() => null);
          if (msg) {
            await msg.edit({ embeds: [embed], files: [file] });
            return message.reply({ content: `Map updated in <#${channelId}>.`, embeds: [embed], files: [file] });
          }
        }
        const sent = await ch.send({ embeds: [embed], files: [file] });
        conquest.setMapMessageId(sent.id);
        return message.reply({ content: `Map posted in <#${channelId}>.` });
      }
    } catch {
      /* fall through to reply */
    }
  }

  return message.reply({ embeds: [embed], files: [file] });
}

module.exports = {
  name: '!!campaign',
  aliases: ['!!conquest', '!!warroom'],
  description: 'Season campaign: houses, armies, and the realm map.',
  usage: '!!campaign [map|create|join|leave|recruit|move|attack|orders|cancel|houses|province|channel|start|pause|tick|help]',
  access: 'free',
  async run(message, arg, ctx) {
    const raw = (ctx.rawArg || '').trim();
    const [sub, ...rest] = raw.split(/\s+/);
    const s = (sub || '').toLowerCase();
    const isAdmin =
      ctx.isOwner || message.member?.permissions?.has(PermissionFlagsBits.ManageGuild);

    if (!s || s === 'status' || s === 'help') {
      if (s === 'help') {
        return message.reply(
          [
            '**Campaign** — season map war (houses & armies)',
            '`!!campaign` — status',
            '`!!campaign map` — render the map',
            '`!!campaign create <name>` / `join <name>` / `leave`',
            '`!!campaign recruit <province> <amount>` (40 coins/troop)',
            '`!!campaign move <from> <to> <amount>`',
            '`!!campaign attack <from> <to>`',
            '`!!campaign orders` · `!!campaign cancel`',
            '`!!campaign houses` · `!!campaign province <name>`',
            '`!!campaign color #8b2942` — house leader sets map tint',
            'Admin: `channel #ch` · `start` · `pause` · `tick`',
            'Orders resolve every **6 hours**. Adjacent provinces only.',
          ].join('\n')
        );
      }
      return message.reply({ embeds: [overviewEmbed(conquest.snapshot())] });
    }

    if (s === 'map') return postMap(message, ctx.client);

    if (s === 'create') {
      const name = rest.join(' ');
      const r = conquest.createHouse(message.author.id, name);
      if (r.error) return message.reply(r.error);
      return message.reply(`House **${r.house.name}** founded. You are the leader.`);
    }

    if (s === 'join') {
      const r = conquest.joinHouse(message.author.id, rest.join(' '));
      if (r.error) return message.reply(r.error);
      return message.reply(`Joined **${r.house.name}**.`);
    }

    if (s === 'leave') {
      const r = conquest.leaveHouse(message.author.id);
      if (r.error) return message.reply(r.error);
      return message.reply('You left your house.');
    }

    if (s === 'color' || s === 'tint') {
      const r = conquest.setHouseColor(message.author.id, rest.join(' '));
      if (r.error) return message.reply(r.error);
      return message.reply(
        `House **${r.name}** tint set to \`${r.color}\`. Claimed provinces use this faint overlay on the map.`
      );
    }

    if (s === 'recruit') {
      const [prov, amt] = rest;
      const r = conquest.recruit(message.author.id, prov, amt);
      if (r.error) return message.reply(r.error);
      return message.reply(
        `Queued recruit: **${r.size}** in **${r.province}** (−${r.cost} coins). Resolves on the next tick.`
      );
    }

    if (s === 'move') {
      const [from, to, amt] = rest;
      const r = conquest.move(message.author.id, from, to, amt);
      if (r.error) return message.reply(r.error);
      return message.reply(`Queued move: **${r.size}** ${r.from} → ${r.to}.`);
    }

    if (s === 'attack') {
      const [from, to] = rest;
      const r = conquest.attack(message.author.id, from, to);
      if (r.error) return message.reply(r.error);
      return message.reply(`Queued attack: **${r.from}** → **${r.to}** (power ${r.power}).`);
    }

    if (s === 'orders') {
      const list = conquest.listOrders(message.author.id);
      if (!list.length) return message.reply('No queued orders.');
      return message.reply(
        list
          .map((o) => {
            if (o.type === 'recruit') return `• recruit ${o.size} @ ${o.provinceId}`;
            if (o.type === 'move') return `• move ${o.size} ${o.fromId} → ${o.toId}`;
            if (o.type === 'attack') return `• attack ${o.fromId} → ${o.toId}`;
            return `• ${o.type}`;
          })
          .join('\n')
      );
    }

    if (s === 'cancel') {
      const n = conquest.cancelOrders(message.author.id);
      return message.reply(n ? `Cancelled **${n}** order(s).` : 'No orders to cancel.');
    }

    if (s === 'houses') {
      const houses = Object.values(conquest.snapshot().houses || {});
      if (!houses.length) return message.reply('No houses yet.');
      return message.reply(
        houses
          .map((h) => `**${h.name}** — leader <@${h.leaderId}> · ${h.members.length} members · ${h.score || 0} pts`)
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
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(p.name)
        .addFields(
          { name: 'Owner', value: house ? house.name : 'Neutral', inline: true },
          { name: 'Borders', value: p.neighbors.map((id) => conquest.getProvince(id)?.name || id).join(', '), inline: false },
          { name: 'Armies', value: armies || 'None', inline: false }
        );
      return message.reply({ embeds: [embed] });
    }

    if (s === 'channel') {
      if (!isAdmin) return message.reply('Manage Server required.');
      const target = rest[0];
      if (!target || target.toLowerCase() === 'off') {
        conquest.setChannel(null);
        conquest.setMapMessageId(null);
        return message.reply('Campaign channel cleared.');
      }
      const id = (target.match(/^<#(\d+)>$/) || target.match(/^(\d{17,20})$/))?.[1];
      if (!id) return message.reply('Mention a channel or paste its ID.');
      conquest.setChannel(id);
      return message.reply(`Campaign map channel set to <#${id}>.`);
    }

    if (s === 'start') {
      if (!isAdmin) return message.reply('Manage Server required.');
      conquest.startCampaign();
      return message.reply('Campaign **started**. Turns resolve every 6 hours.');
    }

    if (s === 'pause') {
      if (!isAdmin) return message.reply('Manage Server required.');
      const snap = conquest.snapshot();
      conquest.pauseCampaign(!snap.paused);
      return message.reply(conquest.snapshot().paused ? 'Campaign **paused**.' : 'Campaign **resumed**.');
    }

    if (s === 'tick') {
      if (!isAdmin) return message.reply('Manage Server required.');
      const result = conquest.resolveTick(message.guild.id);
      if (result.skipped) return message.reply('Nothing to resolve (inactive or paused).');
      const lines = (result.reports || []).slice(0, 12).join('\n') || 'No movements this tick.';
      await message.reply(`**Turn ${result.turn} resolved.**\n${lines}`.slice(0, 1900));
      return postMap(message, ctx.client);
    }

    return message.reply('Unknown subcommand. Try `!!campaign help`.');
  },
};
