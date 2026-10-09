const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits: P,
  PermissionsBitField,
  StringSelectMenuBuilder,
} = require('discord.js');
const { data, saveNow } = require('./world');

const MODES = ['buttons', 'dropdown', 'reactions'];
const MODE_LABEL = { buttons: 'Buttons', dropdown: 'Dropdown', reactions: 'Reactions' };
const MAX_ROLES = { buttons: 25, dropdown: 25, reactions: 20 }; // Discord's limits per message
const REASON = 'Reaction role panel';

// A panel can never hand out a role that has any of these permissions
const DANGEROUS = [
  P.Administrator, P.ManageGuild, P.ManageRoles, P.ManageChannels, P.ManageMessages, P.ManageWebhooks,
  P.KickMembers, P.BanMembers, P.ModerateMembers, P.ManageNicknames, P.MentionEveryone,
  P.ManageGuildExpressions, P.ManageEmojisAndStickers,
].filter((flag) => flag !== undefined);

// An error whose text is safe to show to the person
const fail = (message) => Object.assign(new Error(message), { friendly: true });

// ---------- Saved panels (one list per server, kept inside the world data) ----------

function store() {
  data.reactionRoles ??= { panels: {} };
  data.reactionRoles.panels ??= {};
  return data.reactionRoles.panels;
}

const getPanel = (messageId) => store()[messageId] ?? null;

function savePanel(messageId, panel) {
  store()[messageId] = panel;
  saveNow();
}

function deletePanel(messageId) {
  if (!store()[messageId]) return false;
  delete store()[messageId];
  saveNow();
  return true;
}

function listPanels() {
  return Object.entries(store()).map(([messageId, panel]) => ({ messageId, ...panel }));
}

// A role was deleted from the server: drop it from every panel
function removeRoleFromPanels(roleId) {
  let changed = false;
  for (const panel of Object.values(store())) {
    const before = panel.roles.length;
    panel.roles = panel.roles.filter((r) => r.roleId !== roleId);
    if (panel.roles.length !== before) changed = true;
  }
  if (changed) saveNow();
}

// ---------- Emoji ----------

const CUSTOM_EMOJI = /^<(a?):(\w{2,32}):(\d{17,20})>$/;
const UNICODE_EMOJI =
  /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3)(?:\uFE0F|\u200D\p{Extended_Pictographic}|\p{Emoji_Modifier})*$/u;

// Returns { none: true } (left blank), { invalid: true }, or { raw, key, component }
function readEmoji(input) {
  const text = String(input ?? '').trim();
  if (!text) return { none: true };
  const custom = text.match(CUSTOM_EMOJI);
  if (custom) {
    return { raw: text, key: custom[3], component: { id: custom[3], name: custom[2], animated: custom[1] === 'a' } };
  }
  if (UNICODE_EMOJI.test(text)) return { raw: text, key: text.replace(/\uFE0F/g, ''), component: { name: text } };
  return { invalid: true };
}

// The same "key" for an emoji someone reacted with, so it can be matched to a panel role
function reactionKey(emoji) {
  return emoji.id ?? String(emoji.name ?? '').replace(/\uFE0F/g, '');
}

// ---------- Safety checks ----------

async function getMe(guild) {
  return guild.members.me ?? (await guild.members.fetchMe());
}

// Why the bot can't hand out this role (null = fine)
async function roleProblem(guild, role) {
  if (!role) return 'that role no longer exists';
  if (role.id === guild.id) return '@everyone can\'t be handed out';
  if (role.managed) return 'it belongs to a bot or integration';
  const me = await getMe(guild);
  if (!me.permissions.has(P.ManageRoles)) return 'I don\'t have the **Manage Roles** permission';
  if (role.position >= me.roles.highest.position) {
    return 'it is above my highest role (drag my role above it in Server Settings → Roles)';
  }
  if (role.permissions.any(DANGEROUS)) {
    return 'it has moderator or admin permissions, and role panels can\'t hand those out';
  }
  return null;
}

// Stops people from putting roles on a panel that are above their own
function userRoleProblem(member, role) {
  if (member.guild.ownerId === member.id) return null;
  if (role.position >= member.roles.highest.position) return 'you can only add roles that are below your own highest role';
  return null;
}

