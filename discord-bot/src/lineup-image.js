// Aufstellungs-Grafik im TV-Stil: grünes Spielfeld, Spielerporträts auf
// ihren Positionen (Sturm oben, Torwart unten), Name + Punkte je Spieler,
// Manager-Avatar unten rechts. Aufgebaut als SVG (Porträts als eingebettete
// data-URIs), gerendert nach PNG via sharp/libvips.
//
// Bilder kommen vom öffentlichen Kickbase-CDN (kickbase.b-cdn.net) — Pfade
// liefert die API (squad.pim / ranking.uim). Fehlende Bilder → Initialen.

import sharp from "sharp";

const CDN = "https://kickbase.b-cdn.net/";
const W = 900, H = 1150;
const AV_R = 52; // Radius Spielerporträt

// Bild laden und via sharp nach PNG re-kodieren + quadratisch zuschneiden —
// macht auch WebP/JPEG/Transparenz librsvg-sicher (sonst leere Kreise).
async function fetchDataUri(path) {
  if (!path) return null;
  const url = /^https?:\/\//.test(path) ? path : CDN + path.replace(/^\//, "");
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 5_000_000) return null; // Ausreißer meiden
    const png = await sharp(buf).resize(240, 240, { fit: "cover" }).png().toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch { return null; }
}

// Porträt-Quelle: das originale Kickbase-Spielerfoto (pool/playersbig/
// {id}.png, Kopf + Oberkörper, unbeschnitten — Premium-App-Optik) →
// Trikot-Grafik aus der API (pim) → Initialen-Kreis. Kein eigener
// Zuschnitt: die Bilder kommen 1:1 von Kickbase (nur Kreis-Maskierung).
async function fetchPortrait(p) {
  return (p.id && await fetchDataUri(`pool/playersbig/${p.id}.png`)) || (p.image && await fetchDataUri(p.image)) || null;
}

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Ein Spieler-Knoten: Porträt im Kreis (oder Initialen), Name-Pill, Punkte-Pill
function playerNode(p, x, y, img, idx) {
  const name = esc((p.lastName || "?").slice(0, 14));
  const pts = p.points;
  const ptsColor = pts > 0 ? "#16a34a" : pts < 0 ? "#dc2626" : "#475569";
  const init = esc((p.lastName || "?").trim().slice(0, 2).toUpperCase());
  const portrait = img
    ? `<image href="${img}" x="${x - AV_R}" y="${y - AV_R}" width="${AV_R * 2}" height="${AV_R * 2}" clip-path="url(#c${idx})" preserveAspectRatio="xMidYMid slice"/>`
    : `<text x="${x}" y="${y + 10}" text-anchor="middle" font-size="30" font-weight="bold" fill="#cbd5e1" font-family="DejaVu Sans, sans-serif">${init}</text>`;
  return `
  <clipPath id="c${idx}"><circle cx="${x}" cy="${y}" r="${AV_R}"/></clipPath>
  <circle cx="${x}" cy="${y}" r="${AV_R + 3}" fill="#0f172a"/>
  <circle cx="${x}" cy="${y}" r="${AV_R}" fill="#1e293b"/>
  ${portrait}
  <circle cx="${x}" cy="${y}" r="${AV_R + 2}" fill="none" stroke="#f8fafc" stroke-width="3"/>
  <rect x="${x - 62}" y="${y + AV_R + 8}" width="124" height="26" rx="13" fill="#0f172aE6"/>
  <text x="${x}" y="${y + AV_R + 26}" text-anchor="middle" font-size="15" font-weight="600" fill="#f8fafc" font-family="DejaVu Sans, sans-serif">${name}</text>
  <rect x="${x - 30}" y="${y + AV_R + 38}" width="60" height="24" rx="12" fill="${ptsColor}"/>
  <text x="${x}" y="${y + AV_R + 55}" text-anchor="middle" font-size="15" font-weight="bold" fill="#ffffff" font-family="DejaVu Sans, sans-serif">${pts}</text>`;
}

