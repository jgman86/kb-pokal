import { useRef, useEffect, useMemo } from "react";
import { bk } from "./styles.js";

// Avatar circle (used inside bracket slots)
function Av({ p, size = 18 }) {
  if (!p) return null;
  const init = (p.name || "?").trim().slice(0, 1).toUpperCase();
  if (p.avatar && /^https?:\/\//.test(p.avatar)) {
    return <span style={{ display: "inline-flex", width: size, height: size, borderRadius: "50%", overflow: "hidden", flexShrink: 0, border: "1px solid #334155" }}><img src={p.avatar} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /></span>;
  }
  if (p.avatar && p.avatar.length <= 4) {
    return <span style={{ display: "inline-flex", width: size, height: size, borderRadius: "50%", background: "#1e293b", alignItems: "center", justifyContent: "center", fontSize: size * 0.55, flexShrink: 0 }}>{p.avatar}</span>;
  }
  return <span style={{ display: "inline-flex", width: size, height: size, borderRadius: "50%", background: "linear-gradient(135deg,#1e293b,#334155)", alignItems: "center", justifyContent: "center", fontSize: size * 0.5, fontWeight: 700, color: "#cbd5e1", flexShrink: 0 }}>{init}</span>;
}

const COL_W = 200;
const COL_GAP = 28;
const SLOT_H = 70;
const SLOT_GAP = 14;
const HEADER_H = 52;

