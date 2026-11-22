// The pathway map, drawn as a textbook diagram: molecules are circles sized by
// amount, enzymes are labels on the arrows, energy carriers are small +/−
// tags, and regulation only appears when you point at something. Line width
// tracks flow; dots stream at the speed of the flux; the slowest step is red.
// Layout and geometry live in ../map/layout.ts.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useGame } from '../store';
import { isCompact } from '../hooks';
import type { ActSpec, NetworkSpec, SpeciesSpec } from '../../sim/types';
import { buildGeometry, layoutNet, nodeRadius, notch, placeLabels, quad, textW, trim, type Badge, type EdgeGeo, type Pt } from '../map/layout';
import type { CellSnap } from '../../sim/snapshot';
import { POOL, mix } from '../theme';
import { fmt } from '../../sim/num';
import { ACTS } from '../../content';
import { OptionCard } from '../components/Panel';
import { IconInfo } from '../components/Icons';
import { ConcGraph } from '../components/ConcGraph';
import { audio } from '../audio/engine';
import { send } from '../simClient';

const ACT_C = '#9fe0a8';
const INH_C = '#ff8f8f';

export function MapScreen() {
  const snap = useGame((s) => s.snap)!;
  const act = ACTS[snap.act];
  if (!act?.network || !snap.cell) {
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }} className="faint">
        There is no pathway in this part of the story.
      </div>
    );
  }
  return <MapView act={act} cell={snap.cell} />;
}

