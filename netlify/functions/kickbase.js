// Netlify Serverless Function — Kickbase API proxy
//
// Liest Liga-Mitglieder und Spieltag-Punkte aus der inoffiziellen Kickbase-API.
// Credentials liegen nur serverseitig (Netlify Env Vars):
//   - KICKBASE_EMAIL
//   - KICKBASE_PASSWORD
//   - SUPABASE_URL       (ohne VITE_-Prefix)
//   - SUPABASE_ANON_KEY  (ohne VITE_-Prefix)
//
// Aufruf nur mit gültigem Admin-Hash im Header `x-admin-hash` — wird
// serverseitig via Supabase-RPC verify_password('default', hash) geprüft.
//
// Actions (Query-Param `action`):
//   - test            → Login testen
//   - leagues         → alle Ligen des Accounts
//   - members&lid=X   → Mitglieder einer Liga
//   - points&lid=X&md=N → Matchday-Punkte je Mitglied
//
// Endpoints folgen dem community-dokumentierten v4-Schema der Kickbase-App.
// Sollte Kickbase das Schema ändern → Fehler werden mit Raw-Response
// geloggt, damit man schnell nachziehen kann.

const KB = "https://api.kickbase.com";

// ── Simple in-memory token cache (Function-Cold-Start = neuer Login)
let cachedToken = null;
let cachedTokenExp = 0;

async function kbLogin() {
  if (cachedToken && Date.now() < cachedTokenExp) return cachedToken;
  const email = process.env.KICKBASE_EMAIL;
  const pass = process.env.KICKBASE_PASSWORD;
  if (!email || !pass) throw new Error("KICKBASE_EMAIL/KICKBASE_PASSWORD nicht gesetzt");

  // Kickbase lehnt Logins ohne plausible Browser-/App-Header mit 401 ab.
  // Wir senden die Kombination aus Payload + Headern, die den Web-Client
  // und die Mobile-App am nächsten nachahmt.
  const browserHeaders = {
    "content-type": "application/json",
    "accept": "application/json",
    "origin": "https://play.kickbase.com",
    "referer": "https://play.kickbase.com/",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
    "accept-language": "de-DE,de;q=0.9,en;q=0.8",
  };
  const appHeaders = {
    "content-type": "application/json",
    "accept": "application/json",
    "user-agent": "Kickbase/iOS 6.6.2",
  };
  const attempts = [
    { path: "/v4/user/login",  headers: browserHeaders, body: { em: email, pass, loy: false, rep: {} } },
    { path: "/v4/user/login",  headers: browserHeaders, body: { email, password: pass, ext: false } },
    { path: "/v4/user/login",  headers: appHeaders,     body: { em: email, pass, loy: false, rep: {} } },
    { path: "/v4/cauth/login", headers: browserHeaders, body: { email, password: pass } },
    { path: "/user/login",     headers: browserHeaders, body: { email, password: pass, ext: false } },
  ];

  const errors = [];
  for (let i = 0; i < attempts.length; i++) {
    const a = attempts[i];
    const shape = a.body.email ? "email/password" : "em/pass";
    const ua = a.headers["user-agent"]?.startsWith("Kickbase") ? "app" : "browser";
    const tag = `[${i + 1}] ${a.path} (${ua}, ${shape})`;
    try {
      const r = await fetch(`${KB}${a.path}`, {
        method: "POST",
        headers: a.headers,
        body: JSON.stringify(a.body),
      });
      const txt = await r.text();
      let j = {}; try { j = JSON.parse(txt); } catch {}
      if (!r.ok) { errors.push(`${tag} → ${r.status}: ${txt.slice(0, 160)}`); continue; }
      const token = j.tkn || j.token || j.access_token;
      if (!token) { errors.push(`${tag} → 200 ohne Token: ${JSON.stringify(j).slice(0, 160)}`); continue; }
      cachedToken = token;
      cachedTokenExp = Date.now() + 45 * 60 * 1000;
      return token;
    } catch (e) {
      errors.push(`${tag} → Exception: ${e.message}`);
    }
  }
  throw new Error(`Kickbase-Login fehlgeschlagen. Alle ${attempts.length} Versuche:\n` + errors.join("\n"));
}

async function kbGet(path, token) {
  const r = await fetch(`${KB}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (r.status === 401) {
    cachedToken = null; cachedTokenExp = 0;
    throw new Error("Kickbase-Token abgelaufen — bitte Request wiederholen");
  }
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Kickbase ${path} → ${r.status}: ${txt.slice(0, 300)}`);
  }
  return r.json();
}

// ── Admin-Hash-Verifikation via Supabase
async function verifyAdmin(hash) {
  if (!hash) return false;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL/SUPABASE_ANON_KEY nicht gesetzt");
  const r = await fetch(`${url}/rest/v1/rpc/verify_password`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ p_tournament_id: "default", p_hash: hash }),
  });
  if (!r.ok) return false;
  const role = await r.json();
  return role === "admin";
}

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

