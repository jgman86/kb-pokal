import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { supabase } from "./supabase.js";
import {
  DEFAULT_TID, LOCAL_MODE, generateId, getRoundName, hashPassword, isRpcError,
  rpcHasPassword, rpcVerifyPassword, rpcSetPassword, rpcChangePassword, rpcSetParticipantPassword,
  rpcSave, rpcCreate, rpcDelete,
  loadTournament, listTournaments,
  normalize, resolveTiebreak, seededPairings, randomPairings,
  computeStats, postDiscord,
  requestNotificationPermission, notify,
  formatDeadline, timeUntil,
  getSession, setSession, clearSession,
  getIdentity, setIdentity,
} from "./lib.js";
import { CSS, gt, s } from "./styles.js";
import { Bracket, Av } from "./Bracket.jsx";

const init = () => normalize({});

/* ═══════════════════ PASSWORD GATE ═══════════════════ */
function PasswordGate({ onAuth }) {
  const [mode, setMode] = useState("loading");
  const [pw, setPw] = useState(""); const [pw2, setPw2] = useState("");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      if (!supabase) { setErr("⚠️ Supabase nicht konfiguriert. Prüfe VITE_SUPABASE_URL und VITE_SUPABASE_ANON_KEY in der .env Datei."); setMode("error"); return; }
      const sess = getSession();
      if (sess?.hash && sess?.role) {
        const r = await rpcVerifyPassword(sess.hash);
        if (typeof r === "string" && r !== "") { onAuth({ hash: sess.hash, role: r }); return; }
        clearSession();
      }
      const has = await rpcHasPassword();
      if (isRpcError(has)) { setErr(`⚠️ Supabase-Fehler: ${has.message}. Hast du das SQL-Setup ausgeführt? (supabase-setup.sql)`); setMode("error"); return; }
      setMode(has === true ? "login" : "setup");
    })();
  }, [onAuth]);

  const doSetup = async () => {
    setErr(""); if (pw.length < 4) { setErr("Mindestens 4 Zeichen"); return; }
    if (pw !== pw2) { setErr("Passwörter stimmen nicht überein"); return; }
    setBusy(true); const h = await hashPassword(pw);
    const res = await rpcSetPassword(h); setBusy(false);
    if (isRpcError(res)) { setErr(`Supabase-Fehler: ${res.message}`); return; }
    if (res === true) { setSession({ hash: h, role: "admin" }); onAuth({ hash: h, role: "admin" }); }
    else { setErr("Passwort wurde bereits gesetzt. Bitte einloggen."); setMode("login"); setPw(""); setPw2(""); }
  };
  const doLogin = async () => {
    setErr(""); if (!pw) return; setBusy(true);
    const h = await hashPassword(pw);
    const res = await rpcVerifyPassword(h); setBusy(false);
    if (isRpcError(res)) { setErr(`Supabase-Fehler: ${res.message}`); return; }
    if (typeof res === "string" && res !== "") { setSession({ hash: h, role: res }); onAuth({ hash: h, role: res }); }
    else setErr("Falsches Passwort");
  };

  if (mode === "loading") return <div style={gt.wrap}><style>{CSS}</style><div style={gt.spinner} /><p style={gt.lt}>Verbinde...</p></div>;
  if (mode === "error") return <div style={gt.wrap}><style>{CSS}</style><div style={gt.glow} /><div style={gt.card}>
    <div style={{ fontSize: 40, textAlign: "center", marginBottom: 8 }}>⚠️</div><h1 style={gt.title}>Verbindungsproblem</h1>
    <p style={{ ...gt.err, textAlign: "left", lineHeight: 1.5 }}>{err}</p>
    <p style={{ fontSize: 11, color: "#64748b", marginTop: 12, lineHeight: 1.6 }}>Checklist:<br />1. Supabase-Projekt erstellt?<br />2. SQL aus <code>supabase-setup.sql</code> ausgeführt?<br />3. <code>.env</code> mit den richtigen Keys?<br />4. Öffne die Browser-Konsole (F12) für Details.</p>
    <button style={{ ...gt.btn, marginTop: 14 }} onClick={() => window.location.reload()}>🔄 Nochmal versuchen</button>
  </div></div>;
  return (<div style={gt.wrap}><style>{CSS}</style><div style={gt.glow} /><div style={gt.card}>
    <div style={{ fontSize: 40, textAlign: "center", marginBottom: 8 }}>🏆</div><h1 style={gt.title}>Kickbase Pokal</h1>
    {mode === "setup" ? <>
      <p style={gt.desc}>Willkommen! Lege das Admin-Passwort fest.</p>
      <div style={gt.f}><label style={gt.l}>Admin-Passwort</label><input type="password" style={gt.inp} placeholder="Mind. 4 Zeichen" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && document.getElementById("pw2")?.focus()} /></div>
      <div style={gt.f}><label style={gt.l}>Bestätigen</label><input id="pw2" type="password" style={gt.inp} placeholder="Nochmal eingeben" value={pw2} onChange={(e) => setPw2(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doSetup()} /></div>
      {err && <p style={gt.err}>{err}</p>}<button style={{ ...gt.btn, opacity: busy ? .5 : 1 }} disabled={busy} onClick={doSetup}>{busy ? "..." : "🔐 Starten"}</button>
    </> : <>
      <p style={gt.desc}>Gib das Admin- oder Teilnehmer-Passwort ein.</p>
      <div style={gt.f}><label style={gt.l}>Passwort</label><input type="password" style={gt.inp} placeholder="Pokal-Passwort" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doLogin()} autoFocus /></div>
      {err && <p style={gt.err}>{err}</p>}<button style={{ ...gt.btn, opacity: busy ? .5 : 1 }} disabled={busy} onClick={doLogin}>{busy ? "Prüfe..." : "🏆 Einloggen"}</button>
    </>}
    <div style={gt.sec}><span style={{ fontSize: 12, flexShrink: 0 }}>🔒</span><span style={gt.secT}>SHA-256 Hash serverseitig. Admin = volle Kontrolle, Teilnehmer = Scores & Kommentare.</span></div>
  </div></div>);
}

/* ═══════════════════ CONFETTI ═══════════════════ */
function BigConfetti() {
  const parts = useMemo(() => Array.from({ length: 80 }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 2.5,
    duration: 2 + Math.random() * 2,
    size: 5 + Math.random() * 7,
    color: ["#00e676", "#ffd700", "#ff4081", "#448aff", "#ff9100", "#ab47bc", "#ef4444"][i % 7],
    rot: Math.random() * 360,
  })), []);
  return (
    <div style={{ position: "fixed", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: 2 }}>
      {parts.map((p) => (
        <span key={p.id} style={{
          position: "absolute", bottom: -20, left: `${p.left}%`,
          width: p.size, height: p.size * 1.4, borderRadius: 1,
          background: p.color, transform: `rotate(${p.rot}deg)`,
          animation: `confetti ${p.duration}s ease-out ${p.delay}s infinite`,
        }} />
      ))}
    </div>
  );
}

