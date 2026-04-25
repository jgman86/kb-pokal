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

// ANSI color codes (funktionieren in Discord-ansi-Code-Blöcken)
const ANSI = {
  reset: "\u001b[0m",
  gold: "\u001b[1;33m",  // Champion
  green: "\u001b[1;32m", // Aufsteiger
  red: "\u001b[1;31m",   // Absteiger
  dim: "\u001b[2;37m",   // Trennlinien
};

const DEFAULT_TOP_N = 3;
const DEFAULT_BOT_N = 3;

const isTitleHolder = (row, titleHolder) =>
  titleHolder && row.name && row.name.toLowerCase() === String(titleHolder).toLowerCase();

// Markiert die ersten topN grün (1. zusätzlich gold + 🏆),
// die letzten botN rot, Trennlinien zwischen Zonen,
// Titelverteidiger (Vorjahressieger) bekommt 👑 (überschreibt 🏆 wenn er aktuell auch führt).
function tableBlock(rows, { topN = DEFAULT_TOP_N, botN = DEFAULT_BOT_N, titleHolder } = {}) {
  if (!rows.length) return "_(keine Daten)_";
  const w = Math.min(22, Math.max(8, ...rows.map((r) => r.name.length)));
  const N = rows.length;
  const hasGap = N > topN + botN;
  const sepLine = ANSI.dim + "─".repeat(w + 14) + ANSI.reset;

  const lines = [];
  rows.forEach((r, i) => {
    let color = "";
    let prefix = "  ";
    const tv = isTitleHolder(r, titleHolder);
    if (i === 0) { color = ANSI.gold; prefix = tv ? "👑" : "🏆"; }
    else if (i < topN) { color = ANSI.green; prefix = tv ? "👑" : "  "; }
    else if (hasGap && i >= N - botN) { color = ANSI.red; prefix = tv ? "👑" : "  "; }
    else if (tv) { prefix = "👑"; }
    const reset = color ? ANSI.reset : "";
    const rank = padL(r.rank, 2);
    const name = pad(r.name, w);
    const pts = padL(r.points, 5);
    lines.push(`${prefix} ${color}${rank}. ${name}  ${pts}${reset}`);

    if (hasGap && i === topN - 1) lines.push(`   ${sepLine}`);
    if (hasGap && i === N - botN - 1) lines.push(`   ${sepLine}`);
  });
  return "```ansi\n" + lines.join("\n") + "\n```";
}

function legendLines(rows, { isMatchday = false, topN = DEFAULT_TOP_N, botN = DEFAULT_BOT_N, titleHolder } = {}) {
  if (!rows.length) return "";
  const N = rows.length;
  const champ = rows[0];
  const top = rows.slice(1, topN).map((r) => r.name).filter(Boolean);
  const bot = N > topN + botN ? rows.slice(N - botN).map((r) => r.name) : [];
  const tvRow = titleHolder ? rows.find((r) => isTitleHolder(r, titleHolder)) : null;
  const lines = [];
  lines.push(`🏆 **${isMatchday ? "Spieltagssieger" : "Pokalsieger"}:** ${champ.name} _(${champ.points} Pkt)_`);
  if (tvRow) lines.push(`👑 **Titelverteidiger:** ${tvRow.name} _(akt. Platz ${tvRow.rank})_`);
  if (top.length) lines.push(`🟢 **${isMatchday ? `Top ${topN}` : "Aufstieg"}:** ${top.join(", ")}`);
  if (bot.length) lines.push(`🔴 **${isMatchday ? `Bottom ${botN}` : "Abstieg"}:** ${bot.join(", ")}`);
  return lines.join("\n");
}