// ---------- Giving and taking roles ----------

async function grantRole(member, panel, roleId) {
  const guild = member.guild;
  const role = guild.roles.cache.get(roleId);
  const problem = await roleProblem(guild, role);
  if (problem) return { error: `I can't give **${role?.name ?? 'that role'}** because ${problem}.` };

  try {
    const dropped = [];
    if (panel.exclusive) {
      const others = panel.roles
        .filter((r) => r.roleId !== roleId && member.roles.cache.has(r.roleId))
        .map((r) => guild.roles.cache.get(r.roleId))
        .filter(Boolean);
      if (others.length) {
        await member.roles.remove(others, REASON);
        dropped.push(...others.map((r) => r.name));
      }
    }
    await member.roles.add(role, REASON);
    return { ok: true, name: role.name, dropped };
  } catch {
    return { error: `I couldn't give **${role.name}**. Check that my role is above it and that I have Manage Roles.` };
  }
}

async function revokeRole(member, roleId) {
  const role = member.guild.roles.cache.get(roleId);
  if (!role) return { error: 'That role no longer exists.' };
  try {
    await member.roles.remove(role, REASON);
    return { ok: true, name: role.name };
  } catch {
    return { error: `I couldn't remove **${role.name}**. Check that my role is above it and that I have Manage Roles.` };
  }
}

// Buttons: press once to get the role, again to give it back
async function toggleRole(member, panel, roleId) {
  if (!panel.roles.some((r) => r.roleId === roleId)) return { error: 'That role is no longer part of this panel.' };
  if (member.roles.cache.has(roleId)) {
    const res = await revokeRole(member, roleId);
    return res.error ? res : { text: `➖ Removed **${res.name}**.` };
  }
  const res = await grantRole(member, panel, roleId);
  if (res.error) return res;
  return { text: `✅ You now have **${res.name}**.${res.dropped.length ? ` Removed: ${res.dropped.join(', ')}.` : ''}` };
}

// Dropdown: whatever is picked becomes the member's set of roles from this panel
async function setSelection(member, panel, selected) {
  const guild = member.guild;
  const wanted = new Set(selected);
  const toAdd = [];
  const toRemove = [];
  const problems = [];

  for (const { roleId } of panel.roles) {
    const role = guild.roles.cache.get(roleId);
    const has = member.roles.cache.has(roleId);
    if (wanted.has(roleId) && !has) {
      const problem = await roleProblem(guild, role);
      if (problem) problems.push(`**${role?.name ?? 'A role'}**: ${problem}`);
      else toAdd.push(role);
    } else if (!wanted.has(roleId) && has && role) {
      toRemove.push(role);
    }
  }

  try {
    if (toRemove.length) await member.roles.remove(toRemove, REASON);
    if (toAdd.length) await member.roles.add(toAdd, REASON);
  } catch {
    return { error: 'I couldn\'t update your roles. Check that my role is above them and that I have Manage Roles.' };
  }

  const lines = [];
  if (toAdd.length) lines.push(`✅ Added ${toAdd.map((r) => `**${r.name}**`).join(', ')}`);
  if (toRemove.length) lines.push(`➖ Removed ${toRemove.map((r) => `**${r.name}**`).join(', ')}`);
  if (problems.length) lines.push(`⚠️ Skipped:\n${problems.join('\n')}`);
  return { text: lines.join('\n') || 'Nothing changed.' };
}

// ---------- What the panel looks like ----------

function roleLine(entry) {
  const emoji = entry.emoji ? `${entry.emoji} ` : '• ';
  const desc = entry.description ? ` — ${entry.description}` : '';
  return `${emoji}<@&${entry.roleId}>${desc}`;
}

