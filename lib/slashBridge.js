const { Collection } = require('discord.js');

// !!events-channel -> events-channel
function slashNameFromCommand(command) {
  return String(command.name || '')
    .replace(/^!!/, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 32);
}

function slashDescription(command) {
  const text = String(command.description || command.usage || 'Run this command')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, 100) || 'Run this command';
}

// Turn <@id> / <#id> in the args string into mention-like collections
function mentionsFromText(text, interaction) {
  const users = new Collection();
  const channels = new Collection();
  const members = new Collection();

  for (const match of String(text).matchAll(/<@!?(\d{17,20})>/g)) {
    const id = match[1];
    const user =
      interaction.client.users.cache.get(id) ||
      (interaction.options?.resolved?.users?.get(id) ?? null);
    if (user) users.set(id, user);
    const member = interaction.guild?.members?.cache?.get(id);
    if (member) members.set(id, member);
  }

  for (const match of String(text).matchAll(/<#(\d{17,20})>/g)) {
    const id = match[1];
    const channel =
      interaction.guild?.channels?.cache?.get(id) ||
      interaction.client.channels.cache.get(id);
    if (channel) channels.set(id, channel);
  }

  return {
    users,
    channels,
    members,
    roles: new Collection(),
    everyone: false,
  };
}

function buildSlashPayload(interaction) {
  const body = [];
  const commands = interaction.client._overlordCommands;
  const command =
    [...(commands?.values?.() ?? [])].find(
      (c) => slashNameFromCommand(c) === interaction.commandName
    ) ?? null;

  const argsOpt = interaction.options.getString('args');
  if (argsOpt) body.push(argsOpt);

  // If Discord resolved a user/channel from partial mentions, keep raw text only;
  // commands still parse mentions from the args string.
  const rawArg = body.join(' ').trim();
  const arg = rawArg.toLowerCase();
  return { command, rawArg, arg };
}

/**
 * Minimal stand-in for a Message so existing command.run(message, arg, ctx) can run.
 * Experimental: not every Message API exists.
 */
function createMessageShim(interaction) {
  const { rawArg } = buildSlashPayload(interaction);
  const mentions = mentionsFromText(rawArg, interaction);

  let replied = false;

  const reply = async (payload) => {
    const data = typeof payload === 'string' ? { content: payload } : { ...payload };
    // Slash replies don't use message references the same way
    delete data.failIfNotExists;

    try {
      if (!interaction.deferred && !interaction.replied) {
        replied = true;
        return await interaction.reply(data);
      }
      if (interaction.deferred && !interaction.replied) {
        replied = true;
        return await interaction.editReply(data);
      }
      return await interaction.followUp(data);
    } catch (err) {
      // Fallback: post in channel if interaction token is dead
      if (interaction.channel?.send) {
        return interaction.channel.send(data);
      }
      throw err;
    }
  };

  const shim = {
    author: interaction.user,
    member: interaction.member ?? null,
    guild: interaction.guild ?? null,
    guildId: interaction.guildId ?? null,
    channel: interaction.channel,
    channelId: interaction.channelId,
    client: interaction.client,
    id: interaction.id,
    content: rawArg,
    mentions,
    createdTimestamp: interaction.createdTimestamp,
    url: null,
    // Used by a few commands; best-effort no-ops / fallbacks
    react: async () => null,
    edit: async (payload) => reply(payload),
    delete: async () => null,
    reply,
  };

  return shim;
}

function toSlashCommandJSON(command) {
  return {
    name: slashNameFromCommand(command),
    description: slashDescription(command),
    dm_permission: false, // most economy/game commands need a server
    options: [
      {
        type: 3, // STRING
        name: 'args',
        description: 'Same text you would type after the !!command',
        required: false,
      },
    ],
  };
}

module.exports = {
  slashNameFromCommand,
  slashDescription,
  createMessageShim,
  buildSlashPayload,
  toSlashCommandJSON,
};
