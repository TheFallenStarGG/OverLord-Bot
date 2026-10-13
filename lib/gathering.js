// !!fish / !!mine — pick a zone, optional timing minigame, ranks, stats
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { getUser, peekUser, markDirty, recordQuest, fmt, topBy } = require('./economy');
const { FISH, ORE, GEAR_LUCK, GATHER_COOLDOWN_MS, rollLoot } = require('./items');
const { mult, bonus } = require('./modifiers');
const { perk } = require('./petData');
const { weatherBonus, weatherMult, current: currentWeather } = require('./weather');

const SESSION_MS = 90 * 1000;

const ZONES = {
  fish: [
    { id: 'pond', emoji: '🏞️', name: 'Pond', blurb: 'Safe shallows. Commons show up a lot.', luck: 0, mishap: 0 },
    { id: 'river', emoji: '🌊', name: 'River', blurb: 'Balanced water. A bit more bite.', luck: 0.15, mishap: 0.02 },
    { id: 'ocean', emoji: '⛵', name: 'Ocean', blurb: 'Dangerous and rich. Rares love it.', luck: 0.35, mishap: 0.08 },
  ],
  mine: [
    { id: 'surface', emoji: '🪨', name: 'Surface', blurb: 'Easy digs. Stone and coal country.', luck: 0, mishap: 0 },
    { id: 'cave', emoji: '🕳️', name: 'Cave', blurb: 'Darker tunnels. Better ores.', luck: 0.15, mishap: 0.02 },
    { id: 'deep', emoji: '⛏️', name: 'Deep veins', blurb: 'Risky shafts. Gems hide here.', luck: 0.35, mishap: 0.08 },
  ],
};

const RANKS = {
  fish: [
    { min: 0, name: 'Weekend Angler', emoji: '🎣' },
    { min: 25, name: 'River Regular', emoji: '🐟' },
    { min: 75, name: 'Tide Hunter', emoji: '🌊' },
    { min: 200, name: 'Old Salt', emoji: '⛵' },
    { min: 500, name: 'Sea Legend', emoji: '🦈' },
  ],
  mine: [
    { min: 0, name: 'Pebble Picker', emoji: '🪨' },
    { min: 25, name: 'Tunnel Hand', emoji: '🕯️' },
    { min: 75, name: 'Vein Seeker', emoji: '🔩' },
    { min: 200, name: 'Deep Delver', emoji: '💎' },
    { min: 500, name: 'Mountain King', emoji: '👑' },
  ],
};

const CONFIG = {
  fish: {
    table: FISH,
    slot: 'rod',
    cooldownKey: 'lastFish',
    boostKey: 'netLeft',
    countKey: 'fishTrips',
    intro: '🎣 Fishing',
    verb: 'caught',
    mishap: 'A sudden squall spooked every fish away.',
  },
  mine: {
    table: ORE,
    slot: 'pick',
    cooldownKey: 'lastMine',
    boostKey: 'dynamiteLeft',
    countKey: 'mineTrips',
    intro: '⛏️ Mining',
    verb: 'found',
    mishap: 'A cave-in forced you back empty-handed.',
  },
};

function rankFor(kind, trips) {
  let cur = RANKS[kind][0];
  for (const r of RANKS[kind]) if (trips >= r.min) cur = r;
  return cur;
}

function btn(sid, key, label, style, emoji) {
  const b = new ButtonBuilder().setCustomId(`gath:${sid}:${key}`).setLabel(label).setStyle(style);
  if (emoji) b.setEmoji(emoji);
  return b;
}

function tripsOf(u, kind) {
  const key = CONFIG[kind].countKey;
  u[key] ??= 0;
  return u[key];
}

function hubEmbed(kind, userId) {
  const u = peekUser(userId);
  const cfg = CONFIG[kind];
  const trips = tripsOf(u, kind);
  const rank = rankFor(kind, trips);
  const weather = currentWeather();
  const now = Date.now();
  const readyAt =
    (u[cfg.cooldownKey] ?? 0) + GATHER_COOLDOWN_MS * mult(`${kind}Cd`) * weatherMult(`${kind}Cd`);
  const ready = now >= readyAt;
  const zones = ZONES[kind];
  return new EmbedBuilder()
    .setColor(kind === 'fish' ? 0x3498db : 0x95a5a6)
    .setTitle(`${cfg.intro}`)
    .setDescription(
      `${rank.emoji} **${rank.name}** · **${trips}** trips\n` +
        (ready ? '✅ Ready.\n' : `⏳ Rest until <t:${Math.ceil(readyAt / 1000)}:R>.\n`) +
        `Gear tier: **${u.gear?.[cfg.slot] ?? 0}** · Weather: ${weather.def.emoji} ${weather.def.name}\n\n` +
        zones.map((z) => `${z.emoji} **${z.name}** — ${z.blurb}`).join('\n') +
        `\n\nPick a zone. You can try a quick **timing** bonus before the haul.`
    )
    .setFooter({ text: `!!${kind} stats · !!${kind} top` });
}

