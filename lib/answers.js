// answer messageId -> { model, votes: Map(userId -> 1 | -1) }
const answers = new Map();
const VOTES = { '👍': 1, '👎': -1 };

// Remembers which model wrote an answer and adds the rating reactions
async function registerAnswer(sent, model) {
  answers.set(sent.id, { model, votes: new Map() });
  if (answers.size > 300) answers.delete(answers.keys().next().value); // keep the newest 300
  try {
    await sent.react('👍');
    await sent.react('👎');
  } catch (err) {
    console.error('Could not add reactions:', err.message);
  }
}

module.exports = { answers, VOTES, registerAnswer };
