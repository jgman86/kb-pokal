// Netlify Serverless Function — Discord Webhook Relay
// Umgebungsvariable: DISCORD_WEBHOOK_URL (Netlify → Environment variables)
//
// Erwartet POST mit JSON body:
//   { event: "draw"|"result"|"elimination"|"winner"|"deadline"|"custom", payload: {...} }

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) return json({ error: "DISCORD_WEBHOOK_URL not configured" }, 500);

  let body;
  try { body = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }

  const { event, payload = {} } = body;
  const embed = buildEmbed(event, payload);
  if (!embed) return json({ error: "unknown event" }, 400);

  try {
    const r = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "Kickbase Pokal", avatar_url: "https://kb-pokal.netlify.app/favicon.ico", embeds: [embed] }),
    });
    if (!r.ok) {
      const txt = await r.text();
      return json({ error: "discord rejected", status: r.status, detail: txt }, 502);
    }
    return json({ ok: true });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
};

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

// ── Helpers
const COLORS = { draw: 0x00e676, result: 0x448aff, elimination: 0xef4444, winner: 0xfbbf24, deadline: 0xff9100, custom: 0x94a3b8 };
const mdLabel = (md) => {
  if (!md) return "";
  const num = String(md).match(/\d+/)?.[0];
  return num ? `Spieltag ${num}` : String(md);
};
const pad = (s, n) => {
  const str = String(s ?? "");
  if (str.length >= n) return str.slice(0, n);
  return str + " ".repeat(n - str.length);
};
const padL = (s, n) => {
  const str = String(s ?? "");
  return str.length >= n ? str.slice(-n) : " ".repeat(n - str.length) + str;
};
const lineOf = (ch, n = 28) => ch.repeat(n);

// ── Bracket-View im Monospace-Codeblock
function renderMatchesBlock(matches) {
  // Breite so wählen, dass der längste Name passt (+ Puffer)
  const maxName = Math.max(8, ...matches.flatMap((m) => [m.p1, m.p2].filter(Boolean).map((n) => n.length)));
  const w = Math.min(18, maxName);
  const lines = [];
  matches.forEach((m, i) => {
    const has = m.s1 != null && m.s2 != null;
    const w1 = m.winner ? m.winner === m.p1 : has && m.s1 > m.s2;
    const w2 = m.winner ? m.winner === m.p2 : has && m.s2 > m.s1;
    const mk1 = w1 ? "✓" : w2 ? "✗" : "·";
    const mk2 = w2 ? "✓" : w1 ? "✗" : "·";
    const s1 = has ? padL(m.s1, 4) : "  -";
    const s2 = has ? padL(m.s2, 4) : "  -";
    lines.push(`${mk1} ${pad(m.p1, w)} ${s1}`);
    lines.push(`${mk2} ${pad(m.p2, w)} ${s2}`);
    if (m.tiebreak) lines.push(`  ⚖️  ${m.tiebreak}`);
    if (i < matches.length - 1) lines.push(lineOf("─", w + 7));
  });
  return "```\n" + lines.join("\n") + "\n```";
}

// Mini-Bracket für Auslosung: zeigt die Paarungen als Baum-Fragmente
function renderDrawBlock(pairings) {
  const maxName = Math.max(8, ...pairings.flatMap((p) => [p.p1, p.p2].map((n) => n.length)));
  const w = Math.min(18, maxName);
  const lines = [];
  pairings.forEach((p, i) => {
    const suffix1 = p.p1Liga ? ` (${p.p1Liga})` : "";
    const suffix2 = p.p2Liga ? ` (${p.p2Liga})` : "";
    lines.push(`  ${pad(p.p1, w)}${suffix1}`);
    lines.push(`        vs.`);
    lines.push(`  ${pad(p.p2, w)}${suffix2}`);
    if (i < pairings.length - 1) lines.push(lineOf("·", 24));
  });
  return "```\n" + lines.join("\n") + "\n```";
}

