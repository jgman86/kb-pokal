// Tippspiel — Community-Voting auf die Pokal-Duelle mit Live-"Community-Quote".
//
// Vollautomatischer Zyklus über startTippWatcher (5-Min-Takt):
//   1. Neue Auslosung in der Pokal-App → Tipp-Duelle werden automatisch in
//      den konfigurierten Channel gepostet (config.tippspiel.channelId)
//   2. Auto-Lock zum ersten Anstoß des Spieltags (Kickoff aus der Kickbase-
//      Competition-API; Fallback: Freitag ab 15:00 Berlin, wenn der Spieltag
//      laut Kickbase der aktuelle ist)
//   3. Ergebnisse in der App eingetragen → Auto-Resolve + Tipp-Tabelle wird
//      gepostet. Danach beginnt der Zyklus mit der nächsten Auslosung erneut.
// /tipp start|lock|resolve bleiben als manuelle Admin-Fallbacks erhalten,
// /tipp tabelle zeigt die (unveränderte) Rangliste.
//
// Punkte: richtige Tipper bekommen die Community-Quote (Gesamt/Stimmen) ihres
// Duells. Persistenz: tippspiel.json neben der config.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } from "discord.js";
import { shortLiga, errorEmbed } from "./format.js";
import * as kb from "./kickbase.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_PATH = process.env.TIPP_STORE || path.join(__dirname, "..", "tippspiel.json");

const COLOR_OPEN = 0x00b0ff;
const COLOR_LOCKED = 0x94a3b8;
const COLOR_DONE = 0x00e676;
const WATCH_INTERVAL = 5 * 60 * 1000;

// ── Storage ─────────────────────────────────────────────
function loadStore() {
  try { return JSON.parse(fs.readFileSync(STORE_PATH, "utf-8")); }
  catch { return { open: {}, scores: {}, resolvedIds: [] }; }
}
function saveStore(s) { fs.writeFileSync(STORE_PATH, JSON.stringify(s, null, 2)); }

// ── Supabase (read-only, Anon-Key) ──────────────────────
async function fetchTournament() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_ANON_KEY fehlen in der .env — für das Tippspiel nötig.");
  const tid = process.env.TOURNAMENT_ID || "default";
  const r = await fetch(`${url}/rest/v1/tournaments?id=eq.${encodeURIComponent(tid)}&select=data`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const rows = await r.json();
  if (!rows.length) throw new Error(`Turnier "${tid}" nicht in Supabase gefunden.`);
  return rows[0].data || {};
}

// ── Rendering ───────────────────────────────────────────
const counts = (t) => {
  const vals = Object.values(t.votes || {});
  const n1 = vals.filter((v) => v === "p1").length;
  const n2 = vals.filter((v) => v === "p2").length;
  return { n1, n2, total: n1 + n2 };
};
const quote = (total, n) => (n > 0 ? Math.round((total / n) * 100) / 100 : null);
const fmtQ = (q) => (q == null ? "–" : q.toFixed(2).replace(".", ","));

function tipEmbed(t, { result = null } = {}) {
  const { n1, n2, total } = counts(t);
  const pct1 = total ? Math.round((n1 / total) * 100) : 0;
  const pct2 = total ? 100 - pct1 : 0;
  const filled = total ? Math.round((n1 / total) * 10) : 5;
  const bar = "▰".repeat(filled) + "▱".repeat(10 - filled);
  const q1 = quote(total, n1), q2 = quote(total, n2);

  const lines = [
    `📅 **${t.roundName}**${t.matchday ? ` · Spieltag ${t.matchday}` : ""}`,
    "",
    `⚔️ **${t.p1.name}** \`${t.p1.liga}\`  vs  **${t.p2.name}** \`${t.p2.liga}\``,
    "",
    `📊 **${n1} : ${n2}**${total ? ` (${pct1}% / ${pct2}%)` : " — noch keine Tipps"}`,
    `💰 Community-Quote: **${fmtQ(q1)}** / **${fmtQ(q2)}**`,
    `${t.p1.name} ${bar} ${t.p2.name}`,
  ];
  let color = COLOR_OPEN, footer = "🟢 Tippen offen — Stimme jederzeit änderbar";
  if (result) {
    const winName = result.side === "p1" ? t.p1.name : t.p2.name;
    const wq = result.side === "p1" ? q1 : q2;
    lines.push("", `🏁 **Sieger: ${winName}** (${result.score1}:${result.score2})`,
      result.winners > 0
        ? `✓ ${result.winners} richtige${result.winners === 1 ? "r" : ""} Tipp${result.winners === 1 ? "" : "s"} — je **+${fmtQ(wq)} Punkte**`
        : "_Niemand hat richtig getippt._");
    color = COLOR_DONE; footer = "Aufgelöst";
  } else if (t.locked) {
    color = COLOR_LOCKED; footer = "🔒 Tipps gesperrt";
  }
  return new EmbedBuilder()
    .setTitle(`🎯 Tippspiel — ${t.p1.name} vs ${t.p2.name}`)
    .setDescription(lines.join("\n"))
    .setColor(color)
    .setFooter({ text: footer })
    .setTimestamp(new Date());
}

