const { EmbedBuilder, PermissionFlagsBits, AttachmentBuilder } = require('discord.js');
const conquest = require('../lib/conquest');
const { canvasAvailable } = require('../lib/conquest/render');

// Every campaign action is its own command now. `sub` is the word the shared handler understands
// (and what you type after /campaign args: on slash).
const SUBS = [
  { sub: 'map', cmd: 'map', usage: '!!map', description: 'Show the world map and refresh this server’s map message.' },
  { sub: 'me', cmd: 'me', aliases: ['!!holdings'], usage: '!!me', description: 'Your house’s cities, troops and treasury.' },
  { sub: 'province', cmd: 'province', usage: '!!province <name>', description: 'One province: cities, owners, borders and troops.' },
  { sub: 'houses', cmd: 'houses', usage: '!!houses', description: 'Ranking of every house (server) on the map.' },
  { sub: 'recruit', cmd: 'recruit', usage: '!!recruit <city or province> <amount>', description: 'Claim or reinforce ONE city with troops (costs coins).' },
  { sub: 'move', cmd: 'move', usage: '!!move <from> <to> <amount>', description: 'Move troops between neighboring provinces (next turn).' },
  { sub: 'attack', cmd: 'attack', usage: '!!attack <from> <to>', description: 'Siege the first open city in a neighboring province.' },
  { sub: 'siege', cmd: 'siege', usage: '!!siege <from province> <city>', description: 'Siege one specific city (next turn).' },
  { sub: 'invade', cmd: 'invade', usage: '!!invade <province>', description: 'Landless houses only: gain a foothold by force (costs coins).' },
  { sub: 'fortify', cmd: 'fortify', usage: '!!fortify <city>', description: 'Make a city you own harder to siege.' },
  { sub: 'collect', cmd: 'collect', usage: '!!collect', description: 'Take your cities’ tax as coins.' },
  { sub: 'ally', cmd: 'ally', usage: '!!ally <server name>', description: 'Seasonal alliance with another server.' },
  { sub: 'unally', cmd: 'unally', usage: '!!unally', description: 'Break your alliance.' },
  { sub: 'color', cmd: 'housecolor', usage: '!!housecolor #hex', description: 'Recolor your house on the map.' },
  { sub: 'orders', cmd: 'orders', usage: '!!orders', description: 'Your queued moves and sieges.' },
  { sub: 'cancel', cmd: 'cancelorders', usage: '!!cancelorders', description: 'Cancel all your queued orders.' },
  { sub: 'channel', cmd: 'mapchannel', usage: '!!mapchannel <#channel|off>', description: 'Pick where the live map is posted (Manage Server).' },
  { sub: 'guide', cmd: 'guide', usage: '!!guide', description: 'How the World Campaign works, step by step.' },
];
const OWNER_SUBS = [
  { sub: 'start', cmd: 'campaignstart', usage: '!!campaignstart', description: 'Owner: start the global campaign.' },
  { sub: 'pause', cmd: 'campaignpause', usage: '!!campaignpause', description: 'Owner: pause or resume the campaign.' },
  { sub: 'tick', cmd: 'campaigntick', usage: '!!campaigntick', description: 'Owner: resolve a turn now.' },
  { sub: 'reset', cmd: 'campaignreset', usage: '!!campaignreset', description: 'Owner: reset the world map.' },
];
const BY_SUB = new Map([...SUBS, ...OWNER_SUBS].map((x) => [x.sub, x]));

// Old hints inside engine messages ("!!campaign siege") become the new command names
function hints(text) {
  return String(text).replace(/!!campaign\s+([a-z]+)/gi, (whole, word) => {
    const w = word.toLowerCase();
    if (w === 'help') return '!!guide';
    const hit = BY_SUB.get(w);
    return hit ? `!!${hit.cmd}` : whole;
  });
}

