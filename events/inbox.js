const { ActionRowBuilder, EmbedBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { KINDS } = require('../lib/inbox');
const { logging } = require('../lib/logging');

const isOwner = (interaction) => Boolean(process.env.OWNER_ID) && interaction.user.id === process.env.OWNER_ID;

module.exports = (client) => {
  client.on('interactionCreate', async (interaction) => {
    try {
      // The Reply button opens a form
      if (interaction.isButton() && interaction.customId.startsWith('inbox:reply:')) {
        if (!isOwner(interaction)) {
          return interaction.reply({ content: 'Only the bot owner can reply to these.', flags: MessageFlags.Ephemeral });
        }
        // Button IDs look like inbox:reply:<sender id>:<reference id>
        const [, , userId, refId] = interaction.customId.split(':');
        const modal = new ModalBuilder()
          .setCustomId(`inbox:send:${userId}:${refId}`)
          .setTitle(`Reply to ${refId}`)
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('text')
                .setLabel('Your reply (sent to them by DM)')
                .setStyle(TextInputStyle.Paragraph)
                .setMinLength(2)
                .setMaxLength(1500)
                .setRequired(true)
            )
          );
        return interaction.showModal(modal);
      }

      // Submitting the form sends the DM
      if (interaction.isModalSubmit() && interaction.customId.startsWith('inbox:send:')) {
        if (!isOwner(interaction)) {
          return interaction.reply({ content: 'Only the bot owner can reply to these.', flags: MessageFlags.Ephemeral });
        }
        const [, , userId, refId] = interaction.customId.split(':');
        const reply = interaction.fields.getTextInputValue('text').trim();
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const kind = refId.startsWith('F') ? 'feedback' : 'report';
        const original = interaction.message?.embeds?.[0];
        const quote = (original?.description ?? '')
          .slice(0, 500)
          .split('\n')
          .map((line) => `> ${line}`)
          .join('\n');

        const dm = new EmbedBuilder()
          .setColor(KINDS[kind].color)
          .setTitle(`📬 A reply to your ${kind} (${refId})`)
          .setDescription(reply)
          .setFooter({ text: "This is from the bot owner. You can't reply here, but you can send another !!report or !!feedback any time." });
        if (quote.trim() !== '>') dm.addFields({ name: 'In response to your message', value: quote.slice(0, 1000) });

        try {
          const user = await client.users.fetch(userId);
          await user.send({ embeds: [dm] });
        } catch {
          return interaction.editReply("❌ I couldn't DM them (their DMs are probably closed, or they no longer share a server with me). Your reply wasn't sent.");
        }

        // Mark the card in your inbox channel as answered
        if (interaction.message && original) {
          const card = EmbedBuilder.from(original);
          const fields = (card.data.fields ?? []).filter((f) => f.name !== '✅ Last reply');
          fields.push({ name: '✅ Last reply', value: `<t:${Math.floor(Date.now() / 1000)}:f>\n${reply}`.slice(0, 1024) });
          card.setFields(fields);
          await interaction.message.edit({ embeds: [card] }).catch(() => {});
        }

        logging('info', 'Replied to an inbox message', `${refId} → ${userId}`);
        return interaction.editReply(`✅ Sent your reply to <@${userId}>.`);
      }
    } catch (err) {
      logging('error', 'Inbox reply failed', err);
    }
  });
};
