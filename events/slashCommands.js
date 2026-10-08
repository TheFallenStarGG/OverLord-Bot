const { MessageFlags } = require('discord.js');
const { logging, whoWhere } = require('../lib/logging');
const { maybeNudge } = require('../lib/donate');
const { createMessageShim, buildSlashPayload, toSlashCommandJSON } = require('../lib/slashBridge');
const guard = require('../lib/guard');

module.exports = (client, ctx) => {
  client._overlordCommands = ctx.commands;

  let registered = false;
  const registerOnce = async () => {
    if (registered) return;
    registered = true;

    try {
      const body = [];
      const seen = new Set();

      for (const command of ctx.commands.values()) {
        const json = toSlashCommandJSON(command);
        if (!json.name || seen.has(json.name)) continue;
        seen.add(json.name);
        body.push(json);
      }

      await client.application.commands.set(body);
      logging('info', 'Slash commands registered', `${body.length} commands (experimental)`);
      console.log(`Registered ${body.length} slash commands (experimental)`);
    } catch (err) {
      logging('error', 'Slash command registration failed', err);
      console.error('Slash command registration failed:', err);
    }
  };

  client.once('clientReady', registerOnce);
  client.once('ready', registerOnce);

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { command, rawArg, arg } = buildSlashPayload(interaction);
    if (!command) {
      return interaction
        .reply({ content: 'That slash command is not available right now.', flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }

    const isOwner = Boolean(process.env.OWNER_ID) && interaction.user.id === process.env.OWNER_ID;

    if (command.access !== 'free' && !isOwner) {
      logging('warn', 'Blocked command attempt', `/${interaction.commandName} by ${interaction.user.tag} (not the owner)`);
      return interaction
        .reply({ content: 'That command is owner-only.', flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }

    const message = createMessageShim(interaction);

    // Blacklist, flood limit, and abuse tracking (same checks as the !! commands)
    const check = await guard.preflight(message, command, { isOwner, viaSlash: true });
    if (!check.ok) {
      return interaction
        .reply({ content: check.reply ?? 'You cannot use that right now.', flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }

    try {
      await interaction.deferReply();
    } catch {
      return;
    }

    const msgCtx = { ...ctx, isOwner, rawArg, viaSlash: true };

    logging('info', 'Command used', `/${interaction.commandName} (slash → ${command.name}) by ${whoWhere(message)}`);

    try {
      await command.run(message, arg, msgCtx);

      if (interaction.deferred && !interaction.replied) {
        await interaction
          .editReply({
            content:
              'Done. (This slash command had no direct reply — prefer the `!!` prefix version if something looks missing.)',
          })
          .catch(() => {});
      }

      if (command.name !== '!!donate') {
        try {
          maybeNudge(message);
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      const payload = { content: guard.friendlyError(err, `${command.name} (slash)`) };
      if (interaction.deferred && !interaction.replied) {
        await interaction.editReply(payload).catch(() => {});
      } else {
        await interaction.followUp(payload).catch(() => {});
      }
    }
  });
};
