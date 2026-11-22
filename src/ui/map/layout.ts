// Pathway geometry, independent of React: lays out the reactions that are
// present now as a textbook diagram (straight main arrows, near-aligned
// molecules snapped into rows and columns, short cycles as regular polygons,
// long cycles as circles, back-and-forth pairs as curved arrows), builds the
// arrow and junction geometry, and places enzyme labels without overlaps.
import type { NetworkSpec, PoolColor, ReactionSpec, SpeciesSpec } from '../../sim/types';
import { POOL } from '../theme';

export interface Pt {
  x: number;
  y: number;
}
export interface EdgeGeo {
  id: string;
  d: string;
  pts: Pt[];
  len: number[];
  pool: PoolColor;
  dashed: boolean;
  head: boolean;
}
export interface Badge {
  text: string;
  color: string;
  made: boolean;
}
export interface RxnGeo {
  r: ReactionSpec;
  p: Pt;
  edges: EdgeGeo[];
  badges: Badge[];
  pillW: number;
}

export const PREFERRED = ['ATP', 'ATPh', 'ATPp', 'NADH', 'NADPH', 'Fdr'];

export function quad(a: Pt, b: Pt, bend: number): { d: string; pts: Pt[] } {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const cx = mx - (b.y - a.y) * bend;
  const cy = my + (b.x - a.x) * bend;
  const pts: Pt[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const u = 1 - t;
    pts.push({ x: u * u * a.x + 2 * u * t * cx + t * t * b.x, y: u * u * a.y + 2 * u * t * cy + t * t * b.y });
  }
  return { d: `M${a.x.toFixed(1)},${a.y.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`, pts };
}
export function cumLen(pts: Pt[]): number[] {
  const out = [0];
  for (let i = 1; i < pts.length; i++) out.push(out[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return out;
}
export function trim(a: Pt, b: Pt, ra: number, rb: number): [Pt, Pt] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L = Math.hypot(dx, dy) || 1;
  return [
    { x: a.x + (dx / L) * ra, y: a.y + (dy / L) * ra },
    { x: b.x - (dx / L) * rb, y: b.y - (dy / L) * rb },
  ];
}
export const textW = (s: string, px = 10.5) => s.length * px * 0.6;
/** A rectangle with two cut corners, as an SVG path. */
export function notch(x: number, y: number, w: number, h: number, c: number) {
  return `M${x},${y} H${x + w - c} L${x + w},${y + c} V${y + h} H${x + c} L${x},${y + h - c} Z`;
}
export const carrierName = (s: SpeciesSpec) => s.name.replace(/\s*\(.*\)\s*$/, '').replace('Fd(red)', 'Fd');


/**
 * Textbook layout: single-step reactions become one straight arrow, directed
 * cycles of 3–5 molecules are snapped to regular polygons, and back-and-forth
 * pairs become two curved arrows forming an ellipse.
 */
export interface Laid {
  net: NetworkSpec;
  curve: Map<string, number>;
  primary: Map<string, { a: string; b: string }>;
  box: { x: number; y: number; w: number; h: number };
}

/**
 * Textbook layout of what is unlocked now: one main arrow per reaction,
 * near-aligned molecules snapped into rows and columns, cycles of 3–5 as
 * regular polygons and longer cycles around a circle, back-and-forth pairs
 * as two curved arrows. The view then fits what is on the map.
 */
export function layoutNet(src: NetworkSpec, present: Set<string>): Laid {
  const live = src.reactions.filter((r) => !r.hide && present.has(r.id));
  const species = src.species.map((x) => ({ ...x }));
  const sp = new Map(species.map((x) => [x.id, x]));
  const isMain = (id: string, r?: ReactionSpec) => sp.get(id)?.kind !== 'cofactor' && !sp.get(id)?.tag && !(r?.tags ?? []).includes(id) && sp.get(id)?.x !== undefined;
  const visible = new Set<string>();
  for (const r of live) for (const id of [...Object.keys(r.sub), ...Object.keys(r.prod)]) if (isMain(id, r)) visible.add(id);

  // 1. snap near-aligned molecules into shared rows and columns
  const snapAxis = (key: 'x' | 'y') => {
    const list = [...visible].map((id) => sp.get(id)!).sort((a, b) => a[key]! - b[key]!);
    let group: typeof list = [];
    const flush = () => {
      if (group.length > 1) {
        const m = group.reduce((acc, q) => acc + q[key]!, 0) / group.length;
        for (const q of group) q[key] = m;
      }
      group = [];
    };
    for (const q of list) {
      if (group.length && q[key]! - group[group.length - 1][key]! > 28) flush();
      group.push(q);
    }
    flush();
  };
  snapAxis('x');
  snapAxis('y');

  // 2. one main arrow per reaction (prefer a pair that runs back the other way somewhere)
  const cand = live
    .map((r) => {
      const S = Object.keys(r.sub).filter((id) => isMain(id, r));
      const Q = Object.keys(r.prod).filter((id) => isMain(id, r));
      const pairs: { a: string; b: string }[] = [];
      for (const a of S) for (const b of Q) if (a !== b) pairs.push({ a, b });
      return { id: r.id, pairs };
    })
    .filter((x) => x.pairs.length);
  const primary = new Map<string, { a: string; b: string }>();
  for (const c of cand) {
    const back = c.pairs.find((pr) => cand.some((o) => o.id !== c.id && o.pairs.some((q) => q.a === pr.b && q.b === pr.a)));
    primary.set(c.id, back ?? c.pairs[0]);
  }
  const prim = [...primary.entries()].map(([id, pr]) => ({ id, ...pr }));
  const curve = new Map<string, number>();
  for (const e of prim) if (prim.some((o) => o.a === e.b && o.b === e.a)) curve.set(e.id, 0.3);

  // 3. cycles: 3–5 molecules → regular polygon, 6+ → a circle traced by arcs
  const out = new Map<string, { to: string; id: string }[]>();
  for (const e of prim) {
    if (!out.has(e.a)) out.set(e.a, []);
    out.get(e.a)!.push({ to: e.b, id: e.id });
  }
  const cycles: { nodes: string[]; rx: string[] }[] = [];
  const seen = new Set<string>();
  const dfs = (start: string, cur: string, path: string[], rx: string[]) => {
    if (path.length > 9) return;
    for (const nx of out.get(cur) ?? []) {
      if (nx.to === start && path.length >= 3) {
        const key = [...path].sort().join('|');
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push({ nodes: [...path], rx: [...rx, nx.id] });
        }
      } else if (!path.includes(nx.to)) dfs(start, nx.to, [...path, nx.to], [...rx, nx.id]);
    }
  };
  for (const n of out.keys()) dfs(n, n, [n], []);
  const used = new Set<string>();
  for (const cyc of src.layout === 'fixed' ? [] : cycles.sort((x, y) => x.nodes.length - y.nodes.length)) {
    if (cyc.nodes.some((id) => used.has(id) || sp.get(id)?.kind === 'boundary')) continue;
    cyc.nodes.forEach((id) => used.add(id));
    const pts = cyc.nodes.map((id) => sp.get(id)!);
    const n = pts.length;
    const cx = pts.reduce((a, q) => a + q.x!, 0) / n;
    const cy = pts.reduce((a, q) => a + q.y!, 0) / n;
    const R = Math.max(70, pts.reduce((a, q) => a + Math.hypot(q.x! - cx, q.y! - cy), 0) / n);
    let area = 0;
    for (let i = 0; i < n; i++) {
      const q1 = pts[i];
      const q2 = pts[(i + 1) % n];
      area += q1.x! * q2.y! - q2.x! * q1.y!;
    }
    const dir = area >= 0 ? 1 : -1;
    // start at the top so the shape sits level
    const a0 = -Math.PI / 2;
    pts.forEach((q, i) => {
      const an = a0 + (dir * i * 2 * Math.PI) / n;
      q.x = cx + Math.cos(an) * R;
      q.y = cy + Math.sin(an) * R;
    });
    if (n >= 6) {
      // bend each chord into the circle's arc, bulging outward
      const theta = (2 * Math.PI) / n;
      for (let i = 0; i < n; i++) {
        const A = pts[i];
        const B = pts[(i + 1) % n];
        const L = Math.hypot(B.x! - A.x!, B.y! - A.y!) || 1;
        const sag = R * (1 - Math.cos(theta / 2));
        const mx = (A.x! + B.x!) / 2 - cx;
        const my = (A.y! + B.y!) / 2 - cy;
        const px = -(B.y! - A.y!);
        const py = B.x! - A.x!;
        const sign = px * mx + py * my > 0 ? 1 : -1;
        curve.set(cyc.rx[i], (sign * 2 * sag) / L);
      }
    }
  }

  // 4. each reaction's junction sits at the middle of its main arrow
  const reactions = src.reactions.map((r) => {
    const e = primary.get(r.id);
    if (!e) return r;
    const A = sp.get(e.a)!;
    const B = sp.get(e.b)!;
    const bend = curve.get(r.id) ?? 0;
    return { ...r, x: (A.x! + B.x!) / 2 - (B.y! - A.y!) * bend * 0.5, y: (A.y! + B.y!) / 2 + (B.x! - A.x!) * bend * 0.5 };
  });

  // 5. fit the view to what is on the map
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const take = (x: number, y: number) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  for (const id of visible) take(sp.get(id)!.x!, sp.get(id)!.y!);
  for (const r of reactions) if (present.has(r.id) && !r.hide) take(r.x, r.y);
  if (!Number.isFinite(x0)) {
    x0 = 0;
    y0 = 0;
    x1 = src.width ?? 1000;
    y1 = src.height ?? 620;
  }
  const pad = 90;
  const box = { x: x0 - pad, y: y0 - pad, w: Math.max(420, x1 - x0 + pad * 2), h: Math.max(300, y1 - y0 + pad * 2) };
  return { net: { ...src, species, reactions }, curve, primary, box };
}