export default async (req) => {
  if (req.method !== "GET" && req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  // Admin-Auth
  const adminHash = req.headers.get("x-admin-hash") || "";
  try {
    const ok = await verifyAdmin(adminHash);
    if (!ok) return json({ error: "Unauthorized — Admin-Hash ungültig oder Supabase-Env-Vars fehlen" }, 401);
  } catch (e) {
    return json({ error: `Auth-Check-Fehler: ${e.message}` }, 500);
  }

  const u = new URL(req.url);
  const action = u.searchParams.get("action") || "test";
  const lid = u.searchParams.get("lid");
  const md = u.searchParams.get("md");

  try {
    const token = await kbLogin();

    if (action === "test") {
      return json({ ok: true, message: "Kickbase-Login erfolgreich", cachedUntil: new Date(cachedTokenExp).toISOString() });
    }

    if (action === "leagues") {
      // Selection-Endpoint listet alle Ligen des Users
      const res = await kbGet(`/v4/leagues/selection`, token);
      const leagues = (res.it || res.leagues || res || []).map((l) => ({
        id: String(l.i || l.id),
        name: l.n || l.name || "?",
      }));
      return json({ leagues });
    }

    if (action === "members") {
      // Primär: /settings/managers (nur für Liga-Admins, liefert vollständige Manager-Liste).
      // Fallback: /ranking — funktioniert für jedes Mitglied, enthält alle Nutzer mit i/n.
      if (!lid) return json({ error: "lid fehlt" }, 400);
      let raw = null, source = null, tried = [];
      try {
        raw = await kbGet(`/v4/leagues/${encodeURIComponent(lid)}/settings/managers`, token);
        source = "settings/managers";
      } catch (e) {
        tried.push(`settings/managers → ${e.message.slice(0, 120)}`);
      }
      if (!raw) {
        try {
          raw = await kbGet(`/v4/leagues/${encodeURIComponent(lid)}/ranking`, token);
          source = "ranking";
        } catch (e) {
          tried.push(`ranking → ${e.message.slice(0, 120)}`);
        }
      }
      if (!raw) return json({ error: "Kein Members-Endpoint erreichbar", tried }, 502);
      // Beide liefern Mitglieder unter `us` (Kickbase-Konvention)
      const arr = raw.us || raw.users || raw.ranking || raw.rk || (Array.isArray(raw) ? raw : []);
      const members = arr.map((m) => ({
        id: String(m.i || m.id || m.userId || ""),
        name: m.n || m.name || m.nickname || "?",
        image: m.uim || m.profileUrl || "",
      })).filter((m) => m.id);
      return json({ members, source, count: members.length, _rawSample: members.length === 0 ? JSON.stringify(raw).slice(0, 500) : undefined });
    }

    if (action === "lineup") {
      // Dokumentiert: GET /v4/leagues/{lid}/users/{uid}/teamcenter?dayNumber=X
      if (!lid) return json({ error: "lid fehlt" }, 400);
      const uid = u.searchParams.get("uid");
      if (!uid) return json({ error: "uid fehlt" }, 400);
      if (!md) return json({ error: "md fehlt" }, 400);
      const data = await kbGet(`/v4/leagues/${encodeURIComponent(lid)}/users/${encodeURIComponent(uid)}/teamcenter?dayNumber=${encodeURIComponent(md)}`, token);
      const rawLineup = data.lineup || data.players || data.it || data.squad || data.pl || data.ap || [];
      const lineup = rawLineup.map((p) => ({
        id: String(p.i || p.id || ""),
        firstName: p.fn || p.firstName || "",
        lastName: p.ln || p.lastName || p.n || p.name || "?",
        number: p.nr || p.number || null,
        position: p.pos || p.position || null,
        points: Number(p.tp ?? p.totalPoints ?? p.p ?? p.points ?? p.mdp ?? 0),
        status: p.st || p.status || null,
      }));
      const totalPoints = Number(data.totalPoints ?? data.tp ?? data.sp ?? data.pt ?? lineup.reduce((a, x) => a + (x.points || 0), 0));
      return json({ lineup, totalPoints, _rawSample: lineup.length === 0 ? JSON.stringify(data).slice(0, 500) : undefined });
    }

    if (action === "points") {
      // Dokumentiert: GET /v4/leagues/{lid}/ranking?dayNumber=X
      if (!lid) return json({ error: "lid fehlt" }, 400);
      if (!md) return json({ error: "md fehlt" }, 400);
      const data = await kbGet(`/v4/leagues/${encodeURIComponent(lid)}/ranking?dayNumber=${encodeURIComponent(md)}`, token);
      // Response-Shape dokumentationstechnisch nicht fixiert — mehrere Wrapper probieren
      const arr = data.users || data.us || data.ranking || data.rk || data.it || (Array.isArray(data) ? data : []);
      const points = arr.map((m) => ({
        id: String(m.i || m.id || m.userId || ""),
        name: m.n || m.name || m.nickname || "?",
        points: Number(m.sp ?? m.mdp ?? m.p ?? m.points ?? m.seasonPoints ?? m.matchdayPoints ?? 0),
      })).filter((x) => x.id);
      return json({ matchday: Number(md), points, _rawSample: points.length === 0 ? JSON.stringify(data).slice(0, 500) : undefined });
    }

    return json({ error: `Unbekannte Action: ${action}` }, 400);
  } catch (e) {
    return json({ error: e.message || String(e) }, 502);
  }
};