function tipButtons(t, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`tipp|${t.pairingId}|p1`).setLabel(`${t.p1.name} tippen`).setStyle(ButtonStyle.Primary).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`tipp|${t.pairingId}|p2`).setLabel(`${t.p2.name} tippen`).setStyle(ButtonStyle.Success).setDisabled(disabled),
  );
}

function tableEmbed(store) {
  const rows = Object.values(store.scores).sort((a, b) => b.points - a.points || b.correct - a.correct);
  if (!rows.length) {
    return new EmbedBuilder().setTitle("🎯 Tippspiel-Tabelle").setDescription("_Noch keine aufgelösten Tipps._").setColor(COLOR_LOCKED);
  }
  const medals = ["🥇", "🥈", "🥉"];
  const lines = rows.slice(0, 25).map((r, i) =>
    `${medals[i] || "▫️"} **${i + 1}.** ${r.name} — **${r.points.toFixed(1).replace(".", ",")} Pkt** _(${r.correct}/${r.total} richtig)_`);
  return new EmbedBuilder()
    .setTitle("🎯 Tippspiel-Tabelle")
    .setDescription(lines.join("\n"))
    .setColor(COLOR_DONE)
    .setFooter({ text: "Punkte = Community-Quote des richtigen Tipps · Außenseiter lohnen sich" })
    .setTimestamp(new Date());
}

async function editTipMessage(client, t, payload) {
  const ch = await client.channels.fetch(t.channelId);
  const msg = await ch.messages.fetch(t.messageId);
  await msg.edit(payload);
}

const isAdmin = (interaction) => interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);

// ── Kern-Logik (von Commands UND Watcher genutzt) ───────
async function postRoundPairings(channel, data, store) {
  const round = (data.rounds || []).find((r) => r.roundNumber === data.currentRound) || (data.rounds || [])[(data.rounds || []).length - 1];
  if (!round) return { posted: 0, skipped: 0 };
  const player = (id) => (data.players || []).find((p) => p.id === id);
  let posted = 0, skipped = 0;
  for (const pairing of round.pairings || []) {
    if (store.open[pairing.id] || store.resolvedIds.includes(pairing.id)) { skipped++; continue; }
    if (pairing.score1 != null && pairing.score2 != null) { skipped++; continue; } // schon gespielt
    const p1 = player(pairing.player1Id), p2 = player(pairing.player2Id);
    if (!p1 || !p2) { skipped++; continue; }
    const t = {
      pairingId: pairing.id,
      roundName: round.name,
      matchday: (round.matchday || "").match(/\d+/)?.[0] || null,
      p1: { id: p1.id, name: p1.name, liga: shortLiga(p1.league) || p1.league || "?" },
      p2: { id: p2.id, name: p2.name, liga: shortLiga(p2.league) || p2.league || "?" },
      votes: {}, voterNames: {}, locked: false,
      channelId: channel.id, messageId: null,
    };
    const msg = await channel.send({ embeds: [tipEmbed(t)], components: [tipButtons(t)] });
    t.messageId = msg.id;
    store.open[pairing.id] = t;
    posted++;
  }
  return { posted, skipped };
}

async function lockOne(client, t) {
  t.locked = true;
  await editTipMessage(client, t, { embeds: [tipEmbed(t)], components: [tipButtons(t, true)] }).catch((e) => console.warn("[Tipp] lock edit failed:", e.message));
}