// cfg = a builder session or a saved panel (title, description, color, mode, exclusive, roles)
function buildPanelEmbed(guild, cfg) {
  const lines = cfg.roles.map(roleLine).join('\n') || '_No roles added yet._';
  const how = {
    buttons: 'Press a button to get a role, press it again to remove it.',
    dropdown: 'Use the menu to choose your roles.',
    reactions: 'React below to get a role. Remove your reaction to give it back.',
  }[cfg.mode];
  const footer = `_${how}${cfg.exclusive ? ' You can only keep **one** of these roles at a time.' : ''}_`;
  const room = Math.max(0, 4096 - lines.length - footer.length - 8);
  const description = [String(cfg.description || '').slice(0, room), lines, footer].filter(Boolean).join('\n\n');

  return new EmbedBuilder()
    .setColor(cfg.color ?? 0x5865f2)
    .setTitle(String(cfg.title || 'Pick your roles').slice(0, 256))
    .setDescription(description);
}

function buildPanelComponents(guild, cfg) {
  if (cfg.mode === 'buttons') {
    const rows = [];
    for (let i = 0; i < cfg.roles.length; i += 5) {
      const row = new ActionRowBuilder();
      for (const entry of cfg.roles.slice(i, i + 5)) {
        const role = guild.roles.cache.get(entry.roleId);
        const button = new ButtonBuilder()
          .setCustomId(`rrp:btn:${entry.roleId}`)
          .setLabel((role?.name ?? 'Role').slice(0, 80))
          .setStyle(ButtonStyle.Secondary);
        const emoji = readEmoji(entry.emoji);
        if (emoji.component) button.setEmoji(emoji.component);
        row.addComponents(button);
      }
      rows.push(row);
    }
    return rows;
  }

  if (cfg.mode === 'dropdown') {
    const menu = new StringSelectMenuBuilder()
      .setCustomId('rrp:sel')
      .setPlaceholder(cfg.exclusive ? 'Choose your role…' : 'Choose your roles…')
      .setMinValues(0)
      .setMaxValues(cfg.exclusive ? 1 : cfg.roles.length)
      .addOptions(
        cfg.roles.map((entry) => {
          const role = guild.roles.cache.get(entry.roleId);
          const option = { label: (role?.name ?? 'Role').slice(0, 100), value: entry.roleId };
          if (entry.description) option.description = entry.description.slice(0, 100);
          const emoji = readEmoji(entry.emoji);
          if (emoji.component) option.emoji = emoji.component;
          return option;
        })
      );
    return [new ActionRowBuilder().addComponents(menu)];
  }

  return []; // reactions need no components
}

// Posts the panel and saves it. Throws an error with .friendly = true when the person should see the text.
async function publishPanel(guild, channel, cfg, userId) {
  const me = await getMe(guild);
  const perms = channel.permissionsFor(me);
  const needed = [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory];
  if (cfg.mode === 'reactions') needed.push(P.AddReactions);
  const missing = needed.filter((flag) => !perms?.has(flag));
  if (missing.length) {
    throw fail(
      `I'm missing permissions in ${channel}: **${new PermissionsBitField(missing).toArray().join(', ')}**. Fix that and press Publish again.`
    );
  }

  const message = await channel.send({
    embeds: [buildPanelEmbed(guild, cfg)],
    components: buildPanelComponents(guild, cfg),
  });

  savePanel(message.id, {
    channelId: channel.id,
    mode: cfg.mode,
    exclusive: cfg.exclusive,
    title: cfg.title,
    description: cfg.description,
    color: cfg.color,
    roles: cfg.roles.map(({ roleId, emoji, description }) => ({ roleId, emoji, description })),
    createdBy: userId,
    createdAt: Date.now(),
  });

  if (cfg.mode === 'reactions') {
    for (const entry of cfg.roles) {
      try {
        await message.react(entry.emoji);
      } catch {
        deletePanel(message.id);
        await message.delete().catch(() => {});
        throw fail(
          `I couldn't react with ${entry.emoji}. Use an emoji I can see (custom emoji must come from a server I'm in).`
        );
      }
    }
  }
  return message;
}

module.exports = {
  MODES,
  MODE_LABEL,
  MAX_ROLES,
  getPanel,
  savePanel,
  deletePanel,
  listPanels,
  removeRoleFromPanels,
  readEmoji,
  reactionKey,
  getMe,
  roleProblem,
  userRoleProblem,
  grantRole,
  revokeRole,
  toggleRole,
  setSelection,
  buildPanelEmbed,
  buildPanelComponents,
  publishPanel,
};
