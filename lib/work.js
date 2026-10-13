// Interactive !!work — pick a shift, optional hustle minigame, stats
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { getUser, peekUser, markDirty, recordQuest, fmt, careerFor, topBy } = require('./economy');
const { mult } = require('./modifiers');
const { perk } = require('./petData');

const SESSION_MS = 90 * 1000;
const WORK_COOLDOWN_MS = 60 * 1000;

const SHIFTS = {
  easy: { emoji: '🪑', name: 'Easy shift', blurb: 'Low stress. ~70% pay, never fails.', pay: 0.7, fail: 0 },
  standard: { emoji: '💼', name: 'Standard', blurb: 'Normal job. Full career pay.', pay: 1, fail: 0 },
  double: {
    emoji: '🔥',
    name: 'Double shift',
    blurb: '~160% pay, but 20% chance the boss docks you hard.',
    pay: 1.6,
    fail: 0.2,
  },
};

function readWork(u) {
  u.workStats ??= { shifts: 0, doubles: 0, fails: 0, hustles: 0, earned: 0 };
  u.workStats.shifts ??= 0;
  u.workStats.doubles ??= 0;
  u.workStats.fails ??= 0;
  u.workStats.hustles ??= 0;
  u.workStats.earned ??= 0;
  return u.workStats;
}

function btn(sid, key, label, style, emoji) {
  const b = new ButtonBuilder().setCustomId(`work:${sid}:${key}`).setLabel(label).setStyle(style);
  if (emoji) b.setEmoji(emoji);
  return b;
}

function readyInfo(u) {
  const readyAt = (u.lastWork ?? 0) + WORK_COOLDOWN_MS;
  return { ready: Date.now() >= readyAt, readyAt, nextTs: Math.ceil(readyAt / 1000) };
}

function hubEmbed(userId) {
  const u = peekUser(userId);
  const career = careerFor(u.works || 0);
  const { ready, nextTs } = readyInfo(u);
  const W = readWork(u);
  return new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`${career.emoji} Work — ${career.name}`)
    .setDescription(
      (ready ? '✅ Ready to work.\n' : `⏳ Exhausted until <t:${nextTs}:R>.\n`) +
        `Shifts done: **${u.works || 0}** · Career pay **×${career.mult}**\n` +
        `Lifetime earned on the job: **${fmt(W.earned)}**\n\n` +
        Object.values(SHIFTS)
          .map((s) => `${s.emoji} **${s.name}** — ${s.blurb}`)
          .join('\n') +
        `\n\nAfter you pick a shift you can try a **Hustle** minigame for bonus pay.`
    )
    .setFooter({ text: '!!work stats · !!career · once a minute' });
}

function hubRow(sid, ready) {
  const row = new ActionRowBuilder();
  if (ready) {
    row.addComponents(
      btn(sid, 'easy', 'Easy', ButtonStyle.Success, '🪑'),
      btn(sid, 'standard', 'Standard', ButtonStyle.Primary, '💼'),
      btn(sid, 'double', 'Double', ButtonStyle.Danger, '🔥')
    );
  }
  row.addComponents(btn(sid, 'stats', 'Stats', ButtonStyle.Secondary, '📊'));
  return row;
}

function doShift(userId, shiftKey, hustleBonus) {
  const u = getUser(userId);
  const W = readWork(u);
  const now = Date.now();
  const readyAt = (u.lastWork ?? 0) + WORK_COOLDOWN_MS;
  if (now < readyAt) return { ok: false, nextTs: Math.ceil(readyAt / 1000) };

  const shift = SHIFTS[shiftKey] || SHIFTS.standard;
  const before = careerFor(u.works);
  u.lastWork = now;
  u.works++;
  const career = careerFor(u.works);
  W.shifts++;
  if (shiftKey === 'double') W.doubles++;

  let failed = false;
  if (shift.fail > 0 && Math.random() < shift.fail) {
    failed = true;
    W.fails++;
  }

  let amount = (15 + Math.floor(Math.random() * 31)) * career.mult;
  let boosted = false;
  if ((u.effects.workBoostLeft ?? 0) > 0) {
    amount *= 2;
    u.effects.workBoostLeft--;
    boosted = true;
  }
  amount *= shift.pay;
  if (failed) amount *= 0.25;
  if (hustleBonus) {
    amount *= 1.25;
    W.hustles++;
  }
  amount = Math.round(amount * (1 + (u.prestige || 0) * 0.05) * mult('work') * (1 + perk(u, 'work')));
  u.coins += amount;
  W.earned += amount;
  const job = career.jobs[Math.floor(Math.random() * career.jobs.length)];
  recordQuest(userId, 'work');
  markDirty();

  return {
    ok: true,
    amount,
    job,
    coins: u.coins,
    career,
    promoted: career.name !== before.name ? career : null,
    boosted,
    failed,
    shift,
    hustleBonus: Boolean(hustleBonus),
  };
}

