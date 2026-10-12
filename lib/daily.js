// Interactive !!daily — pick how you claim, streak milestones, stats
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { getUser, peekUser, markDirty, recordQuest, fmt, topBy } = require('./economy');
const { mult } = require('./modifiers');
const { perk } = require('./petData');

const SESSION_MS = 90 * 1000;

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}
function yesterdayUTC() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
function nextMidnightTs() {
  const midnight = new Date();
  midnight.setUTCHours(24, 0, 0, 0);
  return Math.floor(midnight.getTime() / 1000);
}

function readDaily(u) {
  u.daily ??= { claims: 0, bestStreak: 0, totalCoins: 0, lucky: 0, bust: 0 };
  u.daily.claims ??= 0;
  u.daily.bestStreak ??= 0;
  u.daily.totalCoins ??= 0;
  u.daily.lucky ??= 0;
  u.daily.bust ??= 0;
  return u.daily;
}

function baseAmount(u) {
  const streak = u.streak || 1;
  const base = 100 + Math.min(streak - 1, 10) * 10;
  return Math.round(base * (1 + (u.prestige || 0) * 0.05) * mult('daily') * (1 + perk(u, 'daily')));
}

const MILESTONES = [
  { at: 3, label: '3-day spark', bonus: 50 },
  { at: 7, label: 'Week warrior', bonus: 150 },
  { at: 14, label: 'Fortnight flex', bonus: 350 },
  { at: 30, label: 'Monthly legend', bonus: 1000 },
];

function milestoneBonus(streak) {
  return MILESTONES.filter((m) => m.at === streak);
}

function btn(id, key, label, style = ButtonStyle.Primary, emoji) {
  const b = new ButtonBuilder().setCustomId(`daily:${id}:${key}`).setLabel(label).setStyle(style);
  if (emoji) b.setEmoji(emoji);
  return b;
}

function hubEmbed(userId) {
  const u = peekUser(userId);
  const D = readDaily(u);
  const next = MILESTONES.find((m) => m.at > (u.streak || 0));
  const previewStreak = u.lastDaily === todayUTC() ? u.streak : u.lastDaily === yesterdayUTC() ? u.streak + 1 : 1;
  return new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle('🎁 Daily Claim')
    .setDescription(
      u.lastDaily === todayUTC()
        ? `You already claimed today. Next reset <t:${nextMidnightTs()}:R>.\n🔥 Best streak: **${D.bestStreak}** · Lifetime claims: **${D.claims}**`
        : `Pick how you take today's coins.\n` +
            `🔥 Current streak if you claim: **${previewStreak}** day(s)\n` +
            `Safe payout starts around **${fmt(baseAmount({ ...u, streak: previewStreak }))}** (before your pick).\n` +
            (next ? `Next milestone: **${next.at}** days (${next.label}, +${fmt(next.bonus)})\n` : '') +
            `\n**Safe** — full guaranteed pay\n**Lucky** — 0.6× to 2× (random)\n**Gamble** — ~40% chance of a big hit, otherwise a weak payout`
    )
    .setFooter({ text: '!!daily stats · one claim per UTC day' });
}

function hubRow(sid, claimed) {
  if (claimed) {
    return new ActionRowBuilder().addComponents(btn(sid, 'stats', 'Stats', ButtonStyle.Secondary, '📊'));
  }
  return new ActionRowBuilder().addComponents(
    btn(sid, 'safe', 'Safe', ButtonStyle.Success, '🛡️'),
    btn(sid, 'lucky', 'Lucky', ButtonStyle.Primary, '🍀'),
    btn(sid, 'gamble', 'Gamble', ButtonStyle.Danger, '🎲'),
    btn(sid, 'stats', 'Stats', ButtonStyle.Secondary, '📊')
  );
}

function applyClaim(userId, mode) {
  const u = getUser(userId);
  const D = readDaily(u);
  if (u.lastDaily === todayUTC()) {
    return { ok: false, nextTs: nextMidnightTs() };
  }

  u.streak = u.lastDaily === yesterdayUTC() ? u.streak + 1 : 1;
  u.lastDaily = todayUTC();
  D.bestStreak = Math.max(D.bestStreak, u.streak);
  D.claims++;

  const base = baseAmount(u);
  let amount = base;
  let flavor = 'You took the safe envelope.';
  let multRoll = 1;

  if (mode === 'lucky') {
    multRoll = 0.6 + Math.random() * 1.4;
    amount = Math.round(base * multRoll);
    flavor =
      multRoll >= 1.3
        ? 'Fortune smiled on you.'
        : multRoll <= 0.8
          ? 'A thin envelope… better than nothing.'
          : 'A decent lucky draw.';
    if (multRoll >= 1.5) D.lucky++;
  } else if (mode === 'gamble') {
    if (Math.random() < 0.4) {
      multRoll = 2.2 + Math.random() * 0.6;
      amount = Math.round(base * multRoll);
      flavor = 'High risk paid off — jackpot envelope!';
      D.lucky++;
    } else {
      multRoll = 0.25 + Math.random() * 0.25;
      amount = Math.round(base * multRoll);
      flavor = 'The gamble went cold. Thin payout.';
      D.bust++;
    }
  }

  const milestones = milestoneBonus(u.streak);
  let milePay = 0;
  const mileLines = [];
  for (const m of milestones) {
    milePay += m.bonus;
    mileLines.push(`🏆 **${m.label}** (+${fmt(m.bonus)})`);
  }
  amount += milePay;
  u.coins += amount;
  D.totalCoins += amount;
  recordQuest(userId, 'daily');
  markDirty();

  return {
    ok: true,
    amount,
    base,
    multRoll,
    mode,
    flavor,
    streak: u.streak,
    coins: u.coins,
    mileLines,
  };
}