export function MapView({ act, cell }: { act: ActSpec; cell: CellSnap }) {
  const presentKey = cell.present.join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const laid = useMemo(() => layoutNet(act.network, new Set(cell.present)), [act.network, presentKey]);
  const net = laid.net;
  const W0 = laid.box.w;
  const H0 = laid.box.h;
  const geo = useMemo(() => buildGeometry(laid.net, laid.curve, laid.primary), [laid]);
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  const [view, setView] = useState({ x: 0, y: 0, z: 1 });
  const [hover, setHover] = useState<string | null>(null);
  const sel = useGame((s) => s.sel);
  const highlight = useGame((s) => s.highlight);
  const set = useGame((s) => s.set);
  const bump = useGame((s) => s.bumpLabel);
  const reduced = useGame((s) => s.settings.reducedMotion);
  const cellRef = useRef(cell);
  cellRef.current = cell;

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Leave room for the legend above and the status strip below.
  const padX = 36;
  const padTop = 70;
  const padBot = 96;
  const vbW = W0 / view.z;
  const vbH = H0 / view.z;
  const vbX = laid.box.x + (W0 - vbW) / 2 + view.x;
  const vbY = laid.box.y + (H0 - vbH) / 2 + view.y;
  const scale = Math.max(0.2, Math.min((size.w - padX * 2) / vbW, (size.h - padTop - padBot) / vbH));
  const offX = (size.w - vbW * scale) / 2;
  const offY = padTop + (size.h - padTop - padBot - vbH * scale) / 2;
  const mapRef = useRef({ vbX, vbY, scale, offX, offY });
  mapRef.current = { vbX, vbY, scale, offX, offY };
  const toScreen = (p: Pt) => ({ x: (p.x - vbX) * scale + offX, y: (p.y - vbY) * scale + offY });

  const present = useMemo(() => new Set(cell.present), [cell.present]);
  const flags = useMemo(() => new Set(cell.flags), [cell.flags]);
  const vIdx = useMemo(() => {
    const m: Record<string, number> = {};
    cell.rx.forEach((id, i) => (m[id] = i));
    return m;
  }, [cell.rx]);
  const conc = useMemo(() => {
    const m: Record<string, number> = { ...cell.bval };
    cell.ids.forEach((id, i) => (m[id] = cell.conc[i]));
    return m;
  }, [cell]);
  const visibleSpecies = useMemo(() => {
    const s = new Set<string>();
    for (const r of net.reactions) {
      if (!present.has(r.id) || r.hide) continue;
      for (const id of [...Object.keys(r.sub), ...Object.keys(r.prod)]) if (!net.species.find((x) => x.id === id)?.tag && !(r.tags ?? []).includes(id)) s.add(id);
    }
    return s;
  }, [net, present]);
  const vmax = useMemo(() => {
    let m = 1e-9;
    for (const r of net.reactions) {
      if (!present.has(r.id) || r.hide) continue;
      m = Math.max(m, Math.abs(cell.v[vIdx[r.id]] ?? 0));
    }
    return m;
  }, [cell, net, present, vIdx]);
  const vmaxRef = useRef(vmax);
  vmaxRef.current = vmax;

  // ---------- particles ----------
  useEffect(() => {
    if (reduced) return;
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    type Part = { e: EdgeGeo; t: number; sp: number };
    let parts: Part[] = [];
    const spawnAcc = new Map<string, number>();
    let raf = 0;
    let last = performance.now();
    const glowC = document.createElement('canvas');
    const gctx = glowC.getContext('2d')!;
    const GS = 5;
    const posAt = (e: EdgeGeo, t: number): Pt => {
      const target = t * e.len[e.len.length - 1];
      let i = 1;
      while (i < e.len.length - 1 && e.len[i] < target) i++;
      const a = e.pts[i - 1];
      const b = e.pts[i];
      const k = (target - e.len[i - 1]) / (e.len[i] - e.len[i - 1] || 1);
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    };
    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const dpr = Math.min(1.5, devicePixelRatio || 1);
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (w < 4 || h < 4) {
        raf = requestAnimationFrame(draw);
        return;
      }
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      const M = mapRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (glowC.width !== Math.ceil(w / GS) || glowC.height !== Math.ceil(h / GS)) {
        glowC.width = Math.ceil(w / GS);
        glowC.height = Math.ceil(h / GS);
      }
      gctx.clearRect(0, 0, glowC.width, glowC.height);
      gctx.globalCompositeOperation = 'lighter';
      const cl = cellRef.current;
      const pres = new Set(cl.present);
      const idx: Record<string, number> = {};
      cl.rx.forEach((id, i) => (idx[id] = i));
      const vm = vmaxRef.current;
      for (const g of geo.values()) {
        if (!pres.has(g.r.id)) continue;
        const v = cl.v[idx[g.r.id]] ?? 0;
        const norm = Math.min(1, Math.sqrt(Math.abs(v) / vm));
        if (norm < 0.02) continue;
        for (const e of g.edges) {
          const rate = 4 * norm * (1 + e.len[e.len.length - 1] / 120);
          const acc = (spawnAcc.get(e.id) ?? Math.random()) + rate * dt;
          let n = Math.floor(acc);
          spawnAcc.set(e.id, acc - n);
          while (n-- > 0 && parts.length < 1500) parts.push({ e, t: v >= 0 ? 0 : 1, sp: (0.18 + 0.7 * norm) * (v >= 0 ? 1 : -1) * (80 / (e.len[e.len.length - 1] + 40)) });
        }
      }
      ctx.globalCompositeOperation = 'lighter';
      const next: Part[] = [];
      for (const p of parts) {
        p.t += p.sp * dt;
        if (p.t < 0 || p.t > 1) continue;
        next.push(p);
        const q = posAt(p.e, p.t);
        const x = (q.x - M.vbX) * M.scale + M.offX;
        const y = (q.y - M.vbY) * M.scale + M.offY;
        const fade = Math.min(1, p.t * 6, (1 - p.t) * 6);
        const col = POOL[p.e.pool];
        const r = 1.3 * Math.max(0.8, M.scale);
        ctx.fillStyle = mix(col, 0.9 * fade);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        gctx.fillStyle = mix(col, 0.5 * fade);
        gctx.fillRect(x / GS - 0.8, y / GS - 0.8, 1.6, 1.6);
      }
      parts = next;
      // bloom: the low-res glow buffer upscaled (smoothing does the blur)
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(glowC, 0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [geo, reduced]);

  // ---------- pan & zoom ----------
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const onWheel = (e: React.WheelEvent) => {
    const z = Math.max(0.7, Math.min(4, view.z * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    setView((v) => ({ ...v, z }));
  };
  // two fingers pinch to zoom (touch screens)
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; z: number } | null>(null);
  const spread = () => {
    const [a, b] = [...touches.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  };
  const onDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.current.size === 2) {
      pinch.current = { d: spread(), z: view.z };
      drag.current = null;
      return;
    }
    if ((e.target as Element).closest('[data-hit],.popover,.legend')) return;
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
  };
  const onMove = (e: React.PointerEvent) => {
    if (touches.current.has(e.pointerId)) touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pz = pinch.current;
    if (pz && touches.current.size === 2) {
      const z = Math.max(0.7, Math.min(4, (pz.z * spread()) / pz.d));
      setView((v) => ({ ...v, z }));
      return;
    }
    const d = drag.current;
    if (!d) return;
    if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 4) d.moved = true;
    if (d.moved) setView((v) => ({ ...v, x: d.vx - (e.clientX - d.x) / scale, y: d.vy - (e.clientY - d.y) / scale }));
  };
  const onUp = (e: React.PointerEvent) => {
    touches.current.delete(e.pointerId);
    if (pinch.current) {
      if (touches.current.size < 2) pinch.current = null;
      drag.current = null;
      return;
    }
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) set({ sel: { kind: null, id: null } });
  };

  const bottleneck = cell.bottleneck;
  const pick = (kind: 'rxn' | 'species', id: string) => {
    bump(id);
    set({ sel: sel.kind === kind && sel.id === id ? { kind: null, id: null } : { kind, id } });
  };
  const compartments = (net.compartments ?? []).filter((c) => !c.requires || flags.has(c.requires));
  // Enzyme labels: push apart from each other and from molecules and their names.
  const labelPos = useMemo(() => placeLabels(geo, present, net.species, visibleSpecies, cell.bottleneck), [geo, present, net, visibleSpecies, cell.bottleneck]);
  const focus = hover ?? (sel.id as string | null) ?? highlight;

  // regulation lines: only for whatever is pointed at or selected
  const regLines: { key: string; d: string; act: boolean; mid: Pt; text: string }[] = [];
  if (focus) {
    for (const g of geo.values()) {
      if (!present.has(g.r.id)) continue;
      for (const m of g.r.mods ?? []) {
        if (g.r.id !== focus && m.species !== focus) continue;
        const s = net.species.find((x) => x.id === m.species);
        if (!s || s.x === undefined || !visibleSpecies.has(s.id)) continue;
        const [p0, p1] = trim({ x: s.x, y: s.y! }, g.p, 18, 14);
        const q = quad(p0, p1, 0.22);
        regLines.push({ key: g.r.id + m.species, d: q.d, act: m.type === 'act', mid: q.pts[12], text: m.type === 'act' ? 'speeds up' : 'slows' });
      }
    }
  }

  return (
    <div
      ref={wrap}
      style={{ position: 'absolute', inset: 0, cursor: drag.current?.moved ? 'grabbing' : 'default', touchAction: 'none' }}
      onWheel={onWheel}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerLeave={() => (drag.current = null)}
      onPointerCancel={(e) => {
        touches.current.delete(e.pointerId);
        pinch.current = null;
        drag.current = null;
      }}
      onDoubleClick={() => setView({ x: 0, y: 0, z: 1 })}
    >
      <svg width={size.w} height={size.h} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <filter id="mglow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
          <marker id="mArr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
            <path d="M0.5,1 L9,5 L0.5,9 L2.5,5 Z" fill="context-stroke" stroke="none" />
          </marker>
          <marker id="mBar" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="8" markerHeight="8" orient="auto">
            <path d="M5,0.5 L5,9.5" stroke="context-stroke" strokeWidth="2.2" strokeLinecap="round" />
          </marker>
        </defs>
        <g transform={`translate(${offX - vbX * scale},${offY - vbY * scale}) scale(${scale})`}>
          {compartments.map((c) => (
            <g key={c.id}>
              <path d={notch(c.x, c.y, c.w, c.h, 26)} fill="rgba(255,255,255,0.018)" stroke="rgba(255,255,255,0.14)" strokeWidth={1.2} strokeDasharray="6 4" />
              <text x={c.x + 22} y={c.y + 26} fill="var(--text-3)" fontSize={12} fontWeight={600}>
                {c.name}
              </text>
            </g>
          ))}

          {/* lines */}
          {[...geo.values()].map((g) => {
            if (!present.has(g.r.id)) return null;
            const j = vIdx[g.r.id];
            const v = cell.v[j] ?? 0;
            const norm = Math.sqrt(Math.min(1, Math.abs(v) / vmax));
            const isBn = bottleneck === g.r.id;
            const on = focus === g.r.id;
            const starved = (cell.sat[j] ?? 1) < 0.06 && norm < 0.2;
            return (
              <g key={g.r.id} opacity={starved ? 0.35 : 1}>
                {g.edges.map((e) => {
                  const col = POOL[e.pool];
                  const w = 1.2 + 2.6 * norm;
                  return (
                    <g key={e.id}>
                      
                      <path d={e.d} fill="none" stroke={col} strokeOpacity={0.07} strokeWidth={w + 3} strokeLinecap="round" />
                      <path
                        d={e.d}
                        fill="none"
                        stroke={isBn ? 'var(--danger)' : col}
                        strokeOpacity={on || isBn ? 1 : 0.35 + 0.5 * norm}
                        strokeWidth={w}
                        strokeDasharray={e.dashed ? '6 5' : undefined}
                        strokeLinecap="round"
                        markerEnd={e.head ? 'url(#mArr)' : undefined}
                      />
                    </g>
                  );
                })}
                {(() => {
                  const ge = g.edges.find((e) => e.id.endsWith(':grow'));
                  if (!ge) return null;
                  const tip = ge.pts[ge.pts.length - 1];
                  const dx = tip.x - g.p.x;
                  const dy = tip.y - g.p.y;
                  return (
                  <text x={tip.x + dx * 0.25} y={tip.y + dy * 0.25 + 4} fill="var(--text-2)" fontSize={11.5} fontWeight={600} textAnchor={Math.abs(dx) < 5 ? 'middle' : dx > 0 ? 'start' : 'end'} paintOrder="stroke" stroke="var(--bg)" strokeWidth={3}>
                    new cells
                  </text>
                  );
                })()}
              </g>
            );
          })}

        </g>
      </svg>
      <canvas ref={canvas} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
      <svg width={size.w} height={size.h} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <g transform={`translate(${offX - vbX * scale},${offY - vbY * scale}) scale(${scale})`} style={{ pointerEvents: 'auto' }}>
          {/* regulation (hover only) */}
          {regLines.map((l) => (
            <g key={l.key} style={{ pointerEvents: 'none' }}>
              <path d={l.d} fill="none" stroke={l.act ? ACT_C : INH_C} strokeWidth={1.4} strokeDasharray="3 4" markerEnd={l.act ? 'url(#mArr)' : 'url(#mBar)'} />
              <text x={l.mid.x} y={l.mid.y - 6} fill={l.act ? ACT_C : INH_C} fontSize={10.5} textAnchor="middle" fontWeight={600} paintOrder="stroke" stroke="var(--bg)" strokeWidth={3}>
                {l.text}
              </text>
            </g>
          ))}

          {/* stations: molecules */}
          {net.species.map((s: SpeciesSpec) => {
            if (s.kind === 'cofactor' || !visibleSpecies.has(s.id) || s.x === undefined) return null;
            const c = conc[s.id] ?? 0;
            const col = POOL[s.pool];
            const boundary = s.kind === 'boundary';
            const r = boundary ? 13 : nodeRadius(c);
            const pile = cell.pile.includes(s.id);
            const on = focus === s.id || (sel.kind === 'species' && sel.id === s.id);
            const lp = s.label ?? 'below';
            const tx = s.x + (lp === 'left' ? -r - 8 : lp === 'right' ? r + 8 : 0);
            const ty = s.y! + (lp === 'above' ? -r - 9 : lp === 'below' ? r + 16 : 4);
            const anchor = lp === 'left' ? 'end' : lp === 'right' ? 'start' : 'middle';
            return (
              <g
                key={s.id}
                data-hit
                style={{ cursor: 'pointer' }}
                onClick={(e) => {
                  e.stopPropagation();
                  pick('species', s.id);
                }}
                onMouseEnter={() => setHover(s.id)}
                onMouseLeave={() => setHover(null)}
              >
                <circle cx={s.x} cy={s.y} r={r + 12} fill="transparent" />
                {pile && <circle cx={s.x} cy={s.y} r={r + 10} fill={mix('#ffb38a', 0.22)} filter="url(#mglow)" className="breathe" />}
                {on && <circle cx={s.x} cy={s.y} r={r + 5} fill="none" stroke={col} strokeOpacity={0.7} strokeWidth={1.2} />}
                {boundary ? (
                  <rect x={s.x - r} y={s.y! - r} width={r * 2} height={r * 2} rx={1} fill={mix(col, 0.08)} stroke={col} strokeOpacity={0.6} strokeDasharray="3 3" />
                ) : (
                  <>
                    <circle cx={s.x} cy={s.y} r={r + 4} fill="none" stroke={col} strokeOpacity={0.35} strokeWidth={0.8} strokeDasharray="1.5 3" />
                    <circle cx={s.x} cy={s.y} r={r} fill="var(--bg)" />
                    <circle cx={s.x} cy={s.y} r={r} fill={mix(col, pile ? 0.3 : 0.12)} stroke={pile ? '#ffb38a' : col} strokeWidth={1.6} style={{ transition: 'r 600ms var(--ease)' }} />
                    <circle cx={s.x} cy={s.y} r={Math.max(3, r * 0.55)} fill="none" stroke={col} strokeOpacity={0.45} strokeWidth={0.8} />
                    <circle cx={s.x} cy={s.y} r={Math.max(2, r * 0.22)} fill={col} />
                  </>
                )}
                <text
                  x={tx}
                  y={ty}
                  fill={on ? 'var(--white)' : 'var(--text)'}
                  fontSize={13}
                  fontWeight={650}
                  textAnchor={anchor}
                  paintOrder="stroke"
                  stroke="var(--bg)"
                  strokeWidth={4}
                  strokeLinejoin="round"
                  style={{ pointerEvents: 'none' }}
                >
                  {s.name}
                </text>
              </g>
            );
          })}

          {/* enzymes: pills on the lines */}
          {[...geo.values()].map((g0) => {
            if (!present.has(g0.r.id)) return null;
            const lp = labelPos.get(g0.r.id) ?? g0.p;
            const g = { ...g0, p: lp };
            const moved = Math.hypot(lp.x - g0.p.x, lp.y - g0.p.y) > 6;
            const isBn = bottleneck === g.r.id;
            const on = focus === g.r.id || (sel.kind === 'rxn' && sel.id === g.r.id);
            const evolvable = g.r.gene;
            const w = g.pillW;
            const bw = g.badges.map((b) => textW(b.text, 9.5) + 10);
            const total = bw.reduce((a, b) => a + b, 0) + Math.max(0, bw.length - 1) * 4;
            let bx = g.p.x - total / 2;
            return (
              <g
                key={g.r.id + 'n'}
                data-hit
                style={{ cursor: 'pointer' }}
                onClick={(e) => {
                  e.stopPropagation();
                  pick('rxn', g.r.id);
                }}
                onMouseEnter={() => setHover(g.r.id)}
                onMouseLeave={() => setHover(null)}
              >
                {moved && (
                  <g style={{ pointerEvents: 'none' }}>
                    <line x1={g0.p.x} y1={g0.p.y} x2={lp.x} y2={lp.y} stroke="rgba(255,255,255,0.35)" strokeWidth={0.8} strokeDasharray="2 2" />
                    <circle cx={g0.p.x} cy={g0.p.y} r={2} fill="rgba(255,255,255,0.6)" />
                  </g>
                )}
                {isBn && (
                  <g>
                    <path d={notch(g.p.x - w / 2 - 4, g.p.y - 15, w + 8, 30, 8)} fill="none" stroke="var(--danger)" strokeWidth={1} />
                    <text x={g.p.x} y={g.p.y - 21} fill="var(--danger)" fontSize={10.5} fontWeight={700} textAnchor="middle" paintOrder="stroke" stroke="var(--bg)" strokeWidth={3}>
                      slowest step
                    </text>
                  </g>
                )}
                <path
                  d={notch(g.p.x - w / 2, g.p.y - 11, w, 22, 6)}
                  fill={on ? 'var(--white)' : isBn ? '#2a1420' : '#0c1115'}
                  stroke={isBn ? 'var(--pink)' : on ? 'var(--white)' : evolvable ? 'rgba(255,255,255,0.42)' : 'rgba(255,255,255,0.18)'}
                  strokeWidth={1.2}
                />
                <text x={g.p.x} y={g.p.y + 4} fill={on ? '#0b0f12' : isBn ? 'var(--white)' : 'var(--text)'} fontSize={11.5} fontWeight={650} textAnchor="middle" style={{ pointerEvents: 'none' }}>
                  {g.r.short}
                </text>
                {g.badges.map((b, i) => {
                  const x0 = bx;
                  bx += bw[i] + 4;
                  return (
                    <g key={i} style={{ pointerEvents: 'none' }}>
                      <rect x={x0} y={g.p.y + 14} width={bw[i]} height={15} rx={1} fill={mix(b.color, b.made ? 0.2 : 0.08)} stroke={mix(b.color, b.made ? 0.7 : 0.4)} strokeWidth={0.9} />
                      <text x={x0 + bw[i] / 2} y={g.p.y + 24.8} fill={b.color} fillOpacity={b.made ? 1 : 0.8} fontSize={9.5} fontWeight={650} textAnchor="middle">
                        {b.text}
                      </text>
                    </g>
                  );
                })}
              </g>
            );
          })}
        </g>
      </svg>
      <MapLegend />
      {sel.kind && sel.id && (
        <Inspector
          net={net}
          cell={cell}
          kind={sel.kind}
          id={sel.id}
          anchor={toScreen(sel.kind === 'rxn' ? geo.get(sel.id)?.p ?? { x: W0 / 2, y: H0 / 2 } : (() => {
            const s = net.species.find((x) => x.id === sel.id);
            return { x: s?.x ?? W0 / 2, y: s?.y ?? H0 / 2 };
          })())}
          bounds={size}
          badges={sel.kind === 'rxn' ? geo.get(sel.id)?.badges ?? [] : []}
          onClose={() => set({ sel: { kind: null, id: null } })}
        />
      )}
    </div>
  );
}

