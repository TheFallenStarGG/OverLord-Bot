const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits: P,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const rr = require('./reactionRoles');
const { logging } = require('./logging');

const SESSION_MS = 20 * 60 * 1000; // a builder closes itself after 20 minutes of nothing
const EPHEMERAL = MessageFlags.Ephemeral;
const sessions = new Map(); // session id -> everything the person has set up so far

// ---------- Small helpers ----------

function parseColor(text) {
  const m = String(text).trim().replace(/^#/, '').match(/^([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const hex = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return parseInt(hex, 16);
}

const hexOf = (n) => `#${Number(n).toString(16).padStart(6, '0').toUpperCase()}`;

function textInput(id, label, { style = TextInputStyle.Short, required = false, max, placeholder, value } = {}) {
  const input = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required);
  if (max) input.setMaxLength(max);
  if (placeholder) input.setPlaceholder(placeholder);
  if (value) input.setValue(value);
  return new ActionRowBuilder().addComponents(input);
}

// Checks an emoji typed into a form. Returns { error } or { emoji }.
function checkEmoji(session, text) {
  const emoji = rr.readEmoji(text);
  if (emoji.invalid) {
    return { error: '⚠️ That doesn\'t look like an emoji. Use a normal emoji, or a custom one like `<:name:123456789012345678>`.' };
  }
  if (emoji.none && session.mode === 'reactions') return { error: '⚠️ Reaction panels need an emoji on every role.' };
  if (!emoji.none && session.roles.some((r) => rr.readEmoji(r.emoji).key === emoji.key)) {
    return { error: '⚠️ Another role on this panel already uses that emoji.' };
  }
  return { emoji };
}

// ---------- The builder message ----------

function builderComponents(session) {
  const id = (action) => `rr:${action}:${session.sid}`;
  const empty = session.roles.length === 0;
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(id('edit')).setEmoji('✏️').setLabel('Edit embed').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(id('new')).setEmoji('✨').setLabel('New role').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(id('old')).setEmoji('➕').setLabel('Existing role').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(id('rm')).setEmoji('🗑️').setLabel('Remove role').setStyle(ButtonStyle.Secondary).setDisabled(empty)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(id('mode'))
        .setEmoji('🔁')
        .setLabel(`Style: ${rr.MODE_LABEL[session.mode]}`)
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(id('excl'))
        .setEmoji('1️⃣')
        .setLabel(`Pick only one: ${session.exclusive ? 'On' : 'Off'}`)
        .setStyle(session.exclusive ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(id('pub')).setEmoji('🚀').setLabel('Publish').setStyle(ButtonStyle.Primary).setDisabled(empty),
      new ButtonBuilder().setCustomId(id('cancel')).setEmoji('✖️').setLabel('Cancel').setStyle(ButtonStyle.Danger)
    ),
  ];
}

function builderPayload(session, guild) {
  const hint = session.roles.length
    ? ''
    : '\n_No roles yet. Press **New role** to create one (with a color), or **Existing role** to pick one you already have._';
  return {
    content:
      `🛠️ **Reaction role builder** · Style: **${rr.MODE_LABEL[session.mode]}** · ` +
      `Pick only one: **${session.exclusive ? 'On' : 'Off'}** · Roles: **${session.roles.length}**${hint}\n` +
      '_This is a live preview of the panel._',
    embeds: [rr.buildPanelEmbed(guild, session)],
    components: builderComponents(session),
  };
}

const refreshBuilder = (session, guild) =>
  session.message.edit(builderPayload(session, guild)).catch((err) => logging('warn', 'Could not update the role builder', err.message));

async function expire(session) {
  sessions.delete(session.sid);
  await session.message
    .edit({ content: '⌛ This builder timed out. Run `!!reactionroles` to start again.', embeds: [], components: [] })
    .catch(() => {});
}

function endSession(session) {
  clearTimeout(session.timer);
  sessions.delete(session.sid);
}

async function startBuilder(message) {
  // One builder per person per server
  for (const old of [...sessions.values()]) {
    if (old.userId === message.author.id && old.guildId === message.guild.id) {
      clearTimeout(old.timer);
      await expire(old);
    }
  }

  const sid = Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
  const session = {
    sid,
    userId: message.author.id,
    guildId: message.guild.id,
    title: 'Pick your roles',
    description: 'Choose the roles you want below.',
    color: 0x5865f2,
    mode: 'buttons',
    exclusive: false,
    roles: [], // { roleId, emoji, description }
    message: null,
    timer: null,
    tipShown: false,
  };
  sessions.set(sid, session);
  session.message = await message.channel.send(builderPayload(session, message.guild));
  session.timer = setTimeout(() => expire(session), SESSION_MS);
}

