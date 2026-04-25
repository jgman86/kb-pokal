// Kickbase API Client — basiert auf der inoffiziellen v4-API
// (siehe github.com/kevinskyba/kickbase-api-doc).
//
// Alle Calls laufen serverseitig mit dem Bot-Account (Env-Vars
// KICKBASE_EMAIL/KICKBASE_PASSWORD). Token wird im Memory gecacht
// (~45 Min), bei 401 wird einmalig neu geloggt.

const KB = "https://api.kickbase.com";

let cachedToken = null;
let cachedTokenExp = 0;

const browserHeaders = () => ({
  "content-type": "application/json",
  "accept": "application/json",
  "origin": "https://play.kickbase.com",
  "referer": "https://play.kickbase.com/",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
  "accept-language": "de-DE,de;q=0.9,en;q=0.8",
});

export async function login(force = false) {
  if (!force && cachedToken && Date.now() < cachedTokenExp) return cachedToken;
  const email = process.env.KICKBASE_EMAIL;
  const pass = process.env.KICKBASE_PASSWORD;
  if (!email || !pass) throw new Error("KICKBASE_EMAIL / KICKBASE_PASSWORD nicht gesetzt");

  const r = await fetch(`${KB}/v4/user/login`, {
    method: "POST",
    headers: browserHeaders(),
    body: JSON.stringify({ em: email, pass }),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`Kickbase-Login fehlgeschlagen (${r.status}): ${txt.slice(0, 200)}`);
  const j = JSON.parse(txt);
  const token = j.tkn || j.token || j.access_token;
  if (!token) throw new Error("Kein Token in Login-Antwort: " + txt.slice(0, 200));
  cachedToken = token;
  cachedTokenExp = Date.now() + 45 * 60 * 1000;
  return token;
}

async function get(path, retried = false) {
  const token = await login();
  const r = await fetch(`${KB}${path}`, {
    headers: { ...browserHeaders(), Authorization: `Bearer ${token}` },
  });
  if (r.status === 401 && !retried) {
    cachedToken = null; cachedTokenExp = 0;
    return get(path, true);
  }
  const txt = await r.text();
  if (!r.ok) throw new Error(`Kickbase ${path} → ${r.status}: ${txt.slice(0, 200)}`);
  try { return JSON.parse(txt); } catch { throw new Error(`Kickbase ${path}: nicht-JSON Response`); }
}

// ── High-Level API ──────────────────────────────────────

export async function listLeagues() {
  const res = await get(`/v4/leagues/selection`);
  return (res.it || res.leagues || res || []).map((l) => ({
    id: String(l.i || l.id),
    name: l.n || l.name || "?",
  }));
}

export async function listMembers(leagueId) {
  // Primär: settings/managers (admin-only) → Fallback: ranking (universal)
  let raw, source;
  try {
    raw = await get(`/v4/leagues/${encodeURIComponent(leagueId)}/settings/managers`);
    source = "settings/managers";
  } catch {
    raw = await get(`/v4/leagues/${encodeURIComponent(leagueId)}/ranking`);
    source = "ranking";
  }
  const arr = raw.us || raw.users || raw.ranking || raw.rk || (Array.isArray(raw) ? raw : []);
  return {
    source,
    members: arr.map((m) => ({
      id: String(m.i || m.id || m.userId || ""),
      name: m.n || m.name || m.nickname || "?",
      image: m.uim || "",
    })).filter((m) => m.id),
  };
}

function rankByPoints(rows) {
  // Stabil-sortieren: höchste Punkte oben, bei Gleichstand alphabetisch
  rows.sort((a, b) => (b.points - a.points) || a.name.localeCompare(b.name));
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

export async function getStandings(leagueId) {
  const raw = await get(`/v4/leagues/${encodeURIComponent(leagueId)}/ranking`);
  const arr = raw.us || raw.users || raw.ranking || raw.rk || (Array.isArray(raw) ? raw : []);
  const rows = arr.map((m) => ({
    id: String(m.i || m.id || m.userId || ""),
    name: m.n || m.name || "?",
    points: Number(m.sp ?? m.seasonPoints ?? m.tp ?? m.totalPoints ?? m.p ?? 0),
    image: m.uim || "",
  })).filter((m) => m.id);
  return rankByPoints(rows);
}

export async function getMatchdayPoints(leagueId, dayNumber) {
  const raw = await get(`/v4/leagues/${encodeURIComponent(leagueId)}/ranking?dayNumber=${encodeURIComponent(dayNumber)}`);
  const arr = raw.us || raw.users || raw.ranking || raw.rk || (Array.isArray(raw) ? raw : []);
  const rows = arr.map((m) => ({
    id: String(m.i || m.id || m.userId || ""),
    name: m.n || m.name || "?",
    points: Number(m.sp ?? m.mdp ?? m.matchdayPoints ?? m.p ?? 0),
  })).filter((m) => m.id);
  return rankByPoints(rows);
}

// Findet rekursiv das erste Array, dessen Objekte wie Spieler aussehen
// (haben einen Namen UND eine Punktzahl ODER eine Position).
function findPlayerArray(node, depth = 0) {
  if (!node || depth > 4) return null;
  if (Array.isArray(node)) {
    if (node.length > 0 && typeof node[0] === "object" && node[0] !== null) {
      const sample = node[0];
      const hasName = sample.fn || sample.ln || sample.n || sample.name || sample.lastName;
      const hasNumeric = sample.tp != null || sample.p != null || sample.mdp != null || sample.points != null || sample.totalPoints != null || sample.pos != null || sample.position != null;
      if (hasName && hasNumeric) return node;
    }
    for (const item of node) {
      const r = findPlayerArray(item, depth + 1);
      if (r) return r;
    }
    return null;
  }
  if (typeof node === "object") {
    for (const key of Object.keys(node)) {
      const r = findPlayerArray(node[key], depth + 1);
      if (r) return r;
    }
  }
  return null;
}

export async function getLineup(leagueId, userId, dayNumber) {
  const data = await get(`/v4/leagues/${encodeURIComponent(leagueId)}/users/${encodeURIComponent(userId)}/teamcenter?dayNumber=${encodeURIComponent(dayNumber)}`);
  // Bekannte Wrapper zuerst, dann Tiefen-Suche als Fallback
  const candidates = [data.lineup, data.players, data.it, data.squad, data.pl, data.ap, data.tm?.players, data.t?.players, data.tm?.tps, data.psl, data.fl];
  let rawLineup = candidates.find((c) => Array.isArray(c) && c.length > 0);
  if (!rawLineup) rawLineup = findPlayerArray(data) || [];

  const lineup = rawLineup.map((p) => ({
    id: String(p.i || p.id || ""),
    firstName: p.fn || p.firstName || "",
    lastName: p.ln || p.lastName || p.n || p.name || "?",
    number: p.nr || p.number || p.shn || null,
    position: p.pos || p.position || null,
    points: Number(p.tp ?? p.totalPoints ?? p.p ?? p.points ?? p.mdp ?? p.lp ?? 0),
    status: p.st || p.status || null,
  }));
  const totalPoints = Number(data.totalPoints ?? data.tp ?? data.sp ?? data.pt ?? lineup.reduce((a, x) => a + (x.points || 0), 0));

  // Wenn nichts geparsed wurde, raw-Sample mitgeben damit wir das Schema sehen
  const _rawSample = lineup.length === 0 ? JSON.stringify(data).slice(0, 1500) : undefined;
  return { lineup, totalPoints, _rawSample };
}

export async function getCurrentMatchday() {
  // overview enthält day-Feld (current matchday)
  try {
    const res = await get(`/v4/competitions`);
    // competitions[0].cd oder ähnlich — variiert
    if (Array.isArray(res?.it)) {
      const c = res.it[0];
      const d = c?.cd ?? c?.dn ?? c?.day;
      if (d) return Number(d);
    }
  } catch {}
  // Fallback: settings/managers liefert "day" Feld
  try {
    const leagues = await listLeagues();
    if (leagues[0]) {
      const r = await get(`/v4/leagues/${encodeURIComponent(leagues[0].id)}/settings/managers`);
      if (r?.day) return Number(r.day);
    }
  } catch {}
  return null;
}
