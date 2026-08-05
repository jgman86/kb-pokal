// Slash-Command Handler.
// Pro Command:
//   - data: Discord-Slash-Command-Definition (für Registry)
//   - autocomplete (optional): Reagiert auf Tipp-Vorschläge
//   - execute: Reagiert auf Command-Ausführung

import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import * as kb from "./kickbase.js";
import { standingsEmbed, matchdayEmbed, pointsEmbed, lineupEmbed, statsEmbed, leagueStatsEmbed, errorEmbed, helpEmbed } from "./format.js";
import { runJob } from "./scheduler.js";

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

  // Konvention: league immer als erster Parameter und required, dann user/day.
  // So weiß das Autocomplete für `user` sofort welche Liga gemeint ist und
  // die Reihenfolge im Discord-UI ist konsistent.
  return [
    new SlashCommandBuilder()
      .setName("standings")
      .setDescription("Saison-Tabelle einer Liga anzeigen")
      .addStringOption((o) =>
        o.setName("league").setDescription("Liga auswählen").setRequired(true).addChoices(...leagueChoices),
      ),
    new SlashCommandBuilder()
      .setName("matchday")
      .setDescription("Punkte eines Spieltags anzeigen")
      .addStringOption((o) =>
        o.setName("league").setDescription("Liga auswählen").setRequired(true).addChoices(...leagueChoices),
      )
      .addIntegerOption((o) => o.setName("day").setDescription("Spieltag (Default: aktueller)").setMinValue(1).setMaxValue(34)),
    new SlashCommandBuilder()
      .setName("points")
      .setDescription("Punkte eines Managers anzeigen")
      .addStringOption((o) =>
        o.setName("league").setDescription("Liga auswählen").setRequired(true).addChoices(...leagueChoices),
      )
      .addStringOption((o) => o.setName("user").setDescription("Manager (Autocomplete nach Liga-Wahl)").setRequired(true).setAutocomplete(true)),
    new SlashCommandBuilder()
      .setName("lineup")
      .setDescription("Aufstellung eines Managers an einem Spieltag")
      .addStringOption((o) =>
        o.setName("league").setDescription("Liga auswählen").setRequired(true).addChoices(...leagueChoices),
      )
      .addStringOption((o) => o.setName("user").setDescription("Manager (Autocomplete nach Liga-Wahl)").setRequired(true).setAutocomplete(true))
      .addIntegerOption((o) => o.setName("day").setDescription("Spieltag (Default: aktueller)").setMinValue(1).setMaxValue(34)),
    new SlashCommandBuilder()
      .setName("stats")
      .setDescription("Stats-Übersicht (Ø Punkte, σ, Marktwert, Linechart)")
      .addStringOption((o) =>
        o.setName("league").setDescription("Liga auswählen").setRequired(true).addChoices(...leagueChoices),
      )
      .addStringOption((o) => o.setName("user").setDescription("Manager (optional, sonst Liga-Übersicht)").setAutocomplete(true))
      .addIntegerOption((o) => o.setName("last").setDescription("Letzte N Spieltage (Default: alle)").setMinValue(1).setMaxValue(34)),
    new SlashCommandBuilder()
      .setName("run-schedule")
      .setDescription("Einen geplanten Job sofort ausführen (Admin)")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption((o) => o.setName("job").setDescription("Schedule-Name aus config.json").setRequired(true).setAutocomplete(true)),
    new SlashCommandBuilder().setName("help").setDescription("Bot-Befehle anzeigen"),
  ].map((c) => c.toJSON());
}

// ── Handler ────────────────────────────────────────────────