export async function renderLineupImage({ managerName, managerImage, leagueName, day, totalPoints, lineup }) {
  // Positionen: 1=TW, 2=ABW, 3=MF, 4=ST — Sturm oben, TW unten (TV-Perspektive)
  const rows = { 4: [], 3: [], 2: [], 1: [] };
  for (const p of lineup) (rows[p.position] || rows[3]).push(p);
  const rowOrder = [4, 3, 2, 1];
  const usedRows = rowOrder.filter((k) => rows[k].length > 0);
  const top = 150, bottom = 970;
  const rowY = usedRows.map((_, i) => usedRows.length === 1 ? (top + bottom) / 2 : top + 80 + (i * (bottom - top - 160)) / (usedRows.length - 1));

  // Alle Bilder parallel laden (11 Porträts + Manager-Avatar)
  const [imgs, mgrImg] = await Promise.all([
    Promise.all(lineup.map((p) => fetchPortrait(p))),
    fetchDataUri(managerImage),
  ]);

  let nodes = "", idx = 0;
  usedRows.forEach((posKey, ri) => {
    const row = rows[posKey];
    const spacing = Math.min(190, (W - 140) / Math.max(1, row.length));
    row.forEach((p, i) => {
      const x = W / 2 + (i - (row.length - 1) / 2) * spacing;
      nodes += playerNode(p, x, rowY[ri], imgs[lineup.indexOf(p)], idx++);
    });
  });

  const mgrBlock = mgrImg
    ? `<clipPath id="mgr"><circle cx="${W - 90}" cy="${H - 78}" r="46"/></clipPath>
       <circle cx="${W - 90}" cy="${H - 78}" r="49" fill="#f8fafc"/>
       <image href="${mgrImg}" x="${W - 136}" y="${H - 124}" width="92" height="92" clip-path="url(#mgr)" preserveAspectRatio="xMidYMid slice"/>`
    : "";

  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grass" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#166534"/><stop offset="1" stop-color="#14532d"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#grass)"/>
  ${Array.from({ length: 8 }, (_, i) => `<rect x="0" y="${100 + i * 120}" width="${W}" height="60" fill="#ffffff08"/>`).join("")}
  <!-- Spielfeldlinien -->
  <rect x="40" y="100" width="${W - 80}" height="${H - 220}" fill="none" stroke="#ffffff55" stroke-width="3"/>
  <circle cx="${W / 2}" cy="100" r="90" fill="none" stroke="#ffffff55" stroke-width="3"/>
  <rect x="${W / 2 - 180}" y="${H - 200}" width="360" height="80" fill="none" stroke="#ffffff55" stroke-width="3"/>
  <rect x="${W / 2 - 90}" y="${H - 160}" width="180" height="40" fill="none" stroke="#ffffff55" stroke-width="3"/>
  <!-- Header -->
  <rect x="0" y="0" width="${W}" height="76" fill="#0f172a"/>
  <text x="30" y="34" font-size="26" font-weight="bold" fill="#f8fafc" font-family="DejaVu Sans, sans-serif">⚽ ${esc(managerName)}</text>
  <text x="30" y="62" font-size="16" fill="#94a3b8" font-family="DejaVu Sans, sans-serif">${esc(leagueName)} · Spieltag ${day}</text>
  <rect x="${W - 220}" y="16" width="190" height="44" rx="22" fill="#16a34a"/>
  <text x="${W - 125}" y="46" text-anchor="middle" font-size="24" font-weight="bold" fill="#ffffff" font-family="DejaVu Sans, sans-serif">${totalPoints} Pkt</text>
  ${nodes}
  ${mgrBlock}
  <text x="30" y="${H - 24}" font-size="13" fill="#ffffff66" font-family="DejaVu Sans, sans-serif">Kickbase Bot · Daten: kickbase.com</text>
</svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}