function resultEmbed(r) {
  let text = `${r.shift.emoji} **${r.shift.name}** — as a **${r.career.name}**, you ${r.job}`;
  if (r.failed) text += '… but the boss docked your pay';
  text += `\nYou earned **${fmt(r.amount)}**`;
  if (r.boosted) text += ' ⚡ (item boost)';
  if (r.hustleBonus) text += ' ✨ (hustle bonus)';
  text += `\nBalance: ${fmt(r.coins)}`;
  if (r.promoted) {
    text += `\n🎉 **Promotion!** You're now ${r.promoted.emoji} **${r.promoted.name}** (×${r.promoted.mult} pay)!`;
  }
  return new EmbedBuilder()
    .setColor(r.failed ? 0xe67e22 : r.promoted ? 0x2ecc71 : 0x3498db)
    .setTitle('Work complete')
    .setDescription(text);
}

function statsEmbed(userId) {
  const u = peekUser(userId);
  const W = readWork(u);
  const career = careerFor(u.works || 0);
  return new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('📊 Work stats')
    .setDescription(
      `${career.emoji} **${career.name}** · **${u.works || 0}** shifts · ×${career.mult} pay\n` +
        `🪙 Earned: **${fmt(W.earned)}**\n` +
        `🔥 Double shifts: **${W.doubles}** · Docked: **${W.fails}** · Hustles: **${W.hustles}**`
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
    const rows = topBy((u) => u.works || 0, 10).filter((r) => r.value > 0);
    const lines = rows.map((r, i) => {
      const c = careerFor(r.value);
      return `**${i + 1}.** <@${r.id}> — ${r.value} shifts (${c.emoji} ${c.name})`;
    });
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x3498db)
          .setTitle('💼 Most shifts worked')
          .setDescription(lines.join('\n') || 'Nobody yet.'),
      ],
    });
  }

  const u = getUser(message.author.id);
  readWork(u);
  const { ready } = readyInfo(u);
  const sid = `${message.id}${Date.now().toString(36)}`;
  const msg = await message.reply({ embeds: [hubEmbed(message.author.id)], components: [hubRow(sid, ready)] });

  const collector = msg.createMessageComponentCollector({
    time: SESSION_MS,
    filter: (i) => i.user.id === message.author.id && i.customId.startsWith(`work:${sid}:`),
  });

  let phase = 'hub';
  let pendingShift = null;
  let hustleAnswer = null;

  collector.on('collect', async (i) => {
    const key = i.customId.split(':')[2];
    try {
      if (key === 'stats') {
        await i.update({
          embeds: [statsEmbed(message.author.id)],
          components: [hubRow(sid, readyInfo(getUser(message.author.id)).ready)],
        });
        return;
      }
      if (phase === 'hub' && SHIFTS[key]) {
        if (!readyInfo(getUser(message.author.id)).ready) {
          await i.update({ embeds: [hubEmbed(message.author.id)], components: [hubRow(sid, false)] });
          return;
        }
        pendingShift = key;
        phase = 'hustle';
        const prompts = [
          { answer: 'h2', text: 'Boss: "Clock in **on time**. Not early, not late."', labels: ['Early', 'On time', 'Late'] },
          { answer: 'h1', text: 'Boss: "I need this **asap** — get it done first."', labels: ['Do it first', 'Wait a bit', 'Ignore it'] },
          { answer: 'h3', text: 'Boss: "Double-check the numbers **carefully**."', labels: ['Rush it', 'Guess', 'Check carefully'] },
        ];
        const prompt = prompts[Math.floor(Math.random() * prompts.length)];
        hustleAnswer = prompt.answer;
        const embed = new EmbedBuilder()
          .setColor(0x9b59b6)
          .setTitle('✨ Hustle check')
          .setDescription(
            `You picked **${SHIFTS[key].name}**.\n\n${prompt.text}\n\n` +
              `Press the button that matches what the boss asked for → **+25% pay**.\n` +
              `Wrong answer = no bonus. Or **Skip** for normal pay.`
          );
        const row = new ActionRowBuilder().addComponents(
          btn(sid, 'h1', prompt.labels[0], ButtonStyle.Secondary, '1️⃣'),
          btn(sid, 'h2', prompt.labels[1], ButtonStyle.Secondary, '2️⃣'),
          btn(sid, 'h3', prompt.labels[2], ButtonStyle.Secondary, '3️⃣'),
          btn(sid, 'skip', 'Skip', ButtonStyle.Primary, '▶️')
        );
        await i.update({ embeds: [embed], components: [row] });
        return;
      }
      if (phase === 'hustle') {
        let bonus = false;
        if (key === 'skip') bonus = false;
        else if (key === 'h1' || key === 'h2' || key === 'h3') {
          bonus = key.slice(1) === hustleAnswer;
        } else return;
        const r = doShift(message.author.id, pendingShift, bonus);
        collector.stop('done');
        if (!r.ok) {
          await i.update({ embeds: [hubEmbed(message.author.id)], components: [] });
          return;
        }
        await i.update({ embeds: [resultEmbed(r)], components: [] });
      }
    } catch {
      await i.reply({ content: 'Work shift failed to resolve.', ephemeral: true }).catch(() => {});
    }
  });

  collector.on('end', async (_, reason) => {
    if (reason === 'done') return;
    await msg.edit({ components: [] }).catch(() => {});
  });
}

module.exports = { run };