export async function handleCommand(interaction, config) {
  const { commandName } = interaction;

  if (commandName === "help") {
    return interaction.reply({ embeds: [helpEmbed()], ephemeral: true });
  }

  if (commandName === "run-schedule") {
    await interaction.deferReply({ ephemeral: true });
    const name = interaction.options.getString("job", true);

    // Sonderformen: __all_standings / __all_matchday → für alle konfigurierten Ligen
    if (name === "__all_standings" || name === "__all_matchday") {
      const task = name === "__all_standings" ? "standings" : "matchday";
      const results = [];
      for (const league of config.leagues) {
        const virtualSched = task === "standings"
          ? { name: `${league.name} — Saison-Tabelle (manuell)`, leagueId: league.id, task: "standings" }
          : { name: `${league.name} — Spieltag-Recap (manuell)`, leagueId: league.id, task: "matchday", matchdayOffset: -1 };
        try {
          await runJob(interaction.client, virtualSched, league);
          results.push(`✓ ${league.name} → <#${league.channelId}>`);
        } catch (e) {
          results.push(`✗ ${league.name}: ${e.message}`);
        }
      }
      return interaction.editReply(`**Manueller Run für alle Ligen (${task}):**\n${results.join("\n")}`);
    }

    const sched = (config.schedules || []).find((s) => s.name === name);
    if (!sched) return interaction.editReply({ embeds: [errorEmbed(`Schedule "${name}" nicht gefunden.`)] });
    const league = config.leagues.find((l) => l.id === sched.leagueId);
    if (!league) return interaction.editReply({ embeds: [errorEmbed(`Liga ${sched.leagueId} aus Schedule "${name}" nicht in config.`)] });
    try {
      await runJob(interaction.client, sched, league);
      return interaction.editReply(`✓ Job "${name}" ausgeführt — Embed liegt in <#${league.channelId}>.`);
    } catch (e) {
      return interaction.editReply({ embeds: [errorEmbed(`Job "${name}" failed: ${e.message}`)] });
    }
  }

  await interaction.deferReply();

  try {
    const leagueOpt = interaction.options.getString?.("league");
    const league = resolveLeague(config, leagueOpt);

    const tableOpts = { relegationCount: league.relegationCount, promotionCount: league.promotionCount, titleHolder: league.titleHolder };

    if (commandName === "standings") {
      const rows = await kb.getStandings(league.id);
      return interaction.editReply({ embeds: [standingsEmbed(league.name, rows, tableOpts)] });
    }

    if (commandName === "matchday") {
      let day = interaction.options.getInteger("day");
      if (day == null) day = (await kb.getCurrentMatchday()) ?? 1;
      const rows = await kb.getMatchdayPoints(league.id, day);
      return interaction.editReply({ embeds: [matchdayEmbed(league.name, day, rows, tableOpts)] });
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

    if (commandName === "stats") {
      const last = interaction.options.getInteger("last") || null;
      const userIdOrName = interaction.options.getString("user");
      if (!userIdOrName) {
        const league_stats = await kb.getLeagueStats(league.id, last);
        const embed = await leagueStatsEmbed(league.name, last, league_stats);
        return interaction.editReply({ embeds: [embed] });
      }
      const members = await membersOf(league.id);
      const user = members.find((m) => m.id === userIdOrName) || members.find((m) => m.name.toLowerCase() === userIdOrName.toLowerCase());
      if (!user) return interaction.editReply({ embeds: [errorEmbed(`Manager "${userIdOrName}" in ${league.name} nicht gefunden`)] });

      const stats = await kb.getManagerStats(league.id, user.id, last);
      const [mvHistory, leagueStats] = await Promise.all([
        kb.getTeamMarketValueHistory(league.id, stats.squadPlayerIds, 92).catch(() => null),
        kb.getLeagueStats(league.id, last).catch(() => null),
      ]);
      const compareTo = leagueStats?.bestByMean || null;
      const embeds = await statsEmbed(league.name, last, stats, mvHistory, compareTo);
      return interaction.editReply({ embeds });
    }

    if (commandName === "lineup") {
      const userIdOrName = interaction.options.getString("user", true);
      let day = interaction.options.getInteger("day");
      if (day == null) day = (await kb.getCurrentMatchday()) ?? 1;
      const members = await membersOf(league.id);
      const user = members.find((m) => m.id === userIdOrName) || members.find((m) => m.name.toLowerCase() === userIdOrName.toLowerCase());
      if (!user) return interaction.editReply({ embeds: [errorEmbed(`Manager "${userIdOrName}" in ${league.name} nicht gefunden`)] });
      const { lineup, totalPoints, _rawSample } = await kb.getLineup(league.id, user.id, day);
      return interaction.editReply({ embeds: [lineupEmbed(league.name, user, day, lineup, totalPoints, _rawSample)] });
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

    if (focused.name === "job") {
      const q = focused.value.toLowerCase();
      // Virtuelle "Alle Ligen"-Einträge oben anpinnen
      const virtual = [
        { name: "🌐 Alle Ligen — Saison-Tabelle", value: "__all_standings" },
        { name: "🌐 Alle Ligen — Spieltag-Recap", value: "__all_matchday" },
      ].filter((v) => !q || v.name.toLowerCase().includes(q));
      const real = (config.schedules || [])
        .filter((s) => s.name.toLowerCase().includes(q))
        .slice(0, 25 - virtual.length)
        .map((s) => ({ name: s.name, value: s.name }));
      return interaction.respond([...virtual, ...real]);
    }

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
