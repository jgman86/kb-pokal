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

  // 1. Liga-Info + Manager-Liste parallel
  const [leagueInfo, ranking] = await Promise.all([
    getLeagueInfo(leagueId),
    get(`/v4/leagues/${encodeURIComponent(leagueId)}/ranking`).catch(() => null),
  ]);
  const managers = ((ranking && ranking.us) || []).map((m) => ({
    id: String(m.i || ""),
    name: m.n || "?",
    image: m.uim || "",
  })).filter((m) => m.id);

  // Sofort-Abbruch wenn Tag vor Liga-Erstellung
  if (leagueInfo.startMatchday && day < leagueInfo.startMatchday) {
    return Object.assign([], { _meta: { source: "before-league-creation", requestedDay: day, total: 0, nonZero: 0, leagueStartMatchday: leagueInfo.startMatchday } });
  }

  if (managers.length === 0) {
    return Object.assign([], { _meta: { source: "ranking-empty", requestedDay: day, total: 0, nonZero: 0, leagueStartMatchday: leagueInfo.startMatchday } });
  }

  // ─── Strategie A: /teamcenter?dayNumber=X
  // Liefert (laut Doku) alle Manager der Liga mit ihren mdp für den Tag.
  // Wir akzeptieren das Ergebnis nur, wenn auch wirklich Punkte > 0 dabei sind —
  // sonst weiter zu Strategie B (mehr Diagnose-Output).
  const tc = await get(`/v4/leagues/${encodeURIComponent(leagueId)}/users/${encodeURIComponent(managers[0].id)}/teamcenter?dayNumber=${day}`).catch((e) => ({ __error: e.message }));
  if (tc && !tc.__error && Array.isArray(tc.us)) {
    const byId = new Map();
    for (const u of tc.us) byId.set(String(u.i || ""), { name: u.unm || u.n, mdp: Number(u.mdp || 0) });
    const rows = managers.map((m) => ({ ...m, points: byId.get(m.id)?.mdp ?? 0 }));
    const nonZero = rows.filter((r) => r.points > 0).length;
    console.log(`[KB] teamcenter day=${day}: ${tc.us.length} Einträge, ${nonZero}/${rows.length} mit Punkten > 0`);
    if (nonZero > 0) {
      return Object.assign(rankByPoints(rows), { _meta: { source: "teamcenter", requestedDay: day, total: rows.length, nonZero, tcCount: tc.us.length } });
    }
    console.warn(`[KB] teamcenter day=${day}: alle 0, probiere /performance...`);
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

  // Wenn alles 0: ermitteln ob's am Bot-Beitritt liegt (= Tag liegt vor Bot-Membership)
  let earliestAccessibleDay = null;
  if (rows.length > 0 && nonZero === 0) {
    const sample = perfs.find((p) => p && Array.isArray(p.it));
    if (sample) {
      // Frühester Tag in der jüngsten Saison = Datum, ab dem Bot Zugriff hat
      const latestSeason = sample.it[sample.it.length - 1];
      const days = (latestSeason?.it || latestSeason?.ph || []).map((ph) => Number(ph.day)).filter((n) => !isNaN(n));
      if (days.length > 0) earliestAccessibleDay = Math.min(...days);

      const seasonSummaries = sample.it.map((s) => {
        const ds = (s.it || s.ph || []).map((ph) => `${ph.day}:${ph.mdp ?? ph.p ?? "?"}`);
        return `[${s.sn || s.sid || "?"}] (${ds.length} days) ${ds.slice(0, 5).join(", ")}${ds.length > 5 ? ` ... ${ds.slice(-3).join(", ")}` : ""}`;
      });
      console.warn(`[KB] day=${day}: alle mdp=0. Erster Manager hat ${sample.it.length} Saisons:\n  - ${seasonSummaries.join("\n  - ")}`);
    }
  }

  return Object.assign(rankByPoints(rows), { _meta: { source: "managers/performance", requestedDay: day, total: rows.length, nonZero, failures: perfFailures, earliestAccessibleDay, leagueStartMatchday: leagueInfo.startMatchday } });
}

