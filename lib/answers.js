const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// id of an answer's last message -> { model, askerId, votes: Map(userId -> 1 | -1), messageIds: [] }
const answers = new Map();

function createAnswer(model, askerId) {
  return { model, askerId, votes: new Map(), messageIds: [] };
}

function saveAnswer(answer, messageIds, lastId) {
  answer.messageIds = messageIds;
  answers.set(lastId, answer);
  if (answers.size > 300) answers.delete(answers.keys().next().value); // keep the newest 300
}

// The button row shown under every answer, with live 👍/👎 counts
function answerButtons(answer) {
  let up = 0;
  let down = 0;
  for (const vote of answer.votes.values()) {
    if (vote === 1) up++;
    else down++;
  }

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ans:up').setEmoji('👍').setLabel(String(up)).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('ans:down').setEmoji('👎').setLabel(String(down)).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('ans:retry').setEmoji('🔁').setLabel('Retry').setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`ans:delete:${answer.askerId}`)
        .setEmoji('🗑️')
        .setLabel('Delete')
        .setStyle(ButtonStyle.Danger)
    ),
  ];
}

module.exports = { answers, createAnswer, saveAnswer, answerButtons };