async function resolveAll(client, data, store) {
  const allPairings = new Map();
  for (const r of data.rounds || []) for (const p of r.pairings || []) allPairings.set(p.id, p);
  const results = [];
  for (const t of Object.values(store.open)) {
    const pairing = allPairings.get(t.pairingId);
    if (!pairing) continue;
    const done = pairing.score1 != null && pairing.score2 != null;
    const winnerId = pairing.winner || (done && pairing.score1 !== pairing.score2 ? (pairing.score1 > pairing.score2 ? pairing.player1Id : pairing.player2Id) : null);
    if (!winnerId) continue; // noch nicht entschieden
    const side = winnerId === t.p1.id ? "p1" : "p2";
    const { n1, n2, total } = counts(t);
    const wq = quote(total, side === "p1" ? n1 : n2);
    let winners = 0;
    for (const [uid, vote] of Object.entries(t.votes)) {
      const sc = store.scores[uid] || { name: t.voterNames[uid] || "?", points: 0, correct: 0, total: 0 };
      sc.name = t.voterNames[uid] || sc.name;
      sc.total++;
      if (vote === side) { sc.points += wq || 0; sc.correct++; winners++; }
      store.scores[uid] = sc;
    }
    const result = { side, score1: pairing.score1, score2: pairing.score2, winners };
    await editTipMessage(client, t, { embeds: [tipEmbed({ ...t, locked: true }, { result })], components: [] }).catch((e) => console.warn("[Tipp] resolve edit failed:", e.message));
    store.resolvedIds.push(t.pairingId);
    delete store.open[t.pairingId];
    results.push({ t, side, winners });
  }
  return results;
}

// Lock-Zeitpunkt: erster Anstoß des Spieltags. Fallback ohne Kickoff-Daten:
// Freitag ab 15:00 (Europe/Berlin), sofern der Spieltag laut Kickbase dran ist.
async function shouldLockNow(matchday) {
  if (!matchday) return false;
  const kickoff = await kb.getMatchdayKickoff(Number(matchday));
  if (kickoff) return Date.now() >= kickoff.getTime();
  const parts = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", weekday: "short", hour: "numeric", hour12: false }).formatToParts(new Date());
  const wd = parts.find((p) => p.type === "weekday")?.value || "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value || 0);
  const fridayAfternoon = wd.startsWith("Fr") && hour >= 15;
  if (!fridayAfternoon) return false;
  const cur = await kb.getCurrentMatchday();
  return cur != null && Number(cur) >= Number(matchday);
}

// ── Auto-Watcher ────────────────────────────────────────
export function startTippWatcher(client, config) {
  const channelId = config.tippspiel?.channelId;
  if (!channelId) { console.warn("[Tipp] config.tippspiel.channelId fehlt — Automatik aus, /tipp start etc. weiter manuell nutzbar."); return; }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) { console.warn("[Tipp] SUPABASE_URL/ANON_KEY fehlen — Tippspiel-Automatik aus."); return; }
  const tick = () => watcherTick(client, channelId).catch((e) => console.error("[Tipp] Watcher:", e.message));
  setInterval(tick, WATCH_INTERVAL);
  setTimeout(tick, 15 * 1000); // erster Lauf kurz nach dem Start
  console.log(`[Tipp] ✓ Automatik aktiv (${WATCH_INTERVAL / 60000}-Min-Takt) → Channel ${channelId}`);
}

async function watcherTick(client, channelId) {
  const data = await fetchTournament();
  const store = loadStore();
  let dirty = false;

  // 1. Neue Auslosung → Duelle posten
  const channel = await client.channels.fetch(channelId);
  const { posted } = await postRoundPairings(channel, data, store);
  if (posted) { dirty = true; console.log(`[Tipp] ${posted} neue Tipp-Duelle gepostet.`); }

  // 2. Auto-Lock zum Spieltagsstart
  const openUnlocked = Object.values(store.open).filter((t) => !t.locked);
  for (const t of openUnlocked) {
    if (await shouldLockNow(t.matchday)) {
      await lockOne(client, t);
      dirty = true;
      console.log(`[Tipp] 🔒 Auto-Lock: ${t.p1.name} vs ${t.p2.name} (Spieltag ${t.matchday})`);
    }
  }

  // 3. Ergebnisse da → Auto-Resolve + Tabelle posten
  const results = await resolveAll(client, data, store);
  if (results.length) {
    dirty = true;
    console.log(`[Tipp] 🏁 ${results.length} Duell(e) automatisch aufgelöst.`);
    await channel.send({ embeds: [tableEmbed(store)] }).catch(() => {});
  }

  if (dirty) saveStore(store);
}

