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

  // Tag liegt vor Liga-Erstellung — die Liga existierte da noch nicht
  const startMd = meta.leagueStartMatchday || meta.earliestAccessibleDay;
  if (startMd && day < startMd) {
    const reason = meta.leagueStartMatchday
      ? `Diese Liga wurde an **Spieltag ${meta.leagueStartMatchday}** erstellt — frühere Spieltage existieren in dieser Liga nicht.`
      : `Frühester verfügbarer Spieltag in dieser Liga: **${meta.earliestAccessibleDay}**.`;
    return new EmbedBuilder()
      .setTitle(`📅 Spieltag ${day} — ${leagueName}`)
      .setDescription(
        `⚠️ **Keine Daten für Spieltag ${day}**\n\n${reason}\n\n` +
        `_Verfügbarer Bereich: Spieltag ${startMd} bis aktuell._`
      )
      .setColor(0xff9100)
      .setTimestamp(new Date())
      .setFooter({ text: leagueName });
  }

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

// QuickChart.io: Linechart als URL — Discord rendert das als Embed-Bild
function chartUrl(config, w = 700, h = 320) {
  const json = JSON.stringify(config);
  return `https://quickchart.io/chart?bkg=transparent&w=${w}&h=${h}&c=${encodeURIComponent(json)}`;
}

const fmtMoney = (v) => {
  const abs = Math.abs(v);
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)} M€`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(0)} k€`;
  return `${v} €`;
};
const signMoney = (v) => (v >= 0 ? `+${fmtMoney(v)}` : fmtMoney(v));

export function statsEmbed(leagueName, period, stats) {
  if (!stats || stats.n === 0) {
    return new EmbedBuilder()
      .setTitle(`📊 Stats — ${stats?.name || "?"}`)
      .setDescription(`_Keine Datenpunkte im gewählten Zeitraum._`)
      .setColor(0x94a3b8);
  }
  const periodLabel = period ? `Letzte ${period} Spieltage (${stats.days[0]}–${stats.days[stats.days.length - 1]})` : `Alle ${stats.n} Spieltage (${stats.days[0]}–${stats.days[stats.days.length - 1]})`;

  const chart = chartUrl({
    type: "line",
    data: {
      labels: stats.days.map((d) => `ST ${d}`),
      datasets: [{
        label: `${stats.name} — Punkte`,
        data: stats.points,
        borderColor: "rgb(0,230,118)",
        backgroundColor: "rgba(0,230,118,.18)",
        fill: true,
        tension: 0.25,
        pointRadius: 3,
        borderWidth: 2,
      }],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { color: "#94a3b8" }, grid: { color: "rgba(148,163,184,.15)" } },
        x: { ticks: { color: "#94a3b8" }, grid: { color: "rgba(148,163,184,.08)" } },
      },
    },
  });

  return new EmbedBuilder()
    .setTitle(`📊 ${stats.name} — ${leagueName}`)
    .setDescription(`_${periodLabel}_`)
    .addFields(
      { name: "Ø Punkte", value: `**${stats.mean.toFixed(1)}** ± ${stats.sd.toFixed(1)}`, inline: true },
      { name: "Range", value: `${stats.min} – ${stats.max}`, inline: true },
      { name: "Bester Spieltag", value: `ST ${stats.maxDay}: **${stats.max}**`, inline: true },
      { name: "Schlechtester", value: `ST ${stats.minDay}: ${stats.min}`, inline: true },
      { name: "Team-Marktwert", value: fmtMoney(stats.teamValue), inline: true },
      { name: "Saison-Δ", value: signMoney(stats.teamValueGainLoss), inline: true },
    )
    .setImage(chart)
    .setColor(0x00e676)
    .setTimestamp(new Date())
    .setFooter({ text: `${leagueName} · n=${stats.n} · 24h: ${signMoney(stats.teamValueDailyDelta)}` });
}

export function leagueStatsEmbed(leagueName, period, league) {
  if (!league.managers.length) {
    return new EmbedBuilder().setTitle(`📊 Stats — ${leagueName}`).setDescription(`_Keine Daten._`).setColor(0x94a3b8);
  }
  const periodLabel = period ? `Letzte ${period} Spieltage` : `Alle verfügbaren Spieltage`;
  const top5 = [...league.managers].sort((a, b) => b.mean - a.mean).slice(0, 5);
  const colors = ["rgb(0,230,118)", "rgb(255,209,0)", "rgb(68,138,255)", "rgb(255,64,129)", "rgb(255,145,0)"];

  // Multi-Line Chart: alle Top-5 über die Zeit
  const allDays = top5[0]?.days || [];
  const chart = chartUrl({
    type: "line",
    data: {
      labels: allDays.map((d) => `ST ${d}`),
      datasets: top5.map((s, i) => ({
        label: s.name,
        data: s.points,
        borderColor: colors[i],
        backgroundColor: "transparent",
        fill: false,
        tension: 0.25,
        pointRadius: 2,
        borderWidth: 2,
      })),
    },
    options: {
      plugins: { legend: { labels: { color: "#cbd5e1" } } },
      scales: {
        y: { beginAtZero: true, ticks: { color: "#94a3b8" }, grid: { color: "rgba(148,163,184,.15)" } },
        x: { ticks: { color: "#94a3b8" }, grid: { color: "rgba(148,163,184,.08)" } },
      },
    },
  }, 800, 360);

  const lines = [
    `🥇 **Bester (Ø Punkte)**: ${league.bestByMean.name} — ${league.bestByMean.mean.toFixed(1)} ± ${league.bestByMean.sd.toFixed(1)}`,
    `🎯 **Konstantester** (kleinste σ): ${league.mostConsistent.name} — ± ${league.mostConsistent.sd.toFixed(1)}`,
    `💥 **Höchster Einzel-Spieltag**: ${league.biggestMatchday.name} — ${league.biggestMatchday.max} Pkt (ST ${league.biggestMatchday.maxDay})`,
    `💰 **Größter Team-Marktwert**: ${league.biggestTeam.name} — ${fmtMoney(league.biggestTeam.teamValue)}`,
    `📈 **Liga-Durchschnitt**: ${league.leagueMean.toFixed(1)} Pkt`,
  ];

  return new EmbedBuilder()
    .setTitle(`📊 Liga-Stats — ${leagueName}`)
    .setDescription(`_${periodLabel}_\n\n${lines.join("\n")}`)
    .setImage(chart)
    .setColor(0x00e676)
    .setTimestamp(new Date())
    .setFooter({ text: `${league.managers.length} Manager · Top 5 im Chart` });
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
        "**/stats** `<league> [user] [last]` — Stats über Zeitraum mit Linechart (ohne user → Liga-Übersicht)",
        "**/run-schedule** `<job>` — _(Admin)_ Geplanten Job sofort ausführen",
        "**/help** — Diese Übersicht",
        "",
        "_Reihenfolge: zuerst Liga wählen, dann User. So weiß das Autocomplete welche Mitglieder es vorschlagen soll._",
        "_Geplante Posts laufen automatisch laut config.json — Cron-basiert._",
      ].join("\n"),
    );
}