export function buildGeometry(net: NetworkSpec, curve: Map<string, number>, primary: Map<string, { a: string; b: string }>): Map<string, RxnGeo> {
  const sp = new Map(net.species.map((s) => [s.id, s]));
  const poolOf = new Map<string, string>();
  for (const p of net.pools) for (const m of p.species) poolOf.set(m, p.id);
  const out = new Map<string, RxnGeo>();
  for (const r of net.reactions) {
    if (r.hide) continue;
    const P = { x: r.x, y: r.y };
    const lined = (id: string) => sp.get(id)?.kind !== 'cofactor' && !sp.get(id)?.tag && !(r.tags ?? []).includes(id);
    const mainSub = Object.keys(r.sub).filter(lined);
    const mainProd = Object.keys(r.prod).filter(lined);
    const pillW = Math.max(38, textW(r.short, 11.5) + 20);
    const edges: EdgeGeo[] = [];
    const dashed = (r.steps ?? 1) > 1;
    const R0 = (s2: SpeciesSpec, prod: boolean) => (s2.kind === 'boundary' ? 18 : prod ? 21 : 18);
    const pr = primary.get(r.id);
    if (pr) {
      // the main arrow, then side substrates joining and side products branching at its middle
      const a = sp.get(pr.a)!;
      const b = sp.get(pr.b)!;
      const [p0, p1] = trim({ x: a.x!, y: a.y! }, { x: b.x!, y: b.y! }, R0(a, false), R0(b, true));
      const q = quad(p0, p1, curve.get(r.id) ?? 0);
      edges.push({ id: r.id + ':e', d: q.d, pts: q.pts, len: cumLen(q.pts), pool: b.pool, dashed, head: true });
      for (const id of mainSub) {
        if (id === pr.a) continue;
        const s2 = sp.get(id)!;
        if (s2.x === undefined) continue;
        const [s0, s1] = trim({ x: s2.x, y: s2.y! }, P, R0(s2, false), 4);
        const qq = quad(s0, s1, 0);
        edges.push({ id: r.id + ':s:' + id, d: qq.d, pts: qq.pts, len: cumLen(qq.pts), pool: s2.pool, dashed, head: false });
      }
      for (const id of mainProd) {
        if (id === pr.b) continue;
        const s2 = sp.get(id)!;
        if (s2.x === undefined) continue;
        const [s0, s1] = trim(P, { x: s2.x, y: s2.y! }, 4, R0(s2, true));
        const qq = quad(s0, s1, 0);
        edges.push({ id: r.id + ':p:' + id, d: qq.d, pts: qq.pts, len: cumLen(qq.pts), pool: s2.pool, dashed, head: true });
      }
    } else {
      for (const id of mainSub) {
        const s2 = sp.get(id)!;
        if (s2.x === undefined) continue;
        const [p0, p1] = trim({ x: s2.x, y: s2.y! }, P, R0(s2, false), 0);
        const q = quad(p0, p1, 0);
        edges.push({ id: r.id + ':s:' + id, d: q.d, pts: q.pts, len: cumLen(q.pts), pool: s2.pool, dashed, head: false });
      }
      for (const id of mainProd) {
        const s2 = sp.get(id)!;
        if (s2.x === undefined) continue;
        const [p0, p1] = trim(P, { x: s2.x, y: s2.y! }, 0, R0(s2, true));
        const q = quad(p0, p1, 0);
        edges.push({ id: r.id + ':p:' + id, d: q.d, pts: q.pts, len: cumLen(q.pts), pool: s2.pool, dashed, head: true });
      }
    }
    if (!mainProd.length && r.id === net.growth) {
      // "new cells": point the growth arrow into the emptiest direction
      const others = [...net.species.filter((x) => x.x !== undefined).map((x) => ({ x: x.x!, y: x.y! })), ...net.reactions.filter((x) => x.id !== r.id && !x.hide).map((x) => ({ x: x.x, y: x.y }))];
      let best = { x: 0, y: -1 };
      let bestD = -1;
      for (const an of [-90, 90, 0, 180, -45, -135, 45, 135]) {
        const d = { x: Math.cos((an * Math.PI) / 180), y: Math.sin((an * Math.PI) / 180) };
        const end = { x: P.x + d.x * 60, y: P.y + d.y * 60 };
        const m = Math.min(...others.map((o) => Math.hypot(o.x - end.x, o.y - end.y)));
        if (m > bestD + 1) {
          bestD = m;
          best = d;
        }
      }
      const q = quad({ x: P.x + best.x * 14, y: P.y + best.y * 14 }, { x: P.x + best.x * 50, y: P.y + best.y * 50 }, 0);
      edges.push({ id: r.id + ':grow', d: q.d, pts: q.pts, len: cumLen(q.pts), pool: 'carbon', dashed: false, head: true });
    }
    // Energy carriers as +/− badges: show the charged form, signed by whether it is made or spent.
    const badges: Badge[] = [];
    const subC = Object.keys(r.sub).filter((id) => sp.get(id)?.kind === 'cofactor');
    const prodC = Object.keys(r.prod).filter((id) => sp.get(id)?.kind === 'cofactor');
    const seenPools = new Set<string>();
    for (const id of [...subC, ...prodC]) {
      const pool = poolOf.get(id) ?? id;
      if (seenPools.has(pool)) continue;
      const members = [...subC, ...prodC].filter((x) => (poolOf.get(x) ?? x) === pool);
      const pspec = net.pools.find((p) => p.id === pool);
      const show = members.find((m) => PREFERRED.includes(m)) ?? members.find((m) => m === pspec?.charged) ?? members[0];
      const spc = sp.get(show)!;
      let made = prodC.includes(show);
      let label = carrierName(spc);
      if (!PREFERRED.includes(show) && pspec && show !== pspec.charged) {
        // e.g. NAD⁺ consumed means NADH is made
        const other = pspec.species.find((m) => PREFERRED.includes(m));
        if (other) {
          label = carrierName(sp.get(other)!);
          made = !made;
        }
      }
      seenPools.add(pool);
      const n = Math.max(r.sub[show] ?? 0, r.prod[show] ?? 0);
      badges.push({ text: (made ? '+' : '−') + (n > 1 ? n : '') + label, color: POOL[spc.pool], made });
    }
    // species shown as tags (CO₂ and minor side substrates)
    for (const id of [...Object.keys(r.sub), ...Object.keys(r.prod)]) {
      const spc = sp.get(id);
      if (!spc || spc.kind === 'cofactor' || lined(id)) continue;
      const made = !!r.prod[id] && !r.sub[id];
      badges.push({ text: (made ? '+' : '−') + carrierName(spc), color: POOL[spc.pool], made });
    }
    out.set(r.id, { r, p: P, edges, badges, pillW });
  }
  return out;
}

