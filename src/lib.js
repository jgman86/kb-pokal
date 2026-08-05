import { supabase } from "./supabase.js";

export const DEFAULT_TID = "default";
export const generateId = () => Math.random().toString(36).slice(2, 10);
export const LOCAL_MODE = !supabase;

export const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export function getRoundName(rem, rn) {
  if (rem <= 2) return "Finale";
  if (rem <= 4) return "Halbfinale";
  if (rem <= 8) return "Viertelfinale";
  if (rem <= 16) return "Achtelfinale";
  return `Runde ${rn}`;
}

export async function hashPassword(pw) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pw));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function rpcCall(fn, params) {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc(fn, params);
  if (error) { console.error(`RPC ${fn} error:`, error.message, error); return { __error: true, message: error.message }; }
  return data;
}
export const isRpcError = (r) => r && typeof r === "object" && r.__error;

export const rpcHasPassword = () => rpcCall("has_password", { p_tournament_id: DEFAULT_TID });
export const rpcVerifyPassword = (h) => rpcCall("verify_password", { p_tournament_id: DEFAULT_TID, p_hash: h });
export const rpcSetPassword = (h) => rpcCall("set_password", { p_tournament_id: DEFAULT_TID, p_hash: h });
export const rpcChangePassword = (oh, nh) => rpcCall("change_password", { p_tournament_id: DEFAULT_TID, p_old_hash: oh, p_new_hash: nh });
export const rpcSetParticipantPassword = (ah, ph) => rpcCall("set_participant_password", { p_admin_hash: ah, p_participant_hash: ph });
export const rpcSave = (tid, h, d) => rpcCall("save_tournament", { p_tournament_id: tid, p_hash: h, p_data: d });
export const rpcCreate = (tid, h, d) => rpcCall("create_tournament", { p_tournament_id: tid, p_hash: h, p_data: d });
export const rpcDelete = (tid, h) => rpcCall("delete_tournament", { p_tournament_id: tid, p_hash: h });

export async function loadTournament(tid = DEFAULT_TID) {
  if (!supabase) return null;
  const { data } = await supabase.from("tournaments").select("data").eq("id", tid).single();
  return data?.data || null;
}

export async function listTournaments() {
  if (!supabase) return [];
  const { data } = await supabase.from("tournaments").select("id, data, created_at").order("created_at", { ascending: true });
  return (data || []).map((r) => ({ id: r.id, name: r.data?.cupName || r.id, status: r.data?.status || "setup", createdAt: r.created_at }));
}

// ============================================
// Default data-shape factory (backward-compat)
// ============================================
export const defaultConfig = () => ({ tiebreakMode: "marketValue", useSeeding: false, deadlineRequired: false, startMatchday: 10, endMatchday: 34 });
export const normalize = (d) => ({
  players: (d?.players || []).map((p) => ({ marketValue: 0, avatar: "", isTitleHolder: false, seed: 0, kickbaseLeagueId: "", kickbaseUserId: "", ...p })),
  rounds: (d?.rounds || []).map((r) => ({
    ...r,
    pairings: (r.pairings || []).map((m) => ({
      winner: null, tiebreakMethod: null, comments: [], predictions: [], leg1: null, leg2: null, ...m,
    })),
  })),
  currentRound: d?.currentRound ?? 0,
  status: d?.status ?? "setup",
  cupName: d?.cupName ?? "Kickbase Pokal",
  config: { ...defaultConfig(), ...(d?.config || {}) },
  archive: d?.archive || [],
  titleHolder: d?.titleHolder ?? null,
  schedule: d?.schedule || [],
});