function buildEmbed(event, p) {
  const color = COLORS[event] ?? COLORS.custom;
  const cup = p.cupName || "Kickbase Pokal";
  const ts = new Date().toISOString();
  const md = mdLabel(p.matchday);
  const appUrl = p.appUrl || "https://kb-pokal.netlify.app";

  if (event === "draw") {
    const pairings = p.pairings || [];
    const byeTxt = p.bye ? `\n🎫 **Freilos:** ${p.bye}` : "";
    const header = `📅 **${md || "Spieltag steht noch aus"}** · ${pairings.length} Duell${pairings.length === 1 ? "" : "e"}${p.remaining != null ? ` · ${p.remaining} Teilnehmer noch dabei` : ""}${byeTxt}`;
    return {
      title: `🎲 Auslosung — ${p.roundName}`,
      url: appUrl,
      description: `${header}\n\n${renderDrawBlock(pairings)}\n🔗 [Live-Turnierbaum öffnen](${appUrl})`,
      color, timestamp: ts,
      footer: { text: cup },
    };
  }

  if (event === "result") {
    const prog = p.progress ? ` · ${p.progress.done}/${p.progress.total} Duelle gespielt` : "";
    const tiebreak = p.tiebreak ? `\n⚖️ _Entschieden durch: ${p.tiebreak}_` : "";
    const ligaP1 = p.p1Liga ? ` _(${p.p1Liga})_` : "";
    const ligaP2 = p.p2Liga ? ` _(${p.p2Liga})_` : "";
    return {
      title: `⚔️ ${p.p1} ${p.s1} : ${p.s2} ${p.p2}`,
      url: appUrl,
      description: `📅 **${p.roundName}${md ? ` · ${md}` : ""}**${prog}\n\n🏆 **Sieger: ${p.winner}**${tiebreak}`,
      color, timestamp: ts,
      fields: [
        { name: p.p1, value: `${p.s1}${ligaP1}`, inline: true },
        { name: "vs.", value: "\u200b", inline: true },
        { name: p.p2, value: `${p.s2}${ligaP2}`, inline: true },
      ],
      footer: { text: cup },
    };
  }

  if (event === "elimination") {
    const eliminated = (p.eliminated || []).map((n) => `• ${n}`).join("\n") || "_niemand_";
    const results = (p.matchResults || []).length > 0 ? renderMatchesBlock(p.matchResults) : "";
    const next = p.nextRoundName
      ? `\n\n🔜 **Nächste Runde:** ${p.nextRoundName}${p.nextMatchday ? ` · Spieltag ${p.nextMatchday}` : ""}`
      : (p.stillInCount === 1 ? "\n\n👑 **Finale entschieden — Sieger steht fest!**" : "");
    const stillIn = p.stillIn && p.stillIn.length > 0 ? `\n\n🟢 **Noch dabei (${p.stillInCount}):** ${p.stillIn.join(", ")}` : "";
    return {
      title: `🪦 ${p.roundName} abgeschlossen`,
      url: appUrl,
      description: `📅 **${md || ""}**\n\n${results}\n\n**Ausgeschieden:**\n${eliminated}${stillIn}${next}`,
      color, timestamp: ts,
      footer: { text: cup },
    };
  }

  if (event === "winner") {
    const ligaSuf = p.winnerLiga ? ` _(${p.winnerLiga})_` : "";
    return {
      title: `👑 POKALSIEGER: ${p.winner}!`,
      url: appUrl,
      description: `🏆 **${p.winner}**${ligaSuf} gewinnt den **${cup}**!\n\n📊 ${p.rounds} Runde${p.rounds === 1 ? "" : "n"}${p.totalPlayers ? ` · ${p.totalPlayers} Teilnehmer` : ""}${md ? ` · Finale an ${md}` : ""}\n\n🔗 [Turnierbaum ansehen](${appUrl})`,
      color, timestamp: ts,
      footer: { text: `${cup} — Saison-Ende` },
    };
  }

  if (event === "deadline") {
    return {
      title: `⏰ Deadline-Erinnerung — ${p.roundName}`,
      url: appUrl,
      description: `📅 **${md || ""}**\n\nPunkte müssen bis **${p.deadline}** eingetragen sein.\n\n**Fehlend:** ${p.missing || "–"}\n\n🔗 [Jetzt eintragen](${appUrl})`,
      color, timestamp: ts,
      footer: { text: cup },
    };
  }

  if (event === "custom") {
    return { title: p.title || "Kickbase Pokal", url: appUrl, description: p.description || "", color, timestamp: ts, footer: { text: cup } };
  }

  return null;
}
