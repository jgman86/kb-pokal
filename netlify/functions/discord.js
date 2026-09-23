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
  const maxName = Math.max(8, ...matches.flatMap((m) => [m.p1, m.p2, m.p3].filter(Boolean).map((n) => n.length)));
  const w = Math.min(18, maxName);
  const lines = [];
  matches.forEach((m, i) => {
    const rows = [[m.p1, m.s1], [m.p2, m.s2], ...(m.p3 != null ? [[m.p3, m.s3]] : [])];
    const has = rows.every(([, sc]) => sc != null);
    for (const [name, sc] of rows) {
      const win = m.winner ? m.winner === name : false;
      const mk = win ? "✓" : m.winner ? "✗" : "·";
      lines.push(`${mk} ${pad(name, w)} ${has ? padL(sc, 4) : "  -"}`);
    }
    if (m.tiebreak) lines.push(`  ⚖️  ${m.tiebreak}`);
    if (i < matches.length - 1) lines.push(lineOf("─", w + 7));
  });
  return "```\n" + lines.join("\n") + "\n```";
}

// Liga-Namen zu kompakten Tags kürzen: "Aktives Ligasystem 1. Liga" → L1,
// "4. Liga A" → L4A, "Champions League" → CL. Fallback: Initialen.
function shortLiga(name) {
  if (!name) return "";
  const s = String(name);
  if (/champions/i.test(s)) return "CL";
  const m = s.match(/(\d+)\.?\s*liga\s*([A-Za-z])?/i);
  if (m) return `L${m[1]}${m[2] ? m[2].toUpperCase() : ""}`;
  return s.trim().split(/\s+/).map((w) => w[0]).join("").toUpperCase().slice(0, 3);
}
const ligaTag = (name) => (name ? ` \`${shortLiga(name)}\`` : "");

// Auslosung: eine Markdown-Zeile pro Duell — kein Codeblock, keine
// festen Spaltenbreiten, dadurch keine kaputten Umbrüche auf Mobile.
function renderDrawLines(pairings) {
  return pairings
    .map((p) => p.p3
      ? `🎯 **${p.p1}**${ligaTag(p.p1Liga)}  vs  **${p.p2}**${ligaTag(p.p2Liga)}  vs  **${p.p3}**${ligaTag(p.p3Liga)} — _Dreier-Duell, nur Platz 1 kommt weiter!_`
      : `⚔️ **${p.p1}**${ligaTag(p.p1Liga)}  vs  **${p.p2}**${ligaTag(p.p2Liga)}`)
    .join("\n");
}

function buildEmbed(event, p) {
  const color = COLORS[event] ?? COLORS.custom;
  const cup = p.cupName || "Kickbase Pokal";
  const ts = new Date().toISOString();
  const md = mdLabel(p.matchday);
  const appUrl = p.appUrl || "https://kb-pokal.netlify.app";

  if (event === "draw") {
    const pairings = p.pairings || [];
    const byes = p.byes || (p.bye ? [p.bye] : []);
    const byeTxt = byes.length ? `\n\n🎟️ **Freilos${byes.length === 1 ? "" : `e (${byes.length})`}:** ${byes.join(", ")}` : "";
    const header = `📅 **${md || "Spieltag steht noch aus"}** · ${pairings.length} Duell${pairings.length === 1 ? "" : "e"}${p.remaining != null ? ` · ${p.remaining} noch dabei` : ""}`;
    return {
      title: `🎲 Auslosung — ${p.roundName}`,
      url: appUrl,
      description: `${header}\n\n${renderDrawLines(pairings)}${byeTxt}\n\n🔗 [Live-Turnierbaum öffnen](${appUrl})`,
      color, timestamp: ts,
      footer: { text: cup },
    };
  }

  if (event === "result") {
    const prog = p.progress ? ` · ${p.progress.done}/${p.progress.total} Duelle gespielt` : "";
    const tiebreak = p.tiebreak ? `\n⚖️ _Entschieden durch: ${p.tiebreak}_` : "";
    if (p.p3 != null) {
      // Dreier-Duell: drei Teilnehmer, nur Platz 1 kommt weiter
      const rows = [[p.p1, p.s1, p.p1Liga], [p.p2, p.s2, p.p2Liga], [p.p3, p.s3, p.p3Liga]]
        .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
        .map(([n, sc, lg], i) => `${["🥇", "🥈", "🥉"][i]} **${n}**${ligaTag(lg)} — **${sc}**`);
      return {
        title: `🎯 Dreier-Duell — ${p.roundName}`,
        url: appUrl,
        description: `📅 **${p.roundName}${md ? ` · ${md}` : ""}**${prog}\n\n${rows.join("\n")}\n\n🏆 **Weiter: ${p.winner}**${tiebreak}`,
        color, timestamp: ts,
        footer: { text: cup },
      };
    }
    const ligaP1 = ligaTag(p.p1Liga);
    const ligaP2 = ligaTag(p.p2Liga);
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
    const ligaSuf = ligaTag(p.winnerLiga);
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