// ============================================
// Spielplan-Generator
// ============================================
// Verteilt die Runden auf Bundesliga-Spieltage:
// - Final liegt immer auf endMd
// - Restliche Runden bekommen zufällige Spieltage aus [startMd, endMd-1]
// - Sortiert aufsteigend, damit Runde 1 = frühester Spieltag
export function generateSchedule(playerCount, startMd, endMd) {
  if (playerCount < 2) return [];
  const totalRounds = Math.ceil(Math.log2(playerCount));
  if (totalRounds === 0) return [];
  const s = Math.max(1, Math.min(startMd, endMd));
  const e = Math.max(s, endMd);
  const otherNeeded = totalRounds - 1;
  const pool = [];
  for (let md = s; md < e; md++) pool.push(md);
  if (pool.length < otherNeeded) {
    return { error: `Nicht genug Spieltage im Bereich ${s}–${e - 1}: brauche ${otherNeeded}, habe ${pool.length}. Range erweitern.` };
  }
  const picks = shuffle(pool).slice(0, otherNeeded).sort((a, b) => a - b);
  const schedule = picks.map((md, i) => ({ roundNumber: i + 1, matchday: md, isFinal: false }));
  schedule.push({ roundNumber: totalRounds, matchday: e, isFinal: true });
  return schedule;
}

// ============================================
// Tiebreaker resolution
// ============================================
export function resolveTiebreak(pairing, p1, p2, mode) {
  if (pairing.score1 == null || pairing.score2 == null) return { winner: null, method: null };
  if (pairing.score1 !== pairing.score2) {
    return { winner: pairing.score1 > pairing.score2 ? p1.id : p2.id, method: null };
  }
  if (mode === "marketValue") {
    if ((p1.marketValue || 0) === (p2.marketValue || 0)) {
      const w = Math.random() < 0.5 ? p1.id : p2.id;
      return { winner: w, method: "Marktwert gleich → Münzwurf" };
    }
    return {
      winner: (p1.marketValue || 0) > (p2.marketValue || 0) ? p1.id : p2.id,
      method: "höherer Marktwert",
    };
  }
  if (mode === "coinFlip") {
    const w = Math.random() < 0.5 ? p1.id : p2.id;
    return { winner: w, method: "Münzwurf" };
  }
  if (mode === "twoLeg") {
    const l1 = pairing.leg1, l2 = pairing.leg2;
    if (l1 && l2) {
      const total1 = (l1.score1 || 0) + (l2.score1 || 0);
      const total2 = (l1.score2 || 0) + (l2.score2 || 0);
      if (total1 !== total2) return { winner: total1 > total2 ? p1.id : p2.id, method: "Hin- & Rückrunde" };
      const w = Math.random() < 0.5 ? p1.id : p2.id;
      return { winner: w, method: "Hin- & Rückrunde → Münzwurf" };
    }
    return { winner: null, method: "awaiting-second-leg" };
  }
  return { winner: null, method: null };
}

// ============================================
// Seeding — TOP Spieler treffen erst spät aufeinander
// ============================================
export function seededPairings(players) {
  // Standard-Setzliste: 1 vs n, 2 vs n-1, 3 vs n-2, ...
  // Danach nächste Runde: 1 vs 2 (durchgesetzt), 3 vs 4, ...
  const sorted = [...players].sort((a, b) => (b.seed || 0) - (a.seed || 0));
  const n = sorted.length;
  const pairings = [];
  let bye = null;
  // Wenn ungerade → stärkster Spieler bekommt Freilos
  let pool = sorted;
  if (n % 2 === 1) { bye = sorted[0].id; pool = sorted.slice(1); }
  const half = pool.length / 2;
  for (let i = 0; i < half; i++) {
    pairings.push({ id: generateId(), player1Id: pool[i].id, player2Id: pool[pool.length - 1 - i].id, score1: null, score2: null, winner: null, tiebreakMethod: null, comments: [], predictions: [], leg1: null, leg2: null });
  }
  return { pairings, bye };
}

export function randomPairings(players) {
  const sh = shuffle(players);
  const pairings = [];
  let bye = null;
  for (let i = 0; i < sh.length - 1; i += 2) {
    pairings.push({ id: generateId(), player1Id: sh[i].id, player2Id: sh[i + 1].id, score1: null, score2: null, winner: null, tiebreakMethod: null, comments: [], predictions: [], leg1: null, leg2: null });
  }
  if (sh.length % 2 === 1) bye = sh[sh.length - 1].id;
  return { pairings, bye };
}

