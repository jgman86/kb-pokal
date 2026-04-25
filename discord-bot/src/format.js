// Discord embed builders — wandeln Kickbase-Daten in formatierte EmbedBuilder.

import { EmbedBuilder } from "discord.js";

const COLORS = { standings: 0x00e676, matchday: 0x448aff, points: 0xfbbf24, lineup: 0xab47bc, error: 0xef4444 };

const pad = (s, n) => {
  const str = String(s ?? "");
  return str.length >= n ? str.slice(0, n) : str + " ".repeat(n - str.length);
};
const padL = (s, n) => {
  const str = String(s ?? "");
  return str.length >= n ? str.slice(-n) : " ".repeat(n - str.length) + str;
};

function tableBlock(rows) {
  if (!rows.length) return "_(keine Daten)_";
  const w = Math.min(20, Math.max(8, ...rows.map((r) => r.name.length)));
  const lines = rows.map((r) => `${padL(r.rank, 3)}. ${pad(r.name, w)}  ${padL(r.points, 5)}`);
  return "```\n" + lines.join("\n") + "\n```";
}

export function standingsEmbed(leagueName, rows) {
  return new EmbedBuilder()
    .setTitle(`🏆 Tabelle — ${leagueName}`)
    .setDescription(`**Saisonpunkte**\n${tableBlock(rows.slice(0, 25))}`)
    .setColor(COLORS.standings)
    .setTimestamp(new Date())
    .setFooter({ text: `${rows.length} Manager` });
}

export function matchdayEmbed(leagueName, day, rows) {
  return new EmbedBuilder()
    .setTitle(`📅 Spieltag ${day} — ${leagueName}`)
    .setDescription(`**Punkte am Spieltag**\n${tableBlock(rows.slice(0, 25))}`)
    .setColor(COLORS.matchday)
    .setTimestamp(new Date())
    .setFooter({ text: `${rows.length} Manager` });
}

export function pointsEmbed(leagueName, user, totalPoints, day, dayPoints) {
  const lines = [
    `**${user.name}** in **${leagueName}**`,
    `Saisonpunkte: **${totalPoints ?? "–"}**`,
    day != null && dayPoints != null ? `Spieltag ${day}: **${dayPoints}**` : null,
  ].filter(Boolean);
  return new EmbedBuilder()
    .setTitle(`📊 ${user.name}`)
    .setDescription(lines.join("\n"))
    .setColor(COLORS.points)
    .setTimestamp(new Date())
    .setFooter({ text: leagueName });
}

export function lineupEmbed(leagueName, user, day, lineup, totalPoints) {
  const sorted = [...(lineup || [])].sort((a, b) => (b.points || 0) - (a.points || 0));
  const w = Math.min(18, Math.max(8, ...sorted.map((p) => (p.lastName || "").length)));
  const lines = sorted.map((p) => {
    const name = p.firstName ? `${p.firstName[0]}. ${p.lastName}` : p.lastName;
    const sign = p.points > 0 ? "+" : "";
    return `${pad(name, w)}  ${padL(`${sign}${p.points || 0}`, 5)}`;
  });
  const desc = sorted.length
    ? `**${user.name}** · Spieltag ${day}\n\`\`\`\n${lines.join("\n")}\n\`\`\``
    : "_Keine Aufstellung verfügbar._";
  return new EmbedBuilder()
    .setTitle(`⚽ Aufstellung — ${user.name}`)
    .setDescription(desc)
    .addFields({ name: "Gesamtpunkte", value: String(totalPoints || 0), inline: true })
    .setColor(COLORS.lineup)
    .setTimestamp(new Date())
    .setFooter({ text: `${leagueName} · Spieltag ${day}` });
}

export function errorEmbed(message) {
  return new EmbedBuilder()
    .setTitle("⚠️ Fehler")
    .setDescription("```" + String(message).slice(0, 1900) + "```")
    .setColor(COLORS.error)
    .setTimestamp(new Date());
}

export function helpEmbed() {
  return new EmbedBuilder()
    .setTitle("🤖 Kickbase-Bot — Befehle")
    .setColor(0x94a3b8)
    .setDescription(
      [
        "**/standings** `[league]` — Saison-Tabelle einer Liga (Default: erste konfigurierte Liga)",
        "**/matchday** `[day] [league]` — Punkte eines Spieltags (Default: aktueller Spieltag)",
        "**/points** `<user> [league]` — Punkte eines bestimmten Managers",
        "**/lineup** `<user> [day] [league]` — Aufstellung eines Managers an einem Spieltag",
        "**/help** — Diese Übersicht",
        "",
        "_Geplante Posts laufen automatisch laut config.json — Cron-basiert._",
      ].join("\n"),
    );
}
