const { EmbedBuilder } = require('discord.js');
const seasons = require('../lib/seasons');
const war = require('../lib/war');
const { addCoins, fmt } = require('../lib/economy');
const { broadcast } = require('../lib/announce');
const { forEachGuild, runIn, flush } = require('../lib/storage');
const { logging } = require('../lib/logging');

const CHECK_MS = 5 * 60 * 1000;
const MEDALS = ['🥇', '🥈', '🥉'];
const place = (i) => MEDALS[i] ?? `**${i + 1}.**`;

// Ends the season in every server that is behind (runs once per month, per server)
async function closeSeason(client) {
  await forEachGuild(client, async (guild) => {
    const meta = seasons.meta();
    const now = seasons.seasonKey();
    if (meta.key === now) return;

    const finished = meta.key;
    const number = seasons.seasonNumber(finished);
    const winners = seasons
      .board(seasons.data, 's', 'sk', finished)
      .filter((e) => e.value >= seasons.MIN_SCORE)
      .slice(0, 10);

    // Start the new season and save it first, so a crash can never pay the same prizes twice
    meta.key = now;
    if (winners.length) {
      meta.history.unshift({ n: number, winners: winners.slice(0, 3).map((e) => ({ id: e.id, score: e.value })) });
      meta.history.length = Math.min(meta.history.length, 12);
    }
    seasons.save();
    await flush();
    if (!winners.length) return;

    const prizeFor = (i) => seasons.PRIZES[i] ?? seasons.RUNNER_UP_PRIZE;
    seasons.untracked(() => winners.forEach((e, i) => addCoins(e.id, prizeFor(i))));
    winners.slice(0, 3).forEach((e, i) => {
      const p = seasons.data[e.id];
      if (p) (p.h ??= []).push({ n: number, place: i + 1 });
    });
    seasons.save();

    const lines = winners.map((e, i) => `${place(i)} <@${e.id}> · ${fmt(e.value)} → **+${fmt(prizeFor(i))}**`);
    await broadcast(client, {
      embeds: [
        new EmbedBuilder()
          .setColor(0xf1c40f)
          .setTitle(`🏆 Season ${number} is over!`)
          .setDescription(`${lines.join('\n')}\n\nPrizes have been paid out. **Season ${number + 1}** has begun, so everyone's season score is back to 0 (your coins are safe). See it with \`!!season\`.`),
      ],
    });
    logging('info', 'Season ended', `Season ${number} in ${guild.name}: ${winners.length} prize winners`);
  });
}

// Ends the weekly Server War for everyone at once (runs once per week)
async function closeWar(client) {
  const finished = war.state.week;
  const now = seasons.weekKey();
  if (finished === now) return;

  const standings = war.standingsFor(client, finished);
  war.state.week = now;
  if (standings.length) {
    war.state.history.unshift({ week: finished, top: standings.slice(0, 5).map((s) => ({ guildId: s.guildId, name: s.name, score: s.score })) });
    war.state.history.length = Math.min(war.state.history.length, 8);
    war.state.wins[standings[0].guildId] = (war.state.wins[standings[0].guildId] ?? 0) + 1;
  }
  war.save();
  await flush();
  if (!standings.length) return;

  // Every contributor of the top 3 servers gets a prize
  standings.slice(0, 3).forEach((s, i) => {
    runIn(s.guildId, () => seasons.untracked(() => s.ids.forEach((id) => addCoins(id, war.PRIZES[i]))));
  });

  const board = standings
    .slice(0, 5)
    .map((s, i) => `${place(i)} **${s.name}** · ${fmt(s.score)}${i < 3 ? ` (+${fmt(war.PRIZES[i])} each)` : ''}`)
    .join('\n');

  await forEachGuild(
    client,
    async (guild) => {
      if (seasons.meta().warOut) return;
      const rank = standings.findIndex((s) => s.guildId === guild.id);
      const footer =
        rank >= 0
          ? `Your server finished #${rank + 1} of ${standings.length}.`
          : `Your server wasn't ranked. It needs ${war.MIN_CONTRIBUTORS} players with ${war.MIN_PROFIT}+ profit in a week.`;
      await broadcast(client, {
        embeds: [
          new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle('⚔️ The Server War is over!')
            .setDescription(`${board}\n\nA new war has begun. Follow it with \`!!war\`.`)
            .setFooter({ text: footer }),
        ],
      });
    },
    'seasons'
  );
  logging('info', 'Server War ended', `Winner: ${standings[0].name} (${fmt(standings[0].score)})`);
}

module.exports = (client) => {
  let started = false;
  let running = false;

  const run = async () => {
    if (running) return;
    running = true;
    try {
      await closeSeason(client);
    } catch (err) {
      logging('error', 'Season rollover failed', err);
    }
    try {
      await closeWar(client);
    } catch (err) {
      logging('error', 'Server War rollover failed', err);
    }
    running = false;
  };

  const start = () => {
    if (started) return;
    started = true;
    setTimeout(run, 30 * 1000);
    setInterval(run, CHECK_MS);
  };
  client.once('clientReady', start);
  client.once('ready', start);
};
