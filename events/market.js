const { EmbedBuilder } = require('discord.js');
const { maybeTick, pickBroadcast } = require('../lib/stocks');
const { runJobs, runUpkeep } = require('../lib/muscle');
const { claimAnnouncement, announceEmbed } = require('../lib/weather');
const { broadcast } = require('../lib/announce');
const { fmt } = require('../lib/economy');
const { logging } = require('../lib/logging');
const { forEachGuild } = require('../lib/storage');

const CHECK_MS = 60 * 1000; // how often everything is checked
const BIG_THEFT = 1000; // thefts at least this big are announced
const BIG_CATCH = 500; // caught thieves with at least this much at stake are announced

const card = (color, title, text) => new EmbedBuilder().setColor(color).setTitle(title).setDescription(text);

async function safely(name, fn) {
  try {
    await fn();
  } catch (err) {
    logging('error', `${name} update failed`, err);
  }
}

async function check(client) {
  await safely('Stock market', async () => {
    const big = pickBroadcast(maybeTick());
    if (!big) return;
    logging('info', 'Market news', big.line);
    await broadcast(client, {
      embeds: [card(big.pct > 0 ? 0x2ecc71 : 0xe74c3c, 'Market news', `${big.line}\n\nSee the prices with \`!!stocks\`.`)],
    });
  });

  await safely('Weather', async () => {
    const w = claimAnnouncement();
    if (w) await broadcast(client, { embeds: [announceEmbed(w)] });
  });

  await safely('Hired muscle', async () => {
    runUpkeep();
    for (const r of runJobs()) {
      if (r.type === 'steal' && r.amount >= BIG_THEFT) {
        logging('info', 'Thief struck', `${fmt(r.amount)} stolen from ${r.victimId}`);
        await broadcast(client, {
          embeds: [card(0x2c3e50, '🕵️ A thief struck!', `Somebody's hired thief stole **${fmt(r.amount)}** from <@${r.victimId}>. Nobody saw who did it.`)],
        });
      } else if (r.type === 'caught' && r.amount >= BIG_CATCH) {
        logging('info', 'Thief caught', `${r.ownerId}'s ${r.def.name} caught robbing ${r.victimId}`);
        await broadcast(client, {
          embeds: [card(0x2c3e50, '🚔 Caught red-handed!', `<@${r.ownerId}>'s ${r.def.name} was caught robbing <@${r.victimId}>, and had to pay **${fmt(r.amount)}** in damages.`)],
        });
      }
    }
  });
}

module.exports = (client) => {
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    const checkAll = () => forEachGuild(client, () => check(client));
    setTimeout(checkAll, 20 * 1000);
    setInterval(checkAll, CHECK_MS);
};
  client.once('clientReady', start);
  client.once('ready', start);
};
