// The hero: your population as living cells, drawn as technical line art.
// Each cell belongs to a variant (colour) and shows that variant's real
// anatomy. Cells crawl or swim, divide by pinching in two, and burst (lyse)
// when they die; food drifts in the water and is absorbed by nearby cells.
import { useEffect, useRef, useState } from 'react';
import { useGame, variantName, nameKey, onGameEvent } from '../store';
import { useCanvas } from '../hooks';
import { LINEAGE, MOODS, POOL, mix, MONO, SANS } from '../theme';
import { send } from '../simClient';
import { DEV } from '../components/DevPanel';
import { ConcGraph, fmtC, thresholdsFor } from '../components/ConcGraph';
import { ACTS } from '../../content';
import type { LineageSnap, Snapshot } from '../../sim/snapshot';
import { TAU, ORG, cellSprite, drawPhage, drawLiveCell, glowSprite, halfOutline, randomShape, type CellLook, type Shape } from '../art';

interface Cell {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  size: number;
  lid: number;
  div: number; // division progress 0..1 (0 = not dividing)
  angle: number;
  spin: number;
  wa: number;
  seed: number;
  lyse: number; // 0 alive, then 0..1 as it bursts
  phaged: boolean;
  born: number;
  shape: Shape;
  flash: number; // >0 while a cell takes up a released cassette
  kidPh?: number[]; // wobble phases chosen for the daughter when division starts
  fade?: number; // 1 → 0 while a surplus cell quietly leaves the view
  split?: number; // time of the last division, so sisters part slowly
  birth?: { pts: { x: number; y: number }[]; k: number }; // newborn: starts as its half of the parent's outline
  layer?: 0 | 1 | 2; // 0 front (sharp, big), 1 middle, 2 back (small, soft, faint)
  z?: number; // current depth, easing toward the layer: 0 .. 2
}
interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  s: number;
  rot: number;
}
interface Debris {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  kind: 'frag' | 'dot' | 'phage' | 'leak';
  a: number;
  va: number;
  c: string;
  len: number;
}

/** Size and opacity of the three depth layers (z eases between 0 front, 1 middle, 2 back). */
const lerp3 = (z: number, a: number, b: number, c: number) => (z <= 1 ? a + (b - a) * Math.max(0, z) : b + (c - b) * Math.min(1, z - 1));
const layerScale = (z: number) => lerp3(z, 1, 0.74, 0.54);
const layerAlpha = (z: number) => lerp3(z, 1, 0.62, 0.4);
function layerCanvas(list: { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D }[], i: number) {
  if (!list[i]) {
    const c = document.createElement('canvas');
    list[i] = { c, ctx: c.getContext('2d')! };
  }
  return list[i];
}

/**
 * Where the two daughters begin: touching at the old waist, flat faces toward
 * each other. Rods split at the septum; round cells halve along the axis.
 */
function daughters(c: Cell, rod: boolean, aspect: number): { x: number; y: number; r: number; shape: Shape }[] {
  const ca = Math.cos(c.angle);
  const sa = Math.sin(c.angle);
  // round cells: the two lobes of the fully pinched outline are nearly round,
  // about 0.72 r wide and 0.8 r from the middle, so the daughters start there
  const r2 = rod ? c.r * 0.9 : c.r * 0.72;
  const off = rod ? c.r * aspect * c.shape.len * 0.925 : c.r * 0.8;
  const kid = c.kidPh ?? c.shape.ph;
  return [
    { x: c.x - ca * off, y: c.y - sa * off, r: r2, shape: { ...c.shape, flat: 0 } },
    { x: c.x + ca * off, y: c.y + sa * off, r: r2, shape: { ...c.shape, ph: kid, flat: 0 } },
  ];
}

function has(l: LineageSnap | undefined, id: string) {
  return !!l && l.muts.some((m) => m.id === id || m.id.startsWith(id + '#'));
}

/** The anatomy a variant shows in this act (interior only; the membrane is drawn live). */
export function lookFor(act: number, l: LineageSnap | undefined, color: string, variant: number): CellLook {
  const f: string[] = [];
  const base = { color, variant, bare: true };
  if (act === 1) return { ...base, morph: 'proto', aspect: 1, features: f };
  if (act === 2) {
    f.push('fes');
    if (has(l, 'a2-atps')) f.push('atps');
    return { ...base, morph: 'rod', aspect: 1.55, features: f };
  }
  if (act === 3) {
    f.push('atps', 'flag');
    if (has(l, 'a3-glyc')) f.push('glyc');
    return { ...base, morph: 'rod', aspect: 1.85, features: f };
  }
  if (act === 4) return { ...base, morph: 'cyano', aspect: 1, features: ['atps'] };
  if (act === 5) {
    if (has(l, 'a5-nucleus')) f.push('nucleus');
    if (has(l, 'a5-endo')) f.push(has(l, 'a5-import') ? 'mito4' : 'mito');
    if (has(l, 'a5-er')) f.push('golgi');
    return { ...base, morph: 'euk', aspect: 1, features: f };
  }
  f.push('nucleus', 'golgi', 'mito4');
  const klepto = has(l, 'a6-klepto');
  const hetero = has(l, 'a6-hetero');
  if (klepto && !hetero) f.push(has(l, 'a6-tic') ? 'chloro4' : 'chloro');
  if (hetero || !klepto) f.push('vacuole');
  if (has(l, 'a6-nitro')) f.push('nitroplast');
  return { ...base, morph: 'euk', aspect: 1, features: f };
}

const FOOD_COL: Record<string, string> = { nucleotides: POOL.rna, H2: POOL.nad, glucose: POOL.carbon, light: POOL.light, organics: POOL.lipid, prey: POOL.carbon };
const morphOf = (act: number) => (act === 1 ? 'proto' : act === 2 || act === 3 ? 'rod' : act === 4 ? 'cyano' : 'euk');