function guideEmbed() {
  const c = conquest;
  return new EmbedBuilder()
    .setColor(0xc9a227)
    .setTitle('🗺️ World Campaign: Guide')
    .setDescription(
      'One shared map. **Every server is a house** and everyone in it plays for the same side. ' +
        'Turns resolve every **6 hours**.'
    )
    .addFields(
      {
        name: '1 · The basics',
        value: [
          '• The map is split into **provinces**, each holding a few **cities**.',
          '• Own **every city** in a province to **control** it.',
          '• Each turn: queued sieges and moves resolve, cities pay tax, houses earn points.',
          '• Seasons reset the map every month. The top 3 houses win treasury prizes.',
        ].join('\n'),
      },
      {
        name: '2 · Getting started',
        value: [
          '1. `!!map` shows the board, `!!province <name>` shows one province’s cities.',
          `2. \`!!recruit <city> <amount>\` claims a neutral city and garrisons it (**${c.RECRUIT_COST ?? 8} coins per troop**, 1–${c.MAX_RECRUIT_PER_TICK ?? 40} at a time, paid from YOUR coins).`,
          '3. Keep growing next to land you already hold. You can only claim neutral cities **adjacent** to your territory.',
          '4. `!!me` shows everything your house owns.',
        ].join('\n'),
      },
      {
        name: '3 · Fighting',
        value: [
          `• \`!!siege <your province> <city>\` attacks one city. Needs **${c.SIEGE_MIN_TROOPS ?? 5}+ free troops** in your province (1 troop always stays to hold each city you own).`,
          '• `!!attack <from> <to>` sieges the first open city in a neighboring province.',
          '• `!!move <from> <to> <amount>` shifts troops between neighboring provinces where you hold a city.',
          '• Orders resolve on the **next turn**. `!!orders` lists them, `!!cancelorders` clears them.',
          '• The bigger army in a city wins. The loser is wiped out and the winner bleeds. A city with no troops goes neutral.',
        ].join('\n'),
      },
      {
        name: '4 · Defence & money',
        value: [
          `• \`!!fortify <city>\`: ${c.FORT_COST ?? 40} coins, up to level ${c.MAX_FORT ?? 3}, +5 defence per level.`,
          '• `!!collect` turns your cities’ tax into coins.',
          `• \`!!invade <province>\` is for a house with **no land** (${c.INVADE_COST ?? 120} coins, ${c.INVADE_TROOPS ?? 18} troops, fights the holder).`,
        ].join('\n'),
      },
      {
        name: '5 · Allies & the Shadow Court',
        value: [
          '• `!!ally <server name>` is a seasonal alliance: you can’t siege each other and you hold cities together. `!!unally` ends it.',
          '• **The Shadow Court** is an AI house. It only grows while players are active, holds at most a quarter of the map, and keeps small armies (never more than a share of the strongest real house).',
        ].join('\n'),
      },
      {
        name: '6 · Tips',
        value: [
          '• Spread troops across the cities you want to keep. An empty city is abandoned.',
          '• `!!mapchannel #channel` (Manage Server) keeps a live map message updated.',
          '• Slash: `/campaign args: recruit sandholt 10`. Any command above works as the argument (`args: guide`, `args: map`...).',
        ].join('\n'),
      }
    )
    .setFooter({ text: 'Stuck? !!help campaign lists every campaign command.' });
}

function overviewEmbed(snap, client) {
  let houses = conquest.visibleHouses ? conquest.visibleHouses(client) : Object.values(snap.houses || {});

  if (!conquest.visibleHouses) {
    houses = houses.filter((h) => {
      if (h.ai) return true;
      return (h.score || 0) > 0;
    });
  }

  const top = houses
    .slice(0, 8)
    .map((h, i) => `${i + 1}. **${h.name}**: ${h.score || 0} pts`)
    .join('\n');

  const held = Object.values(snap.owner || {}).filter(Boolean).length;
  const total = conquest.listProvinces().length;
  const claimedCities =
    snap.claimedCities != null ? snap.claimedCities : Object.values(snap.cityOwner || {}).filter(Boolean).length;
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
          : 'The **global** campaign is active. Every server is one house on the same map.'
        : 'Campaign offline. Bot owner: `!!campaignstart`.'
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
        value: top || 'None active yet. Recruit or score points to show up here.',
      }
    )
    .setFooter({ text: 'One house per server · new here? !!guide' });
}

