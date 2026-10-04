const { answers, VOTES } = require('../lib/answers');
const { adjustRating } = require('../lib/models');

module.exports = (client) => {
  client.on('messageReactionAdd', (reaction, user) => {
    if (user.bot) return;
    const vote = VOTES[reaction.emoji.name];
    const answer = answers.get(reaction.message.id);
    if (!vote || !answer) return;

    const previous = answer.votes.get(user.id);
    if (previous === vote) return;
    if (previous) adjustRating(answer.model, previous, -1); // user switched their vote
    answer.votes.set(user.id, vote);
    adjustRating(answer.model, vote, 1);
  });

  client.on('messageReactionRemove', (reaction, user) => {
    if (user.bot) return;
    const vote = VOTES[reaction.emoji.name];
    const answer = answers.get(reaction.message.id);
    if (!vote || !answer || answer.votes.get(user.id) !== vote) return;

    answer.votes.delete(user.id);
    adjustRating(answer.model, vote, -1);
  });
};
