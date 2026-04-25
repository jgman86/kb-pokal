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

// Spieltag-Punkte über zwei verschiedene Endpoints versucht — der erste der
// nicht-leere Daten liefert wird genommen. Hintergrund: /ranking?dayNumber=X
// liefert für vergangene Spieltage konsistent mdp=0, /performance kann je
// nach Permissions auch leer kommen.
export async function getMatchdayPoints(leagueId, dayNumber) {
  const day = Number(dayNumber);

  // 1. Manager-Liste + irgendeine User-ID für die teamcenter-Path
  const ranking = await get(`/v4/leagues/${encodeURIComponent(leagueId)}/ranking`).catch(() => null);
  const managers = ((ranking && ranking.us) || []).map((m) => ({
    id: String(m.i || ""),
    name: m.n || "?",
    image: m.uim || "",
  })).filter((m) => m.id);

  if (managers.length === 0) {
    return Object.assign([], { _meta: { source: "ranking-empty", requestedDay: day, total: 0, nonZero: 0 } });
  }

  // ─── Strategie A: /teamcenter?dayNumber=X
  // Liefert (laut Doku) alle Manager der Liga mit ihren mdp für den Tag.
  const tc = await get(`/v4/leagues/${encodeURIComponent(leagueId)}/users/${encodeURIComponent(managers[0].id)}/teamcenter?dayNumber=${day}`).catch((e) => ({ __error: e.message }));
  if (tc && !tc.__error && Array.isArray(tc.us)) {
    const byId = new Map();
    for (const u of tc.us) byId.set(String(u.i || ""), { name: u.unm || u.n, mdp: Number(u.mdp || 0) });
    const rows = managers.map((m) => {
      const tcEntry = byId.get(m.id);
      return { ...m, points: tcEntry?.mdp ?? 0 };
    });
    const nonZero = rows.filter((r) => r.points > 0).length;
    if (nonZero > 0 || rows.length > 0) {
      if (nonZero === 0) console.warn(`[KB] teamcenter day=${day}: alle mdp=0 (vermutlich zukünftig).`);
      return Object.assign(rankByPoints(rows), { _meta: { source: "teamcenter", requestedDay: day, total: rows.length, nonZero, tcCount: tc.us.length } });
    }
  } else if (tc?.__error) {
    console.warn(`[KB] /teamcenter day=${day} failed: ${tc.__error}. Fallback zu /performance...`);
  }

  // ─── Strategie B: /managers/{id}/performance (Fan-out)
  let perfFailures = 0;
  const perfPromises = managers.map((m) =>
    get(`/v4/leagues/${encodeURIComponent(leagueId)}/managers/${encodeURIComponent(m.id)}/performance`)
      .catch((e) => { perfFailures++; if (perfFailures === 1) console.warn(`[KB] /performance ${m.id} failed: ${e.message}`); return null; }),
  );
  const perfs = await Promise.all(perfPromises);

  function pointsForDay(perf) {
    if (!perf || !Array.isArray(perf.it)) return 0;
    let bestDate = "", bestPoints = 0;
    for (const season of perf.it) {
      for (const ph of (season.it || season.ph || [])) {
        if (Number(ph.day) !== day) continue;
        const md = ph.md || "";
        if (md >= bestDate) { bestDate = md; bestPoints = Number(ph.mdp ?? ph.p ?? 0); }
      }
    }
    return bestPoints;
  }

  const rows = managers.map((m, i) => ({ ...m, points: pointsForDay(perfs[i]) }));
  const nonZero = rows.filter((r) => r.points > 0).length;

  // Wenn alles 0 ist → tiefer graben und Roh-Struktur des ersten Managers loggen
  if (rows.length > 0 && nonZero === 0) {
    const sample = perfs.find((p) => p && Array.isArray(p.it));
    if (sample) {
      const seasonSummaries = sample.it.map((s) => {
        const days = (s.it || s.ph || []).map((ph) => `${ph.day}:${ph.mdp ?? ph.p ?? "?"}`);
        return `[${s.sn || s.sid || "?"}] (${days.length} days) ${days.slice(0, 5).join(", ")}${days.length > 5 ? ` ... ${days.slice(-3).join(", ")}` : ""}`;
      });
      console.warn(`[KB] day=${day}: alle mdp=0. Erster Manager hat ${sample.it.length} Saisons:\n  - ${seasonSummaries.join("\n  - ")}`);
    } else {
      console.warn(`[KB] day=${day}: alle mdp=0 und keiner der ${rows.length} Manager hat eine parseable it[]. Failures=${perfFailures}, first response keys: ${perfs[0] ? JSON.stringify(Object.keys(perfs[0])) : "null"}`);
    }
  }
  return Object.assign(rankByPoints(rows), { _meta: { source: "managers/performance", requestedDay: day, total: rows.length, nonZero, failures: perfFailures } });
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