/* ═══════════════════ TOURNAMENT ═══════════════════ */
function Tournament({ session, onLogout }) {
  const [tid, setTid] = useState(DEFAULT_TID);
  const [tournaments, setTournaments] = useState([]);
  const [data, setDataRaw] = useState(init());
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [view, setView] = useState("overview");
  const [np, setNp] = useState({ name: "", league: "", marketValue: "", avatar: "", seed: "" });
  const [editSc, setEditSc] = useState(null);
  const [scInp, setScInp] = useState({ s1: "", s2: "", leg: 1 });
  const [cupNm, setCupNm] = useState("");
  const [confirm, setConfirm] = useState(null);
  const [animDraw, setAnimDraw] = useState(false);
  const [drawn, setDrawn] = useState([]);
  const [impTxt, setImpTxt] = useState("");
  const [showImp, setShowImp] = useState(false);
  const [sync, setSync] = useState(null);
  const [cpw, setCpw] = useState({ show: false, o: "", n1: "", n2: "", err: "", ok: false });
  const [ppw, setPpw] = useState({ show: false, v: "", err: "", ok: false });
  const [identity, setIdent] = useState(getIdentity());
  const [identityInput, setIdentityInput] = useState(getIdentity());
  const [notifPerm, setNotifPerm] = useState(typeof Notification !== "undefined" ? Notification.permission : "unsupported");
  const [expandedMatch, setExpandedMatch] = useState(null);
  const [commentInp, setCommentInp] = useState({});
  const [newCupName, setNewCupName] = useState("");
  const [coinFlip, setCoinFlip] = useState(null);
  const skip = useRef(false);

  const isAdmin = session.role === "admin";
  const setData = (d) => setDataRaw(normalize(d));

  // ── Initial load + tournament list
  useEffect(() => {
    (async () => {
      if (LOCAL_MODE) {
        try { const ls = localStorage.getItem("kb-pokal-data"); if (ls) { const p = JSON.parse(ls); setData(p); setCupNm(p.cupName || "Kickbase Pokal"); } } catch {}
        setConnected(false); setLoading(false); setTournaments([{ id: "local", name: "Lokal", status: "setup" }]); return;
      }
      const list = await listTournaments();
      setTournaments(list.length ? list : [{ id: DEFAULT_TID, name: "Kickbase Pokal", status: "setup" }]);
      const r = await loadTournament(tid);
      if (r) { setData(r); setCupNm(r.cupName || "Kickbase Pokal"); setConnected(true); }
      setLoading(false);
    })();
  // eslint-disable-next-line
  }, [tid]);

  // ── Realtime subscription
  useEffect(() => {
    if (!supabase) return;
    const ch = supabase.channel(`t-up-${tid}`).on("postgres_changes", { event: "*", schema: "public", table: "tournaments", filter: `id=eq.${tid}` }, (pl) => {
      if (skip.current) { skip.current = false; return; }
      if (pl.new?.data) {
        const n = normalize(pl.new.data);
        setDataRaw(n); setCupNm(n.cupName || "");
        setSync(new Date());
        // Check if I'm in a newly drawn pairing → notify
        maybeNotifyDraw(n, identity);
      }
    }).subscribe((st) => setConnected(st === "SUBSCRIBED"));
    return () => { supabase.removeChannel(ch); };
  // eslint-disable-next-line
  }, [tid, identity]);

  // ── Save
  const save = useCallback(async (nd) => {
    const n = normalize(nd);
    setDataRaw(n);
    if (LOCAL_MODE) { try { localStorage.setItem("kb-pokal-data", JSON.stringify(n)); } catch {} setSync(new Date()); return; }
    skip.current = true;
    const res = await rpcSave(tid, session.hash, n);
    if (isRpcError(res)) { console.error("Save failed:", res.message); alert("Speichern fehlgeschlagen: " + res.message); }
    else if (res !== true) { console.error("Save rejected"); alert("Speichern abgelehnt. Keine Berechtigung?"); }
    setSync(new Date());
  }, [session.hash, tid]);

  // ── Derived
  const gp = (id) => data.players.find((p) => p.id === id);
  const act = data.players.filter((p) => !p.eliminated);
  const cr = data.rounds.find((r) => r.roundNumber === data.currentRound);
  const W = data.status === "finished" ? act[0] : null;
  const allScoresDone = cr?.pairings.every((p) => p.winner != null || (p.score1 != null && p.score2 != null && p.score1 !== p.score2));
  const stats = useMemo(() => computeStats(data), [data]);

  // ── Player CRUD (admin only)
  const addP = () => {
    if (!isAdmin || !np.name.trim()) return;
    save({
      ...data,
      players: [...data.players, {
        id: generateId(), name: np.name.trim(), league: np.league.trim(),
        eliminated: false,
        marketValue: parseFloat(np.marketValue) || 0,
        avatar: np.avatar.trim(),
        seed: parseFloat(np.seed) || 0,
        isTitleHolder: data.titleHolder === np.name.trim(),
      }],
    });
    setNp({ name: "", league: "", marketValue: "", avatar: "", seed: "" });
  };
  const importP = () => {
    if (!isAdmin) return;
    const ps = impTxt.split("\n").filter((l) => l.trim()).map((l) => {
      const p = l.split(/[,;\t]/).map((x) => x.trim());
      return {
        id: generateId(), name: p[0] || "", league: p[1] || "",
        marketValue: parseFloat(p[2]) || 0,
        avatar: p[3] || "",
        seed: parseFloat(p[4]) || 0,
        eliminated: false, isTitleHolder: false,
      };
    }).filter((x) => x.name);
    save({ ...data, players: [...data.players, ...ps] });
    setImpTxt(""); setShowImp(false);
  };
  const remP = (id) => { if (isAdmin) save({ ...data, players: data.players.filter((p) => p.id !== id) }); };
  const setTitleHolder = (id) => {
    if (!isAdmin) return;
    const name = gp(id)?.name || null;
    save({
      ...data,
      titleHolder: name,
      players: data.players.map((p) => ({ ...p, isTitleHolder: p.name === name })),
    });
  };
  const updatePlayer = (id, patch) => {
    if (!isAdmin) return;
    save({ ...data, players: data.players.map((p) => p.id === id ? { ...p, ...patch } : p) });
  };

  // ── Start / Draw (admin only)
  const startT = () => {
    if (!isAdmin || data.players.length < 2) return;
    save({ ...data, status: "running", currentRound: 0, rounds: [], cupName: cupNm || "Kickbase Pokal" });
    setView("draw");
  };

  const drawR = () => {
    if (!isAdmin) return;
    const { pairings, bye } = data.config.useSeeding ? seededPairings(act) : randomPairings(act);
    const rn = data.currentRound + 1;
    const round = {
      roundNumber: rn,
      name: getRoundName(act.length, rn),
      matchday: "",
      deadline: null,
      pairings,
      bye,
      status: "active",
    };
    setAnimDraw(true); setDrawn([]);
    pairings.forEach((p, i) => setTimeout(() => setDrawn((pr) => [...pr, p]), (i + 1) * 500));
    setTimeout(() => {
      setAnimDraw(false);
      const nd = { ...data, rounds: [...data.rounds, round], currentRound: rn };
      save(nd);
      setView("round");
      // Discord + notify
      postDiscord("draw", {
        cupName: nd.cupName, roundName: round.name,
        pairings: pairings.map((m) => ({ p1: gp(m.player1Id)?.name || "?", p2: gp(m.player2Id)?.name || "?" })),
        bye: bye ? gp(bye)?.name : null,
      });
      maybeNotifyDraw(nd, identity);
    }, (pairings.length + 1) * 500);
  };

  // ── Deadline / Matchday update
  const updMD = (v) => {
    const r = [...data.rounds];
    const i = r.findIndex((x) => x.roundNumber === data.currentRound);
    if (i >= 0) { r[i] = { ...r[i], matchday: v }; save({ ...data, rounds: r }); }
  };
  const updDeadline = (v) => {
    if (!isAdmin) return;
    const r = [...data.rounds];
    const i = r.findIndex((x) => x.roundNumber === data.currentRound);
    if (i >= 0) { r[i] = { ...r[i], deadline: v || null }; save({ ...data, rounds: r }); }
  };

  // ── Score entry — participants can only edit their own matches
  const canEditScore = (pairing) => {
    if (isAdmin) return true;
    if (!identity) return false;
    const ident = identity.toLowerCase();
    const p1 = gp(pairing.player1Id), p2 = gp(pairing.player2Id);
    return p1?.name.toLowerCase() === ident || p2?.name.toLowerCase() === ident;
  };

  const saveSc = (pid) => {
    const s1 = parseFloat(scInp.s1), s2 = parseFloat(scInp.s2);
    if (isNaN(s1) || isNaN(s2)) return;
    const rounds = [...data.rounds];
    const ri = rounds.findIndex((r) => r.roundNumber === data.currentRound);
    if (ri < 0) return;
    const prs = [...rounds[ri].pairings];
    const pi = prs.findIndex((p) => p.id === pid);
    if (pi < 0) return;
    const existing = prs[pi];
    if (data.config.tiebreakMode === "twoLeg") {
      const key = scInp.leg === 2 ? "leg2" : "leg1";
      prs[pi] = { ...existing, [key]: { score1: s1, score2: s2 } };
      // Aggregate into top-level score for display
      const l1 = key === "leg1" ? { score1: s1, score2: s2 } : existing.leg1;
      const l2 = key === "leg2" ? { score1: s1, score2: s2 } : existing.leg2;
      if (l1 && l2) {
        prs[pi].score1 = (l1.score1 || 0) + (l2.score1 || 0);
        prs[pi].score2 = (l1.score2 || 0) + (l2.score2 || 0);
      } else {
        prs[pi].score1 = null; prs[pi].score2 = null;
      }
    } else {
      prs[pi] = { ...existing, score1: s1, score2: s2 };
    }
    rounds[ri] = { ...rounds[ri], pairings: prs };
    const nd = { ...data, rounds };
    save(nd);
    setEditSc(null); setScInp({ s1: "", s2: "", leg: 1 });
    // Discord result
    if (prs[pi].score1 != null && prs[pi].score2 != null) {
      const p1 = gp(prs[pi].player1Id), p2 = gp(prs[pi].player2Id);
      const winner = prs[pi].score1 > prs[pi].score2 ? p1 : prs[pi].score2 > prs[pi].score1 ? p2 : null;
      postDiscord("result", {
        cupName: nd.cupName, roundName: rounds[ri].name,
        p1: p1?.name, p2: p2?.name, s1: prs[pi].score1, s2: prs[pi].score2,
        winner: winner?.name || "offen (Gleichstand)",
      });
    }
  };

  // ── Complete round (admin only) — resolves tiebreaks
  const compR = () => {
    if (!isAdmin) return;
    const rounds = [...data.rounds];
    const ri = rounds.findIndex((r) => r.roundNumber === data.currentRound);
    if (ri < 0) return;
    const round = rounds[ri];
    if (round.pairings.some((p) => p.score1 == null || p.score2 == null)) return;

    const players = [...data.players];
    const mode = data.config.tiebreakMode;
    const newPairings = round.pairings.map((p) => {
      const p1 = players.find((x) => x.id === p.player1Id);
      const p2 = players.find((x) => x.id === p.player2Id);
      const res = resolveTiebreak(p, p1, p2, mode);
      return { ...p, winner: res.winner || (p.score1 > p.score2 ? p.player1Id : p.score2 > p.score1 ? p.player2Id : null), tiebreakMethod: res.method };
    });

    const eliminated = [];
    newPairings.forEach((p) => {
      if (!p.winner) return;
      const loserId = p.winner === p.player1Id ? p.player2Id : p.player1Id;
      const idx = players.findIndex((x) => x.id === loserId);
      if (idx >= 0) { players[idx] = { ...players[idx], eliminated: true }; eliminated.push(players[idx].name); }
    });
    rounds[ri] = { ...round, pairings: newPairings, status: "completed" };
    const rem = players.filter((p) => !p.eliminated);
    const fin = rem.length <= 1;
    let nd = { ...data, players, rounds, status: fin ? "finished" : "running" };
    if (fin && rem[0]) {
      nd.titleHolder = rem[0].name;
      nd.players = nd.players.map((p) => ({ ...p, isTitleHolder: p.name === rem[0].name }));
    }
    save(nd);
    setView(fin ? "bracket" : "draw");
    setConfirm(null);

    postDiscord("elimination", { cupName: nd.cupName, roundName: round.name, eliminated });
    if (fin && rem[0]) postDiscord("winner", { cupName: nd.cupName, winner: rem[0].name, rounds: rounds.length });

    // Coin-flip visual if any pairing used coinFlip
    const cfMatch = newPairings.find((p) => p.tiebreakMethod && p.tiebreakMethod.includes("Münzwurf"));
    if (cfMatch) {
      const wName = players.find((x) => x.id === cfMatch.winner)?.name;
      setCoinFlip({ winner: wName, method: cfMatch.tiebreakMethod });
      setTimeout(() => setCoinFlip(null), 3500);
    }
  };

  // ── Archive & reset (admin only)
  const archiveCup = () => {
    if (!isAdmin || data.status !== "finished") return;
    const entry = { id: generateId(), name: data.cupName, winner: data.titleHolder, rounds: data.rounds.length, endedAt: new Date().toISOString() };
    save({ ...data, archive: [...data.archive, entry] });
  };
  const resetT = () => {
    if (!isAdmin) return;
    const holder = data.titleHolder;
    save({
      ...init(),
      players: data.players.map((p) => ({ ...p, eliminated: false, isTitleHolder: p.name === holder })),
      cupName: data.cupName, archive: data.archive, titleHolder: holder, config: data.config,
    });
    setView("overview"); setConfirm(null);
  };
  const fullRst = () => { if (!isAdmin) return; save(init()); setCupNm("Kickbase Pokal"); setView("overview"); setConfirm(null); };

  // ── Multi-cup
  const createCup = async () => {
    if (!isAdmin || !newCupName.trim()) return;
    const id = newCupName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) + "-" + Math.random().toString(36).slice(2, 6);
    const payload = { ...init(), cupName: newCupName.trim() };
    const res = await rpcCreate(id, session.hash, payload);
    if (res === true) {
      const list = await listTournaments();
      setTournaments(list);
      setTid(id); setNewCupName("");
    } else alert("Konnte Pokal nicht anlegen");
  };
  const deleteCup = async (delId) => {
    if (!isAdmin || delId === DEFAULT_TID) return;
    if (!window.confirm("Diesen Pokal wirklich löschen?")) return;
    const res = await rpcDelete(delId, session.hash);
    if (res === true) {
      const list = await listTournaments();
      setTournaments(list);
      if (tid === delId) setTid(DEFAULT_TID);
    } else alert("Löschen fehlgeschlagen");
  };

  // ── Password mgmt
  const chgPw = async () => {
    setCpw((p) => ({ ...p, err: "", ok: false }));
    if (cpw.n1.length < 4) { setCpw((p) => ({ ...p, err: "Mind. 4 Zeichen" })); return; }
    if (cpw.n1 !== cpw.n2) { setCpw((p) => ({ ...p, err: "Stimmen nicht überein" })); return; }
    const oh = await hashPassword(cpw.o), nh = await hashPassword(cpw.n1);
    const res = await rpcChangePassword(oh, nh);
    if (isRpcError(res)) { setCpw((p) => ({ ...p, err: `Fehler: ${res.message}` })); return; }
    if (res === true) { setSession({ hash: nh, role: "admin" }); setCpw({ show: false, o: "", n1: "", n2: "", err: "", ok: true }); }
    else setCpw((p) => ({ ...p, err: "Altes Passwort falsch" }));
  };
  const setParticipantPw = async () => {
    setPpw((p) => ({ ...p, err: "", ok: false }));
    if (ppw.v && ppw.v.length < 4) { setPpw((p) => ({ ...p, err: "Mind. 4 Zeichen (oder leer zum Löschen)" })); return; }
    const ph = ppw.v ? await hashPassword(ppw.v) : "";
    const res = await rpcSetParticipantPassword(session.hash, ph);
    if (isRpcError(res)) { setPpw((p) => ({ ...p, err: `Fehler: ${res.message}` })); return; }
    if (res === true) setPpw({ show: false, v: "", err: "", ok: true });
    else setPpw((p) => ({ ...p, err: "Fehler beim Setzen" }));
  };

  const logout = () => { clearSession(); onLogout(); };

  // ── Identity
  const saveIdentity = () => { setIdentity(identityInput.trim()); setIdent(identityInput.trim()); };

  // ── Notifications
  const enableNotifs = async () => {
    const r = await requestNotificationPermission();
    setNotifPerm(r);
    if (r === "granted") notify("Kickbase Pokal", "Benachrichtigungen aktiviert!");
  };

  // ── Predictions
  const submitPrediction = (pairingId, predictedWinnerId) => {
    if (!identity) { alert("Bitte erst einen Nickname in den Einstellungen festlegen."); return; }
    const rounds = [...data.rounds];
    const ri = rounds.findIndex((r) => r.roundNumber === data.currentRound);
    if (ri < 0) return;
    const prs = [...rounds[ri].pairings];
    const pi = prs.findIndex((p) => p.id === pairingId);
    if (pi < 0) return;
    if (prs[pi].score1 != null) return; // Locked after first score
    const existing = (prs[pi].predictions || []).filter((x) => x.userName.toLowerCase() !== identity.toLowerCase());
    prs[pi] = { ...prs[pi], predictions: [...existing, { id: generateId(), userName: identity, predictedWinnerId, ts: new Date().toISOString() }] };
    rounds[ri] = { ...rounds[ri], pairings: prs };
    save({ ...data, rounds });
  };

  const submitComment = (pairingId, txt) => {
    if (!identity || !txt.trim()) return;
    const rounds = [...data.rounds];
    const ri = rounds.findIndex((r) => r.roundNumber === data.currentRound);
    if (ri < 0) return;
    const prs = [...rounds[ri].pairings];
    const pi = prs.findIndex((p) => p.id === pairingId);
    if (pi < 0) return;
    const c = { id: generateId(), author: identity, text: txt.trim().slice(0, 400), ts: new Date().toISOString() };
    prs[pi] = { ...prs[pi], comments: [...(prs[pi].comments || []), c] };
    rounds[ri] = { ...rounds[ri], pairings: prs };
    save({ ...data, rounds });
    setCommentInp({ ...commentInp, [pairingId]: "" });
  };

  // ── Deadline auto-tick
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 30000);
    return () => clearInterval(t);
  }, []);

  if (loading) return <div style={s.lw}><style>{CSS}</style><div style={s.sp} /><p style={s.lt}>Lade Turnier...</p></div>;

  const tabs = [
    { k: "overview", l: "Übersicht", i: "📋" },
    ...(data.status === "setup" && isAdmin ? [{ k: "players", l: "Teilnehmer", i: "👥" }] : []),
    ...(data.status === "running" ? [{ k: "round", l: "Runde", i: "⚔️" }] : []),
    ...(data.status === "running" && isAdmin ? [{ k: "draw", l: "Auslosung", i: "🎲" }] : []),
    ...(data.rounds.length > 0 ? [{ k: "bracket", l: "Turnierbaum", i: "🏆" }, { k: "history", l: "Ergebnisse", i: "📊" }, { k: "stats", l: "Statistik", i: "📈" }] : []),
    ...(data.archive.length > 0 ? [{ k: "archive", l: "Historie", i: "🗄️" }] : []),
    { k: "settings", l: "⚙️", i: "" },
  ];

  return (
    <div style={s.app}><style>{CSS}</style>
      <header style={s.hdr}>
        <div style={s.hdrI}>
          <div style={{ fontSize: 34, marginBottom: 4 }}>🏆</div>
          <h1 style={s.title}>{data.cupName}</h1>
          <p style={s.sub}>{data.status === "setup" ? "Turnierplanung" : data.status === "finished" ? "Abgeschlossen" : `Runde ${data.currentRound} · ${act.length} übrig`}</p>
          <div style={s.conn}>
            <span style={{ ...s.dot, background: LOCAL_MODE ? "#fbbf24" : connected ? "#22c55e" : "#fbbf24" }} />
            <span style={s.connT}>{LOCAL_MODE ? "Lokal (Test)" : connected ? "Live" : "..."}</span>
            {!LOCAL_MODE && <span style={{ fontSize: 10 }}>🔒</span>}
            {sync && <span style={s.syncT}>{sync.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}</span>}
            <span style={{ ...s.roleBadge, background: isAdmin ? "#1b4332" : "#162032", color: isAdmin ? "#4ade80" : "#94a3b8" }}>{isAdmin ? "Admin" : "Teilnehmer"}</span>
          </div>
          {tournaments.length > 1 && (
            <div style={{ marginTop: 10 }}>
              <select style={{ ...s.sel, maxWidth: 260, display: "inline-block" }} value={tid} onChange={(e) => setTid(e.target.value)}>
                {tournaments.map((t) => <option key={t.id} value={t.id}>{t.name} {t.status === "finished" ? "🏆" : ""}</option>)}
              </select>
            </div>
          )}
        </div>
        <div style={s.glow} />
      </header>

      {W && <>
        <BigConfetti />
        <div style={s.wB}>
          <div style={s.wCf}>{[...Array(16)].map((_, i) => <span key={i} style={{ ...s.wP, left: `${4 + i * 6}%`, animationDelay: `${i * .1}s`, background: ["#00e676", "#ffd700", "#ff4081", "#448aff", "#ff9100"][i % 5] }} />)}</div>
          <div style={s.wCt}>
            <span style={{ fontSize: 44, animation: "crownBounce 2s infinite" }}>👑</span>
            <span style={s.wN}>{W.name}</span>
            <span style={s.wL}>Pokalsieger!</span>
          </div>
        </div>
      </>}

      {coinFlip && (
        <div style={s.ov} onClick={() => setCoinFlip(null)}>
          <div style={{ ...s.mo, textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 56, display: "inline-block", animation: "coinFlip 2s ease-out forwards", margin: "14px 0" }}>🪙</div>
            <h3 style={s.moT}>Münzwurf-Entscheidung</h3>
            <p style={s.moTx}>{coinFlip.method} → <b style={{ color: "#00e676" }}>{coinFlip.winner}</b></p>
          </div>
        </div>
      )}

      <nav style={s.nav}>{tabs.map((t) => <button key={t.k} className="tab" onClick={() => setView(t.k)} style={{ ...s.tab, ...(view === t.k ? s.tabA : {}) }}>{t.i && <span style={{ marginRight: 3 }}>{t.i}</span>}{t.l}</button>)}</nav>

      <main style={s.main}>
        {/* ═══ BRACKET ═══ */}
        {view === "bracket" && (
          <div style={s.fade}>
            <div style={{ ...s.card, padding: 12 }} className="card">
              <h2 style={{ ...s.cT, marginBottom: 6 }}>Turnierbaum</h2>
              <Bracket data={data} gp={gp} />
            </div>
          </div>
        )}

        {/* ═══ OVERVIEW ═══ */}
        {view === "overview" && <div style={s.fade}>
          {data.status === "setup" && isAdmin && <>
            <div style={s.card} className="card">
              <h2 style={s.cT}>Turniersetup</h2>
              <div style={s.fl}><label style={s.lb}>Pokaltitel</label><input style={s.inp} value={cupNm} onChange={(e) => setCupNm(e.target.value)} placeholder="z.B. Kickbase Pokal 25/26" /></div>
              <div style={s.fl}><label style={s.lb}>Gleichstand-Regel</label>
                <select style={s.sel} value={data.config.tiebreakMode} onChange={(e) => save({ ...data, config: { ...data.config, tiebreakMode: e.target.value } })}>
                  <option value="marketValue">Höherer Marktwert</option>
                  <option value="coinFlip">Münzwurf</option>
                  <option value="twoLeg">Hin- & Rückrunde</option>
                </select>
              </div>
              <div style={s.fl}><label style={{ ...s.lb, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <input type="checkbox" checked={data.config.useSeeding} onChange={(e) => save({ ...data, config: { ...data.config, useSeeding: e.target.checked } })} />
                Setzliste verwenden (starke Spieler treffen später aufeinander)
              </label></div>
              <div style={s.sr}>
                <div style={s.st}><span style={s.sn}>{data.players.length}</span><span style={s.sl}>Teilnehmer</span></div>
                <div style={s.st}><span style={s.sn}>{data.players.length < 2 ? "–" : Math.ceil(Math.log2(data.players.length))}</span><span style={s.sl}>Runden</span></div>
              </div>
              <button className="btn" style={{ ...s.bP, opacity: data.players.length < 2 ? .4 : 1 }} disabled={data.players.length < 2} onClick={startT}>🏆 Starten ({data.players.length})</button>
              {data.players.length < 2 && <p style={s.hint}>Mind. 2 Teilnehmer</p>}
            </div>
            <div style={{ ...s.card, marginTop: 12 }} className="card">
              <h3 style={s.cS}>Schnell hinzufügen</h3>
              <div style={s.ar}>
                <input style={{ ...s.inp, flex: 2 }} placeholder="Name" value={np.name} onChange={(e) => setNp({ ...np, name: e.target.value })} onKeyDown={(e) => e.key === "Enter" && addP()} />
                <input style={{ ...s.inp, flex: 1 }} placeholder="Liga" value={np.league} onChange={(e) => setNp({ ...np, league: e.target.value })} onKeyDown={(e) => e.key === "Enter" && addP()} />
                <button className="btn" style={s.bA} onClick={addP}>+</button>
              </div>
            </div>
          </>}
          {data.status === "setup" && !isAdmin && (
            <div style={s.card} className="card">
              <h2 style={s.cT}>Warte auf Admin</h2>
              <p style={s.info}>Der Admin richtet das Turnier ein. Du siehst hier, sobald es losgeht.</p>
            </div>
          )}
          {data.status === "running" && (
            <div style={s.card} className="card">
              <h2 style={s.cT}>Status</h2>
              <div style={s.sr}>
                <div style={s.st}><span style={s.sn}>{data.players.length}</span><span style={s.sl}>Gesamt</span></div>
                <div style={s.st}><span style={s.sn}>{act.length}</span><span style={s.sl}>Dabei</span></div>
                <div style={s.st}><span style={s.sn}>{data.currentRound}</span><span style={s.sl}>Runde</span></div>
              </div>
              <h3 style={{ ...s.cS, marginTop: 14 }}>Noch dabei</h3>
              <div style={s.cps}>{act.map((p) => <span key={p.id} style={s.cp}><Av p={p} size={16} />{p.name}{p.isTitleHolder && <span style={s.tdB}>TV</span>}{p.league && <span style={s.cpL}>{p.league}</span>}</span>)}</div>
            </div>
          )}
          {data.status === "finished" && (
            <div style={s.card} className="card">
              <h2 style={s.cT}>Beendet</h2>
              <p style={s.fT}>{data.cupName} — {data.rounds.length} Runde(n)</p>
              <button className="btn" style={{ ...s.bS, marginTop: 10 }} onClick={() => setView("bracket")}>🏆 Turnierbaum</button>
              {isAdmin && <button className="btn" style={{ ...s.bS, marginTop: 8 }} onClick={archiveCup}>🗄️ In Historie verschieben</button>}
            </div>
          )}
        </div>}

        {/* ═══ PLAYERS ═══ */}
        {view === "players" && data.status === "setup" && isAdmin && <div style={s.fade}>
          <div style={s.card} className="card">
            <h2 style={s.cT}>Teilnehmer</h2>
            <div style={s.ar}>
              <input style={{ ...s.inp, flex: 2 }} placeholder="Name" value={np.name} onChange={(e) => setNp({ ...np, name: e.target.value })} onKeyDown={(e) => e.key === "Enter" && addP()} />
              <input style={{ ...s.inp, flex: 1 }} placeholder="Liga" value={np.league} onChange={(e) => setNp({ ...np, league: e.target.value })} />
              <button className="btn" style={s.bA} onClick={addP}>+</button>
            </div>
            <div style={s.ar}>
              <input style={{ ...s.inp, flex: 1 }} type="number" placeholder="Marktwert (€)" value={np.marketValue} onChange={(e) => setNp({ ...np, marketValue: e.target.value })} />
              <input style={{ ...s.inp, flex: 1 }} placeholder="Avatar (Emoji/URL)" value={np.avatar} onChange={(e) => setNp({ ...np, avatar: e.target.value })} />
              <input style={{ ...s.inp, flex: 1 }} type="number" placeholder="Seed" value={np.seed} onChange={(e) => setNp({ ...np, seed: e.target.value })} />
            </div>
            <button style={s.bTx} onClick={() => setShowImp(!showImp)}>{showImp ? "Schließen" : "📋 Importieren (Name, Liga, Marktwert, Avatar, Seed)"}</button>
            {showImp && <div style={{ marginTop: 6 }}>
              <textarea style={s.ta} rows={5} placeholder={"Name, Liga, Marktwert, Avatar, Seed\nMax, Liga A, 150000000, 🦁, 90"} value={impTxt} onChange={(e) => setImpTxt(e.target.value)} />
              <button className="btn" style={{ ...s.bS, marginTop: 6 }} onClick={importP}>Importieren</button>
            </div>}
          </div>
          {data.players.length > 0 && <div style={{ ...s.card, marginTop: 12 }} className="card">
            <h3 style={s.cS}>{data.players.length} Teilnehmer</h3>
            {data.players.map((p, i) => (
              <div key={p.id} style={s.pR}>
                <span style={s.pN}>{i + 1}</span>
                <Av p={p} size={22} />
                <span style={s.pNm}>
                  {p.name}
                  {p.isTitleHolder && <span style={s.tdB}>🏆 Titelverteidiger</span>}
                </span>
                {p.league && <span style={s.lB}>{p.league}</span>}
                {p.marketValue > 0 && <span style={{ ...s.lB, background: "#1a2a3a", color: "#94a3b8" }}>{(p.marketValue / 1e6).toFixed(1)}M €</span>}
                {p.seed > 0 && <span style={{ ...s.lB, background: "#2a1a3a", color: "#c084fc" }}>#{p.seed}</span>}
                <button style={s.bRm} title="Titelverteidiger" onClick={() => setTitleHolder(p.id)}>🏆</button>
                <button style={s.bRm} onClick={() => remP(p.id)}>✕</button>
              </div>
            ))}
          </div>}
        </div>}

        {/* ═══ DRAW ═══ */}
        {view === "draw" && data.status === "running" && isAdmin && <div style={s.fade}>
          <div style={s.card} className="card">
            <h2 style={s.cT}>🎲 Auslosung — {getRoundName(act.length, data.currentRound + 1)}</h2>
            <p style={s.dI}>{act.length} → {Math.floor(act.length / 2)} Duelle{act.length % 2 === 1 && " + 1 Freilos"}</p>
            {data.config.useSeeding && <p style={{ ...s.hint, color: "#00e676" }}>📊 Setzliste aktiv</p>}
            {cr?.status === "active" ? <p style={s.hint}>Runde läuft noch — erst Punkte eintragen & abschließen.</p>
              : animDraw ? <div>
                <p style={{ ...s.dI, color: "#00e676", animation: "pulse 1s infinite" }}>Lose werden gezogen...</p>
                {drawn.map((p) => { const p1 = gp(p.player1Id), p2 = gp(p.player2Id); return (
                  <div key={p.id} style={{ ...s.drP, animation: "drawReveal .4s ease-out forwards" }}>
                    <Av p={p1} size={20} /><span style={s.drN}>{p1?.name}</span>
                    <span style={s.vsT}>vs</span>
                    <span style={s.drN}>{p2?.name}</span><Av p={p2} size={20} />
                  </div>
                ); })}
              </div>
              : <button className="btn" style={s.bP} onClick={drawR}>🎲 Jetzt auslosen!</button>}
          </div>
        </div>}
        {view === "draw" && !isAdmin && <div style={s.fade}><div style={s.card} className="card"><p style={s.info}>Nur Admins können auslosen.</p></div></div>}

        {/* ═══ ROUND ═══ */}
        {view === "round" && cr && <div style={s.fade}>
          <div style={s.card} className="card">
            <div style={s.rH}>
              <h2 style={s.cT}>{cr.name}</h2>
              <span style={{ ...s.bdg, background: cr.status === "completed" ? "#1b4332" : "#1a2e1a", color: cr.status === "completed" ? "#4ade80" : "#00e676" }}>{cr.status === "completed" ? "✓" : "●"}</span>
            </div>
            <div style={s.fl}><label style={s.lb}>Spieltag</label><input style={s.inp} placeholder="Spieltag 15" value={cr.matchday} onChange={(e) => updMD(e.target.value)} disabled={cr.status === "completed" || !isAdmin} /></div>
            {isAdmin && cr.status === "active" && (
              <div style={s.fl}><label style={s.lb}>Deadline (Punkte-Eintrag bis)</label><input type="datetime-local" style={s.inp} value={cr.deadline ? cr.deadline.slice(0, 16) : ""} onChange={(e) => updDeadline(e.target.value ? new Date(e.target.value).toISOString() : null)} /></div>
            )}
            {cr.deadline && <DeadlineBar deadline={cr.deadline} onPing={() => {
              const missing = cr.pairings.filter((p) => p.score1 == null).map((p) => `${gp(p.player1Id)?.name} vs ${gp(p.player2Id)?.name}`).join(", ");
              postDiscord("deadline", { cupName: data.cupName, roundName: cr.name, deadline: formatDeadline(cr.deadline), missing });
            }} isAdmin={isAdmin} />}
            {data.config.tiebreakMode === "twoLeg" && <p style={{ ...s.hint, color: "#a855f7" }}>Modus: Hin- & Rückrunde</p>}
          </div>
          {cr.pairings.map((p) => {
            const p1 = gp(p.player1Id), p2 = gp(p.player2Id);
            const d = p.score1 !== null && p.score2 !== null;
            const ed = editSc === p.id;
            const canEdit = canEditScore(p);
            const expanded = expandedMatch === p.id;
            const myPrediction = (p.predictions || []).find((x) => x.userName.toLowerCase() === identity.toLowerCase());
            const predStats = (p.predictions || []).reduce((a, pr) => { a[pr.predictedWinnerId] = (a[pr.predictedWinnerId] || 0) + 1; return a; }, {});
            return (
              <div key={p.id} style={s.mC}>
                <div style={s.mI}>
                  <div style={{ ...s.mP, background: d && p.score1 > p.score2 ? "#0a2e1a" : "transparent", borderRadius: 8, padding: "7px 10px" }}>
                    <span style={s.mN}><Av p={p1} size={20} />{p1?.name}{p1?.isTitleHolder && <span style={s.tdB}>TV</span>}</span>
                    {p1?.league && <span style={s.mLg}>{p1.league}</span>}
                    {d && <span style={{ ...s.mS, color: p.score1 > p.score2 ? "#00e676" : p.score1 < p.score2 ? "#ef4444" : "#fbbf24" }}>{p.score1}</span>}
                  </div>
                  <div style={s.vsC}>VS</div>
                  <div style={{ ...s.mP, background: d && p.score2 > p.score1 ? "#0a2e1a" : "transparent", borderRadius: 8, padding: "7px 10px" }}>
                    <span style={s.mN}><Av p={p2} size={20} />{p2?.name}{p2?.isTitleHolder && <span style={s.tdB}>TV</span>}</span>
                    {p2?.league && <span style={s.mLg}>{p2.league}</span>}
                    {d && <span style={{ ...s.mS, color: p.score2 > p.score1 ? "#00e676" : p.score2 < p.score1 ? "#ef4444" : "#fbbf24" }}>{p.score2}</span>}
                  </div>
                </div>
                {p.tiebreakMethod && <p style={{ fontSize: 10, color: "#fbbf24", marginTop: 4, textAlign: "center" }}>⚖️ {p.tiebreakMethod}</p>}

                {data.config.tiebreakMode === "twoLeg" && (p.leg1 || p.leg2) && (
                  <div style={{ fontSize: 10, color: "#64748b", textAlign: "center", marginTop: 3 }}>
                    Hin: {p.leg1 ? `${p.leg1.score1} : ${p.leg1.score2}` : "–"} · Rück: {p.leg2 ? `${p.leg2.score1} : ${p.leg2.score2}` : "–"}
                  </div>
                )}

                {cr.status !== "completed" && canEdit && (ed ? (
                  <div style={s.sE}>
                    {data.config.tiebreakMode === "twoLeg" && (
                      <div style={s.chipRow}>
                        <span style={{ ...s.chip, ...(scInp.leg === 1 ? s.chipA : {}) }} onClick={() => setScInp({ ...scInp, leg: 1 })}>Hinrunde</span>
                        <span style={{ ...s.chip, ...(scInp.leg === 2 ? s.chipA : {}) }} onClick={() => setScInp({ ...scInp, leg: 2 })}>Rückrunde</span>
                      </div>
                    )}
                    <div style={s.sR}>
                      <div style={{ flex: 1 }}><label style={s.sLb}>{p1?.name}</label><input type="number" step="0.01" style={s.sI} placeholder="Punkte" value={scInp.s1} onChange={(e) => setScInp({ ...scInp, s1: e.target.value })} /></div>
                      <div style={{ flex: 1 }}><label style={s.sLb}>{p2?.name}</label><input type="number" step="0.01" style={s.sI} placeholder="Punkte" value={scInp.s2} onChange={(e) => setScInp({ ...scInp, s2: e.target.value })} /></div>
                    </div>
                    <div style={s.sA}>
                      <button className="btn" style={s.bS} onClick={() => setEditSc(null)}>Abbrechen</button>
                      <button className="btn" style={s.bP} onClick={() => saveSc(p.id)}>Speichern</button>
                    </div>
                  </div>
                ) : (
                  <button className="btn" style={s.bEn} onClick={() => {
                    setEditSc(p.id);
                    const leg = data.config.tiebreakMode === "twoLeg" && p.leg1 ? 2 : 1;
                    const src = data.config.tiebreakMode === "twoLeg" ? (leg === 2 ? p.leg2 : p.leg1) : p;
                    setScInp({ s1: src?.score1 != null ? String(src.score1) : "", s2: src?.score2 != null ? String(src.score2) : "", leg });
                  }}>{d ? "✏️ Ändern" : "📝 Punkte eintragen"}</button>
                ))}

                {cr.status !== "completed" && !canEdit && !isAdmin && (
                  <p style={{ ...s.hint, fontSize: 10 }}>Nur {p1?.name} oder {p2?.name} können Punkte eintragen.</p>
                )}

                <button style={{ ...s.bTx, marginTop: 6, color: "#64748b" }} onClick={() => setExpandedMatch(expanded ? null : p.id)}>
                  {expanded ? "▲ zuklappen" : `▼ Tipps (${(p.predictions || []).length}) · Chat (${(p.comments || []).length})`}
                </button>

                {expanded && (
                  <div style={{ marginTop: 8, padding: 10, background: "#0d1520", borderRadius: 10 }}>
                    {/* Predictions */}
                    {!d && cr.status === "active" && (
                      <div style={{ marginBottom: 10 }}>
                        <label style={s.lb}>Dein Tipp</label>
                        <div style={s.chipRow}>
                          <span style={{ ...s.chip, ...(myPrediction?.predictedWinnerId === p.player1Id ? s.chipA : {}) }} onClick={() => submitPrediction(p.id, p.player1Id)}>{p1?.name}</span>
                          <span style={{ ...s.chip, ...(myPrediction?.predictedWinnerId === p.player2Id ? s.chipA : {}) }} onClick={() => submitPrediction(p.id, p.player2Id)}>{p2?.name}</span>
                        </div>
                      </div>
                    )}
                    {(p.predictions || []).length > 0 && (
                      <div style={{ marginBottom: 10, fontSize: 11, color: "#94a3b8" }}>
                        {Object.entries(predStats).map(([pid, c]) => (
                          <span key={pid} style={{ marginRight: 8 }}>{gp(pid)?.name}: <b style={{ color: "#00e676" }}>{c}</b></span>
                        ))}
                      </div>
                    )}
                    {/* Comments */}
                    <label style={s.lb}>Chat / Trash-Talk</label>
                    <div style={{ maxHeight: 200, overflowY: "auto", marginBottom: 6 }}>
                      {(p.comments || []).map((c) => (
                        <div key={c.id} style={s.commentRow}>
                          <div style={{ ...s.avatar, width: 22, height: 22, fontSize: 10 }}>{(c.author || "?")[0]?.toUpperCase()}</div>
                          <div style={s.commentBody}>
                            <div style={s.commentAuthor}>{c.author} · {new Date(c.ts).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}</div>
                            {c.text}
                          </div>
                        </div>
                      ))}
                      {(p.comments || []).length === 0 && <p style={{ ...s.info, fontStyle: "italic" }}>Noch keine Nachrichten.</p>}
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <input style={{ ...s.inp, flex: 1 }} placeholder={identity ? "Nachricht..." : "Erst Nickname in ⚙️ setzen"} value={commentInp[p.id] || ""} disabled={!identity} onChange={(e) => setCommentInp({ ...commentInp, [p.id]: e.target.value })} onKeyDown={(e) => e.key === "Enter" && submitComment(p.id, commentInp[p.id] || "")} />
                      <button className="btn" style={s.bS} disabled={!identity} onClick={() => submitComment(p.id, commentInp[p.id] || "")}>▶</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {cr.bye && <div style={s.byC}>🎫 {gp(cr.bye)?.name} — Freilos</div>}
          {cr.status === "active" && isAdmin && <button className="btn" style={{ ...s.bCp, opacity: allScoresDone ? 1 : .4 }} disabled={!allScoresDone} onClick={() => setConfirm("complete")}>✓ Runde abschließen</button>}
          {cr.status === "active" && !allScoresDone && isAdmin && <p style={s.hint}>Alle Duelle müssen klaren Sieger haben (Gleichstand wird beim Abschluss entschieden)</p>}
        </div>}

        {/* ═══ HISTORY ═══ */}
        {view === "history" && <div style={s.fade}>{[...data.rounds].reverse().map((r) => (
          <div key={r.roundNumber} style={{ ...s.card, marginBottom: 12 }} className="card">
            <div style={s.rH}>
              <h2 style={s.cT}>{r.name}{r.matchday && <span style={s.mdt}>{r.matchday}</span>}</h2>
              <span style={{ ...s.bdg, background: r.status === "completed" ? "#1b4332" : "#1a2e1a", color: r.status === "completed" ? "#4ade80" : "#00e676" }}>{r.status === "completed" ? "✓" : "●"}</span>
            </div>
            {r.pairings.map((p) => {
              const p1 = gp(p.player1Id), p2 = gp(p.player2Id);
              const d = p.score1 != null && p.score2 != null;
              const w = p.winner;
              return (
                <div key={p.id} style={s.hP}>
                  <span style={{ ...s.hN, fontWeight: w === p.player1Id ? 700 : 400, color: w === p.player1Id ? "#00e676" : "#cbd5e1" }}>{p1?.name}</span>
                  <span style={s.hS}>{d ? `${p.score1} : ${p.score2}` : "– : –"}{p.tiebreakMethod && <span style={{ fontSize: 9, color: "#fbbf24", display: "block" }}>⚖️</span>}</span>
                  <span style={{ ...s.hN, textAlign: "right", fontWeight: w === p.player2Id ? 700 : 400, color: w === p.player2Id ? "#00e676" : "#cbd5e1" }}>{p2?.name}</span>
                </div>
              );
            })}
            {r.bye && <div style={s.hB}>🎫 {gp(r.bye)?.name} — Freilos</div>}
          </div>
        ))}</div>}

        {/* ═══ STATS ═══ */}
        {view === "stats" && <div style={s.fade}>
          <div style={s.card} className="card">
            <h2 style={s.cT}>📈 Statistik</h2>
            <div style={s.sr}>
              <div style={s.st}><span style={s.sn}>{stats.matchCount}</span><span style={s.sl}>Duelle</span></div>
              <div style={s.st}><span style={s.sn}>{data.rounds.length}</span><span style={s.sl}>Runden</span></div>
              <div style={s.st}><span style={s.sn}>{data.players.length}</span><span style={s.sl}>Spieler</span></div>
            </div>
          </div>
          <div style={{ ...s.card, marginTop: 12 }} className="card">
            <h3 style={s.cS}>🔥 Rundenrekord</h3>
            {stats.topRoundScore.playerId ? (
              <p style={{ fontSize: 13, color: "#e2e8f0" }}><b style={{ color: "#00e676" }}>{gp(stats.topRoundScore.playerId)?.name}</b> — <b>{stats.topRoundScore.value}</b> Punkte in Runde {stats.topRoundScore.roundNumber}{stats.topRoundScore.matchday && ` (${stats.topRoundScore.matchday})`}</p>
            ) : <p style={s.info}>Noch keine Ergebnisse.</p>}
          </div>
          <div style={{ ...s.card, marginTop: 12 }} className="card">
            <h3 style={s.cS}>💥 Höchster Sieg</h3>
            {stats.biggestWin.winnerId ? (
              <p style={{ fontSize: 13, color: "#e2e8f0" }}><b style={{ color: "#00e676" }}>{gp(stats.biggestWin.winnerId)?.name}</b> schlägt <b>{gp(stats.biggestWin.loserId)?.name}</b> mit <b>{stats.biggestWin.s1} : {stats.biggestWin.s2}</b> (Diff. {stats.biggestWin.diff})</p>
            ) : <p style={s.info}>Noch kein Duell.</p>}
          </div>
          <div style={{ ...s.card, marginTop: 12 }} className="card">
            <h3 style={s.cS}>📊 Durchschnittspunkte</h3>
            {stats.avg.length ? stats.avg.map((x, i) => (
              <div key={x.player.id} style={s.pR}>
                <span style={s.pN}>{i + 1}</span>
                <Av p={x.player} size={22} />
                <span style={s.pNm}>{x.player.name}</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#00e676", fontFamily: "'Bebas Neue',sans-serif", letterSpacing: 1 }}>{x.avg.toFixed(1)}</span>
              </div>
            )) : <p style={s.info}>Noch keine Daten.</p>}
          </div>
        </div>}

        {/* ═══ ARCHIVE ═══ */}
        {view === "archive" && <div style={s.fade}>
          <div style={s.card} className="card">
            <h2 style={s.cT}>🗄️ Pokal-Historie</h2>
            {data.archive.length === 0 && <p style={s.info}>Noch keine archivierten Pokale.</p>}
            {[...data.archive].reverse().map((e) => (
              <div key={e.id} style={s.pR}>
                <span style={{ fontSize: 20 }}>🏆</span>
                <span style={s.pNm}>{e.name}</span>
                <span style={s.lB}>{e.rounds} Runden</span>
                <span style={{ fontSize: 11, color: "#00e676", fontWeight: 700 }}>{e.winner || "–"}</span>
                <span style={{ fontSize: 10, color: "#475569" }}>{new Date(e.endedAt).toLocaleDateString("de-DE")}</span>
              </div>
            ))}
          </div>
        </div>}

        {/* ═══ SETTINGS ═══ */}
        {view === "settings" && <div style={s.fade}>
          <div style={s.card} className="card">
            <h3 style={s.cS}>🪪 Identität (für Tipps & Chat)</h3>
            <div style={{ display: "flex", gap: 6 }}>
              <input style={{ ...s.inp, flex: 1 }} placeholder="Dein Name (wie bei Teilnehmer-Eintrag)" value={identityInput} onChange={(e) => setIdentityInput(e.target.value)} />
              <button className="btn" style={s.bS} onClick={saveIdentity}>💾</button>
            </div>
            {identity && <p style={{ ...s.info, marginTop: 6 }}>Du bist: <b style={{ color: "#00e676" }}>{identity}</b></p>}
          </div>

          <div style={{ ...s.card, marginTop: 12 }} className="card">
            <h3 style={s.cS}>🔔 Benachrichtigungen</h3>
            <p style={s.info}>Push-Hinweis wenn du ausgelost wirst oder die Deadline naht.</p>
            {notifPerm === "granted" ? <p style={{ ...s.info, color: "#4ade80", marginTop: 6 }}>✓ Aktiv</p>
              : notifPerm === "denied" ? <p style={{ ...s.info, color: "#ef4444", marginTop: 6 }}>Verweigert — in den Browser-Einstellungen freigeben.</p>
              : <button className="btn" style={{ ...s.bS, marginTop: 8 }} onClick={enableNotifs}>Aktivieren</button>}
          </div>

          {isAdmin && <div style={{ ...s.card, marginTop: 12 }} className="card">
            <h3 style={s.cS}>🏆 Mehrere Pokale</h3>
            <div style={{ marginBottom: 8 }}>
              {tournaments.map((t) => (
                <div key={t.id} style={s.pR}>
                  <span style={s.pNm}>{t.name}</span>
                  <span style={s.lB}>{t.status}</span>
                  {t.id !== tid && <button style={s.bRm} onClick={() => setTid(t.id)}>→</button>}
                  {t.id !== DEFAULT_TID && <button style={{ ...s.bRm, color: "#ef4444" }} onClick={() => deleteCup(t.id)}>🗑</button>}
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <input style={{ ...s.inp, flex: 1 }} placeholder="Neuer Pokal-Titel" value={newCupName} onChange={(e) => setNewCupName(e.target.value)} />
              <button className="btn" style={s.bS} onClick={createCup}>+ Neu</button>
            </div>
          </div>}

          {isAdmin && <div style={{ ...s.card, marginTop: 12 }} className="card">
            <h2 style={s.cT}>Einstellungen</h2>
            {data.status !== "setup" && <button className="btn" style={{ ...s.bD, marginBottom: 10 }} onClick={() => setConfirm("reset")}>🔄 Reset (Teilnehmer behalten)</button>}
            <button className="btn" style={s.bD} onClick={() => setConfirm("full")}>🗑️ Alles löschen</button>
          </div>}

          {!LOCAL_MODE && isAdmin && <div style={{ ...s.card, marginTop: 12 }} className="card">
            <h3 style={s.cS}>🔐 Admin-Passwort ändern</h3>
            {cpw.show ? <>
              <div style={s.fl}><label style={s.lb}>Altes Passwort</label><input type="password" style={s.inp} value={cpw.o} onChange={(e) => setCpw((p) => ({ ...p, o: e.target.value }))} /></div>
              <div style={s.fl}><label style={s.lb}>Neues Passwort</label><input type="password" style={s.inp} value={cpw.n1} onChange={(e) => setCpw((p) => ({ ...p, n1: e.target.value }))} placeholder="Mind. 4 Zeichen" /></div>
              <div style={s.fl}><label style={s.lb}>Bestätigen</label><input type="password" style={s.inp} value={cpw.n2} onChange={(e) => setCpw((p) => ({ ...p, n2: e.target.value }))} /></div>
              {cpw.err && <p style={{ fontSize: 12, color: "#ef4444", marginBottom: 8 }}>{cpw.err}</p>}
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn" style={s.bS} onClick={() => setCpw({ show: false, o: "", n1: "", n2: "", err: "", ok: false })}>Abbrechen</button>
                <button className="btn" style={s.bP} onClick={chgPw}>Ändern</button>
              </div>
            </> : <button className="btn" style={s.bS} onClick={() => setCpw((p) => ({ ...p, show: true }))}>Passwort ändern</button>}
          </div>}

          {!LOCAL_MODE && isAdmin && <div style={{ ...s.card, marginTop: 12 }} className="card">
            <h3 style={s.cS}>👥 Teilnehmer-Passwort</h3>
            <p style={s.info}>Mit diesem PW können Teilnehmer ihre eigenen Punkte eintragen, aber nicht auslosen oder Runden abschließen.</p>
            {ppw.show ? <>
              <div style={s.fl}><label style={s.lb}>Teilnehmer-Passwort (leer = deaktivieren)</label><input type="password" style={s.inp} value={ppw.v} onChange={(e) => setPpw((p) => ({ ...p, v: e.target.value }))} placeholder="Mind. 4 Zeichen" /></div>
              {ppw.err && <p style={{ fontSize: 12, color: "#ef4444", marginBottom: 8 }}>{ppw.err}</p>}
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn" style={s.bS} onClick={() => setPpw({ show: false, v: "", err: "", ok: false })}>Abbrechen</button>
                <button className="btn" style={s.bP} onClick={setParticipantPw}>Speichern</button>
              </div>
            </> : <button className="btn" style={s.bS} onClick={() => setPpw((p) => ({ ...p, show: true }))}>Teilnehmer-Passwort setzen</button>}
          </div>}

          {!LOCAL_MODE && <div style={{ ...s.card, marginTop: 12 }} className="card">
            <h3 style={s.cS}>Session</h3>
            <p style={s.info}>Tab schließen = automatisch ausgeloggt.</p>
            <button className="btn" style={{ ...s.bS, marginTop: 8 }} onClick={logout}>🚪 Ausloggen</button>
          </div>}
        </div>}
      </main>

      {confirm && <div style={s.ov} onClick={() => setConfirm(null)}>
        <div style={s.mo} onClick={(e) => e.stopPropagation()}>
          <h3 style={s.moT}>{confirm === "complete" ? "Runde abschließen?" : "Zurücksetzen?"}</h3>
          <p style={s.moTx}>{confirm === "complete" ? "Verlierer werden eliminiert. Gleichstände werden per Regel entschieden." : confirm === "reset" ? "Verlauf weg, Teilnehmer bleiben." : "Alles wird gelöscht."}</p>
          <div style={s.moA}>
            <button className="btn" style={s.bS} onClick={() => setConfirm(null)}>Abbrechen</button>
            <button className="btn" style={confirm === "complete" ? s.bP : s.bD} onClick={() => { if (confirm === "complete") compR(); else if (confirm === "reset") resetT(); else fullRst(); }}>{confirm === "complete" ? "Abschließen" : "Löschen"}</button>
          </div>
        </div>
      </div>}
    </div>
  );
}

/* ═══════════════════ DEADLINE BAR ═══════════════════ */
function DeadlineBar({ deadline, onPing, isAdmin }) {
  const tu = timeUntil(deadline);
  if (!tu) return null;
  return (
    <div style={s.deadlineBar}>
      <span style={s.deadlineLabel}>⏰ Deadline</span>
      <span style={{ ...s.deadlineTime, ...(tu.past ? s.deadlinePast : {}) }}>{formatDeadline(deadline)}</span>
      <span style={{ fontSize: 11, color: tu.past ? "#ef4444" : "#64748b" }}>{tu.label}</span>
      {isAdmin && !tu.past && <button className="btn" style={{ ...s.bS, marginLeft: "auto", padding: "4px 10px", fontSize: 11 }} onClick={onPing}>📣 Erinnerung</button>}
    </div>
  );
}

/* ═══════════════════ NOTIFY ═══════════════════ */
function maybeNotifyDraw(data, identity) {
  if (!identity) return;
  const cr = data.rounds.find((r) => r.roundNumber === data.currentRound);
  if (!cr || cr.status !== "active") return;
  const ident = identity.toLowerCase();
  const me = data.players.find((p) => p.name.toLowerCase() === ident);
  if (!me) return;
  const myMatch = cr.pairings.find((p) => p.player1Id === me.id || p.player2Id === me.id);
  if (!myMatch) return;
  // Deduplicate per round
  const key = `kb-notif-${data.currentRound}-${myMatch.id}`;
  if (sessionStorage.getItem(key)) return;
  sessionStorage.setItem(key, "1");
  const opp = myMatch.player1Id === me.id ? data.players.find((p) => p.id === myMatch.player2Id) : data.players.find((p) => p.id === myMatch.player1Id);
  notify(`${data.cupName} — ${cr.name}`, `Du spielst gegen ${opp?.name || "?"}${cr.deadline ? ` — Deadline: ${formatDeadline(cr.deadline)}` : ""}`);
}

/* ═══════════════════ ROOT ═══════════════════ */
export default function App() {
  const [session, setSessionState] = useState(LOCAL_MODE ? { hash: "local", role: "admin" } : null);
  if (!session) return <PasswordGate onAuth={setSessionState} />;
  return <Tournament session={session} onLogout={() => setSessionState(null)} />;
}