// ============================================
// Statistics
// ============================================
export function computeStats(data) {
  const rounds = data.rounds || [];
  const players = data.players || [];
  let topRoundScore = { value: -Infinity, playerId: null, roundNumber: null, matchday: "" };
  let biggestWin = { diff: -Infinity, winnerId: null, loserId: null, s1: 0, s2: 0, roundNumber: null };
  const totals = {};
  const counts = {};
  let matchCount = 0;
  for (const r of rounds) {
    for (const m of r.pairings || []) {
      if (m.score1 == null || m.score2 == null) continue;
      matchCount++;
      [[m.player1Id, m.score1, m.score2, m.player2Id], [m.player2Id, m.score2, m.score1, m.player1Id]].forEach(([pid, s, opp]) => {
        totals[pid] = (totals[pid] || 0) + s;
        counts[pid] = (counts[pid] || 0) + 1;
        if (s > topRoundScore.value) topRoundScore = { value: s, playerId: pid, roundNumber: r.roundNumber, matchday: r.matchday };
      });
      const diff = Math.abs(m.score1 - m.score2);
      if (diff > biggestWin.diff) {
        const winId = m.score1 > m.score2 ? m.player1Id : m.player2Id;
        const loseId = m.score1 > m.score2 ? m.player2Id : m.player1Id;
        biggestWin = { diff, winnerId: winId, loserId: loseId, s1: Math.max(m.score1, m.score2), s2: Math.min(m.score1, m.score2), roundNumber: r.roundNumber };
      }
    }
  }
  const avg = players.map((p) => ({ player: p, avg: counts[p.id] ? (totals[p.id] / counts[p.id]) : null })).filter((x) => x.avg != null).sort((a, b) => b.avg - a.avg);
  return { topRoundScore, biggestWin, avg, matchCount };
}

// ============================================
// Kickbase-API (via Netlify function /api/kickbase)
// ============================================
export async function kbFetch(action, params, adminHash) {
  const qs = new URLSearchParams({ action, ...(params || {}) }).toString();
  const r = await fetch(`/api/kickbase?${qs}`, {
    headers: { "x-admin-hash": adminHash || "" },
  });
  const txt = await r.text();
  let j; try { j = JSON.parse(txt); } catch { j = { error: `Unparseable (${r.status}): ${txt.slice(0, 200)}` }; }
  if (!r.ok) return { __error: true, status: r.status, ...j };
  return j;
}

// ============================================
// Discord webhook (via Netlify function)
// ============================================
export async function postDiscord(event, payload) {
  try {
    // Immer die App-URL mitschicken, damit Embed-Titel klickbar wird
    const enriched = { ...payload, appUrl: typeof window !== "undefined" ? window.location.origin : "" };
    const r = await fetch("/api/discord", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event, payload: enriched }),
    });
    if (!r.ok) console.warn("Discord webhook failed:", r.status);
    return r.ok;
  } catch (e) {
    console.warn("Discord webhook error:", e);
    return false;
  }
}

// ============================================
// Browser-Notifications (einfach, ohne Service Worker)
// ============================================
export async function requestNotificationPermission() {
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  return await Notification.requestPermission();
}

export function notify(title, body) {
  try {
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;
    new Notification(title, { body, icon: "/favicon.ico", tag: "kb-pokal" });
  } catch {}
}

// ============================================
// Deadline helpers
// ============================================
export function formatDeadline(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
}

export function timeUntil(iso) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (isNaN(ms)) return null;
  const abs = Math.abs(ms);
  const d = Math.floor(abs / 86400000);
  const h = Math.floor((abs % 86400000) / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  const past = ms < 0;
  const parts = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  return { ms, past, label: past ? `vor ${parts}` : `in ${parts}` };
}

// ============================================
// Session
// ============================================
export function getSession() {
  try {
    const raw = sessionStorage.getItem("kb-session-v2");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}
export function setSession(s) { try { sessionStorage.setItem("kb-session-v2", JSON.stringify(s)); } catch {} }
export function clearSession() { try { sessionStorage.removeItem("kb-session-v2"); sessionStorage.removeItem("kb-session"); } catch {} }

// Pseudo-role für LOCAL_MODE
export const LOCAL_ROLE = "admin";

// Player attribution in local mode / participant session
// (Nicknames the browser user identifies as — used for comments / predictions)
export function getIdentity() {
  try { return localStorage.getItem("kb-identity") || ""; } catch { return ""; }
}
export function setIdentity(v) { try { localStorage.setItem("kb-identity", v); } catch {} }
