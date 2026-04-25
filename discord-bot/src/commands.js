// Slash-Command Handler.
// Pro Command:
//   - data: Discord-Slash-Command-Definition (für Registry)
//   - autocomplete (optional): Reagiert auf Tipp-Vorschläge
//   - execute: Reagiert auf Command-Ausführung

import { SlashCommandBuilder } from "discord.js";
import * as kb from "./kickbase.js";
import { standingsEmbed, matchdayEmbed, pointsEmbed, lineupEmbed, errorEmbed, helpEmbed } from "./format.js";

// Memo: Member-Listen pro Liga (für Autocomplete)
const memberCache = new Map(); // leagueId → { ts, members }
const MEMBER_TTL = 5 * 60 * 1000; // 5 Min

async function membersOf(leagueId) {
  const cached = memberCache.get(leagueId);
  if (cached && Date.now() - cached.ts < MEMBER_TTL) return cached.members;
  const { members } = await kb.listMembers(leagueId);
  memberCache.set(leagueId, { ts: Date.now(), members });
  return members;
}

// Hilfsfunktion: Liga-Lookup mit Default
function resolveLeague(config, optionValue) {
  if (optionValue) {
    const found = config.leagues.find((l) => l.id === optionValue || l.name.toLowerCase() === optionValue.toLowerCase());
    if (found) return found;
    throw new Error(`Liga "${optionValue}" nicht in config.json gefunden`);
  }
  return config.leagues[0];
}

// ── Command-Builder ────────────────────────────────────────

export function buildCommands(config) {
  const leagueChoices = config.leagues.slice(0, 25).map((l) => ({ name: l.name, value: l.id }));

  return [
    new SlashCommandBuilder()
      .setName("standings")
      .setDescription("Saison-Tabelle einer Liga anzeigen")
      .addStringOption((o) =>
        o.setName("league").setDescription("Liga (Default: erste konfigurierte)").addChoices(...leagueChoices),
      ),
    new SlashCommandBuilder()
      .setName("matchday")
      .setDescription("Punkte eines Spieltags anzeigen")
      .addIntegerOption((o) => o.setName("day").setDescription("Spieltag (Default: aktueller)").setMinValue(1).setMaxValue(34))
      .addStringOption((o) =>
        o.setName("league").setDescription("Liga (Default: erste konfigurierte)").addChoices(...leagueChoices),
      ),
    new SlashCommandBuilder()
      .setName("points")
      .setDescription("Punkte eines Managers anzeigen")
      .addStringOption((o) => o.setName("user").setDescription("Manager-Name (Autocomplete)").setRequired(true).setAutocomplete(true))
      .addStringOption((o) =>
        o.setName("league").setDescription("Liga").addChoices(...leagueChoices),
      ),
    new SlashCommandBuilder()
      .setName("lineup")
      .setDescription("Aufstellung eines Managers an einem Spieltag")
      .addStringOption((o) => o.setName("user").setDescription("Manager-Name (Autocomplete)").setRequired(true).setAutocomplete(true))
      .addIntegerOption((o) => o.setName("day").setDescription("Spieltag (Default: aktueller)").setMinValue(1).setMaxValue(34))
      .addStringOption((o) =>
        o.setName("league").setDescription("Liga").addChoices(...leagueChoices),
      ),
    new SlashCommandBuilder().setName("help").setDescription("Bot-Befehle anzeigen"),
  ].map((c) => c.toJSON());
}

// ── Handler ────────────────────────────────────────────────

export async function handleCommand(interaction, config) {
  const { commandName } = interaction;

  if (commandName === "help") {
    return interaction.reply({ embeds: [helpEmbed()], ephemeral: true });
  }

  await interaction.deferReply();

  try {
    const leagueOpt = interaction.options.getString?.("league");
    const league = resolveLeague(config, leagueOpt);

    if (commandName === "standings") {
      const rows = await kb.getStandings(league.id);
      return interaction.editReply({ embeds: [standingsEmbed(league.name, rows)] });
    }

    if (commandName === "matchday") {
      let day = interaction.options.getInteger("day");
      if (day == null) day = (await kb.getCurrentMatchday()) ?? 1;
      const rows = await kb.getMatchdayPoints(league.id, day);
      return interaction.editReply({ embeds: [matchdayEmbed(league.name, day, rows)] });
    }

    if (commandName === "points") {
      const userIdOrName = interaction.options.getString("user", true);
      const members = await membersOf(league.id);
      const user = members.find((m) => m.id === userIdOrName) || members.find((m) => m.name.toLowerCase() === userIdOrName.toLowerCase());
      if (!user) return interaction.editReply({ embeds: [errorEmbed(`Manager "${userIdOrName}" in ${league.name} nicht gefunden`)] });
      const standings = await kb.getStandings(league.id);
      const inStanding = standings.find((r) => r.id === user.id);
      const day = await kb.getCurrentMatchday();
      let dayPoints = null;
      if (day) {
        const md = await kb.getMatchdayPoints(league.id, day);
        dayPoints = md.find((r) => r.id === user.id)?.points ?? null;
      }
      return interaction.editReply({ embeds: [pointsEmbed(league.name, user, inStanding?.points ?? null, day, dayPoints)] });
    }

    if (commandName === "lineup") {
      const userIdOrName = interaction.options.getString("user", true);
      let day = interaction.options.getInteger("day");
      if (day == null) day = (await kb.getCurrentMatchday()) ?? 1;
      const members = await membersOf(league.id);
      const user = members.find((m) => m.id === userIdOrName) || members.find((m) => m.name.toLowerCase() === userIdOrName.toLowerCase());
      if (!user) return interaction.editReply({ embeds: [errorEmbed(`Manager "${userIdOrName}" in ${league.name} nicht gefunden`)] });
      const { lineup, totalPoints } = await kb.getLineup(league.id, user.id, day);
      return interaction.editReply({ embeds: [lineupEmbed(league.name, user, day, lineup, totalPoints)] });
    }
  } catch (e) {
    console.error(`/${commandName} failed:`, e);
    return interaction.editReply({ embeds: [errorEmbed(e.message || String(e))] }).catch(() => {});
  }
}

// ── Autocomplete ───────────────────────────────────────────

export async function handleAutocomplete(interaction, config) {
  try {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== "user") return interaction.respond([]);
    const leagueOpt = interaction.options.getString("league");
    const league = resolveLeague(config, leagueOpt);
    const members = await membersOf(league.id);
    const q = focused.value.toLowerCase();
    const filtered = members.filter((m) => m.name.toLowerCase().includes(q)).slice(0, 25);
    return interaction.respond(filtered.map((m) => ({ name: m.name, value: m.id })));
  } catch (e) {
    console.warn("Autocomplete error:", e.message);
    return interaction.respond([]).catch(() => {});
  }
}