export function standingsEmbed(leagueName, rows, opts = {}) {
  const { relegationCount = DEFAULT_BOT_N, promotionCount = DEFAULT_TOP_N, titleHolder } = opts;
  const top25 = rows.slice(0, 25);
  const tableOpts = { topN: promotionCount, botN: relegationCount, titleHolder };
  return new EmbedBuilder()
    .setTitle(`🏆 Saison-Tabelle — ${leagueName}`)
    .setDescription(`${legendLines(top25, tableOpts)}\n\n${tableBlock(top25, tableOpts)}`)
    .setColor(COLORS.standings)
    .setTimestamp(new Date())
    .setFooter({ text: `${rows.length} Manager` });
}

export function matchdayEmbed(leagueName, day, rows, opts = {}) {
  const { relegationCount = DEFAULT_BOT_N, promotionCount = DEFAULT_TOP_N, titleHolder } = opts;
  const top25 = rows.slice(0, 25);
  const tableOpts = { topN: promotionCount, botN: relegationCount, titleHolder };
  const meta = rows._meta || {};
  const warnLines = [];
  if (meta.total > 0 && meta.nonZero === 0) {
    warnLines.push(`⚠️ Alle Manager 0 Punkte — Spieltag liegt in der Zukunft oder wurde nicht gespielt.`);
  }
  const warnBlock = warnLines.length ? `\n${warnLines.join("\n")}\n` : "";
  return new EmbedBuilder()
    .setTitle(`📅 Spieltag ${day} — ${leagueName}`)
    .setDescription(`${legendLines(top25, { ...tableOpts, isMatchday: true })}${warnBlock}\n\n${tableBlock(top25, tableOpts)}`)
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

export function lineupEmbed(leagueName, user, day, lineup, totalPoints, rawSample) {
  const sorted = [...(lineup || [])].sort((a, b) => (b.points || 0) - (a.points || 0));
  const w = Math.min(18, Math.max(8, ...sorted.map((p) => (p.lastName || "").length)));
  const lines = sorted.map((p) => {
    const name = p.firstName ? `${p.firstName[0]}. ${p.lastName}` : p.lastName;
    const sign = p.points > 0 ? "+" : "";
    return `${pad(name, w)}  ${padL(`${sign}${p.points || 0}`, 5)}`;
  });

  let desc;
  if (sorted.length) {
    desc = `**${user.name}** · Spieltag ${day}\n\`\`\`\n${lines.join("\n")}\n\`\`\``;
  } else if (rawSample) {
    // Debug-Modus: zeige rohes Response-Schema, damit wir die Feldnamen finden
    desc = `**${user.name}** · Spieltag ${day}\n\n_Aufstellung leer — Kickbase-Response-Schema:_\n\`\`\`json\n${rawSample.slice(0, 1500)}\n\`\`\``;
  } else {
    desc = "_Keine Aufstellung verfügbar._";
  }

  const embed = new EmbedBuilder()
    .setTitle(`⚽ Aufstellung — ${user.name}`)
    .setDescription(desc)
    .setColor(COLORS.lineup)
    .setTimestamp(new Date())
    .setFooter({ text: `${leagueName} · Spieltag ${day}` });
  if (sorted.length) embed.addFields({ name: "Gesamtpunkte", value: String(totalPoints || 0), inline: true });
  return embed;
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
        "**/standings** `<league>` — Saison-Tabelle einer Liga",
        "**/matchday** `<league> [day]` — Punkte eines Spieltags (Default: aktueller)",
        "**/points** `<league> <user>` — Saison- + Spieltagspunkte eines Managers",
        "**/lineup** `<league> <user> [day]` — 11er-Aufstellung mit Einzelpunkten",
        "**/run-schedule** `<job>` — _(Admin)_ Geplanten Job sofort ausführen",
        "**/help** — Diese Übersicht",
        "",
        "_Reihenfolge: zuerst Liga wählen, dann User. So weiß das Autocomplete welche Mitglieder es vorschlagen soll._",
        "_Geplante Posts laufen automatisch laut config.json — Cron-basiert._",
      ].join("\n"),
    );
}
