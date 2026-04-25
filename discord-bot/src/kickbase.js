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
  // Beide Endpoints liefern us[].{i, n, uim} — settings/managers ist
  // Admin-only, ranking funktioniert für jedes Mitglied.
  let raw, source;
  try {
    raw = await get(`/v4/leagues/${encodeURIComponent(leagueId)}/settings/managers`);
    source = "settings/managers";
  } catch {
    raw = await get(`/v4/leagues/${encodeURIComponent(leagueId)}/ranking`);
    source = "ranking";
  }
  const arr = raw.us || [];
  return {
    source,
    members: arr.map((m) => ({
      id: String(m.i || ""),
      name: m.n || "?",
      image: m.uim || "",
    })).filter((m) => m.id),
  };
}

function rankByPoints(rows) {
  rows.sort((a, b) => (b.points - a.points) || a.name.localeCompare(b.name));
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

// Schema laut kickbase-api-doc:
//   GET /v4/leagues/{lid}/ranking → { us: [{i, n, sp, mdp, spl, mdpl, uim, ...}] }
//   sp  = season points (kumuliert)
//   mdp = matchday points (am angefragten dayNumber, sonst 0)
//   spl = season points place/rank
//   mdpl = matchday points place/rank
export async function getStandings(leagueId) {
  const raw = await get(`/v4/leagues/${encodeURIComponent(leagueId)}/ranking`);
  const arr = raw.us || [];
  const rows = arr.map((m) => ({
    id: String(m.i || ""),
    name: m.n || "?",
    points: Number(m.sp || 0),
    image: m.uim || "",
  })).filter((m) => m.id);
  return rankByPoints(rows);
}

export async function getMatchdayPoints(leagueId, dayNumber) {
  const day = Number(dayNumber);

  // 1. Manager-Liste von /ranking (ohne dayNumber, das wäre nur die Saison-Tabelle)
  const ranking = await get(`/v4/leagues/${encodeURIComponent(leagueId)}/ranking`);
  const managers = (ranking.us || []).map((m) => ({
    id: String(m.i || ""),
    name: m.n || "?",
    image: m.uim || "",
  })).filter((m) => m.id);

  if (managers.length === 0) {
    return Object.assign([], { _meta: { source: "ranking-empty", requestedDay: day, total: 0, nonZero: 0 } });
  }

  // 2. Pro Manager /performance abfragen — dort sind die echten Spieltag-für-Spieltag mdp
  const perfPromises = managers.map((m) =>
    get(`/v4/leagues/${encodeURIComponent(leagueId)}/managers/${encodeURIComponent(m.id)}/performance`).catch(() => null),
  );
  const perfs = await Promise.all(perfPromises);

  // 3. Pro Manager den angefragten Tag in der jüngsten Saison finden
  function pointsForDay(perf) {
    if (!perf || !Array.isArray(perf.it)) return 0;
    let bestDate = "", bestPoints = 0;
    for (const season of perf.it) {
      for (const ph of season.it || []) {
        if (Number(ph.day) !== day) continue;
        const md = ph.md || "";
        if (md > bestDate) { bestDate = md; bestPoints = Number(ph.mdp || 0); }
      }
    }
    return bestPoints;
  }

  const rows = managers.map((m, i) => ({ ...m, points: pointsForDay(perfs[i]) }));
  const nonZero = rows.filter((r) => r.points > 0).length;
  if (rows.length > 0 && nonZero === 0) {
    console.warn(`[KB] day=${day}: ${rows.length} Manager, alle mdp=0 nach /performance-Lookup. Spieltag wirklich nicht gespielt oder zukünftig?`);
  }
  return Object.assign(rankByPoints(rows), { _meta: { source: "managers/performance", requestedDay: day, total: rows.length, nonZero } });
}

// Lineup für einen Manager an einem Spieltag. Drei Calls nötig (parallel
// wo's geht), weil Kickbase die Daten verteilt:
//   1. /teamcenter?dayNumber=X    → us[].lp (Player-IDs der Aufstellung) + us[].mdp (Total)
//   2. /managers/{uid}/squad      → it[].pi/pn (Player-Namen + Positionen)
//   3. /players/{pid}/performance → it[].ph[].p für genauen Tag (parallel × 11)
export async function getLineup(leagueId, userId, dayNumber) {
  const day = Number(dayNumber);

  // 1. Teamcenter: us[] enthält ALLE Manager der Liga, wir filtern unseren raus
  const tc = await get(`/v4/leagues/${encodeURIComponent(leagueId)}/users/${encodeURIComponent(userId)}/teamcenter?dayNumber=${day}`);
  const me = (tc.us || []).find((u) => String(u.i) === String(userId));
  if (!me) {
    return { lineup: [], totalPoints: 0, _rawSample: JSON.stringify(tc).slice(0, 1500) };
  }
  const playerIds = (me.lp || []).filter((p) => p != null && p !== "").map(String);
  const totalPoints = Number(me.mdp || 0);
  if (playerIds.length === 0) return { lineup: [], totalPoints };

  // 2. Squad parallel (Namen + Positionen aus aktuellem Kader)
  const squadPromise = get(`/v4/leagues/${encodeURIComponent(leagueId)}/managers/${encodeURIComponent(userId)}/squad`).catch(() => ({}));

  // 3. Per-Player Performance parallel (Matchday-Punkte pro Spieler)
  const perfPromises = playerIds.map((pid) =>
    get(`/v4/leagues/${encodeURIComponent(leagueId)}/players/${encodeURIComponent(pid)}/performance`).catch(() => null),
  );

  const [squad, ...perfs] = await Promise.all([squadPromise, ...perfPromises]);
  const squadById = Object.fromEntries(((squad && squad.it) || []).map((p) => [String(p.pi), p]));

  function pointsForDay(perf) {
    if (!perf || !Array.isArray(perf.it)) return 0;
    let bestDate = "", bestPoints = 0;
    for (const season of perf.it) {
      for (const ph of season.ph || []) {
        if (Number(ph.day) !== day) continue;
        const md = ph.md || "";
        if (md > bestDate) { bestDate = md; bestPoints = Number(ph.p || 0); }
      }
    }
    return bestPoints;
  }

  const lineup = playerIds.map((pid, i) => {
    const sq = squadById[pid] || {};
    return {
      id: pid,
      firstName: "",
      lastName: sq.pn || "?",
      number: null,
      position: sq.pos ?? null,
      points: pointsForDay(perfs[i]),
      status: sq.st ?? null,
    };
  });

  return { lineup, totalPoints };
}

export async function getCurrentMatchday() {
  // /ranking-Response enthält "day"-Feld als Top-Level (siehe Doku-Sample)
  try {
    const leagues = await listLeagues();
    if (!leagues[0]) return null;
    const r = await get(`/v4/leagues/${encodeURIComponent(leagues[0].id)}/ranking`);
    if (r?.day) return Number(r.day);
  } catch {}
  return null;
}
