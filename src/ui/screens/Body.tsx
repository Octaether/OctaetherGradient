// Act 7: one representative organism. Each dot is a cell; colour shows its job.
import { useRef } from 'react';
import { useGame } from '../store';
import { useCanvas, hash01 } from '../hooks';
import { POOL, mix } from '../theme';
import { LIME, WARM, cellSprite, drawSpriteCell, glowSprite, type CellLook } from '../art';

/** Act 7: the body plan. One representative organism of up to six cell types. */
export function Body() {
  const snap = useGame((s) => s.snap)!;
  const ref = useRef(snap);
  ref.current = snap;
  const reduced = useGame((s) => s.settings.reducedMotion);
  const canvas = useCanvas(
    (ctx, w, h, t) => {
      const s = ref.current;
      const g = s.cell?.globals ?? {};
      const alga = s.branch !== 'hetero';
      const move = reduced ? 0 : 1;
      ctx.clearRect(0, 0, w, h);
      const size = g.size ?? 4;
      const n = Math.min(150, Math.max(4, Math.round(size)));
      const fFeed = (g.feeders ?? 1) / 2;
      const fGerm = (g.germ ?? 1) / 2 / (g.germBonus ?? 1);
      const fTrans = Math.max(0, 1 - fFeed - fGerm);
      const o2i = s.cell ? s.cell.conc[s.cell.ids.indexOf('O2i')] ?? 0.3 : 0.3;
      const cheat = g.cheat ?? 0;
      const cx = w / 2 + 40;
      const cy = h / 2;
      const scale = Math.min(w, h) / (Math.sqrt(n) * 2.6 + 6);
      const r = Math.max(6, Math.min(52, scale * 0.95));
      // positions: snowflake branching (golden-angle spiral with branch jitter)
      const pts: { x: number; y: number; d: number; i: number }[] = [];
      for (let i = 0; i < n; i++) {
        const k = i + 0.5;
        const rad = Math.sqrt(k / n);
        const a = k * 2.39996 + (alga ? Math.sin(k * 0.3) * 0.25 : 0) + t * 0.01 * move;
        const breathe = 1 + 0.015 * Math.sin(t * 1.2 + i * 0.3) * move;
        const R = rad * Math.sqrt(n) * r * 1.22 * breathe;
        pts.push({ x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R * (alga ? 1.1 : 1), d: rad, i });
      }
      // the rest of the population: small organisms drifting far behind
      for (let k = 0; k < 8; k++) {
        const bx = (((hash01(k * 3.7) * 1.3 - 0.15) * w + t * (4 + 6 * hash01(k)) * move) % (w + 120)) - 60;
        const by = (0.08 + 0.84 * hash01(k * 9.1)) * h;
        const m = Math.min(n, 9);
        const rr = 3 + 2 * hash01(k * 5.5);
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 0.8;
        for (let i = 0; i < m; i++) {
          const kk = i + 0.5;
          const a2 = kk * 2.39996;
          const R2 = Math.sqrt(kk) * rr * 2.1;
          ctx.beginPath();
          ctx.arc(bx + Math.cos(a2) * R2, by + Math.sin(a2) * R2, rr, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      // whole-body glow and the oxygen penetration line
      const bodyR = Math.sqrt(n) * r * 1.22 + r;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.5;
      ctx.drawImage(glowSprite(alga ? LIME : WARM[1], 0.14), cx - bodyR * 1.8, cy - bodyR * 1.8, bodyR * 3.6, bodyR * 3.6);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      const pen = Math.max(0.15, Math.min(1, o2i / 0.4));
      ctx.strokeStyle = mix(POOL.oxygen, 0.35);
      ctx.setLineDash([3, 6]);
      ctx.beginPath();
      ctx.arc(cx, cy, bodyR * (1 - pen * 0.85), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      // cell-to-cell junctions: daughter cells stay stuck together
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const dx = pts[i].x - pts[j].x;
          const dy = pts[i].y - pts[j].y;
          if (dx * dx + dy * dy < r * r * 6) {
            ctx.moveTo(pts[i].x, pts[i].y);
            ctx.lineTo(pts[j].x, pts[j].y);
          }
        }
      }
      ctx.stroke();
      for (const p of pts) {
        const hsh = hash01(p.i * 7.3);
        let role: 'feed' | 'germ' | 'trans' = 'feed';
        if (hsh < fGerm * 0.9) role = 'germ';
        else if (hsh < fGerm * 0.9 + fTrans) role = 'trans';
        const starving = p.d < 1 - pen;
        const isCheat = cheat > 0 && hash01(p.i * 3.1) < cheat * 0.35;
        const flick = isCheat ? 0.55 + 0.45 * Math.sin(t * 9 + p.i) : 1;
        const col = isCheat ? '#ff6b5e' : role === 'germ' ? POOL.atp : role === 'trans' ? POOL.oxygen : alga ? LIME : POOL.carbon;
        const look: CellLook = {
          morph: 'euk',
          color: col,
          aspect: 1,
          features: role === 'feed' ? (alga ? ['nucleus', 'chloro'] : ['nucleus', 'vacuole']) : role === 'trans' ? ['nucleus', 'mito4'] : ['nucleus', 'golgi'],
          variant: p.i % 3,
        };
        const alpha = (starving ? 0.38 : 1) * flick;
        drawSpriteCell(ctx, cellSprite(look), p.x, p.y, r * 0.95, p.i * 0.7, alpha, starving ? '#7b6fd6' : col, 1, 1, !starving);
        // cilia on surface cells for the animal line
        if (!alga && p.d > 0.85 && role === 'feed') {
          const a = Math.atan2(p.y - cy, p.x - cx);
          ctx.strokeStyle = mix(WARM[1], 0.5);
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (const off of [-0.25, 0, 0.25]) {
            const b = a + off + Math.sin(t * 6 * move + p.i + off * 4) * 0.25;
            ctx.moveTo(p.x + Math.cos(a + off) * r, p.y + Math.sin(a + off) * r);
            ctx.lineTo(p.x + Math.cos(b) * r * 1.6, p.y + Math.sin(b) * r * 1.6);
          }
          ctx.stroke();
        }
      }
    },
    [reduced],
  );
  const g = snap.cell?.globals ?? {};
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <canvas ref={canvas} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      {(
        <div className="legend">
          <h5>{snap.branch === 'hetero' ? 'Your animal-like organism' : 'Your algal organism'}</h5>
          <Row k="Cells per organism" v={Math.round(g.size ?? 4)} />
          <Row k="Predation" v={((g.predation ?? 1) * 100).toFixed(0) + '%'} />
          <Row k="O₂ reaching core" v={(Math.min(1, (snap.cell?.conc[snap.cell.ids.indexOf('O2i')] ?? 0) / 0.4) * 100).toFixed(0) + '%'} />
          {(g.cheat ?? 0) > 0 && <Row k="Cheater load" v={((g.cheat ?? 0) * 100).toFixed(0) + '%'} color="var(--oxygen)" />}
          <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }} className="faint">
            <Key c={snap.branch === 'hetero' ? POOL.carbon : LIME} t="Feeding" />
            <Key c={POOL.oxygen} t="Transport" />
            <Key c={POOL.atp} t="Germ" />
            <Key c="#7b6fd6" t="Starving" />
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ k, v, color }: { k: string; v: string | number; color?: string }) {
  return (
    <div style={{ display: 'flex', padding: '4px 0', borderTop: '1px solid var(--hair)', marginTop: 4 }}>
      <span className="muted" style={{ fontSize: 12 }}>{k}</span>
      <span className="num" style={{ marginLeft: 'auto', color }}>{v}</span>
    </div>
  );
}
function Key({ c, t }: { c: string; t: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5 }}>
      <span style={{ width: 9, height: 9, borderRadius: 1, background: c, boxShadow: `0 0 8px ${c}` }} />
      {t}
    </span>
  );
}