// Lineup für einen Manager an einem Spieltag. Drei Calls nötig (parallel
// wo's geht), weil Kickbase die Daten verteilt:
//   1. /teamcenter?dayNumber=X    → us[].lp (Player-IDs der Aufstellung) + us[].mdp (Total)
//   2. /managers/{uid}/squad      → it[].pi/pn (Player-Namen + Positionen)
//   3. /players/{pid}/performance → it[].ph[].p für genauen Tag (parallel × 11)
// Stats für einen Manager über einen Zeitraum (lastN matchdays oder all).
// Liefert: tageweise Punkte, Mittelwert, Stdabw, Min/Max, Team-Marktwert.
export async function getManagerStats(leagueId, managerId, lastN = null) {
  const [perf, squad] = await Promise.all([
    get(`/v4/leagues/${encodeURIComponent(leagueId)}/managers/${encodeURIComponent(managerId)}/performance`).catch(() => null),
    get(`/v4/leagues/${encodeURIComponent(leagueId)}/managers/${encodeURIComponent(managerId)}/squad`).catch(() => null),
  ]);
  const name = perf?.unm || "?";

  // Aktuellste Saison = letzte im it[]-Array
  const currentSeason = perf?.it?.[perf.it.length - 1];
  const allDays = (currentSeason?.it || currentSeason?.ph || []).filter((p) => p.mdp != null && p.mdp >= 0);
  // nur die mit echtem Datum berücksichtigen (vermeidet 0-mdp-Lücken)
  const playedDays = allDays.filter((p) => p.mdp > 0 || (p.cur === false && p.md));
  const period = lastN && lastN > 0 ? playedDays.slice(-lastN) : playedDays;

  const points = period.map((p) => Number(p.mdp || 0));
  const days = period.map((p) => Number(p.day));
  const n = points.length;
  const mean = n > 0 ? points.reduce((a, b) => a + b, 0) / n : 0;
  const variance = n > 1 ? points.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
  const sd = Math.sqrt(variance);
  const min = n > 0 ? Math.min(...points) : 0;
  const max = n > 0 ? Math.max(...points) : 0;
  const minDay = n > 0 ? days[points.indexOf(min)] : null;
  const maxDay = n > 0 ? days[points.indexOf(max)] : null;

  // Team-Marktwert aus Squad — Summen über alle Spieler
  const squadPlayers = squad?.it || [];
  const teamValue = squadPlayers.reduce((a, p) => a + Number(p.mv || 0), 0);
  const teamValueGainLoss = squadPlayers.reduce((a, p) => a + Number(p.mvgl || 0), 0);
  const teamValueDailyDelta = squadPlayers.reduce((a, p) => a + Number(p.sdmvt || 0), 0);

  // Top-Spieler im Kader nach Ø-Punkten (ap = average points)
  const topPlayers = [...squadPlayers]
    .filter((p) => Number(p.ap) > 0 && p.pn)
    .sort((a, b) => Number(b.ap) - Number(a.ap))
    .slice(0, 5)
    .map((p) => ({ id: String(p.pi), name: p.pn, avgPoints: Number(p.ap), totalPoints: Number(p.p || 0), marketValue: Number(p.mv || 0) }));

  return {
    id: String(managerId), name,
    days, points,
    n, mean, sd, min, max, minDay, maxDay,
    teamValue, teamValueGainLoss, teamValueDailyDelta,
    squadPlayerIds: squadPlayers.map((p) => String(p.pi)).filter(Boolean),
    topPlayers,
  };
}

// Team-Marktwert-Kurve über die letzten 92 Tage. Pro Squad-Spieler die MV-Historie
// holen und nach Datum aufsummieren. Optional auf lastDays beschränken.
export async function getTeamMarketValueHistory(leagueId, playerIds, lastDays = null) {
  if (!playerIds?.length) return { points: [] };
  const promises = playerIds.map((pid) =>
    get(`/v4/leagues/${encodeURIComponent(leagueId)}/players/${encodeURIComponent(pid)}/marketValue/92`).catch(() => null),
  );
  const results = await Promise.all(promises);
  const byDt = new Map();
  for (const r of results) {
    if (!r || !Array.isArray(r.it)) continue;
    for (const e of r.it) {
      const dt = Number(e.dt);
      const mv = Number(e.mv || 0);
      if (!isFinite(dt)) continue;
      byDt.set(dt, (byDt.get(dt) || 0) + mv);
    }
  }
  let series = [...byDt.entries()].sort((a, b) => a[0] - b[0]).map(([dt, mv]) => ({ dt, mv }));
  if (lastDays && series.length > lastDays) series = series.slice(-lastDays);
  return { points: series };
}

export async function getLeagueStats(leagueId, lastN = null) {
  const ranking = await get(`/v4/leagues/${encodeURIComponent(leagueId)}/ranking`);
  const managers = ((ranking && ranking.us) || []).map((m) => ({ id: String(m.i || ""), name: m.n || "?" })).filter((m) => m.id);

  const stats = await Promise.all(managers.map((m) => getManagerStats(leagueId, m.id, lastN).catch(() => null)));
  const valid = stats.filter((s) => s && s.n > 0);

  if (valid.length === 0) return { managers: [], bestByMean: null, mostConsistent: null, biggestMatchday: null };

  const byMean = [...valid].sort((a, b) => b.mean - a.mean);
  const byConsistency = [...valid].sort((a, b) => a.sd - b.sd);
  const byMax = [...valid].sort((a, b) => b.max - a.max);
  const byTeamValue = [...valid].sort((a, b) => b.teamValue - a.teamValue);

  return {
    managers: valid,
    bestByMean: byMean[0],
    mostConsistent: byConsistency[0],
    biggestMatchday: byMax[0],
    biggestTeam: byTeamValue[0],
    leagueMean: valid.reduce((a, s) => a + s.mean, 0) / valid.length,
  };
}

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
  try {
    const leagues = await listLeagues();
    if (!leagues[0]) return null;
    const r = await get(`/v4/leagues/${encodeURIComponent(leagues[0].id)}/ranking`);
    if (r?.day) return Number(r.day);
  } catch {}
  return null;
}

// Liga-Metadaten incl. Start-Spieltag (mppu = matchday-pickup, Spieltag an
// dem die Liga erstellt wurde). Vor diesem Tag existiert keine Punkte-Historie
// in der Liga — auch nicht für Manager, die bei Bundesliga-Saisonbeginn dabei waren.
const leagueInfoCache = new Map();
const LEAGUE_INFO_TTL = 60 * 60 * 1000; // 1h

export async function getLeagueInfo(leagueId) {
  const cached = leagueInfoCache.get(leagueId);
  if (cached && Date.now() - cached.ts < LEAGUE_INFO_TTL) return cached.data;
  try {
    const me = await get(`/v4/leagues/${encodeURIComponent(leagueId)}/me`);
    const info = {
      startMatchday: Number(me.mppu) || null,  // Liga-Erstellungs-Spieltag
      leagueName: me.lnm || "",
    };
    leagueInfoCache.set(leagueId, { ts: Date.now(), data: info });
    return info;
  } catch (e) {
    console.warn(`[KB] /me ${leagueId} failed: ${e.message}`);
    return { startMatchday: null, leagueName: "" };
  }
}
