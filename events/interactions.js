const { MessageFlags } = require('discord.js');
const { answers, answerButtons } = require('../lib/answers');
const { adjustRating } = require('../lib/models');
const { retry } = require('../lib/chat');
const { logging } = require('../lib/logging');

async function handleButton(interaction) {
  const [, action, extra] = interaction.customId.split(':');
  const isOwner = Boolean(process.env.OWNER_ID) && interaction.user.id === process.env.OWNER_ID;
  const privateReply = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });

  // 🗑️ Delete: the person who asked (or the owner) can remove the answer
  if (action === 'delete') {
    if (interaction.user.id !== extra && !isOwner) {
      return privateReply('Only the person who asked (or the bot owner) can delete this answer.');
    }
    await interaction.deferUpdate();
    const record = answers.get(interaction.message.id);
    const ids = record?.messageIds ?? [interaction.message.id];
    answers.delete(interaction.message.id);
    await Promise.all(ids.map((id) => interaction.channel.messages.delete(id).catch(() => {})));
    logging('info', 'Answer deleted', `by ${interaction.user.username}`);
    return;
  }

  // 👍 / 👎 votes (clicking the same one again removes your vote)
  if (action === 'up' || action === 'down') {
    const record = answers.get(interaction.message.id);
    if (!record) return privateReply('That answer is too old to rate, because the bot has restarted since.');

    const vote = action === 'up' ? 1 : -1;
    const previous = record.votes.get(interaction.user.id);

    if (previous === vote) {
      record.votes.delete(interaction.user.id);
      adjustRating(record.model, vote, -1);
    } else {
      if (previous) adjustRating(record.model, previous, -1); // switched their vote
      record.votes.set(interaction.user.id, vote);
      adjustRating(record.model, vote, 1);
    }

    logging('info', 'Answer rated', `${vote === 1 ? '👍' : '👎'} for ${record.model} by ${interaction.user.username}`);
    return interaction.update({ components: answerButtons(record) });
  }

  // 🔁 Retry: answer again with a different model
  if (action === 'retry') {
    await interaction.deferUpdate();
    const error = await retry(interaction.message, interaction.user, isOwner, interaction.message.id);
    if (error) await interaction.followUp({ content: error, flags: MessageFlags.Ephemeral });
  }
}

module.exports = (client) => {
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton() || !interaction.customId.startsWith('ans:')) return;
    try {
      await handleButton(interaction);
    } catch (err) {
      logging('error', 'Button press failed', err);
    }
  });
};
