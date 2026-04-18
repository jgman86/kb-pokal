import { useRef, useState, useEffect, useMemo } from "react";
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

export function Bracket({ data, gp, onMatchClick }) {
  const rounds = data.rounds || [];
  const W = data.status === "finished" ? data.players.find((p) => !p.eliminated) : null;
  const cols = W ? rounds.length + 1 : rounds.length;

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState(null);
  const wrapRef = useRef(null);
  const viewRef = useRef(null);

  // Compute slot positions per round
  const layout = useMemo(() => {
    const positions = []; // [col][pairIdx] -> {x, y, h}
    const rCols = rounds.map((r) => r.pairings.length || 1);
    const maxPairs = Math.max(1, ...rCols);
    const canvasH = maxPairs * (SLOT_H + SLOT_GAP) + 60;
    rounds.forEach((r, ci) => {
      const n = r.pairings.length || 1;
      const spacing = (canvasH - 60) / n;
      const arr = r.pairings.map((_, i) => {
        const y = 30 + i * spacing + (spacing - SLOT_H) / 2;
        return { x: ci * (COL_W + COL_GAP), y, h: SLOT_H };
      });
      positions.push(arr);
    });
    if (W) {
      positions.push([{ x: rounds.length * (COL_W + COL_GAP), y: (canvasH - 80) / 2, h: 80 }]);
    }
    return { positions, canvasH, canvasW: cols * (COL_W + COL_GAP) };
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

  const fit = () => {
    const w = wrapRef.current?.clientWidth || 600;
    const h = 320;
    const zx = w / layout.canvasW;
    const zy = h / layout.canvasH;
    const z = Math.min(1, Math.min(zx, zy));
    setZoom(z);
    setPan({ x: 0, y: 0 });
  };
  useEffect(() => { fit(); /* eslint-disable-next-line */ }, [layout.canvasW, layout.canvasH]);

  const onPointerDown = (e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };
  const onPointerMove = (e) => {
    if (!drag) return;
    setPan({ x: e.clientX - drag.x, y: e.clientY - drag.y });
  };
  const onPointerUp = (e) => {
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    setDrag(null);
  };
  const onWheel = (e) => {
    if (!e.ctrlKey && !e.metaKey && Math.abs(e.deltaY) < 30) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    setZoom((z) => Math.max(0.3, Math.min(2.5, z * factor)));
  };

  if (!rounds.length) {
    return (
      <div style={bk.empty}>
        <span style={{ fontSize: 36, display: "block", marginBottom: 10 }}>🏟️</span>
        <p style={bk.et}>Turnierbaum erscheint nach der ersten Auslosung.</p>
      </div>
    );
  }

  return (
    <div style={bk.wr} ref={wrapRef}>
      <div style={bk.ctrl}>
        <button style={bk.ctrlBtn} title="Rein" onClick={() => setZoom((z) => Math.min(2.5, z * 1.15))}>+</button>
        <button style={bk.ctrlBtn} title="Raus" onClick={() => setZoom((z) => Math.max(0.3, z * 0.85))}>−</button>
        <button style={bk.ctrlBtn} title="Anpassen" onClick={fit}>⤢</button>
      </div>
      <div
        ref={viewRef}
        className="bracket-svg"
        style={{ ...bk.sc, ...(drag ? bk.scGrab : {}) }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        <div style={{ ...bk.canvas, width: layout.canvasW, height: layout.canvasH, transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})` }}>
          <svg width={layout.canvasW} height={layout.canvasH} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
            {lines.map((l) => (
              <path key={l.key} d={l.d} stroke="#1e3a2a" strokeWidth={1.5} fill="none" />
            ))}
          </svg>
          {rounds.map((r, ri) => (
            <div key={r.roundNumber} style={{ ...bk.col, left: ri * (COL_W + COL_GAP) }}>
              <div style={bk.rl}>
                <span style={{ ...bk.rn, color: r.status === "completed" ? "#64748b" : "#00e676" }}>{r.name}</span>
                {r.matchday && <span style={bk.md}>{r.matchday}</span>}
                <span style={{ ...bk.rs, color: r.status === "completed" ? "#334155" : "#00e67688" }}>
                  {r.status === "completed" ? "abgeschlossen" : "aktiv"}
                </span>
              </div>
            </div>
          ))}
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
      <div style={bk.sh}>⤢ ziehen · Strg/Cmd + Scroll = Zoom · {Math.round(zoom * 100)}%</div>
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