function resultEmbed(r) {
  const modeLabel = { safe: 'Safe', lucky: 'Lucky', gamble: 'Gamble' }[r.mode] || r.mode;
  return new EmbedBuilder()
    .setColor(r.multRoll >= 1.2 ? 0x2ecc71 : r.multRoll < 0.7 ? 0xe74c3c : 0xf1c40f)
    .setTitle(`🎁 Daily — ${modeLabel}`)
    .setDescription(
      `${r.flavor}\n\nYou received **${fmt(r.amount)}**` +
        (r.mode !== 'safe' ? ` _(×${r.multRoll.toFixed(2)} on a ${fmt(r.base)} base)_` : '') +
        `\n🔥 Streak: **${r.streak}** day${r.streak === 1 ? '' : 's'}` +
        (r.mileLines.length ? `\n${r.mileLines.join('\n')}` : '') +
        `\nBalance: ${fmt(r.coins)}`
    );
}

function statsEmbed(userId) {
  const u = peekUser(userId);
  const D = readDaily(u);
  return new EmbedBuilder()
    .setColor(0x95a5a6)
    .setTitle('📊 Daily stats')
    .setDescription(
      `🔥 Current streak: **${u.streak || 0}** (best **${D.bestStreak}**)\n` +
        `📅 Claims: **${D.claims}**\n` +
        `🪙 From dailies: **${fmt(D.totalCoins)}**\n` +
        `🍀 Big lucky hits: **${D.lucky}** · 💀 Cold gambles: **${D.bust}**\n` +
        `Last claim: **${u.lastDaily || 'never'}** (UTC)`
    );
}

async function run(message, arg) {
  const sub = String(arg || '')
    .trim()
    .toLowerCase();
  if (sub === 'stats' || sub === 'stat') {
    return message.reply({ embeds: [statsEmbed(message.author.id)] });
  }
  if (sub === 'top' || sub === 'lb') {
    const rows = topBy((u) => readDaily(u).bestStreak || u.streak || 0, 10).filter((r) => r.value > 0);
    const lines = rows.map((r, i) => `**${i + 1}.** <@${r.id}> — ${r.value} day streak`);
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xf1c40f)
          .setTitle('🔥 Best daily streaks')
          .setDescription(lines.join('\n') || 'Nobody yet.'),
      ],
    });
  }

  const u = getUser(message.author.id);
  readDaily(u);
  const claimed = u.lastDaily === todayUTC();
  const sid = `${message.id}${Date.now().toString(36)}`;
  const msg = await message.reply({
    embeds: [hubEmbed(message.author.id)],
    components: [hubRow(sid, claimed)],
  });

  const collector = msg.createMessageComponentCollector({
    time: SESSION_MS,
    filter: (i) => i.user.id === message.author.id && i.customId.startsWith(`daily:${sid}:`),
  });

  collector.on('collect', async (i) => {
    const key = i.customId.split(':')[2];
    try {
      if (key === 'stats') {
        await i.update({
          embeds: [statsEmbed(message.author.id)],
          components: [hubRow(sid, getUser(message.author.id).lastDaily === todayUTC())],
        });
        return;
      }
      if (claimed || getUser(message.author.id).lastDaily === todayUTC()) {
        await i.update({ embeds: [hubEmbed(message.author.id)], components: [hubRow(sid, true)] });
        return;
      }
      if (!['safe', 'lucky', 'gamble'].includes(key)) return;
      const r = applyClaim(message.author.id, key);
      if (!r.ok) {
        await i.update({ embeds: [hubEmbed(message.author.id)], components: [hubRow(sid, true)] });
        return;
      }
      collector.stop('done');
      await i.update({ embeds: [resultEmbed(r)], components: [] });
    } catch {
      await i.reply({ content: 'Something went wrong with the daily claim.', ephemeral: true }).catch(() => {});
    }
  });

  collector.on('end', async (_, reason) => {
    if (reason === 'done') return;
    await msg.edit({ components: [] }).catch(() => {});
  });
}

module.exports = { run };
