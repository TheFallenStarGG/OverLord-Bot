const { addMessageXp, recordQuest, saveNow, fmt } = require('../lib/economy');
const { data: world } = require('../lib/world');
const { logging } = require('../lib/logging');
const { isUserBlocked } = require('../lib/blacklist');

module.exports = (client) => {
  client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild || isUserBlocked(message.author.id)) return;
    
    try {
      recordQuest(message.author.id, 'messages');

      const result = addMessageXp(message.author.id);
      if (result?.leveledUp) {
        const channelId = world.settings.levelChannelId;
        if (channelId) {
          const channel = await client.channels.fetch(channelId).catch(() => null);
          if (channel?.guildId === message.guild.id) {
            await channel
              .send(`🎉 <@${message.author.id}> reached **level ${result.level}**! Bonus: **${fmt(result.reward)}**`)
              .catch(() => {});
          }
        }
        logging('info', 'Level up', `${message.author.username} reached level ${result.level}`);
      }
    } catch (err) {
      logging('error', 'XP handler failed', err);
    }
  });

  // Make sure nothing is lost when the bot stops
  process.on('exit', saveNow);
};
