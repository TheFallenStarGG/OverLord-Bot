const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require('discord.js');
const { startGame, isBusy } = require('./games/common');
const duel = require('./games/duel');
const { currentUsurper, crown } = require('./rebellion');
const { logEvent } = require('./world');

const ACCEPT_MS = 2 * 60 * 1000;
const CHALLENGE_GAP_MS = 10 * 60 * 1000;
const pending = new Map(); // challenge id -> { challenger, usurperId, timer }
const lastChallenge = new Map(); // userId -> time

async function challengeUsurper(message) {
  const king = currentUsurper();
  if (!king) return message.reply('Nobody sits on the throne right now. Fill the Rebellion meter and defeat the Overlord to claim it! (`!!rebellion`)');

  const userId = message.author.id;
  if (king.id === userId) return message.reply('You already sit on the throne!');
  const readyAt = (lastChallenge.get(userId) ?? 0) + CHALLENGE_GAP_MS;
  if (Date.now() < readyAt) return message.reply(`You need a moment to regroup. Try again <t:${Math.ceil(readyAt / 1000)}:R>.`);
  if (isBusy(userId)) return message.reply("You're already in a game. Finish it first!");
  if (isBusy(king.id)) return message.reply('The Usurper is busy in another game. Try again in a moment.');

  lastChallenge.set(userId, Date.now());
  const id = Math.random().toString(36).slice(2, 8);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`usurp:accept:${id}`).setLabel('Defend the throne').setEmoji('👑').setStyle(ButtonStyle.Danger)
  );
  const sent = await message.reply({
    content:
      `⚔️ <@${userId}> challenges <@${king.id}> for the throne! Best of 3 on equal gear.\n` +
      '-# Only the Usurper can accept. Expires in 2 minutes.',
    components: [row],
    allowedMentions: { users: [king.id], repliedUser: false },
  });

  const timer = setTimeout(() => {
    if (!pending.delete(id)) return;
    sent.edit({ content: `⌛ <@${king.id}> ignored the challenge. The throne stays put.`, components: [] }).catch(() => {});
  }, ACCEPT_MS);
  pending.set(id, { challenger: message.author, usurperId: king.id, timer });
}

function settle(channel, challenger, king, winnerId) {
  if (winnerId === challenger.id && currentUsurper()?.id === king.id) {
    crown(challenger.id, challenger.username);
    channel
      .send({
        embeds: [
          new EmbedBuilder()
            .setColor(0xf1c40f)
            .setTitle('👑 A new Usurper!')
            .setDescription(`<@${challenger.id}> defeated <@${king.id}> and seizes the throne for 24 hours!`),
        ],
      })
      .catch(() => {});
  } else if (winnerId === king.id) {
    logEvent(`🛡️ <@${king.id}> defended the throne against <@${challenger.id}>`);
    channel.send(`🛡️ <@${king.id}> defended the throne!`).catch(() => {});
  }
}

async function handleUsurpButton(interaction) {
  const id = interaction.customId.split(':')[2];
  const reply = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });

  const challenge = pending.get(id);
  if (!challenge) return reply('That challenge has expired.');

  const king = currentUsurper();
  if (!king || king.id !== challenge.usurperId) {
    clearTimeout(challenge.timer);
    pending.delete(id);
    return interaction.update({ content: 'The throne changed hands before the fight began.', components: [] });
  }
  if (interaction.user.id !== king.id) return reply('Only the Usurper can accept this challenge.');
  if (isBusy(king.id) || isBusy(challenge.challenger.id)) return reply('One of you is already in another game.');

  clearTimeout(challenge.timer);
  pending.delete(id);
  const { challenger } = challenge;

  const game = duel.createMatch({
    players: [challenger.id, king.id],
    names: [challenger.username, king.name],
    fair: true,
    bestOf: 3,
    noDraw: true,
    onFinish: (winnerId) => settle(interaction.message.channel, challenger, king, winnerId),
  });
  game.message = interaction.message;
  startGame(game);
  await interaction.update(duel.render(game));
}

module.exports = { challengeUsurper, handleUsurpButton };