function MapLegend() {
  // folded to its title on a phone; tap to open
  const [folded, setFolded] = useState(isCompact);
  return (
    <div className={'legend map-key' + (folded ? ' folded' : '')} style={{ width: 'auto', maxWidth: 'calc(100% - 28px)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 16px', padding: '9px 13px', fontSize: 12, color: 'var(--text-2)' }}>
      <b style={{ color: 'var(--text)', fontWeight: 600, cursor: 'pointer' }} onClick={() => setFolded(!folded)}>
        How to read the map <span className="faint fold-x">{folded ? '▾' : '▴'}</span>
      </b>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <svg width="16" height="16">
          <circle cx="8" cy="8" r="6" fill={mix(POOL.carbon, 0.14)} stroke={POOL.carbon} strokeWidth="1.6" />
        </svg>
        molecule (bigger = more)
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <svg width="30" height="16">
          <path d={notch(1, 3, 28, 10, 3)} fill="#10151a" stroke="rgba(255,255,255,.42)" />
        </svg>
        enzyme (click it)
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <svg width="34" height="16">
          <path d="M2 8h30" stroke={POOL.nad} strokeWidth="2" opacity=".6" />
          <circle cx="10" cy="8" r="2" fill={POOL.nad} />
          <circle cx="22" cy="8" r="2" fill={POOL.nad} />
        </svg>
        moving dots = molecules flowing (faster, thicker = more flux)
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <svg width="26" height="16">
          <path d="M2 8h22" stroke="var(--text-3)" strokeWidth="1.6" strokeDasharray="4 3" />
        </svg>
        dashed = several steps
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span className="chip" style={{ color: POOL.atp, height: 18, padding: '0 7px' }}>+ATP</span>
        made / <span style={{ color: POOL.atp, opacity: 0.8 }}>−</span> spent
      </span>
      <span style={{ color: 'var(--danger)' }}>red = slowest step</span>
    </div>
  );
}