async function postMap(message, client) {
  const snap = conquest.snapshot();
  const buffer = await conquest.buildMapBuffer();
  const embed = overviewEmbed(snap, message.client);

  if (!buffer) {
    embed.addFields({
      name: 'Map',
      value: canvasAvailable() ? 'Could not render.' : 'Install `@napi-rs/canvas` on the host.',
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

// One handler for every campaign action (separate prefix commands AND /campaign args: ...)
async function handle(s, rest, message, ctx) {
  const say = (payload) => message.reply(typeof payload === 'string' ? hints(payload) : payload);

  if (s === 'guide' || s === 'help') return say({ embeds: [guideEmbed()] });
  if (!message.guild) return say('Campaign only works in a server.');

  const isOwner = ctx.isOwner;
  const isAdmin = isOwner || message.member?.permissions?.has(PermissionFlagsBits.ManageGuild);

  // Register this server as a house named after the guild
  conquest.ensureHouse(message.guild);

  if (!s || s === 'status') {
    return say({ embeds: [overviewEmbed(conquest.snapshot(), message.client)] });
  }

  if (s === 'map') return postMap(message, ctx.client);

  if (s === 'me' || s === 'holdings' || s === 'my') {
    const r = conquest.holdingsSummary(message.guild.id);
    if (r.error) return say(r.error);
    if (!r.rows.length) {
      return say(
        `**${r.house.name}** holds no cities.\n` +
          (r.mapFull
            ? `Map is full → \`!!invade <province>\` (costs ${conquest.INVADE_COST} coins).`
            : '`!!recruit <city or province> <amount>` (e.g. `!!recruit frostmere 10`).')
      );
    }
    return say(
      `**${r.house.name}** · treasury **${r.treasury}** coins\n` +
        r.rows
          .map(
            (x) =>
              `• **${x.name}**: ${x.troops} troops · cities ${x.citiesHeld}/${x.citiesTotal}` +
              (x.controlled ? ' · **controlled**' : ' · contested')
          )
          .join('\n')
    );
  }

  if (s === 'recruit') {
    if (rest.length < 2) return say('Usage: `!!recruit <city or province> <amount>` e.g. `!!recruit Sandholt 10`.');
    const amt = rest[rest.length - 1];
    const target = rest.slice(0, -1).join(' ');
    const r = conquest.recruit(message.guild, message.author.id, target, amt);
    if (r.error) return say(r.error);
    return say(
      `✅ **${r.house}** ${r.claimed ? 'claimed' : 'reinforced'} **${r.city}** (${r.province}) with **${r.size}** troops (−${r.cost} coins).` +
        (r.controlled
          ? `\n🏰 You now control all of **${r.province}**.`
          : r.open.length
            ? `\nStill open in ${r.province}: ${r.open.join(', ')}. Use \`!!recruit <city> <n>\`.`
            : '')
    );
  }

  if (s === 'move') {
    const [from, to, amt] = rest;
    const r = conquest.move(message.guild, message.author.id, from, to, amt);
    if (r.error) return say(r.error);
    return say(`Queued move: **${r.size}** ${r.from} → ${r.to} (next turn).`);
  }

  if (s === 'attack') {
    const [from, to] = rest;
    const r = conquest.attack(message.guild, message.author.id, from, to);
    if (r.error) return say(r.error);
    return say(`Queued siege: **${r.city}** via **${r.from}** → **${r.to}** (power ${r.power}).\n${r.note || ''}`);
  }

  if (s === 'siege') {
    const from = rest[0];
    const city = rest.slice(1).join(' ');
    const r = conquest.siege(message.guild, message.author.id, from, city);
    if (r.error) return say(r.error);
    return say(`Queued siege: **${r.city}** (${r.province}) from **${r.from}** (power ${r.power}). Resolves next turn.`);
  }

  if (s === 'fortify') {
    const r = conquest.fortify(message.guild, message.author.id, rest.join(' '));
    if (r.error) return say(r.error);
    return say(`Fortified **${r.city}** to level **${r.level}** (−${r.cost} coins).`);
  }

  if (s === 'collect' || s === 'treasury' || s === 'tax') {
    const r = conquest.collectTax(message.guild, message.author.id);
    if (r.error) return say(r.error);
    return say(`Collected **${r.amount}** coins from **${r.house}**’s cities.`);
  }

  if (s === 'ally') {
    const name = rest.join(' ').trim();
    if (!name) return say('Usage: `!!ally <other server name>` (they must already be on the map).');
    const snap = conquest.snapshot();
    const match = Object.values(snap.houses || {}).find(
      (h) => !h.ai && h.name.toLowerCase().includes(name.toLowerCase()) && h.id !== message.guild.id
    );
    if (!match) return say('No matching house on the map. They need to run a campaign command first.');
    const r = conquest.allyWith(message.guild, match.id);
    if (r.error) return say(r.error);
    return say(`Allied with **${r.ally}** for this season. You cannot siege each other.`);
  }

  if (s === 'unally' || s === 'breakally') {
    const r = conquest.clearAlly(message.guild);
    if (r.error) return say(r.error);
    return say(r.was ? `Alliance with **${r.was}** broken.` : 'You had no alliance.');
  }

  if (s === 'invade') {
    const r = conquest.invade(message.guild, message.author.id, rest.join(' '));
    if (r.error) return say(r.error);
    return say(`Invasion of **${r.province}** queued (−${r.cost} coins, power ${r.power}). Resolves next turn.`);
  }

  if (s === 'color' || s === 'tint') {
    const r = conquest.setHouseColor(message.guild.id, rest.join(' '));
    if (r.error) return say(r.error);
    return say(`**${r.name}** tint → \`${r.color}\``);
  }

  if (s === 'orders') {
    const list = conquest.listOrders(message.guild.id);
    if (!list.length) return say('No queued orders for this server.');
    return say(
      list
        .map((o) => {
          if (o.type === 'move') return `• move ${o.size} ${o.fromId} → ${o.toId}`;
          if (o.type === 'attack') return `• attack ${o.fromId} → ${o.toId}`;
          if (o.type === 'siege') return `• siege ${o.cityId} from ${o.fromId}`;
          if (o.type === 'invade') return `• invade ${o.toId}`;
          return `• ${o.type}`;
        })
        .join('\n')
    );
  }

  if (s === 'cancel') {
    const n = conquest.cancelOrders(message.guild.id);
    return say(n ? `Cancelled **${n}** order(s).` : 'Nothing to cancel.');
  }

  if (s === 'houses') {
    const houses = conquest.visibleHouses(message.client);
    if (!houses.length) return say('No active houses to show.');
    return say(
      houses
        .map((h, i) => `${i + 1}. **${h.name}**: ${h.score || 0} pts`)
        .join('\n')
        .slice(0, 1900)
    );
  }

  if (s === 'province') {
    const p = conquest.resolveName(rest.join(' '));
    if (!p) return say('Unknown province.');
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
          .map((a) => `${snap.houses[a.houseId]?.name || a.houseId} ${a.size}`)
          .join(', ');
        return (
          `• **${c.name}**: ${who} · tax ${c.tax || 0}` +
          (fort ? ` · fort ${fort}` : '') +
          (stacks ? ` · troops: ${stacks}` : ' · troops: none')
        );
      })
      .join('\n');
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(p.name)
      .addFields(
        { name: 'Owner', value: house ? house.name : 'Neutral', inline: true },
        { name: 'Borders', value: p.neighbors.map((id) => conquest.getProvince(id)?.name || id).join(', ') || '—' },
        { name: 'Cities', value: cities || '—' },
        { name: 'Armies', value: armies || 'None' }
      );
    return say({ embeds: [embed] });
  }

  if (s === 'channel') {
    if (!isAdmin) return say('Manage Server required.');
    const target = rest[0];
    if (!target || target.toLowerCase() === 'off') {
      conquest.setChannel(message.guild.id, null);
      conquest.setMapMessageId(message.guild.id, null);
      return say('Campaign channel cleared for this server.');
    }
    const id = (target.match(/^<#(\d+)>$/) || target.match(/^(\d{17,20})$/))?.[1];
    if (!id) return say('Mention a channel or paste its ID.');
    conquest.setChannel(message.guild.id, id);
    return say(`This server’s campaign map channel → <#${id}>.`);
  }

  if (s === 'start') {
    if (!isOwner) return say('Bot owner only (global campaign).');
    conquest.startCampaign();
    return say('Global campaign **started**.');
  }

  if (s === 'pause') {
    if (!isOwner) return say('Bot owner only.');
    const snap = conquest.snapshot();
    conquest.pauseCampaign(!snap.paused);
    return say(conquest.snapshot().paused ? 'Paused.' : 'Resumed.');
  }

  if (s === 'tick') {
    if (!isOwner) return say('Bot owner only.');
    const result = conquest.resolveTick();
    if (result.skipped) return say('Nothing to resolve (inactive/paused).');
    const lines = (result.reports || []).slice(0, 15).join('\n') || 'Quiet turn.';
    await say(`**Turn ${result.turn}**\n${lines}`.slice(0, 1900));
    return postMap(message, ctx.client);
  }

  if (s === 'reset') {
    if (!isOwner) return say('Bot owner only.');
    conquest.resetWorld();
    return say('World campaign **reset** (global). Run `!!campaignstart` if needed.');
  }

  return say('Unknown campaign action. See `!!guide`.');
}

// "!!campaign": overview on prefix, and the single slash command (/campaign args: recruit sandholt 10)
const campaignCommand = {
  name: '!!campaign',
  aliases: ['!!conquest', '!!warroom'],
  description: 'World campaign overview. Slash: /campaign args: <action> (see !!guide).',
  usage: '!!campaign',
  access: 'free',
  async run(message, arg, ctx) {
    const raw = (ctx.rawArg || '').trim();
    const [word, ...rest] = raw.split(/\s+/);
    const s = (word || '').toLowerCase();

    if (!ctx.viaSlash && s && s !== 'status') {
      const hit = BY_SUB.get(s) || [...BY_SUB.values()].find((x) => x.cmd === s);
      return message.reply(
        hit
          ? `Campaign commands are separate now: use \`!!${hit.cmd}\`. Full list in \`!!guide\`.`
          : 'Campaign commands are separate now (like `!!recruit`, `!!map`, `!!siege`). Full list in `!!guide`.'
      );
    }
    return handle(s, rest, message, ctx);
  },
};

const make = (x, owner) => ({
  name: `!!${x.cmd}`,
  aliases: x.aliases || [],
  usage: x.usage,
  description: x.description,
  access: owner ? 'owner' : 'free',
  hidden: Boolean(owner),
  noSlash: true,
  async run(message, arg, ctx) {
    const rest = (ctx.rawArg || '').split(/\s+/).filter(Boolean);
    return handle(x.sub, rest, message, ctx);
  },
});

module.exports = [campaignCommand, ...SUBS.map((x) => make(x, false)), ...OWNER_SUBS.map((x) => make(x, true))];