export function CellView() {
  const snap = useGame((s) => s.snap)!;
  const names = useGame((s) => s.names);
  const rename = useGame((s) => s.rename);
  const ref = useRef(snap);
  ref.current = snap;
  const namesRef = useRef(names);
  namesRef.current = names;
  const reduced = useGame((s) => s.settings.reducedMotion);
  const set = useGame((s) => s.set);
  const [editing, setEditing] = useState<{ key: string; value: string } | null>(null);
  const [inside, setInside] = useState(false);
  const cells = useRef<Cell[]>([]);
  const food = useRef<Mote[]>([]);
  const debris = useRef<Debris[]>([]);
  const shareT = useRef(0);
  const layers = useRef<{ c: HTMLCanvasElement; ctx: CanvasRenderingContext2D }[]>([]);
  const dust = useRef<{ x: number; y: number; z: number }[]>([]);
  const bokeh = useRef<{ x: number; y: number; r: number; vx: number; vy: number; c: string; a: number }[]>([]);
  const bubbles = useRef<{ x: number; y: number; r: number; life: number }[]>([]);
  const flashes = useRef<{ x: number; y: number; life: number; c: string }[]>([]);
  const transforms = useRef<{ from: number; to: number; rate: number }[]>([]);
  // a released cassette: that share of the source cells visibly takes it up
  useEffect(() => {
    const off = onGameEvent((e) => {
      const d = e.data as { from?: number; to?: number; rate?: number } | undefined;
      if (e.kind === 'purchase' && d?.to !== undefined && d.from !== undefined) transforms.current.push({ from: d.from, to: d.to, rate: d.rate ?? 0.05 });
    });
    return () => {
      off();
    };
  }, []);

  const pick = (s: Snapshot) => {
    let r = Math.random();
    for (const l of s.lineages) {
      r -= l.freq;
      if (r <= 0) return l.id;
    }
    return s.lineages[0]?.id ?? 1;
  };

  /** Burst a cell: membrane fragments, cytoplasm and (if a virus did it) new phages fly out. */
  const lyse = (c: Cell, col: string, phage: boolean) => {
    if (c.lyse > 0) return;
    c.lyse = 0.001;
    c.phaged = phage;
    const n = 26;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + Math.random() * 0.3;
      const sp = 18 + Math.random() * 40;
      const kind: Debris['kind'] = i % 3 === 0 ? 'frag' : 'dot';
      debris.current.push({ x: c.x + Math.cos(a) * c.r * 0.9, y: c.y + Math.sin(a) * c.r * 0.9, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, kind, a: a + Math.PI / 2, va: (Math.random() - 0.5) * 3, c: kind === 'frag' ? '#ffffff' : i % 2 ? col : '#ffffff', len: c.r * (0.18 + Math.random() * 0.2) });
    }
    // what was inside leaks out: energy carriers, reducing power, carbon; neighbours can take it up
    const inside = [POOL.atp, POOL.nad, POOL.carbon, POOL.atp, col];
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * TAU;
      const sp = 6 + Math.random() * 16;
      debris.current.push({ x: c.x + Math.cos(a) * c.r * 0.5, y: c.y + Math.sin(a) * c.r * 0.5, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, kind: 'leak', a: 0, va: 0, c: inside[i % inside.length], len: 1.2 + Math.random() * 1.1 });
    }
    if (phage)
      for (let i = 0; i < 7; i++) {
        const a = Math.random() * TAU;
        debris.current.push({ x: c.x, y: c.y, vx: Math.cos(a) * 30, vy: Math.sin(a) * 30, life: 1.6, kind: 'phage', a: a + Math.PI / 2, va: 0.4, c: POOL.oxygen, len: 3 });
      }
    if (debris.current.length > 500) debris.current.splice(0, debris.current.length - 500);
  };

  const canvas = useCanvas(
    (ctx, w, h, t, dt) => {
      const s = ref.current;
      const act = s.act;
      const move = reduced ? 0 : 1;
      ctx.clearRect(0, 0, w, h);
      const day = s.dayPhase === null ? 1 : Math.max(0, Math.sin(s.dayPhase * TAU));
      const lin = new Map(s.lineages.map((l) => [l.id, l]));
      const colOf = (l: LineageSnap | undefined) => LINEAGE[(l?.color ?? 0) % LINEAGE.length];

      ctx.globalCompositeOperation = 'lighter';
      // ---- deep dust with parallax ----
      if (dust.current.length < 140) for (let i = 0; i < 140; i++) dust.current.push({ x: Math.random() * w, y: Math.random() * h, z: 0.2 + Math.random() * 0.8 });
      ctx.fillStyle = 'rgb(220,230,255)';
      for (const d of dust.current) {
        d.x = (d.x + (4 + 6 * d.z) * dt * move + w) % w;
        d.y = (d.y + Math.sin(t * 0.2 + d.z * 9) * 2 * dt * move + h) % h;
        ctx.globalAlpha = 0.05 + 0.2 * d.z;
        const sz = 0.6 + d.z * 0.9;
        ctx.fillRect(d.x, d.y, sz, sz);
      }
      ctx.globalAlpha = 1;
      // ---- bokeh orbs (depth) ----
      if (bokeh.current.length < 4) {
        const acc = MOODS[Math.min(act, 8)]?.accent ?? '#00e5ff';
        const cols = [acc, acc, '#ffffff', acc];
        for (let i = 0; i < 4; i++) bokeh.current.push({ x: Math.random() * w, y: Math.random() * h, r: 30 + Math.random() * 90, vx: (Math.random() - 0.5) * 6, vy: (Math.random() - 0.5) * 4, c: cols[i % cols.length], a: 0.25 + Math.random() * 0.4 });
      }
      for (const b of bokeh.current) {
        b.x += b.vx * dt * move;
        b.y += b.vy * dt * move;
        if (b.x < -b.r) b.x = w + b.r;
        if (b.x > w + b.r) b.x = -b.r;
        if (b.y < -b.r) b.y = h + b.r;
        if (b.y > h + b.r) b.y = -b.r;
        ctx.globalAlpha = b.a * 0.25;
        ctx.drawImage(glowSprite(b.c, 0.18), b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);
      }
      ctx.globalAlpha = 1;
      if (act === 4 || act === 6) {
        const tint = s.goe > 0 ? '#ffb38a' : POOL.light;
        for (let i = 0; i < 4; i++) {
          const x = w * (0.12 + i * 0.26) + Math.sin(t * 0.08 + i) * 40;
          const gr = ctx.createLinearGradient(x, 0, x + 120, h);
          gr.addColorStop(0, mix(tint, 0.07 * day + 0.01));
          gr.addColorStop(1, mix(tint, 0));
          ctx.fillStyle = gr;
          ctx.beginPath();
          ctx.moveTo(x - 40, 0);
          ctx.lineTo(x + 40, 0);
          ctx.lineTo(x + 200, h);
          ctx.lineTo(x - 10, h);
          ctx.fill();
        }
      }
      ctx.globalCompositeOperation = 'source-over';

      // ---- population sample ----
      const logP = Math.log10(Math.max(10, Number(s.P)));
      const N = Math.max(9, Math.min(act >= 5 ? 12 : 20, Math.round(7 + (logP - 3) * 1.5)));
      const rod = act === 2 || act === 3;
      const aspect = act === 2 ? 1.55 : act === 3 ? 1.85 : 1;
      const K = act === 1 ? 4.4 : rod ? 6.8 : act === 4 ? 5 : 4.1;
      const base = Math.min(w, h) / (Math.sqrt(N) * K);
      const morph = morphOf(act);
      const list = cells.current;
      while (list.length < Math.min(N, 6)) list.push(newCell(w, h, base, pick(s), t, morph));
      // every second, nudge the shares on screen toward the real ones
      // (also catches up after the tab was hidden)
      shareT.current -= dt;
      if (shareT.current <= 0 && list.length) {
        shareT.current = 1;
        const alive = list.filter((c) => c.lyse === 0 && !c.fade && c.div === 0);
        const n = alive.length;
        const gap = s.lineages.map((l) => ({ l, d: l.freq * n - alive.filter((c) => c.lid === l.id).length }));
        const under = gap.filter((g) => g.d >= 0.6).sort((a, b) => b.d - a.d)[0];
        const known = new Set(s.lineages.map((l) => l.id));
        const strays = alive.filter((c) => !known.has(c.lid));
        const over = gap.filter((g) => g.d <= -0.6).sort((a, b) => a.d - b.d)[0];
        const from = strays[0] ?? (over ? alive.find((c) => c.lid === over.l.id) : undefined);
        if (under && from) {
          from.lid = under.l.id;
          from.flash = 0.8;
        }
      }
      const growth = Math.max(0.15, Math.min(2.5, s.mu * 6));
      const declining = s.growth < -0.0005;
      const virus = s.virus?.active ? s.virus.pressure : 0;
      for (const tr of transforms.current) {
        const src = list.filter((c) => c.lid === tr.from && c.lyse === 0);
        const pool = src.length ? src : list.filter((c) => c.lyse === 0);
        const k = Math.max(1, Math.round(tr.rate * pool.length));
        for (const c of pool.sort(() => Math.random() - 0.5).slice(0, k)) {
          c.lid = tr.to;
          c.flash = 1;
          c.born = t - 2;
        }
      }
      transforms.current = [];
      const next: Cell[] = [];
      for (const c of list) {
        const l = lin.get(c.lid);
        if (!l) c.lid = pick(s);
        const reach = c.r * (rod ? aspect * c.shape.len : 1.08);
        if (move && c.lyse === 0) {
          c.wa += Math.sin(t * 0.31 + c.seed * 40) * 0.5 * dt;
          const sp = act === 3 ? 16 : morph === 'euk' ? 5 : 7;
          c.vx += (Math.cos(c.wa) * sp - c.vx) * dt * 0.5;
          c.vy += (Math.sin(c.wa) * sp - c.vy) * dt * 0.5;
          c.x += c.vx * dt;
          c.y += c.vy * dt;
          if (act === 3) {
            let d = Math.atan2(c.vy, c.vx) - c.angle;
            d = Math.atan2(Math.sin(d), Math.cos(d));
            c.angle += d * dt * 1.2;
          } else c.angle += c.spin * dt * (c.div > 0 ? 0.2 : 1);
        }
        const m = reach + 12;
        if (c.x < m) c.wa = 0;
        if (c.x > w - m) c.wa = Math.PI;
        if (c.y < m) c.wa = Math.PI / 2;
        if (c.y > h - m - 70) c.wa = -Math.PI / 2;
        c.x = Math.max(reach, Math.min(w - reach, c.x));
        c.y = Math.max(reach, Math.min(h - reach - 50, c.y));
        if (c.x < 300 && c.y < 230) c.x += 14 * dt;
        if (c.shape.flat && c.shape.flat > 0) c.shape.flat = Math.max(0, c.shape.flat - dt / 1.6);
        if (c.birth) {
          c.birth.k -= (dt * Math.max(move, 0.25)) / 2.4;
          if (c.birth.k <= 0) c.birth = undefined;
        }
        // three layers; now and then a cell swims forward or back by one layer
        if (c.layer === undefined) {
          const r0 = Math.random();
          c.layer = r0 < 0.55 ? 0 : r0 < 0.82 ? 1 : 2;
          c.z = c.layer;
        }
        if (move && c.div === 0 && t - (c.split ?? -99) > 8 && Math.random() < dt / 55) c.layer = (c.layer === 0 ? 1 : c.layer === 2 ? 1 : Math.random() < 0.5 ? 0 : 2) as 0 | 1 | 2;
        const zt = c.layer;
        c.z = (c.z ?? zt) + Math.sign(zt - (c.z ?? zt)) * Math.min(Math.abs(zt - (c.z ?? zt)), 0.45 * dt * Math.max(move, 0.3));
        if (c.lyse > 0) {
          c.lyse += dt * 0.6;
          if (c.lyse >= 1) continue;
        } else if (c.div > 0) {
          c.div += dt / 4.2;
          if (c.div >= 1) {
            // two daughters, exactly where the cross-fade drew them; they drift apart gently
            const [d1, d2] = daughters(c, rod, aspect);
            // each daughter's first outline is exactly its half of the pinched parent
            const spP = cellSprite(lookFor(act, l, colOf(l), Math.floor(c.seed * 6)));
            const b1 = halfOutline(spP, c.x, c.y, c.r, c.angle, t * move, c.shape, -1, d1.x, d1.y);
            const b2 = halfOutline(spP, c.x, c.y, c.r, c.angle, t * move, c.shape, 1, d2.x, d2.y);
            // the same interior variant, so the inside does not jump either
            const seed = (Math.floor(c.seed * 6) + Math.random()) / 6;
            const child: Cell = { ...c, seed, x: d2.x, y: d2.y, vx: c.vx + Math.cos(c.angle) * 2, vy: c.vy + Math.sin(c.angle) * 2, born: t - 2, wa: c.wa + 1, r: d2.r, div: 0, kidPh: undefined, shape: d2.shape, birth: { pts: b2, k: 1 } };
            c.birth = { pts: b1, k: 1 };
            c.x = d1.x;
            c.y = d1.y;
            c.vx -= Math.cos(c.angle) * 2;
            c.vy -= Math.sin(c.angle) * 2;
            c.r = d1.r;
            c.shape = d1.shape;
            c.div = 0;
            c.kidPh = undefined;
            c.split = t;
            child.split = t;
            next.push(child);
          }
        } else if (move) {
          if (!l?.dormant) {
            c.r += base * c.size * 0.025 * growth * dt;
            if (c.r > base * c.size * (rod ? 1.16 : 1.3)) {
              c.div = 0.001;
              c.kidPh = c.shape.ph.map((p) => p + Math.random());
            }
          }
          // deaths: crowding, a shrinking population, or a virus on the commonest variant
          const deathRate = (list.length > N ? 0.08 : 0) + (declining ? 0.12 : 0) + (virus && c.lid === s.dominant ? virus * 0.25 : 0);
          if (deathRate > 0 && Math.random() < deathRate * dt) lyse(c, colOf(l), !!virus && c.lid === s.dominant);
        }
        next.push(c);
      }
      if (next.length < N && Math.random() < dt * 0.6) next.push(newCell(w, h, base, pick(s), t, morph));
      // surplus cells (crowding) fade out quietly instead of vanishing
      let surplus = next.filter((c) => !c.fade && c.lyse === 0).length - (N + 4);
      for (const c of next) {
        if (surplus <= 0) break;
        if (!c.fade && c.lyse === 0 && c.div === 0) {
          c.fade = 1;
          surplus--;
        }
      }
      for (const c of next) if (c.fade) c.fade = Math.max(0, c.fade - dt * 0.6);
      cells.current = next.filter((c) => c.fade === undefined || c.fade > 0);
      if (DEV) (window as unknown as { __cells: Cell[] }).__cells = cells.current;
      // keep cells from growing into each other: a few rounds of positional relaxation
      const live = cells.current.filter((c) => c.lyse === 0);
      const reachOf = (c: Cell) => c.r * (rod ? aspect * c.shape.len * (1 + 0.6 * c.div) * 0.92 : (act >= 5 ? 1.22 : 1.1) * (1 + 0.45 * c.div));
      for (let pass = 0; pass < 3; pass++) {
        for (let i = 0; i < live.length; i++) {
          for (let j = i + 1; j < live.length; j++) {
            const a2 = live[i];
            const b2 = live[j];
            if (Math.round(a2.z ?? 0) !== Math.round(b2.z ?? 0)) continue;
            const dx = b2.x - a2.x;
            const dy = b2.y - a2.y;
            const d = Math.hypot(dx, dy) || 0.01;
            const min = (reachOf(a2) * layerScale(a2.z ?? 0) + reachOf(b2) * layerScale(b2.z ?? 0)) + 4;
            if (d < min) {
              const sisters = Math.max(0, 1 - Math.min(t - (a2.split ?? -9), t - (b2.split ?? -9)) / 2.5);
              // firm for strangers (no overlaps), gentle for sisters that just split
              const push = Math.min(2.2, (min - d) * 0.2) * (1 - 0.85 * sisters);
              a2.x -= (dx / d) * push;
              a2.y -= (dy / d) * push;
              b2.x += (dx / d) * push;
              b2.y += (dy / d) * push;
            }
          }
        }
      }

      // ---- food motes, absorbed by nearby cells ----
      const fcol = FOOD_COL[s.food] ?? POOL.carbon;
      const nFood = Math.round(Math.min(1.4, s.foodLevel) * (act === 4 ? 50 : 70)) + 6;
      while (food.current.length < nFood) {
        const fromTop = s.food === 'light';
        food.current.push({ x: Math.random() * w, y: fromTop ? -10 : Math.random() * h, vx: (Math.random() - 0.5) * 8, vy: fromTop ? 30 + Math.random() * 30 : (Math.random() - 0.5) * 8, s: 0.7 + Math.random() * 0.8, rot: Math.random() * TAU });
      }
      if (food.current.length > nFood + 10) food.current.length = nFood + 10;
      const keep: Mote[] = [];
      const podTarget = new Map<Cell, number>();
      ctx.globalCompositeOperation = 'lighter';
      const fa = act === 4 ? 0.35 + 0.65 * day : 1;
      for (const f of food.current) {
        let eaten = false;
        if (move) {
          for (const c of cells.current) {
            if (c.lyse > 0) continue;
            const dx = c.x - f.x;
            const dy = c.y - f.y;
            const d = Math.hypot(dx, dy) || 1;
            const reach = c.r * (rod ? aspect : 1);
            if (morph === 'euk' && d < reach * 2.6 && !podTarget.has(c)) podTarget.set(c, Math.atan2(-dy, -dx));
            if (d < reach * 1.9) {
              f.vx += (dx / d) * 60 * dt;
              f.vy += (dy / d) * 60 * dt;
              if (d < reach * 0.55) eaten = true;
              break;
            }
          }
          f.vx *= 0.985;
          f.vy *= 0.985;
          f.x += f.vx * dt;
          f.y += f.vy * dt;
          f.rot += dt * 0.6;
        }
        if (eaten) {
          if (flashes.current.length < 24) flashes.current.push({ x: f.x, y: f.y, life: 1, c: fcol });
          continue;
        }
        if (f.x < -20 || f.x > w + 20 || f.y < -20 || f.y > h + 20) continue;
        keep.push(f);
        ctx.globalAlpha = 0.5 * fa;
        ctx.drawImage(glowSprite(fcol, 0.5), f.x - 7 * f.s, f.y - 7 * f.s, 14 * f.s, 14 * f.s);
        ctx.globalAlpha = 0.85 * fa;
        ctx.strokeStyle = fcol;
        ctx.lineWidth = 0.9;
        drawFood(ctx, s.food, f.x, f.y, 2.6 * f.s, f.rot);
      }
      food.current = keep;
      for (const fl of flashes.current) {
        fl.life -= dt * 2.2;
        ctx.globalAlpha = Math.max(0, fl.life) * 0.7;
        const rr = 10 * (1.4 - fl.life);
        ctx.drawImage(glowSprite(fl.c, 0.7), fl.x - rr, fl.y - rr, rr * 2, rr * 2);
      }
      flashes.current = flashes.current.filter((f) => f.life > 0);
      ctx.globalAlpha = 1;

      // ---- draw cells ----
      const flags = new Set(s.cell?.flags ?? []);
      const dom = s.dominant;
      const drawCell = (ctx: CanvasRenderingContext2D, c: Cell, am = 1) => {
        const l = lin.get(c.lid);
        const col = colOf(l);
        // further layers look fainter
        let alpha = Math.min(1, (t - c.born) * 1.5 + 0.15) * layerAlpha(c.z ?? 0) * am;
        if (l?.dormant) alpha *= 0.4;
        if (act === 4) alpha *= 0.55 + 0.45 * Math.max(day, 0.25);
        const sp = cellSprite(lookFor(act, l, col, Math.floor(c.seed * 6)));
        // halo
        ctx.globalCompositeOperation = 'lighter';
        const hr = c.r * (rod ? aspect * 1.6 : 2.1) * (1 + c.div * 0.4);
        ctx.globalAlpha = alpha * 0.7 * (c.lyse > 0 ? 1 - c.lyse : 1);
        ctx.drawImage(glowSprite(col, 0.22), c.x - hr, c.y - hr, hr * 2, hr * 2);
        ctx.globalAlpha = 1;
        if (act === 3 && c.lyse === 0) {
          const L = c.r * aspect * c.shape.len * (1 + 0.85 * c.div);
          const ca = Math.cos(c.angle);
          const sa = Math.sin(c.angle);
          const g = ctx.createLinearGradient(c.x - ca * L, c.y - sa * L, c.x - ca * L * 3.4, c.y - sa * L * 3.4);
          g.addColorStop(0, mix(col, 0.85 * alpha));
          g.addColorStop(0.5, mix(col, 0.35 * alpha));
          g.addColorStop(1, mix(col, 0));
          ctx.strokeStyle = g;
          ctx.lineWidth = 1.3;
          ctx.beginPath();
          for (let k = 0; k <= 30; k++) {
            const u = k / 30;
            const lx = -L - u * L * 2.4;
            const ly = Math.sin(u * 10 - t * 10 * move + c.seed * 5) * c.r * 0.28 * u;
            const x = c.x + lx * ca - ly * sa;
            const y = c.y + lx * sa + ly * ca;
            if (k === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
        ctx.globalCompositeOperation = 'source-over';
        if (c.fade !== undefined) alpha *= c.fade;
        drawLiveCell(ctx, sp, { x: c.x, y: c.y, r: c.r, angle: c.angle, t: t * move, shape: c.shape, div: c.div, dying: 1 - c.lyse, alpha, accent: col, podDir: podTarget.get(c) ?? null, birth: c.birth });
        if (c.flash > 0) {
          // taking up the new DNA: converging rings in the new variant's colour
          c.flash = Math.max(0, c.flash - dt * 0.35);
          const f = c.flash;
          ctx.strokeStyle = mix(col, 0.9 * f);
          ctx.lineWidth = 1.5;
          for (let k2 = 0; k2 < 3; k2++) {
            const ph = ((t * 0.9 + k2 / 3) % 1);
            ctx.globalAlpha = f * (1 - ph);
            ctx.beginPath();
            ctx.arc(c.x, c.y, c.r * (2.4 - ph * 1.3), 0, TAU);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
          if (f > 0.4) {
            ctx.font = `600 9px ${MONO}`;
            ctx.fillStyle = mix(col, f);
            ctx.textAlign = 'center';
            ctx.fillText('TAKING UP DNA', c.x, c.y - c.r * 1.6);
            ctx.textAlign = 'left';
          }
        }
        if (act === 5 && !has(l, 'a5-endo') && c.lyse === 0) {
          for (let i = 0; i < 3; i++) {
            const a = c.seed * 5 + (i / 3) * TAU + t * 0.05 * move;
            const px = c.x + Math.cos(a) * c.r * 1.2;
            const py = c.y + Math.sin(a) * c.r * 1.2;
            drawPartner(ctx, px, py, c.r * 0.22, a + Math.PI / 2, alpha);
            if (has(l, 'a5-ent')) {
              ctx.strokeStyle = mix(col, 0.55 * alpha);
              ctx.lineWidth = 1.2;
              ctx.beginPath();
              ctx.moveTo(c.x + Math.cos(a - 0.32) * c.r, c.y + Math.sin(a - 0.32) * c.r);
              ctx.quadraticCurveTo(px + Math.cos(a) * c.r * 0.35, py + Math.sin(a) * c.r * 0.35, c.x + Math.cos(a + 0.32) * c.r, c.y + Math.sin(a + 0.32) * c.r);
              ctx.stroke();
            }
          }
        }
        if (act === 4 && flags.has('oxygenic') && day > 0.3 && move && c.lyse === 0 && Math.random() < dt * 0.7) bubbles.current.push({ x: c.x + (Math.random() - 0.5) * c.r, y: c.y - c.r, r: 1.5 + Math.random() * 2.2, life: 1 });
      };
      // back and middle layers render at low resolution, then scale up: soft focus for free
      const sizeLayer = (L: { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D }, res: number) => {
        const cw = Math.max(1, Math.round(w * res));
        const ch = Math.max(1, Math.round(h * res));
        if (L.c.width !== cw || L.c.height !== ch) {
          L.c.width = cw;
          L.c.height = ch;
        }
        L.ctx.setTransform(1, 0, 0, 1, 0, 0);
        L.ctx.clearRect(0, 0, cw, ch);
        L.ctx.setTransform(res, 0, 0, res, 0, 0);
      };
      const back = layerCanvas(layers.current, 0);
      const mid = layerCanvas(layers.current, 1);
      sizeLayer(back, 0.38);
      sizeLayer(mid, 0.6);
      const order = [...cells.current].sort((a, b) => (b.z ?? 0) - (a.z ?? 0));

      const inScale = (g: CanvasRenderingContext2D, c: Cell, f: () => void) => {
        const k2 = layerScale(c.z ?? 0);
        g.save();
        g.translate(c.x, c.y);
        g.scale(k2, k2);
        g.translate(-c.x, -c.y);
        f();
        g.restore();
      };
      // a cell between two layers is drawn in both, cross-faded, so it softens gradually
      const parts = (z: number): [number, number][] => {
        const i0 = Math.floor(Math.min(2, Math.max(0, z)));
        const f = Math.min(2, Math.max(0, z)) - i0;
        return f < 0.02 ? [[i0, 1]] : f > 0.98 ? [[i0 + 1, 1]] : [[i0, 1 - f], [i0 + 1, f]];
      };
      for (const c of order)
        for (const [L, a] of parts(c.z ?? 0)) {
          if (L === 2) inScale(back.ctx, c, () => drawCell(back.ctx, c, a));
          else if (L === 1) inScale(mid.ctx, c, () => drawCell(mid.ctx, c, a));
        }
      ctx.drawImage(back.c, 0, 0, w, h);
      ctx.drawImage(mid.c, 0, 0, w, h);
      for (const c of order)
        for (const [L, a] of parts(c.z ?? 0)) if (L === 0) inScale(ctx, c, () => drawCell(ctx, c, a));
      // debris from lysed cells
      debris.current = debris.current.filter((d) => d.life > 0);
      for (const d of debris.current) {
        d.life -= dt * (d.kind === 'phage' ? 0.35 : d.kind === 'leak' ? 0.09 : 0.55);
        d.vx *= d.kind === 'leak' ? 0.985 : 0.97;
        d.vy *= d.kind === 'leak' ? 0.985 : 0.97;
        if (d.kind === 'leak') {
          // leaked molecules drift, and a living neighbour that touches them takes them up
          d.vx += Math.sin(t * 0.7 + d.len * 9) * 2 * dt;
          d.vy += Math.cos(t * 0.6 + d.len * 7) * 2 * dt;
          for (const c of cells.current) {
            if (c.lyse > 0) continue;
            const dx = c.x - d.x;
            const dy = c.y - d.y;
            if (dx * dx + dy * dy < c.r * c.r * 1.2) {
              d.life = 0;
              break;
            }
          }
        }
        d.x += d.vx * dt * move;
        d.y += d.vy * dt * move;
        d.a += d.va * dt;
        const a = Math.max(0, Math.min(1, d.life));
        if (d.kind === 'frag') {
          ctx.strokeStyle = mix(d.c, 0.75 * a);
          ctx.lineWidth = 1.1;
          ctx.beginPath();
          ctx.arc(d.x, d.y, d.len, d.a, d.a + 0.9);
          ctx.stroke();
        } else if (d.kind === 'dot') {
          ctx.fillStyle = mix(d.c, 0.8 * a);
          ctx.fillRect(d.x, d.y, 1.6, 1.6);
        } else if (d.kind === 'leak') {
          ctx.fillStyle = mix(d.c, 0.7 * Math.min(1, a * 1.6));
          ctx.beginPath();
          ctx.arc(d.x, d.y, d.len, 0, TAU);
          ctx.fill();
        } else drawPhage(ctx, d.x, d.y, 3, d.a, d.c, a);
      }
      // oxygen bubbles
      bubbles.current = bubbles.current.filter((b) => b.life > 0);
      for (const b of bubbles.current) {
        b.life -= dt * 0.35;
        b.y -= 24 * dt;
        b.x += Math.sin(t * 2 + b.r) * 6 * dt;
        ctx.strokeStyle = mix(POOL.oxygen, 0.75 * b.life);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, TAU);
        ctx.stroke();
      }
      // viruses waiting on the commonest variant
      if (virus) {
        const victims = cells.current.filter((c) => c.lid === dom && c.lyse === 0).slice(0, 4);
        const n = Math.round(3 + virus * 18);
        for (let i = 0; i < n && victims.length; i++) {
          const v = victims[i % victims.length];
          const a = (i / n) * TAU + t * 0.15 * move + v.seed;
          drawPhage(ctx, v.x + Math.cos(a) * v.r * 1.3, v.y + Math.sin(a) * v.r * 1.3, 3.2, a + Math.PI / 2, POOL.oxygen);
        }
      }
      // ---- callouts: label the leader and the newest spreading variant ----
      const rising = s.lineages.filter((l) => l.id !== dom && l.s > 0.0005 && l.freq > 0.002).sort((a, b) => b.s - a.s)[0];
      const targets = [s.lineages.find((l) => l.id === dom), rising].filter(Boolean) as LineageSnap[];
      const used: Cell[] = [];
      for (const l of targets) {
        const cand = cells.current
          .filter((c) => c.lid === l.id && c.lyse === 0 && c.div === 0 && (c.z ?? 0) < 0.3 && !used.includes(c) && !(c.x < 330 && c.y < 270) && !(c.x > w - 340 && c.y < 250) && c.y > 90)
          .sort((a, b) => Math.abs(a.x - w * 0.55) + Math.abs(a.y - h * 0.45) - (Math.abs(b.x - w * 0.55) + Math.abs(b.y - h * 0.45)))[0];
        if (!cand) continue;
        used.push(cand);
        callout(ctx, cand, variantName(namesRef.current, act, l), l.freq, w, colOf(l), l.id === dom ? 'MOST COMMON' : 'SPREADING', rod ? aspect : 1, t);
      }
    },
    [reduced],
  );

  const lineages = [...snap.lineages].sort((a, b) => b.freq - a.freq).slice(0, 6);
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <canvas ref={canvas} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      <div className="legend">
        <h5>
          Population <span className="faint">· {snap.lineages.length} variant{snap.lineages.length > 1 ? 's' : ''}</span>
        </h5>
        {lineages.map((l) => {
          const key = nameKey(snap.act, l.tag, l.id);
          const col = LINEAGE[l.color % LINEAGE.length];
          if (editing?.key === key)
            return (
              <form
                key={l.id}
                className="lrow"
                onSubmit={(e) => {
                  e.preventDefault();
                  rename(key, editing.value);
                  setEditing(null);
                }}
              >
                <span className="sw" style={{ background: col, color: col }} />
                <input type="text" autoFocus maxLength={40} value={editing.value} onChange={(e) => setEditing({ key, value: e.target.value })} onBlur={() => { rename(key, editing.value); setEditing(null); }} style={{ gridColumn: '2 / 4', height: 22, padding: '2px 6px', fontFamily: 'var(--font)' }} />
              </form>
            );
          return (
            <div
              key={l.id}
              className={'lrow' + (l.id === snap.selected ? ' on' : '')}
              title="Click: view this species (its genome and pathway). Double-click: rename it."
              onClick={() => {
                send({ type: 'select', lineage: l.id });
                send({ type: 'view', lineage: l.id });
              }}
              onDoubleClick={() => setEditing({ key, value: variantName(names, snap.act, l) })}
              style={{ opacity: l.dormant ? 0.5 : 1 }}
            >
              <span className="sw" style={{ background: col, color: col }} />
              <span className="nm">
                {variantName(names, snap.act, l)}
                {l.id !== snap.dominant && l.s > 0.0005 && <span style={{ color: 'var(--accent)' }} title="Grows faster than the commonest variant: spreading"> ↑</span>}
                {l.id !== snap.dominant && l.s < -0.0005 && <span style={{ color: 'var(--danger)' }} title="Grows slower than the commonest variant: losing out"> ↓</span>}
              </span>
              <span className="num faint" style={{ textAlign: 'right' }}>{(l.freq * 100).toFixed(l.freq < 0.1 ? 1 : 0)}%</span>
            </div>
          );
        })}
        <button className="legend-sub lnk-sub" onClick={() => setInside(!inside)}>
          Inside the cell {inside ? '▴' : '▾'}
        </button>
        {inside && <InsideCell />}
        <div className="legend-sub">In the water</div>
        <div className="lrow plain" title="Food drifting in the water. Cells take it up as they pass.">
          <FoodIcon food={snap.food} />
          <span className="nm">{FOOD_NAME[snap.food] ?? 'Food'}: food, taken up as cells pass</span>
        </div>
        <div className="lrow plain" title="When a cell bursts, its contents spill out. Neighbours can take them up.">
          <svg width="12" height="12" viewBox="0 0 12 12">
            <circle cx="3" cy="4" r="1.6" fill={POOL.atp} />
            <circle cx="8" cy="3" r="1.4" fill={POOL.nad} />
            <circle cx="6" cy="8.5" r="1.5" fill={POOL.carbon} />
          </svg>
          <span className="nm">Spilled contents of a burst cell (ATP, NADH, carbon)</span>
        </div>
        <div className="legend-foot">
          <span>Click to view · double-click to rename</span>
          <button className="lnk" onClick={() => set({ screen: 'tree' })}>
            Tree →
          </button>
        </div>
      </div>
    </div>
  );
}

/** Every molecule inside the viewed cell, with its recent history and the levels that matter. */
function InsideCell() {
  const snap = useGame((s) => s.snap)!;
  const act = snap.act;
  const cell = snap.cell;
  const spec = ACTS[act];
  if (!cell || !spec) return null;
  const list = spec.network.species.filter((sp) => sp.kind !== 'boundary' && cell.ids.includes(sp.id));
  return (
    <div className="inside">
      {list.map((sp) => {
        const c = cell.conc[cell.ids.indexOf(sp.id)];
        const th = thresholdsFor(act, sp.id);
        const harm = th.find((x) => x.kind === 'harm' && c > x.value);
        return (
          <div key={sp.id} className="inside-row" title={[sp.plain, ...th.map((x) => x.text)].join(' · ')}>
            <span className="nm" style={{ color: POOL[sp.pool] }}>{sp.name}</span>
            <ConcGraph id={sp.id} width={80} height={16} compact />
            <span className="num" style={{ color: harm ? 'var(--danger)' : 'var(--text-2)' }}>{fmtC(c)}</span>
          </div>
        );
      })}
      <div className="faint" style={{ fontSize: 10.5, marginTop: 4 }}>Dashed lines: levels that switch a step on or off, or harm the cell. Click a molecule on the Pathway for details.</div>
    </div>
  );
}

const FOOD_NAME: Record<string, string> = { nucleotides: 'Nucleotides', H2: 'Hydrogen (H₂)', glucose: 'Sugar (glucose)', light: 'Sunlight', organics: 'Organics', prey: 'Prey cells' };

/** The same mark the canvas draws for this act's food, for the legend. */
function FoodIcon({ food }: { food: string }) {
  const c = FOOD_COL[food] ?? POOL.carbon;
  const poly = (n: number) => Array.from({ length: n }, (_, k) => `${6 + Math.cos(-Math.PI / 2 + (k / n) * TAU) * 4.2},${6 + Math.sin(-Math.PI / 2 + (k / n) * TAU) * 4.2}`).join(' ');
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke={c} strokeWidth="1.1">
      {food === 'nucleotides' && <polygon points={poly(5)} />}
      {food === 'glucose' && <polygon points={poly(6)} />}
      {food === 'H2' && (
        <>
          <circle cx="3.6" cy="6" r="2.4" />
          <circle cx="8.4" cy="6" r="2.4" />
        </>
      )}
      {food === 'light' && <path d="M1 6h10M6 1v10" />}
      {food === 'prey' && <rect x="1" y="3.5" width="10" height="5" rx="2.5" />}
      {!['nucleotides', 'glucose', 'H2', 'light', 'prey'].includes(food) && <circle cx="6" cy="6" r="2.6" />}
    </svg>
  );
}

