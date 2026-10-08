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
  const resolved = interaction.options?.resolved;

  for (const match of String(text).matchAll(/<@!?(\d{17,20})>/g)) {
    const id = match[1];
    const user = resolved?.users?.get(id) ?? interaction.client.users.cache.get(id) ?? null;
    if (user) users.set(id, user);
    const member = interaction.guild?.members?.cache?.get(id) ?? resolved?.members?.get(id) ?? null;
    if (member) members.set(id, member);
  }

  for (const match of String(text).matchAll(/<#(\d{17,20})>/g)) {
    const id = match[1];
    const channel =
      resolved?.channels?.get(id) ??
      interaction.guild?.channels?.cache?.get(id) ??
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

// The picked user and channel become normal <@id> / <#id> text, so existing commands parse them as usual
function buildSlashPayload(interaction) {
  const commands = interaction.client._overlordCommands;
  const command =
    [...(commands?.values?.() ?? [])].find((c) => slashNameFromCommand(c) === interaction.commandName) ?? null;

  const user = interaction.options.getUser('user');
  const channel = interaction.options.getChannel('channel');
  const text = interaction.options.getString('args');

  const rawArg = [user ? `<@${user.id}>` : null, text, channel ? `<#${channel.id}>` : null]
    .filter(Boolean)
    .join(' ')
    .trim();

  return { command, rawArg, arg: rawArg.toLowerCase() };
}

/**
 * Minimal stand-in for a Message so existing command.run(message, arg, ctx) can run.
 * Experimental: not every Message API exists.
 */
function createMessageShim(interaction) {
  const { rawArg } = buildSlashPayload(interaction);
  const mentions = mentionsFromText(rawArg, interaction);

  const reply = async (payload) => {
    const data = typeof payload === 'string' ? { content: payload } : { ...payload };
    // Slash replies don't use message references the same way
    delete data.failIfNotExists;

    try {
      if (!interaction.deferred && !interaction.replied) return await interaction.reply(data);
      if (interaction.deferred && !interaction.replied) return await interaction.editReply(data);
      return await interaction.followUp(data);
    } catch (err) {
      // Fallback: post in channel if interaction token is dead
      if (interaction.channel?.send) return interaction.channel.send(data);
      throw err;
    }
  };

  return {
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
}

// ---------- Building the slash options from each command's usage text ----------

// "!!give @user <amount>" -> { user: 'required', channel: false, hint: '<amount>' }
function parseUsage(command) {
  const usage = String(command.usage || '').replace(/^!!\S+\s*/, '');

  const userMatch = /@[a-z]+/i.exec(usage);
  let user = null;
  if (userMatch) {
    // The person is required unless they sit inside [ ] brackets
    const before = usage.slice(0, userMatch.index);
    const open = (before.match(/\[/g) || []).length;
    const close = (before.match(/\]/g) || []).length;
    user = open > close ? 'optional' : 'required';
  }

  const channel = /#[a-z]+/i.test(usage);

  const hint = usage
    .replace(/\[?\s*@[a-z]+\s*\]?/gi, ' ')
    .replace(/#[a-z]+/gi, ' ')
    .replace(/\|\s*\]/g, ']')
    .replace(/\[\s*\|/g, '[')
    .replace(/\[\s*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return { user, channel, hint };
}

function toSlashCommandJSON(command) {
  const { user, channel, hint } = parseUsage(command);
  const options = [];

  // Required options must come first
  if (user) {
    options.push({
      type: 6, // USER
      name: 'user',
      description: 'Who to use this on',
      required: user === 'required',
    });
  }

  options.push({
    type: 3, // STRING
    name: 'args',
    description: (hint ? `Options: ${hint}` : 'Anything else you would type after the command').slice(0, 100),
    required: false,
  });

  if (channel) {
    options.push({
      type: 7, // CHANNEL
      name: 'channel',
      description: 'Which channel to use',
      required: false,
      channel_types: [0, 4, 5], // text, category, announcement
    });
  }

  return {
    name: slashNameFromCommand(command),
    description: slashDescription(command),
    dm_permission: false, // most economy/game commands need a server
    options,
  };
}

module.exports = {
  slashNameFromCommand,
  slashDescription,
  createMessageShim,
  buildSlashPayload,
  toSlashCommandJSON,
};