// ── Commands (manuelle Fallbacks + Tabelle) ─────────────
export async function startTipps(interaction) {
  if (!isAdmin(interaction)) return interaction.reply({ content: "Nur Admins können das Tippspiel starten.", ephemeral: true });
  await interaction.deferReply({ ephemeral: true });
  const data = await fetchTournament();
  const store = loadStore();
  const { posted, skipped } = await postRoundPairings(interaction.channel, data, store);
  saveStore(store);
  if (!posted && !skipped) return interaction.editReply("Keine Runde gefunden — erst in der Pokal-App auslosen.");
  return interaction.editReply(`🎯 ${posted} Tipp-Duell${posted === 1 ? "" : "e"} gepostet${skipped ? ` · ${skipped} übersprungen (schon offen/gespielt)` : ""}.`);
}

export async function handleTippButton(interaction) {
  const [, pairingId, side] = interaction.customId.split("|");
  const store = loadStore();
  const t = store.open[pairingId];
  if (!t) return interaction.reply({ content: "Dieses Tipp-Duell ist nicht mehr aktiv.", ephemeral: true });
  if (t.locked) return interaction.reply({ content: "🔒 Tipps für dieses Duell sind gesperrt.", ephemeral: true });
  const uid = interaction.user.id;
  const prev = t.votes[uid];
  t.votes[uid] = side;
  t.voterNames[uid] = interaction.member?.displayName || interaction.user.username;
  saveStore(store);
  const name = side === "p1" ? t.p1.name : t.p2.name;
  await interaction.update({ embeds: [tipEmbed(t)], components: [tipButtons(t)] });
  if (prev !== side) {
    await interaction.followUp({ content: `✓ Dein Tipp: **${name}**${prev ? " (geändert)" : ""}`, ephemeral: true }).catch(() => {});
  }
}

export async function lockTipps(interaction) {
  if (!isAdmin(interaction)) return interaction.reply({ content: "Nur Admins können Tipps sperren.", ephemeral: true });
  await interaction.deferReply({ ephemeral: true });
  const store = loadStore();
  let locked = 0;
  for (const t of Object.values(store.open)) {
    if (t.locked) continue;
    await lockOne(interaction.client, t);
    locked++;
  }
  saveStore(store);
  return interaction.editReply(`🔒 ${locked} Duell${locked === 1 ? "" : "e"} gesperrt.`);
}

export async function resolveTipps(interaction) {
  if (!isAdmin(interaction)) return interaction.reply({ content: "Nur Admins können auflösen.", ephemeral: true });
  await interaction.deferReply({ ephemeral: true });
  const data = await fetchTournament();
  const store = loadStore();
  const results = await resolveAll(interaction.client, data, store);
  saveStore(store);
  if (!results.length) return interaction.editReply("Keine auflösbaren Duelle — Ergebnisse fehlen noch in der Pokal-App.");
  const lines = results.map(({ t, side, winners }) => `✓ ${t.p1.name} vs ${t.p2.name} → ${side === "p1" ? t.p1.name : t.p2.name} (${winners} richtig)`);
  return interaction.editReply(`🏁 Aufgelöst:\n${lines.join("\n")}`);
}

export async function tippTable(interaction) {
  await interaction.deferReply();
  return interaction.editReply({ embeds: [tableEmbed(loadStore())] });
}

export async function handleTippCommand(interaction) {
  const sub = interaction.options.getSubcommand();
  try {
    if (sub === "start") return await startTipps(interaction);
    if (sub === "lock") return await lockTipps(interaction);
    if (sub === "resolve") return await resolveTipps(interaction);
    if (sub === "tabelle") return await tippTable(interaction);
  } catch (e) {
    console.error("[Tipp] error:", e);
    const payload = { embeds: [errorEmbed(e.message)] };
    return (interaction.deferred || interaction.replied) ? interaction.editReply(payload) : interaction.reply({ ...payload, ephemeral: true });
  }
}