function drawFood(ctx: CanvasRenderingContext2D, food: string, x: number, y: number, s: number, rot: number) {
  ctx.beginPath();
  if (food === 'nucleotides') {
    for (let k = 0; k < 5; k++) ctx.lineTo(x + Math.cos(rot + (k / 5) * TAU) * s, y + Math.sin(rot + (k / 5) * TAU) * s);
    ctx.closePath();
  } else if (food === 'glucose') {
    for (let k = 0; k < 6; k++) ctx.lineTo(x + Math.cos(rot + (k / 6) * TAU) * s, y + Math.sin(rot + (k / 6) * TAU) * s);
    ctx.closePath();
  } else if (food === 'H2') {
    ctx.arc(x - s * 0.6, y, s * 0.55, 0, TAU);
    ctx.moveTo(x + s * 1.15, y);
    ctx.arc(x + s * 0.6, y, s * 0.55, 0, TAU);
  } else if (food === 'light') {
    ctx.moveTo(x - s * 1.3, y);
    ctx.lineTo(x + s * 1.3, y);
    ctx.moveTo(x, y - s * 1.3);
    ctx.lineTo(x, y + s * 1.3);
  } else if (food === 'prey') {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.roundRect(-s * 1.4, -s * 0.6, s * 2.8, s * 1.2, s * 0.6);
    ctx.restore();
  } else ctx.arc(x, y, s * 0.6, 0, TAU);
  ctx.stroke();
}

