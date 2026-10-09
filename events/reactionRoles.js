const { MessageFlags } = require('discord.js');
const rr = require('../lib/reactionRoles');
const { handleBuilderInteraction } = require('../lib/rrBuilder');
const { logging } = require('../lib/logging');
const { runIn } = require('../lib/storage');

// Reactions the bot removes itself shouldn't also count as the person taking their role back
const quiet = new Set();
const quietKey = (messageId, userId, key) => `${messageId}:${userId}:${key}`;

function removeQuietly(reaction, userId) {
  const key = quietKey(reaction.message.id, userId, rr.reactionKey(reaction.emoji));
  quiet.add(key);
  setTimeout(() => quiet.delete(key), 15 * 1000);
  return reaction.users.remove(userId).catch(() => quiet.delete(key));
}

// Buttons and dropdowns on a published panel (customId starts with "rrp:")
async function handlePanelInteraction(interaction) {
  if (!interaction.guild) return;
  const panel = rr.getPanel(interaction.message.id);
  if (!panel) {
    return interaction.reply({ content: 'This role panel is no longer active.', flags: MessageFlags.Ephemeral });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let result;
  if (interaction.isButton()) {
    result = await rr.toggleRole(interaction.member, panel, interaction.customId.split(':')[2]);
  } else if (interaction.isStringSelectMenu()) {
    result = await rr.setSelection(interaction.member, panel, interaction.values);
  } else {
    return interaction.deleteReply().catch(() => {});
  }
  await interaction.editReply({ content: result.error ? `⚠️ ${result.error}` : result.text });
}

async function handleReaction(client, reaction, user, adding) {
  if (user.partial) {
    try {
      user = await user.fetch();
    } catch {
      return;
    }
  }
  if (user.bot) return;

  const message = reaction.message;
  if (!message.guildId) return;
  const panel = rr.getPanel(message.id);
  if (!panel || panel.mode !== 'reactions') return;

  const key = rr.reactionKey(reaction.emoji);
  if (!adding && quiet.delete(quietKey(message.id, user.id, key))) return;

  const guild = client.guilds.cache.get(message.guildId);
  if (!guild) return;

  const entry = panel.roles.find((r) => rr.readEmoji(r.emoji).key === key);
  if (!entry) {
    if (adding) removeQuietly(reaction, user.id); // keep the panel clean: only its own emojis are allowed
    return;
  }

  let member;
  try {
    member = await guild.members.fetch(user.id);
  } catch {
    return;
  }

  if (adding) {
    const res = await rr.grantRole(member, panel, entry.roleId);
    if (res.error) {
      removeQuietly(reaction, user.id);
      logging('warn', 'Reaction role not given', `${guild.name}: ${res.error}`);
      return;
    }
    if (panel.exclusive) {
      if (message.partial) await message.fetch().catch(() => {});
      for (const other of message.reactions.cache.values()) {
        if (rr.reactionKey(other.emoji) !== key) removeQuietly(other, user.id);
      }
    }
  } else {
    await rr.revokeRole(member, entry.roleId);
  }
}

module.exports = (client) => {
  client.on('interactionCreate', async (interaction) => {
    const id = interaction.customId;
    if (typeof id !== 'string') return; // slash commands have no customId

    try {
      if (id.startsWith('rr:')) return await handleBuilderInteraction(interaction);
      if (id.startsWith('rrp:')) return await handlePanelInteraction(interaction);
    } catch (err) {
      logging('error', 'Reaction roles interaction failed', err);
      if (!interaction.replied && !interaction.deferred) {
        interaction.reply({ content: 'Something went wrong. Please try again.', flags: MessageFlags.Ephemeral }).catch(() => {});
      } else {
        interaction.followUp({ content: 'Something went wrong. Please try again.', flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    }
  });

  client.on('messageReactionAdd', async (reaction, user) => {
    try {
      await handleReaction(client, reaction, user, true);
    } catch (err) {
      logging('error', 'Reaction role (add) failed', err);
    }
  });

  client.on('messageReactionRemove', async (reaction, user) => {
    try {
      await handleReaction(client, reaction, user, false);
    } catch (err) {
      logging('error', 'Reaction role (remove) failed', err);
    }
  });

  // Housekeeping: forget panels whose message or roles were deleted
  client.on('messageDelete', (message) => {
    try {
      rr.deletePanel(message.id);
    } catch {
      /* no server attached to this event */
    }
  });

  client.on('messageDeleteBulk', (messages) => {
    const first = messages.first();
    if (!first?.guildId) return;
    runIn(first.guildId, () => {
      for (const message of messages.values()) rr.deletePanel(message.id);
    });
  });

  client.on('roleDelete', (role) => {
    try {
      rr.removeRoleFromPanels(role.id);
    } catch {
      /* no server attached to this event */
    }
  });
};