function hubRow(kind, sid, ready) {
  const row = new ActionRowBuilder();
  if (ready) {
    for (const z of ZONES[kind]) {
      row.addComponents(btn(sid, z.id, z.name, ButtonStyle.Primary, z.emoji));
    }
  }
  row.addComponents(btn(sid, 'stats', 'Stats', ButtonStyle.Secondary, '📊'));
  return row;
}

function resolveTrip(kind, userId, zoneId, timed) {
  const cfg = CONFIG[kind];
  const u = getUser(userId);
  const now = Date.now();
  const weather = currentWeather();
  const readyAt =
    (u[cfg.cooldownKey] ?? 0) + GATHER_COOLDOWN_MS * mult(`${kind}Cd`) * weatherMult(`${kind}Cd`);
  if (now < readyAt) {
    return { ok: false, nextTs: Math.ceil(readyAt / 1000) };
  }

  const zone = ZONES[kind].find((z) => z.id === zoneId) || ZONES[kind][0];
  u[cfg.cooldownKey] = now;
  u[cfg.countKey] = tripsOf(u, kind) + 1;

  const mishapChance = (zone.mishap || 0) + weatherBonus(`${kind}Mishap`);
  if (Math.random() < mishapChance) {
    markDirty();
    return {
      ok: true,
      empty: true,
      zone,
      text:
        `${cfg.intro}\n${zone.emoji} **${zone.name}**\n${weather.def.emoji} ${cfg.mishap}\n` +
        `-# Cooldown still counts · \`!!forecast\``,
    };
  }

  const luck = Math.max(
    -0.5,
    (GEAR_LUCK[u.gear[cfg.slot]] || 0) +
      ((u.effects.luckUntil ?? 0) > now ? 0.5 : 0) +
      bonus(`${kind}Luck`) +
      weatherBonus(`${kind}Luck`) +
      perk(u, 'luck') +
      (zone.luck || 0) +
      (timed ? 0.25 : 0)
  );

  let rolls = 1;
  if ((u.effects[cfg.boostKey] ?? 0) > 0) {
    rolls = 2;
    u.effects[cfg.boostKey]--;
  }

  const found = Array.from({ length: rolls }, () => rollLoot(cfg.table, luck));
  for (const item of found) u.inventory[item.id] = (u.inventory[item.id] ?? 0) + 1;
  recordQuest(userId, kind);
  markDirty();

  const lines = found.map((f) => `${f.emoji} **${f.name}** (worth ${fmt(f.value)})`);
  const best = Math.max(...found.map((f) => f.value));
  const rank = rankFor(kind, u[cfg.countKey]);
  const affected = weather.def.fx[`${kind}Luck`] || weather.def.fx[`${kind}Cd`];
  const weatherNote = affected
    ? `\n-# ${weather.def.emoji} ${weather.def.name} · \`!!forecast\``
    : '';

  return {
    ok: true,
    empty: false,
    zone,
    rank,
    text:
      `${cfg.intro} — ${zone.emoji} **${zone.name}**\n` +
      `You ${cfg.verb}: ${lines.join(' and ')}${rolls === 2 ? ' (rolled twice!)' : ''}` +
      (timed ? '\n✨ Perfect timing bonus!' : '') +
      `${best >= 300 ? '\n🎉 **What a find!**' : ''}\n` +
      `${rank.emoji} ${rank.name} · **${u[cfg.countKey]}** trips\n` +
      `-# Sell with \`!!sell all\`${weatherNote}`,
  };
}

function statsEmbed(kind, userId) {
  const u = peekUser(userId);
  const trips = tripsOf(u, kind);
  const rank = rankFor(kind, trips);
  return new EmbedBuilder()
    .setColor(kind === 'fish' ? 0x3498db : 0x95a5a6)
    .setTitle(`📊 ${kind === 'fish' ? 'Fishing' : 'Mining'} stats`)
    .setDescription(
      `${rank.emoji} **${rank.name}**\nTrips: **${trips}**\nGear tier: **${u.gear?.[CONFIG[kind].slot] ?? 0}**`
    );
}