export function nodeRadius(c: number) {
  const t = Math.max(0, Math.min(1, (Math.log10(Math.max(c, 1e-6)) + 2.3) / 3));
  return 7 + 11 * t;
}

/**
 * Enzyme labels: start each on its arrow, then push apart from each other and
 * from molecules and their names, with a gentle pull back toward the arrow.
 */
export function placeLabels(
  geo: Map<string, RxnGeo>,
  present: Set<string>,
  species: SpeciesSpec[],
  visibleSpecies: Set<string>,
  bottleneck: string | null | undefined,
): Map<string, Pt> {
  type Box = { id: string; ax: number; ay: number; x: number; y: number; w: number; h: number; dy: number };
  const boxes: Box[] = [];
  for (const g of geo.values()) {
    if (!present.has(g.r.id)) continue;
    const bw = g.badges.reduce((a, b) => a + textW(b.text, 9.5) + 14, 0);
    const w = Math.max(g.pillW, bw) + 8;
    const bn = bottleneck === g.r.id;
    const h = 26 + (g.badges.length ? 17 : 0) + (bn ? 18 : 0);
    boxes.push({ id: g.r.id, ax: g.p.x, ay: g.p.y, x: g.p.x, y: g.p.y, w: Math.max(w, bn ? 84 : 0), h, dy: (g.badges.length ? 8 : 0) - (bn ? 9 : 0) });
  }
  const obs: { x: number; y: number; w: number; h: number }[] = [];
  for (const sp2 of species) {
    if (sp2.kind === 'cofactor' || !visibleSpecies.has(sp2.id) || sp2.x === undefined) continue;
    obs.push({ x: sp2.x, y: sp2.y!, w: 44, h: 44 });
    const lp = sp2.label ?? 'below';
    const tw = textW(sp2.name, 13) + 6;
    const r0 = 16;
    const lx = sp2.x + (lp === 'left' ? -r0 - 8 - tw / 2 : lp === 'right' ? r0 + 8 + tw / 2 : 0);
    const ly = sp2.y! + (lp === 'above' ? -r0 - 13 : lp === 'below' ? r0 + 12 : 0);
    obs.push({ x: lx, y: ly, w: tw, h: 18 });
  }
  const overlap = (ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number) => {
    const ox = (aw + bw) / 2 - Math.abs(ax - bx);
    const oy = (ah + bh) / 2 - Math.abs(ay - by);
    return ox > 0 && oy > 0 ? { ox, oy } : null;
  };
  for (let it = 0; it < 120; it++) {
    let moved = false;
    for (let i = 0; i < boxes.length; i++) {
      const a = boxes[i];
      for (let j = i + 1; j < boxes.length; j++) {
        const b = boxes[j];
        const o = overlap(a.x, a.y + a.dy, a.w, a.h, b.x, b.y + b.dy, b.w, b.h);
        if (!o) continue;
        moved = true;
        if (o.ox < o.oy) {
          const s2 = a.x < b.x || (a.x === b.x && i < j) ? -1 : 1;
          a.x += (s2 * o.ox) / 2 + s2 * 0.5;
          b.x -= (s2 * o.ox) / 2 + s2 * 0.5;
        } else {
          const s2 = a.y < b.y || (a.y === b.y && i < j) ? -1 : 1;
          a.y += (s2 * o.oy) / 2 + s2 * 0.5;
          b.y -= (s2 * o.oy) / 2 + s2 * 0.5;
        }
      }
      for (const ob of obs) {
        const o = overlap(a.x, a.y + a.dy, a.w, a.h, ob.x, ob.y, ob.w, ob.h);
        if (!o) continue;
        moved = true;
        if (o.ox < o.oy) a.x += (a.x < ob.x ? -1 : 1) * (o.ox + 0.5);
        else a.y += (a.y + a.dy < ob.y ? -1 : 1) * (o.oy + 0.5);
      }
      // a gentle pull back toward the arrow
      a.x += (a.ax - a.x) * 0.02;
      a.y += (a.ay - a.y) * 0.02;
    }
    if (!moved) break;
  }
  return new Map(boxes.map((b) => [b.id, { x: b.x, y: b.y }]));
}
