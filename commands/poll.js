const { parseDuration } = require('../lib/utils');

const NUMBERS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
const MIN_DURATION_MS = 10 * 1000;
const MAX_DURATION_MS = 24 * 60 * 60 * 1000;

// Counts the votes and posts the results under the poll
async function closePoll(pollMsg, question, options, emojis) {
  try {
    const fresh = await pollMsg.channel.messages.fetch(pollMsg.id);

    // Subtract the bot's own reaction from each count
    const counts = emojis.map((emoji) => {
      const reaction = fresh.reactions.cache.find((r) => r.emoji.name === emoji);
      return reaction ? reaction.count - (reaction.me ? 1 : 0) : 0;
    });
    const total = counts.reduce((a, b) => a + b, 0);
    const top = Math.max(...counts);

    const lines = [`📊 **Poll closed:** ${question}`, ''];
    options.forEach((option, i) => {
      const percent = total ? Math.round((counts[i] / total) * 100) : 0;
      const bar = '█'.repeat(Math.round(percent / 10));
      const trophy = total && counts[i] === top ? ' 🏆' : '';
      lines.push(`${emojis[i]} ${option} — **${counts[i]}** (${percent}%) ${bar}${trophy}`);
    });
    lines.push('', total ? `-# ${total} vote(s)` : '-# No votes were cast.');

    await fresh.reply(lines.join('\n'));
  } catch (err) {
    console.error('Could not close poll:', err.message);
  }
}

module.exports = {
  name: '!!poll',
  usage: '!!poll [time] <question> | <option> | <option>',
  description:
    'Starts a poll with 2-10 options, or yes/no if you give none. Add a time like `10m` or `2h` at the start to close it and show results (max 24h). Example: `!!poll 1h Pizza or tacos? | Pizza | Tacos`.',
  access: 'free',

  async run(message, arg, ctx) {
    let raw = ctx.rawArg;
    let durationMs = null;

    // Optional time at the start, like 10m
    const first = raw.split(/\s+/)[0];
    const parsed = parseDuration(first);
    if (parsed !== null) {
      durationMs = parsed;
      raw = raw.slice(first.length).trim();
      if (durationMs < MIN_DURATION_MS) return message.reply('Polls must last at least 10 seconds.');
      if (durationMs > MAX_DURATION_MS) return message.reply('Polls can last at most 24 hours.');
    }

    const parts = raw.split('|').map((s) => s.trim()).filter(Boolean);
    const question = parts[0];
    let options = parts.slice(1);

    if (!question) {
      return message.reply('Usage: `!!poll [time] <question> | <option> | <option>` (leave out the options for a yes/no poll)');
    }
    if (question.length > 250) return message.reply('That question is too long (250 characters max).');

    let emojis;
    if (!options.length) {
      options = ['Yes', 'No'];
      emojis = ['✅', '❌'];
    } else {
      if (options.length < 2) return message.reply('Give at least 2 options, or none for a yes/no poll.');
      if (options.length > 10) return message.reply('Polls can have at most 10 options.');
      if (options.some((o) => o.length > 100)) return message.reply('Each option must be 100 characters or less.');
      emojis = NUMBERS.slice(0, options.length);
    }

    const name = message.member?.displayName ?? message.author.username;
    const closesAt = durationMs ? Math.floor((Date.now() + durationMs) / 1000) : null;

    const lines = [`📊 **${question}**`, '', ...options.map((o, i) => `${emojis[i]} ${o}`)];
    lines.push('', `-# Poll by ${name}${closesAt ? ` · closes <t:${closesAt}:R>` : ' · react to vote'}`);

    const pollMsg = await message.channel.send(lines.join('\n'));
    for (const emoji of emojis) await pollMsg.react(emoji);

    if (durationMs) setTimeout(() => closePoll(pollMsg, question, options, emojis), durationMs);
  },
};