function Inspector({
  net,
  cell,
  kind,
  id,
  anchor,
  bounds,
  badges,
  onClose,
}: {
  net: NetworkSpec;
  cell: CellSnap;
  kind: 'rxn' | 'species';
  id: string;
  anchor: Pt;
  bounds: { w: number; h: number };
  badges: Badge[];
  onClose: () => void;
}) {
  const snap = useGame((s) => s.snap)!;
  const set = useGame((s) => s.set);
  const W = 320;
  const right = anchor.x + 30 + W < bounds.w - 10;
  const left = right ? anchor.x + 30 : Math.max(10, anchor.x - 30 - W);
  const top = Math.max(60, Math.min(anchor.y - 60, bounds.h - 380));
  const style: React.CSSProperties = { left, top, width: W };

  if (kind === 'rxn') {
    const r = net.reactions.find((x) => x.id === id);
    if (!r) return null;
    const j = cell.rx.indexOf(id);
    const v = cell.v[j] ?? 0;
    const sat = cell.sat[j] ?? 0;
    const C = cell.control[id];
    const isBn = cell.bottleneck === id;
    const options = snap.shop.filter((it) => it.target === id && (it.state === 'available' || it.state === 'sweeping'));
    const mods = (r.mods ?? []).map((m) => ({ m, s: net.species.find((x) => x.id === m.species) })).filter((x) => x.s);
    return (
      <div className="popover" style={style} onPointerDown={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="faint" style={{ fontSize: 11 }}>{r.gene ? 'Enzyme' : 'Process'}</div>
            <div style={{ fontWeight: 650, fontSize: 15, lineHeight: 1.25 }}>{r.name}</div>
          </div>
          <button className="btn ghost sm" style={{ width: 28, padding: 0 }} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {r.plain && <p style={{ margin: '6px 0 0', color: 'var(--text-2)', fontSize: 12.5, lineHeight: 1.5 }}>{r.plain}</p>}
        {isBn && <div className="chip bad" style={{ marginTop: 8 }}>Slowest step: improving it helps most</div>}
        <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
          <Meter label="Working at" value={sat} text={`${Math.round(sat * 100)}% of top speed`} color="var(--accent)" />
          {C !== undefined && <Meter label="Control over growth" value={Math.min(1, Math.max(0, C))} text={C < 0.03 ? 'barely matters now' : `${Math.round(C * 100)}%`} color="var(--pink)" />}
          <div className="faint" style={{ fontSize: 11.5 }}>
            Flow: <span className="num" style={{ color: 'var(--text-2)' }}>{fmt(Math.abs(v), 2)}</span> mM/s{v < 0 ? ' (running backwards)' : ''}
          </div>
        </div>
        {badges.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
            <span className="faint" style={{ fontSize: 11.5 }}>Energy:</span>
            {badges.map((b, i) => (
              <span key={i} className="chip" style={{ color: b.color }}>
                {b.text} {b.made ? 'made' : 'spent'}
              </span>
            ))}
          </div>
        )}
        {mods.length > 0 && (
          <div className="faint" style={{ fontSize: 11.5, marginTop: 8, lineHeight: 1.5 }}>
            Regulated by:{' '}
            {mods.map(({ m, s }, i) => (
              <span key={i}>
                {i > 0 && ', '}
                <span style={{ color: m.type === 'act' ? ACT_C : INH_C }}>
                  {s!.name} {m.type === 'act' ? 'speeds it up' : 'slows it'}
                </span>
              </span>
            ))}
          </div>
        )}
        {options.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="faint" style={{ fontSize: 11.5, marginBottom: 6 }}>Evolve this enzyme</div>
            {options.slice(0, 2).map((it) => (
              <OptionCard key={it.id} it={it} />
            ))}
          </div>
        )}
        {r.gene && <Experiment rxn={id} />}
        {r.card && (
          <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => set({ cardOpen: r.card! })}>
            <IconInfo size={14} /> The science
          </button>
        )}
      </div>
    );
  }
  const s = net.species.find((x) => x.id === id);
  if (!s) return null;
  const i = cell.ids.indexOf(id);
  const c = i >= 0 ? cell.conc[i] : cell.bval[id] ?? 0;
  const pile = cell.pile.includes(id);
  const makers = net.reactions.filter((r) => !r.hide && cell.present.includes(r.id) && r.prod[id]).map((r) => r.short);
  const users = net.reactions.filter((r) => !r.hide && cell.present.includes(r.id) && r.sub[id]).map((r) => r.short);
  return (
    <div className="popover" style={style} onPointerDown={(e) => e.stopPropagation()}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="faint" style={{ fontSize: 11 }}>{s.kind === 'boundary' ? 'From the surroundings' : 'Molecule inside the cell'}</div>
          <div style={{ fontWeight: 650, fontSize: 15, color: POOL[s.pool] }}>{s.name}</div>
        </div>
        <button className="btn ghost sm" style={{ width: 28, padding: 0 }} onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <p style={{ margin: '6px 0 0', color: 'var(--text-2)', fontSize: 12.5, lineHeight: 1.5 }}>{s.plain}</p>
      <div style={{ marginTop: 10, fontSize: 12.5 }}>
        Amount: <span className="num">{c >= 1 ? c.toFixed(2) + ' mM' : fmt(c * 1000, 2) + ' µM'}</span>
      </div>
      {i >= 0 && s.kind !== 'boundary' && (
        <div style={{ marginTop: 8 }}>
          <ConcGraph id={id} width={290} />
        </div>
      )}
      {pile && <div className="chip warn" style={{ marginTop: 8 }}>Piling up: the step that uses it is too slow</div>}
      {(makers.length > 0 || users.length > 0) && (
        <div className="faint" style={{ fontSize: 11.5, marginTop: 8, lineHeight: 1.6 }}>
          {makers.length > 0 && <div>Made by: <span style={{ color: 'var(--text-2)' }}>{makers.join(', ')}</span></div>}
          {users.length > 0 && <div>Used by: <span style={{ color: 'var(--text-2)' }}>{users.join(', ')}</span></div>}
        </div>
      )}
      {s.card && (
        <button className="btn ghost sm" style={{ marginTop: 10 }} onClick={() => set({ cardOpen: s.card! })}>
          <IconInfo size={14} /> The science
        </button>
      )}
    </div>
  );
}