function drawPartner(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, a: number, alpha: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.roundRect(-s * 1.5, -s * 0.75, s * 3, s * 1.5, s * 0.75);
  ctx.fillStyle = mix(ORG[0], 0.14);
  ctx.fill();
  ctx.strokeStyle = mix(ORG[0], 0.9);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  for (let k = -2; k <= 2; k++) {
    ctx.moveTo(k * s * 0.5, -s * 0.45);
    ctx.lineTo(k * s * 0.5 + s * 0.1, s * 0.15);
  }
  ctx.strokeStyle = mix(ORG[1], 0.7);
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.restore();
  ctx.globalAlpha = 1;
}

/** A technical-drawing callout: leader line, target ring, label plate. */
function callout(ctx: CanvasRenderingContext2D, c: Cell, name: string, freq: number, w: number, col: string, kind: string, aspect: number, t: number) {
  const reach = c.r * Math.max(1, aspect * 0.75);
  const right = c.x + reach + 210 < w;
  const dir = right ? 1 : -1;
  const a = right ? -Math.PI / 4 : (-Math.PI * 3) / 4;
  const x0 = c.x + Math.cos(a) * reach * 1.05;
  const y0 = c.y + Math.sin(a) * reach * 1.05;
  const x1 = x0 + dir * 22;
  const y1 = y0 - 22;
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x0, y0, 2.5, 0, TAU);
  ctx.fillStyle = col;
  ctx.fill();
  ctx.strokeStyle = mix(col, 0.5 + 0.3 * Math.sin(t * 3));
  ctx.beginPath();
  ctx.arc(x0, y0, 6, 0, TAU);
  ctx.stroke();
  const nm = name.length > 26 ? name.slice(0, 25) + '…' : name;
  ctx.font = `500 11.5px ${SANS}`;
  const tw = Math.max(ctx.measureText(nm).width, 130) + 12;
  ctx.fillStyle = 'rgba(6,8,11,0.82)';
  ctx.fillRect(right ? x1 + 1 : x1 - tw - 1, y1 - 19, tw, 39);
  ctx.strokeStyle = mix(col, 0.35);
  ctx.strokeRect(right ? x1 + 1.5 : x1 - tw - 0.5, y1 - 18.5, tw - 1, 38);
  ctx.textAlign = right ? 'left' : 'right';
  ctx.font = `600 9.5px ${MONO}`;
  ctx.fillStyle = col;
  ctx.fillText(`${kind} · ${(freq * 100).toFixed(freq < 0.1 ? 1 : 0)}%`, x1 + dir * 7, y1 - 5);
  ctx.font = `500 11.5px ${SANS}`;
  ctx.fillStyle = 'rgba(233,238,242,0.95)';
  ctx.fillText(nm, x1 + dir * 7, y1 + 13);
  ctx.textAlign = 'left';
}

function newCell(w: number, h: number, base: number, lid: number, t: number, morph: 'proto' | 'rod' | 'cyano' | 'euk'): Cell {
  const size = 0.85 + Math.random() * 0.3;
  return {
    x: base * 2 + Math.random() * Math.max(10, w - base * 4),
    y: base * 2 + Math.random() * Math.max(10, h - base * 4 - 60),
    vx: 0,
    vy: 0,
    r: base * size * (0.85 + Math.random() * 0.25),
    size,
    lid,
    div: 0,
    angle: Math.random() * TAU,
    spin: (Math.random() - 0.5) * 0.25,
    wa: Math.random() * TAU,
    seed: Math.random(),
    lyse: 0,
    phaged: false,
    born: t,
    shape: randomShape(morph),
    flash: 0,
  };
}
