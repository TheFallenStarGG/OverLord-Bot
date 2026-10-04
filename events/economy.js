const { addMessageXp, saveNow, fmt } = require('../lib/economy');
const { logging } = require('../lib/logging');

module.exports = (client) => {
  client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    try {
      const result = addMessageXp(message.author.id);
      if (result?.leveledUp) {
        await message.channel.send(
          `🎉 <@${message.author.id}> reached **level ${result.level}**! Bonus: **${fmt(result.reward)}**`
        );
        logging('info', 'Level up', `${message.author.username} reached level ${result.level}`);
      }
    } catch (err) {
      logging('error', 'XP handler failed', err);
    }
  });

  // Make sure nothing is lost when the bot stops
  process.on('exit', saveNow);
};
