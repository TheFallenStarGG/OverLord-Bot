const { EmbedBuilder } = require('discord.js');
const { spawnBoss } = require('../lib/boss');
const { fmt } = require('../lib/economy');
const { RAID_HP, RAID_MS, commandUsed, meterInfo, expireUsurper, startRaid, finishRaid, recoverRaid } = require('../lib/rebellion');
const { dueForBounty, startBounty, scheduleNextBounty, expireBounty, bountyEmbed } = require('../lib/bounty');
const { handleUsurpButton } = require('../lib/throne');
const { gazetteDue, publishGazette } = require('../lib/gazette');
const { channelIds, broadcast, getChannel } = require('../lib/announce');
const { logging } = require('../lib/logging');
const { forEachGuild, currentGuild } = require('../lib/storage');

const CHECK_MS = 60 * 1000;
const pick = (list) => list[Math.floor(Math.random() * list.length)];

const card = (color, title, description) => new EmbedBuilder().setColor(color).setTitle(title).setDescription(description);

const crownEmbed = (id) =>
  card(
    0xf1c40f,
    '👑 The Overlord has fallen!',
    `<@${id}> struck the final blow and is the new **Usurper** for 24 hours!\n\n` +
      '• Command one **decree** with `!!usurper decree <name>`\n' +
      '• Collect a royal stipend with `!!usurper stipend`\n' +
      '• Anyone can challenge the throne with `!!usurper challenge`'
  );

async function raidWon(client, killerId) {
  const user = await client.users.fetch(killerId).catch(() => null);
  if (finishRaid(true, killerId, user?.username ?? 'Unknown')) {
    await broadcast(client, { embeds: [crownEmbed(killerId)] });
  }
}

async function raidLost(client) {
  if (finishRaid(false)) {
    await broadcast(client, {
      embeds: [card(0x7f8c8d, '💀 The Rebellion was crushed', 'The Overlord laughs and leaves. The Rebellion will have to rebuild its strength.')],
    });
  }
}

// When the meter is full, the Overlord appears in every events channel
async function trySpawnRaid(client) {
  const info = meterInfo();
  if (info.raid || info.meter < info.goal) return;

  const ids = channelIds();
  if (!ids.length) return; // nowhere to appear yet (set one with !!events-channel)

  let spawned = 0;
  for (const id of ids) {
    const channel = await client.channels.fetch(id).catch(() => null);
    if (!channel?.guild) continue;

    const boss = await spawnBoss(channel, RAID_HP, {
      def: { name: 'Overlord', emoji: '👑', weak: pick(['fire', 'ice', 'poison']), drop: pick(['essence_fire', 'essence_ice', 'essence_poison']), special: 'dragonscale' },
      raid: true,
      durationMs: RAID_MS,
      onDefeat: (killerId) => raidWon(client, killerId).catch((err) => logging('error', 'Raid win failed', err)),
      onEscape: () => raidLost(client).catch((err) => logging('error', 'Raid loss failed', err)),
    }).catch((err) => {
      logging('error', 'Raid spawn failed', err);
      return null;
    });
    if (boss) spawned++;
  }
  if (spawned) startRaid(); // otherwise a normal boss is in the way, so try again next minute
}

const safe = async (name, fn) => {
  try {
    await fn();
  } catch (err) {
    logging('error', `${name} check failed`, err);
  }
};

async function tick(client) {
  await safe('Throne', async () => {
    const ended = expireUsurper();
    if (ended) {
      await broadcast(client, { embeds: [card(0x7f8c8d, '👑 A reign has ended', `The rule of **${ended.name}** is over. The throne is empty. Fill the Rebellion meter to bring the Overlord back!`)] });
    }
  });

  await safe('Raid', () => trySpawnRaid(client));

    await safe('Bounty', async () => {
    const done = expireBounty();
    if (done) {
      await broadcast(client, {
        embeds: [card(0x2ecc71, '🛡️ A bounty has ended', `<@${done.targetId}> survived and keeps **${fmt(done.payout)}** of the reward!`)],
      });
    }
    if (getChannel(currentGuild()) && dueForBounty()) {
      const b = startBounty();
      scheduleNextBounty();
      if (b) {
        logging('info', 'Bounty started', `${b.targetId} for ${b.reward}`);
        await broadcast(client, {
          content: `<@${b.targetId}>`,
          embeds: [bountyEmbed(b, '🎯 **The Overlord has marked someone!**')],
          allowedMentions: { users: [b.targetId] },
        });
      }
    }
  });

  await safe('Gazette', async () => {
    if (getChannel(currentGuild()) && gazetteDue()) await publishGazette(client);
  });

}

module.exports = (client) => {
  // Every command feeds the Rebellion
  client.on('messageCreate', (message) => {
    if (message.author.bot || !message.guild || !message.content.startsWith('!!')) return;
    commandUsed(message.author.id);
  });

  // The "Defend the throne" button
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton() || !interaction.customId.startsWith('usurp:')) return;
    try {
      await handleUsurpButton(interaction);
    } catch (err) {
      logging('error', 'Throne button failed', err);
    }
  });

  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    forEachGuild(client, () => recoverRaid());
    const tickAll = () => forEachGuild(client, () => tick(client));
    setTimeout(tickAll, 15 * 1000);
    setInterval(tickAll, CHECK_MS);
  };
  client.once('clientReady', start);
  client.once('ready', start);
};
