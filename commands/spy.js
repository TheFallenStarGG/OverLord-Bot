const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { fmt } = require('../lib/economy');
const { attempt, SPY_COST, SPY_COOLDOWN_MS, MARK_BONUS, MARK_MS } = require('../lib/spy');

module.exports = {
  name: '!!spy',
  usage: '!!spy @user',
  description: `Pay ${SPY_COST} coins to send a spy and learn someone's wallet, guards, and thieves. Success also makes your next \`!!rob\` on them ${Math.round(MARK_BONUS * 100)}% more likely to work. Guards make spies easier to catch.`,
  access: 'free',

  async run(message) {
    const target = message.mentions.users.first();
    if (!target) return message.reply('Who do you want to spy on? Usage: `!!spy @user`');
    if (target.bot) return message.reply('Bots have nothing worth spying on.');
    if (target.id === message.author.id) return message.reply('You cannot spy on yourself.');

    const r = attempt(message.author.id, target.id);
    if (r.error) return message.reply(r.error);

    if (r.caught) {
      return message.reply({
        content: `🚨 A spy sent by <@${message.author.id}> was caught snooping around <@${target.id}>! The ${fmt(SPY_COST)} fee is gone.`,
        allowedMentions: { users: [target.id], repliedUser: false },
      });
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`spy:reveal:${r.reportId}`).setLabel('Read the intel').setEmoji('🕵️').setStyle(ButtonStyle.Primary)
    );
    return message.reply({
      content:
        `🕵️ Your spy slipped in unnoticed and came back with intel on **${target.username}**. Only you can read it.\n` +
        `-# Your next \`!!rob\` on them in the next ${MARK_MS / 60000} minutes is ${Math.round(MARK_BONUS * 100)}% more likely to succeed. You can send a spy every ${SPY_COOLDOWN_MS / 60000} minutes.`,
      components: [row],
    });
  },
};
