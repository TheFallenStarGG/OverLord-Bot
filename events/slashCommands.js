const { logging, whoWhere } = require('../lib/logging');
const { maybeNudge } = require('../lib/donate');
const {
  createMessageShim,
  buildSlashPayload,
  toSlashCommandJSON,
} = require('../lib/slashBridge');

const FLOOD_MS = 1000;
const lastSlashAt = new Map();

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
        .reply({ content: 'That slash command is not available right now.', ephemeral: true })
        .catch(() => {});
    }

    const isOwner =
      Boolean(process.env.OWNER_ID) && interaction.user.id === process.env.OWNER_ID;

    if (command.access !== 'free' && !isOwner) {
      logging(
        'warn',
        'Blocked command attempt',
        `/${interaction.commandName} by ${interaction.user.tag} (not the owner)`
      );
      return interaction
        .reply({ content: 'That command is owner-only.', ephemeral: true })
        .catch(() => {});
    }

    if (!isOwner) {
      const now = Date.now();
      if (now - (lastSlashAt.get(interaction.user.id) ?? 0) < FLOOD_MS) {
        return interaction
          .reply({ content: 'Slow down a second.', ephemeral: true })
          .catch(() => {});
      }
      lastSlashAt.set(interaction.user.id, now);
      if (lastSlashAt.size > 5000) lastSlashAt.clear();
    }

    try {
      await interaction.deferReply();
    } catch {
      return;
    }

    const message = createMessageShim(interaction);
    const msgCtx = { ...ctx, isOwner, rawArg, viaSlash: true };

    logging(
      'info',
      'Command used',
      `/${interaction.commandName} (slash → ${command.name}) by ${whoWhere(message)}`
    );

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
      logging('error', `Command ${command.name} failed (slash)`, err);
      const payload = { content: 'Something went wrong running that command.' };
      if (interaction.deferred && !interaction.replied) {
        await interaction.editReply(payload).catch(() => {});
      } else {
        await interaction.followUp(payload).catch(() => {});
      }
    }
  });
};