/**
 * A test-tube experiment on the species you are viewing: knock the enzyme out,
 * block most of it, or make five times more, and watch growth over 90 seconds.
 * The real population is not touched.
 */
function Experiment({ rxn }: { rxn: string }) {
  const res = useGame((s) => s.snap?.experiments.find((e) => e.rxn === rxn));
  const run = (kind: 'knockout' | 'inhibit' | 'overexpress') => {
    audio.click();
    send({ type: 'experiment', kind, rxn });
  };
  const ratio = res ? res.after / Math.max(res.before, 1e-12) : 1;
  const g = res?.growth ?? [];
  const max = Math.max(1e-12, res?.before ?? 0, ...g);
  const d = g.map((v, i) => `${i ? 'L' : 'M'}${((i / Math.max(1, g.length - 1)) * 100).toFixed(1)},${(40 - (v / max) * 36).toFixed(1)}`).join(' ');
  const by = res ? 40 - (res.before / max) * 36 : 0;
  return (
    <div style={{ marginTop: 12 }}>
      <div className="faint" style={{ fontSize: 11.5 }} title="Run on a copy of the cells you are viewing; your population is not changed">
        Experiment in a test tube
      </div>
      <div className="exp-row">
        <button className="btn sm" onClick={() => run('knockout')} title="Delete the gene">
          Knock out
        </button>
        <button className="btn sm" onClick={() => run('inhibit')} title="An inhibitor leaves 20% of the activity">
          Inhibit
        </button>
        <button className="btn sm" onClick={() => run('overexpress')} title="Five times more enzyme">
          ×5 enzyme
        </button>
      </div>
      {res && (
        <div className="exp-res">
          <b>{res.label}</b>: growth {ratio > 1.005 ? 'rose' : ratio < 0.995 ? 'fell' : 'held'} to{' '}
          <b style={{ color: ratio < 0.7 ? 'var(--danger)' : ratio > 1.05 ? 'var(--accent)' : 'var(--text)' }}>{(ratio * 100).toFixed(0)}%</b> of before.
          {ratio > 0.97 && ratio < 1.03 && res.kind !== 'overexpress' && <span className="faint"> This step has little control right now.</span>}
          {res.kind === 'overexpress' && ratio < 1.03 && <span className="faint"> More of it does not help: another step limits growth.</span>}
          <svg viewBox="0 0 100 44" preserveAspectRatio="none">
            <line x1="0" x2="100" y1={by} y2={by} stroke="var(--text-3)" strokeDasharray="2 3" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            <path d={d} fill="none" stroke="var(--accent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          </svg>
          <div className="faint" style={{ fontSize: 10.5 }}>Growth over 90 s (dashed: before)</div>
        </div>
      )}
    </div>
  );
}

function Meter({ label, value, text, color }: { label: string; value: number; text: string; color: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', alignItems: 'center', gap: 10, fontSize: 11.5 }}>
      <span className="faint">{label}</span>
      <div>
        <div className="bar">
          <i style={{ width: Math.max(2, value * 100) + '%', background: color }} />
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 3 }}>{text}</div>
      </div>
    </div>
  );
}