// Everything that has to be true before the panel can be posted
async function publishProblem(session, guild) {
  if (!session.roles.length) return 'Add at least one role first.';

  const max = rr.MAX_ROLES[session.mode];
  if (session.roles.length > max) {
    return `A ${rr.MODE_LABEL[session.mode].toLowerCase()} panel holds at most **${max}** roles. Remove some or change the style.`;
  }
  if (session.mode === 'reactions') {
    const missing = session.roles.filter((r) => rr.readEmoji(r.emoji).none);
    if (missing.length) {
      return `Reaction panels need an emoji on every role. Missing on: ${missing.map((r) => `<@&${r.roleId}>`).join(', ')}. Remove and re-add them with an emoji, or change the style.`;
    }
  }
  for (const entry of session.roles) {
    const role = guild.roles.cache.get(entry.roleId);
    const problem = await rr.roleProblem(guild, role);
    if (problem) return `**${role?.name ?? 'A role'}** can't be handed out: ${problem}.`;
  }
  return null;
}

// ---------- Button / form / menu clicks (customId starts with "rr:") ----------

async function handleBuilderInteraction(interaction) {
  const [, action, sid, extra] = interaction.customId.split(':');
  const session = sessions.get(sid);

  if (!session) {
    return interaction.reply({ content: '⌛ This builder has expired. Run `!!reactionroles` to start a new one.', flags: EPHEMERAL });
  }
  if (interaction.user.id !== session.userId) {
    return interaction.reply({ content: 'This is someone else\'s builder. Run `!!reactionroles` to make your own.', flags: EPHEMERAL });
  }
  const guild = interaction.guild;
  if (!guild || guild.id !== session.guildId) return;

  const isOwner = Boolean(process.env.OWNER_ID) && interaction.user.id === process.env.OWNER_ID;
  if (!isOwner && !interaction.memberPermissions?.has(P.ManageRoles)) {
    return interaction.reply({ content: 'You need the **Manage Roles** permission to use this.', flags: EPHEMERAL });
  }

  clearTimeout(session.timer);
  session.timer = setTimeout(() => expire(session), SESSION_MS);

  switch (action) {
    // ----- Embed title / description / color -----
    case 'edit':
      return interaction.showModal(
        new ModalBuilder()
          .setCustomId(`rr:editm:${sid}`)
          .setTitle('Edit the embed')
          .addComponents(
            textInput('title', 'Title', { max: 256, value: session.title }),
            textInput('desc', 'Description', { style: TextInputStyle.Paragraph, max: 1500, value: session.description }),
            textInput('color', 'Color (hex, like #5865F2)', { max: 7, value: hexOf(session.color) })
          )
      );

    case 'editm': {
      const title = interaction.fields.getTextInputValue('title').trim();
      const description = interaction.fields.getTextInputValue('desc').trim();
      const colorText = interaction.fields.getTextInputValue('color').trim();
      if (colorText) {
        const color = parseColor(colorText);
        if (color === null) {
          return interaction.reply({ content: '⚠️ That color isn\'t valid. Use hex like `#5865F2`.', flags: EPHEMERAL });
        }
        session.color = color;
      }
      session.title = title || 'Pick your roles';
      session.description = description;
      return interaction.update(builderPayload(session, guild));
    }

    // ----- Create a brand new role -----
    case 'new':
      return interaction.showModal(
        new ModalBuilder()
          .setCustomId(`rr:newm:${sid}`)
          .setTitle('Create a new role')
          .addComponents(
            textInput('name', 'Role name', { required: true, max: 100, placeholder: 'Gamer' }),
            textInput('color', 'Role color (hex, optional)', { max: 7, placeholder: '#E91E63' }),
            textInput('emoji', session.mode === 'reactions' ? 'Emoji (required for reactions)' : 'Emoji (optional)', { max: 64, placeholder: '🎮' }),
            textInput('desc', 'Short description (optional)', { max: 100 })
          )
      );

    case 'newm': {
      if (session.roles.length >= 25) {
        return interaction.reply({ content: '⚠️ A panel holds at most 25 roles.', flags: EPHEMERAL });
      }
      const name = interaction.fields.getTextInputValue('name').trim();
      const colorText = interaction.fields.getTextInputValue('color').trim();
      const description = interaction.fields.getTextInputValue('desc').trim();
      if (!name) return interaction.reply({ content: '⚠️ The role needs a name.', flags: EPHEMERAL });

      let color;
      if (colorText) {
        color = parseColor(colorText);
        if (color === null) {
          return interaction.reply({ content: '⚠️ That color isn\'t valid. Use hex like `#E91E63`.', flags: EPHEMERAL });
        }
      }
      const checked = checkEmoji(session, interaction.fields.getTextInputValue('emoji'));
      if (checked.error) return interaction.reply({ content: checked.error, flags: EPHEMERAL });

      if (guild.roles.cache.some((r) => r.name.toLowerCase() === name.toLowerCase())) {
        return interaction.reply({
          content: `⚠️ A role named **${name}** already exists. Use **Existing role** to add it instead.`,
          flags: EPHEMERAL,
        });
      }
      const me = await rr.getMe(guild);
      if (!me.permissions.has(P.ManageRoles)) {
        return interaction.reply({ content: '⚠️ I need the **Manage Roles** permission to create roles.', flags: EPHEMERAL });
      }

      await interaction.deferUpdate();
      let role;
      try {
        role = await guild.roles.create({
          name,
          color,
          permissions: [], // new roles never get any permissions
          mentionable: false,
          reason: `Reaction role builder (${interaction.user.username})`,
        });
      } catch (err) {
        logging('warn', 'Could not create a role', err.message);
        return interaction.followUp({
          content: '⚠️ I couldn\'t create that role. The server may have reached its role limit, or I\'m missing Manage Roles.',
          flags: EPHEMERAL,
        });
      }

      session.roles.push({ roleId: role.id, emoji: checked.emoji.raw ?? '', description });
      await refreshBuilder(session, guild);
      if (!session.tipShown) {
        session.tipShown = true;
        await interaction.followUp({
          content: `✅ Created ${role}. New roles start at the bottom of your role list, so drag it up in **Server Settings → Roles** if its color should win over your other roles (keep it below my role).`,
          flags: EPHEMERAL,
        });
      }
      return;
    }

    // ----- Add a role that already exists -----
    case 'old': {
      const menu = new RoleSelectMenuBuilder()
        .setCustomId(`rr:pickrole:${sid}`)
        .setPlaceholder('Pick a role to add')
        .setMinValues(1)
        .setMaxValues(1);
      return interaction.reply({
        content: 'Which existing role should go on the panel?',
        components: [new ActionRowBuilder().addComponents(menu)],
        flags: EPHEMERAL,
      });
    }

    case 'pickrole': {
      const picked = interaction.roles.first();
      const role = picked && guild.roles.cache.get(picked.id);
      if (!role) return interaction.update({ content: '⚠️ I couldn\'t find that role.', components: [] });

      const problem = (await rr.roleProblem(guild, role)) || rr.userRoleProblem(interaction.member, role);
      if (problem) return interaction.update({ content: `⚠️ **${role.name}** can't be added: ${problem}.`, components: [] });
      if (session.roles.some((r) => r.roleId === role.id)) {
        return interaction.update({ content: `⚠️ **${role.name}** is already on this panel.`, components: [] });
      }
      if (session.roles.length >= 25) return interaction.update({ content: '⚠️ A panel holds at most 25 roles.', components: [] });

      return interaction.showModal(
        new ModalBuilder()
          .setCustomId(`rr:oldm:${sid}:${role.id}`)
          .setTitle(`Set up "${role.name}"`.slice(0, 45))
          .addComponents(
            textInput('emoji', session.mode === 'reactions' ? 'Emoji (required for reactions)' : 'Emoji (optional)', { max: 64, placeholder: '🎮' }),
            textInput('desc', 'Short description (optional)', { max: 100 })
          )
      );
    }

    case 'oldm': {
      const role = guild.roles.cache.get(extra);
      if (!role) return interaction.update({ content: '⚠️ That role no longer exists.', components: [] });
      if (session.roles.some((r) => r.roleId === role.id)) {
        return interaction.update({ content: `⚠️ **${role.name}** is already on this panel.`, components: [] });
      }
      const checked = checkEmoji(session, interaction.fields.getTextInputValue('emoji'));
      if (checked.error) return interaction.reply({ content: checked.error, flags: EPHEMERAL });

      session.roles.push({
        roleId: role.id,
        emoji: checked.emoji.raw ?? '',
        description: interaction.fields.getTextInputValue('desc').trim(),
      });
      await interaction.update({ content: `✅ Added **${role.name}** to the panel.`, components: [] });
      return refreshBuilder(session, guild);
    }

    // ----- Take a role off the panel (the Discord role itself is kept) -----
    case 'rm': {
      if (!session.roles.length) return interaction.reply({ content: 'There are no roles to remove yet.', flags: EPHEMERAL });
      const menu = new StringSelectMenuBuilder()
        .setCustomId(`rr:rmpick:${sid}`)
        .setPlaceholder('Pick a role to remove from the panel')
        .addOptions(
          session.roles.map((entry) => ({
            label: (guild.roles.cache.get(entry.roleId)?.name ?? 'Deleted role').slice(0, 100),
            value: entry.roleId,
          }))
        );
      return interaction.reply({
        content: 'Remove which role from the panel? (The Discord role itself is not deleted.)',
        components: [new ActionRowBuilder().addComponents(menu)],
        flags: EPHEMERAL,
      });
    }

    case 'rmpick': {
      const roleId = interaction.values[0];
      session.roles = session.roles.filter((r) => r.roleId !== roleId);
      await interaction.update({ content: '🗑️ Removed from the panel.', components: [] });
      return refreshBuilder(session, guild);
    }

    // ----- Style and pick-only-one -----
    case 'mode': {
      session.mode = rr.MODES[(rr.MODES.indexOf(session.mode) + 1) % rr.MODES.length];
      return interaction.update(builderPayload(session, guild));
    }

    case 'excl': {
      session.exclusive = !session.exclusive;
      return interaction.update(builderPayload(session, guild));
    }

    // ----- Publish -----
    case 'pub': {
      const problem = await publishProblem(session, guild);
      if (problem) return interaction.reply({ content: `⚠️ ${problem}`, flags: EPHEMERAL });
      const menu = new ChannelSelectMenuBuilder()
        .setCustomId(`rr:pubchan:${sid}`)
        .setPlaceholder('Where should the panel be posted?')
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(1)
        .setMaxValues(1);
      return interaction.reply({
        content: 'Pick the channel to post the panel in:',
        components: [new ActionRowBuilder().addComponents(menu)],
        flags: EPHEMERAL,
      });
    }

    case 'pubchan': {
      const picked = interaction.channels.first();
      const channel = picked && (guild.channels.cache.get(picked.id) ?? (await guild.channels.fetch(picked.id).catch(() => null)));
      if (!channel?.isTextBased()) return interaction.update({ content: '⚠️ I can\'t post in that channel.', components: [] });

      // You can only post where you could post yourself
      if (!channel.permissionsFor(interaction.member)?.has([P.ViewChannel, P.SendMessages])) {
        return interaction.update({ content: '⚠️ You can\'t post in that channel yourself, so I won\'t post there for you.', components: [] });
      }

      await interaction.update({ content: '⏳ Publishing…', components: [] });
      const problem = await publishProblem(session, guild); // things may have changed since the builder opened
      if (problem) return interaction.editReply({ content: `⚠️ ${problem}` });

      try {
        const message = await rr.publishPanel(guild, channel, session, session.userId);
        endSession(session);
        await session.message.delete().catch(() => {});
        return interaction.editReply({ content: `✅ Published in ${channel}! [Jump to the panel](${message.url})` });
      } catch (err) {
        if (!err.friendly) logging('error', 'Reaction role publish failed', err);
        return interaction.editReply({
          content: `⚠️ ${err.friendly ? err.message : 'I couldn\'t post the panel. Check my permissions in that channel and try again.'}`,
        });
      }
    }

    case 'cancel': {
      endSession(session);
      return interaction.update({ content: '✖️ Builder closed. Nothing was posted.', embeds: [], components: [] });
    }

    default:
      return;
  }
}

module.exports = { startBuilder, handleBuilderInteraction };