async function runGather(message, kind, opts = {}) {
  const parts = message.content.trim().split(/\s+/);
  const sub = (parts[1] || '').toLowerCase();

  if (sub === 'stats' || sub === 'stat') {
    return message.reply({ embeds: [statsEmbed(kind, message.author.id)] });
  }
  if (sub === 'top' || sub === 'lb') {
    const key = CONFIG[kind].countKey;
    const rows = topBy((u) => u[key] || 0, 10).filter((r) => r.value > 0);
    const lines = rows.map((r, i) => {
      const rank = rankFor(kind, r.value);
      return `**${i + 1}.** <@${r.id}> — ${r.value} trips (${rank.emoji} ${rank.name})`;
    });
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(kind === 'fish' ? 0x3498db : 0x95a5a6)
          .setTitle(kind === 'fish' ? '🎣 Top anglers' : '⛏️ Top miners')
          .setDescription(lines.join('\n') || 'Nobody yet.'),
      ],
    });
  }

  if (opts.legacy) {
    const zone = ZONES[kind][Math.floor(Math.random() * ZONES[kind].length)];
    const r = resolveTrip(kind, message.author.id, zone.id, false);
    if (!r.ok) return message.reply(`⏳ Ready <t:${r.nextTs}:R>.`);
    return message.reply({ embeds: [new EmbedBuilder().setColor(r.empty ? 0xe67e22 : 0x2ecc71).setDescription(r.text)] });
  }

  const u = getUser(message.author.id);
  tripsOf(u, kind);
  const cfg = CONFIG[kind];
  const now = Date.now();
  const readyAt =
    (u[cfg.cooldownKey] ?? 0) + GATHER_COOLDOWN_MS * mult(`${kind}Cd`) * weatherMult(`${kind}Cd`);
  const ready = now >= readyAt;
  const sid = `${message.id}${Date.now().toString(36)}`;
  const msg = await message.reply({
    embeds: [hubEmbed(kind, message.author.id)],
    components: [hubRow(kind, sid, ready)],
  });

  const collector = msg.createMessageComponentCollector({
    time: SESSION_MS,
    filter: (i) => i.user.id === message.author.id && i.customId.startsWith(`gath:${sid}:`),
  });

  let phase = 'zone';
  let zoneId = null;
  let timingAnswer = null;

  collector.on('collect', async (i) => {
    const key = i.customId.split(':')[2];
    try {
      if (key === 'stats') {
        await i.update({
          embeds: [statsEmbed(kind, message.author.id)],
          components: [hubRow(kind, sid, ready)],
        });
        return;
      }
      if (phase === 'zone') {
        if (!ZONES[kind].some((z) => z.id === key)) return;
        const u2 = getUser(message.author.id);
        const ra =
          (u2[cfg.cooldownKey] ?? 0) +
          GATHER_COOLDOWN_MS * mult(`${kind}Cd`) * weatherMult(`${kind}Cd`);
        if (Date.now() < ra) {
          await i.update({
            embeds: [hubEmbed(kind, message.author.id)],
            components: [hubRow(kind, sid, false)],
          });
          return;
        }
        zoneId = key;
        phase = 'timing';
        const fishPrompts = [
          { a: '1', line: 'Something heavy tugs the line — **Reel** it in now!' },
          { a: '2', line: 'A cautious nibble… **Wait** or you will spook it.' },
          { a: '3', line: 'It is getting away — **Yank** hard!' },
        ];
        const minePrompts = [
          { a: '1', line: 'The ore is on the **Left** wall — swing there!' },
          { a: '2', line: 'Sparkle in the **Center** — hit the middle!' },
          { a: '3', line: 'A seam on the **Right** — dig right!' },
        ];
        const prompt = (kind === 'fish' ? fishPrompts : minePrompts)[Math.floor(Math.random() * 3)];
        timingAnswer = prompt.a;
        const embed = new EmbedBuilder()
          .setColor(0x9b59b6)
          .setTitle(kind === 'fish' ? '🎯 Set the hook' : '💥 Strike the vein')
          .setDescription(
            `**Read this:**\n${prompt.line}\n\n` +
              'Press the matching button for a **rare-luck bonus**.\n' +
              'Wrong button = normal haul. **Skip** also = normal haul.'
          );
        const row = new ActionRowBuilder().addComponents(
          btn(sid, 't1', kind === 'fish' ? 'Reel' : 'Left', ButtonStyle.Secondary, '1️⃣'),
          btn(sid, 't2', kind === 'fish' ? 'Wait' : 'Center', ButtonStyle.Secondary, '2️⃣'),
          btn(sid, 't3', kind === 'fish' ? 'Yank' : 'Right', ButtonStyle.Secondary, '3️⃣'),
          btn(sid, 'skip', 'Skip', ButtonStyle.Primary, '▶️')
        );
        await i.update({ embeds: [embed], components: [row] });
        return;
      }
      if (phase === 'timing') {
        let timed = false;
        if (key === 'skip') timed = false;
        else if (key.startsWith('t')) timed = key.slice(1) === timingAnswer;
        else return;
        const r = resolveTrip(kind, message.author.id, zoneId, timed);
        collector.stop('done');
        if (!r.ok) {
          await i.update({ content: `⏳ Ready <t:${r.nextTs}:R>.`, embeds: [], components: [] });
          return;
        }
        await i.update({
          embeds: [
            new EmbedBuilder().setColor(r.empty ? 0xe67e22 : 0x2ecc71).setDescription(r.text),
          ],
          components: [],
        });
      }
    } catch {
      await i.reply({ content: 'That trip failed to resolve.', ephemeral: true }).catch(() => {});
    }
  });

  collector.on('end', async (_, reason) => {
    if (reason === 'done') return;
    await msg.edit({ components: [] }).catch(() => {});
  });
}

module.exports = { runGather };