export function Bracket({ data, gp, onMatchClick }) {
  const rounds = data.rounds || [];
  const W = data.status === "finished" ? data.players.find((p) => !p.eliminated) : null;
  const cols = W ? rounds.length + 1 : rounds.length;

  const scrollRef = useRef(null);

  // Compute slot positions per round — natural (readable) size, no scaling.
  const layout = useMemo(() => {
    const positions = []; // [col][pairIdx] -> {x, y, h}
    const rCols = rounds.map((r) => r.pairings.length || 1);
    const maxPairs = Math.max(1, ...rCols);
    const canvasH = maxPairs * (SLOT_H + SLOT_GAP) + 20;
    rounds.forEach((r, ci) => {
      const n = r.pairings.length || 1;
      const spacing = (canvasH - 20) / n;
      const arr = r.pairings.map((_, i) => {
        const y = 10 + i * spacing + (spacing - SLOT_H) / 2;
        return { x: ci * (COL_W + COL_GAP), y, h: SLOT_H };
      });
      positions.push(arr);
    });
    if (W) {
      positions.push([{ x: rounds.length * (COL_W + COL_GAP), y: (canvasH - 80) / 2, h: 80 }]);
    }
    return { positions, canvasH, canvasW: cols * (COL_W + COL_GAP) - COL_GAP };
  }, [rounds, W, cols]);

  // Connector lines (SVG paths) between rounds
  const lines = useMemo(() => {
    const out = [];
    for (let ci = 0; ci < layout.positions.length - 1; ci++) {
      const from = layout.positions[ci];
      const to = layout.positions[ci + 1];
      from.forEach((f, fi) => {
        const targetIdx = Math.floor(fi / 2);
        const t = to[targetIdx];
        if (!t) return;
        const x1 = f.x + COL_W;
        const y1 = f.y + f.h / 2;
        const x2 = t.x;
        const y2 = t.y + t.h / 2;
        const mx = x1 + (x2 - x1) / 2;
        out.push({ d: `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`, key: `${ci}-${fi}` });
      });
    }
    return out;
  }, [layout]);

  // Aktuelle Runde: erste aktive, sonst letzte (bzw. Sieger-Spalte)
  const currentCol = useMemo(() => {
    const ai = rounds.findIndex((r) => r.status === "active");
    if (ai >= 0) return ai;
    return W ? rounds.length : Math.max(0, rounds.length - 1);
  }, [rounds, W]);

  const scrollToCurrent = (smooth = true) => {
    const el = scrollRef.current;
    if (!el) return;
    const x = currentCol * (COL_W + COL_GAP) - (el.clientWidth - COL_W) / 2;
    // Vertikal: erstes offenes Match der aktuellen Runde anpeilen
    let y = 0;
    const r = rounds[currentCol];
    if (r) {
      const oi = r.pairings.findIndex((p) => p.score1 == null || p.score2 == null);
      const pos = layout.positions[currentCol]?.[Math.max(0, oi)];
      if (pos) y = pos.y - (el.clientHeight - HEADER_H) / 2 + SLOT_H / 2;
    }
    el.scrollTo({ left: Math.max(0, x), top: Math.max(0, y), behavior: smooth ? "smooth" : "auto" });
  };
  // Beim Öffnen direkt zur aktuellen Runde springen
  useEffect(() => { scrollToCurrent(false); /* eslint-disable-next-line */ }, [layout.canvasW]);

  if (!rounds.length) {
    return (
      <div style={bk.empty}>
        <span style={{ fontSize: 36, display: "block", marginBottom: 10 }}>🏟️</span>
        <p style={bk.et}>Turnierbaum erscheint nach der ersten Auslosung.</p>
      </div>
    );
  }

  return (
    <div style={bk.wr}>
      <div style={bk.ctrl}>
        <button style={{ ...bk.ctrlBtn, width: "auto", padding: "0 10px", fontSize: 11 }} title="Zur aktuellen Runde" onClick={() => scrollToCurrent(true)}>● Aktuelle Runde</button>
      </div>
      <div
        ref={scrollRef}
        className="bracket-svg"
        style={{ ...bk.sc, maxHeight: `min(72vh, ${layout.canvasH + HEADER_H + 20}px)` }}
      >
        <div style={{ width: layout.canvasW, position: "relative" }}>
          {/* Sticky Runden-Header — bleibt beim vertikalen Scrollen sichtbar */}
          <div style={{ ...bk.hdr, width: layout.canvasW, height: HEADER_H }}>
            {rounds.map((r, ri) => (
              <div key={r.roundNumber} style={{ ...bk.rl, position: "absolute", left: ri * (COL_W + COL_GAP), width: COL_W, ...(ri === currentCol ? bk.rlA : {}) }}>
                <span style={{ ...bk.rn, color: r.status === "completed" ? "#64748b" : "#00e676" }}>{r.name}</span>
                <span style={bk.md}>
                  {r.matchday ? `${r.matchday} · ` : ""}
                  <span style={{ color: r.status === "completed" ? "#334155" : "#00e67688", textTransform: "uppercase", letterSpacing: .8 }}>{r.status === "completed" ? "abgeschlossen" : "aktiv"}</span>
                </span>
              </div>
            ))}
            {W && (
              <div style={{ ...bk.rl, position: "absolute", left: rounds.length * (COL_W + COL_GAP), width: COL_W }}>
                <span style={{ ...bk.rn, color: "#fbbf24" }}>Sieger</span>
              </div>
            )}
          </div>
          <div style={{ position: "relative", width: layout.canvasW, height: layout.canvasH }}>
            <svg width={layout.canvasW} height={layout.canvasH} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
              {lines.map((l) => (
                <path key={l.key} d={l.d} stroke="#1e3a2a" strokeWidth={1.5} fill="none" />
              ))}
            </svg>
            {rounds.map((r, ri) => {
              const poss = layout.positions[ri];
              return r.pairings.map((p, i) => {
                const pos = poss[i];
                const p1 = gp(p.player1Id), p2 = gp(p.player2Id);
                const d = p.score1 !== null && p.score2 !== null;
                const w1 = p.winner === p.player1Id || (d && !p.winner && p.score1 > p.score2);
                const w2 = p.winner === p.player2Id || (d && !p.winner && p.score2 > p.score1);
                const t = d && !p.winner && p.score1 === p.score2;
                const clickable = d && onMatchClick;
                return (
                  <div key={p.id} style={{ position: "absolute", left: pos.x, top: pos.y, width: COL_W, height: pos.h }}>
                    <div
                      onClick={clickable ? (e) => { e.stopPropagation(); onMatchClick(p, r); } : undefined}
                      style={{ ...bk.mb, borderColor: r.status === "active" ? "#00e67633" : "#1e293b", cursor: clickable ? "pointer" : "default" }}
                      title={clickable ? "Aufstellungen anzeigen" : ""}
                    >
                      <Slot p={p1} win={w1} lose={d && !w1 && !t} tie={t} score={d ? p.score1 : null} />
                      <Slot p={p2} win={w2} lose={d && !w2 && !t} tie={t} score={d ? p.score2 : null} />
                    </div>
                  </div>
                );
              });
            })}
            {W && (
              <div style={{ position: "absolute", left: rounds.length * (COL_W + COL_GAP), top: layout.positions[layout.positions.length - 1][0].y, width: COL_W }}>
                <div style={bk.wb}>
                  <span style={{ fontSize: 30, lineHeight: 1, animation: "crownBounce 2s infinite" }}>👑</span>
                  <span style={bk.wn}>{W.name}</span>
                  {W.league && <span style={bk.wl}>{W.league}</span>}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <div style={bk.sh}>Wischen/Scrollen zum Navigieren — Runden horizontal, Matches vertikal</div>
    </div>
  );
}

function Slot({ p, win, lose, tie, score }) {
  return (
    <div style={{ ...bk.sl, borderBottom: "1px solid #1e293b22", background: win ? "linear-gradient(90deg,#0d281888,#0d281800)" : "transparent" }}>
      <div style={{ ...bk.si, background: win ? "#22c55e" : lose ? "#334155" : "transparent" }} />
      <Av p={p} size={18} />
      <span style={{ ...bk.sn, color: win ? "#e2e8f0" : lose ? "#475569" : "#cbd5e1", fontWeight: win ? 700 : 400, textDecoration: lose ? "line-through" : "none", textDecorationColor: "#47556944" }}>{p?.name || "?"}</span>
      {p?.league && <span style={{ ...bk.slg, opacity: lose ? .3 : .6 }}>{p.league}</span>}
      <span style={{ ...bk.ss, color: score == null ? "#334155" : win ? "#4ade80" : tie ? "#fbbf24" : "#475569" }}>{score == null ? "–" : score}</span>
    </div>
  );
}

export { Av };
