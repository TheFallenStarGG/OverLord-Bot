const { logging, whoWhere } = require('../lib/logging');
const { maybeNudge } = require('../lib/donate');
const {
  createMessageShim,
  buildSlashPayload,
  toSlashCommandJSON,
  slashNameFromCommand,
} = require('../lib/slashBridge');

const FLOOD_MS = 1000;
const lastSlashAt = new Map();

module.exports = (client, ctx) => {
  // So the bridge can resolve command objects by slash name
  client._overlordCommands = ctx.commands;

  const register = async () => {
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

  client.once('clientReady', register);
  client.once('ready', register); // older discord.js name, harmless if both fire once each — prefer single:

  // If both clientReady and ready exist, only one should run register.
  // Safer pattern:
  let registered = false;
  const registerOnce = () => {
    if (registered) return;
    registered = true;
    register();
  };
  client.once('clientReady', registerOnce);
  client.once('ready', registerOnce);

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { command, rawArg, arg } = buildSlashPayload(interaction);
    if (!command) {
      return interaction.reply({
        content: 'That slash command is not available right now.',
        ephemeral: true,
      }).catch(() => {});
    }

    const isOwner = Boolean(process.env.OWNER_ID) && interaction.user.id === process.env.OWNER_ID;

    if (command.access !== 'free' && !isOwner) {
      logging('warn', 'Blocked command attempt', `/${interaction.commandName} by ${interaction.user.tag} (not the owner)`);
      return interaction.reply({
        content: 'That command is owner-only.',
        ephemeral: true,
      }).catch(() => {});
    }

    if (!isOwner) {
      const now = Date.now();
      if (now - (lastSlashAt.get(interaction.user.id) ?? 0) < FLOOD_MS) {
        return interaction.reply({ content: 'Slow down a second.', ephemeral: true }).catch(() => {});
      }
      lastSlashAt.set(interaction.user.id, now);
      if (lastSlashAt.size > 5000) lastSlashAt.clear();
    }

    // Buy time for slow commands (3s slash limit)
    try {
      await interaction.deferReply();
    } catch {
      return;
    }

    const message = createMessageShim(interaction);
    const msgCtx = { ...ctx, isOwner, rawArg, viaSlash: true };

    logging('info', 'Command used', `/${interaction.commandName} (slash → ${command.name}) by ${whoWhere(message)}`);

    try {
      await command.run(message, arg, msgCtx);

      // If the command never called message.reply, close the deferred interaction
      if (interaction.deferred && !interaction.replied) {
        await interaction.editReply({
          content: 'Done. (This slash command had no direct reply — try the `!!` version if something looks missing.)',
        }).catch(() => {});
      }

      if (command.name !== '!!donate') {
        // maybeNudge expects a message with reply/channel; best-effort
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
