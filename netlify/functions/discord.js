// Netlify Serverless Function — Discord Webhook Relay
// Umgebungsvariable: DISCORD_WEBHOOK_URL (in Netlify Site Settings → Environment variables)
//
// Erwartet POST mit JSON body:
//   { event: "draw"|"result"|"elimination"|"winner"|"custom", payload: {...} }
//
// Baut je nach Event ein Discord-Embed und POST-et es an den Webhook.

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) return new Response(JSON.stringify({ error: "DISCORD_WEBHOOK_URL not configured" }), { status: 500, headers: { "content-type": "application/json" } });

  let body;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: "invalid JSON" }), { status: 400, headers: { "content-type": "application/json" } }); }

  const { event, payload = {} } = body;
  const embed = buildEmbed(event, payload);
  if (!embed) return new Response(JSON.stringify({ error: "unknown event" }), { status: 400, headers: { "content-type": "application/json" } });

  try {
    const r = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "Kickbase Pokal", embeds: [embed] }),
    });
    if (!r.ok) {
      const txt = await r.text();
      return new Response(JSON.stringify({ error: "discord rejected", status: r.status, detail: txt }), { status: 502, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { "content-type": "application/json" } });
  }
};

function buildEmbed(event, p) {
  const colors = { draw: 0x00e676, result: 0x448aff, elimination: 0xef4444, winner: 0xfbbf24, deadline: 0xff9100, custom: 0x94a3b8 };
  const color = colors[event] ?? colors.custom;
  const cup = p.cupName || "Kickbase Pokal";

  if (event === "draw") {
    const pairings = (p.pairings || []).map((m, i) => `**Duell ${i + 1}:** ${m.p1} 🆚 ${m.p2}`).join("\n") || "_keine Duelle_";
    const bye = p.bye ? `\n🎫 Freilos: **${p.bye}**` : "";
    return { title: `🎲 Auslosung — ${p.roundName}`, description: `${cup}\n\n${pairings}${bye}`, color, timestamp: new Date().toISOString() };
  }
  if (event === "result") {
    return { title: `⚔️ Ergebnis — ${p.roundName}`, description: `${cup}\n\n**${p.p1}** ${p.s1} : ${p.s2} **${p.p2}**\nSieger: **${p.winner}**${p.tiebreak ? `\n_(Entschieden durch: ${p.tiebreak})_` : ""}`, color, timestamp: new Date().toISOString() };
  }
  if (event === "elimination") {
    const names = (p.eliminated || []).map((n) => `• ${n}`).join("\n");
    return { title: `🪦 Ausgeschieden — ${p.roundName}`, description: `${cup}\n\n${names}`, color, timestamp: new Date().toISOString() };
  }
  if (event === "winner") {
    return { title: "👑 POKALSIEGER!", description: `**${p.winner}** gewinnt den **${cup}** nach ${p.rounds} Runden!`, color, timestamp: new Date().toISOString() };
  }
  if (event === "deadline") {
    return { title: `⏰ Deadline-Erinnerung — ${p.roundName}`, description: `${cup}\n\nPunkte müssen bis **${p.deadline}** eingetragen sein.\nFehlend: ${p.missing || "–"}`, color, timestamp: new Date().toISOString() };
  }
  if (event === "custom") {
    return { title: p.title || "Kickbase Pokal", description: p.description || "", color, timestamp: new Date().toISOString() };
  }
  return null;
}
