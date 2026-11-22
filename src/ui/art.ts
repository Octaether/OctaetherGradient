// Line-art illustration kit. Cells are drawn like technical illustrations:
// thin white structure lines, a lineage accent colour, and a warm gradient for
// energy organelles. Each cell look is rendered once into a cached sprite, so
// the live scene only blits images (fast) while the drawings stay detailed.
import { mix } from './theme';

export const TAU = Math.PI * 2;
/** Cool light: rim light, ribbons and glows (DNA blue → teal → green). */
export const WARM = ['#00e5ff', '#8b5cff', '#ff3ec8'];
/** Soft warm tones kept for organelles, so they read as distinct parts. */
export const ORG = ['#ff8a3d', '#ff4d6d', '#c77dff'];
export const LIME = '#a8ff3e';

export function rng(seed: number) {
  let a = Math.floor(seed * 2654435761) >>> 0 || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type P = { x: number; y: number };

/** Smooth curve through points (Catmull-Rom as Béziers). */
export function smooth(ctx: CanvasRenderingContext2D | Path2D, pts: P[], closed: boolean) {
  const n = pts.length;
  if (n < 2) return;
  const get = (i: number) => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  ctx.moveTo(pts[0].x, pts[0].y);
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = get(i - 1);
    const p1 = get(i);
    const p2 = get(i + 1);
    const p3 = get(i + 2);
    ctx.bezierCurveTo(p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6, p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6, p2.x, p2.y);
  }
  if (closed) ctx.closePath();
}

export type Morph = 'proto' | 'rod' | 'cyano' | 'euk';
export interface CellLook {
  morph: Morph;
  color: string;
  aspect: number; // rods: half-length / half-width
  features: string[];
  variant: number;
  bare?: boolean; // interior only: the membrane is drawn live
}
export interface Sprite {
  c: HTMLCanvasElement;
  w: number;
  h: number;
  R: number; // sprite px per unit cell radius (half-width)
  outline: Path2D; // in sprite-centred coordinates
  pts: P[];
  morph: Morph;
  aspect: number;
}

const R0 = 110; // sprite radius in px

/** Outline points for a morphology, centred on 0,0. */
function outlinePts(look: CellLook, R: number, r: () => number): P[] {
  const pts: P[] = [];
  if (look.morph === 'rod') {
    const W = R;
    const L = R * look.aspect;
    const n = 120;
    // capsule perimeter param
    const straight = 2 * (L - W);
    const per = 2 * straight + TAU * W;
    for (let i = 0; i < n; i++) {
      let s = (i / n) * per;
      let p: P;
      if (s < straight) p = { x: -L + W + s, y: -W };
      else if ((s -= straight) < Math.PI * W) {
        const a = -Math.PI / 2 + s / W;
        p = { x: L - W + Math.cos(a) * W, y: Math.sin(a) * W };
      } else if ((s -= Math.PI * W) < straight) p = { x: L - W - s, y: W };
      else {
        s -= straight;
        const a = Math.PI / 2 + s / W;
        p = { x: -L + W + Math.cos(a) * W, y: Math.sin(a) * W };
      }
      pts.push(p);
    }
    return pts;
  }
  const n = 96;
  const k1 = r() * TAU;
  const k2 = r() * TAU;
  const amp = look.morph === 'euk' ? 0.075 : look.morph === 'proto' ? 0.03 : 0.015;
  const sy = look.morph === 'cyano' ? 0.88 : 1;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const w = 1 + amp * Math.sin(a * 3 + k1) + amp * 0.6 * Math.sin(a * 5 + k2);
    pts.push({ x: Math.cos(a) * R * w, y: Math.sin(a) * R * w * sy });
  }
  return pts;
}

/** Offset a closed outline inward (negative d) or outward along its normals. */
export function offset(pts: P[], d: number): P[] {
  const n = pts.length;
  return pts.map((p, i) => {
    const a = pts[(i - 1 + n) % n];
    const b = pts[(i + 1) % n];
    let nx = b.y - a.y;
    let ny = -(b.x - a.x);
    const L = Math.hypot(nx, ny) || 1;
    nx /= L;
    ny /= L;
    return { x: p.x + nx * d, y: p.y + ny * d };
  });
}

const cache = new Map<string, Sprite>();
export function lookKey(l: CellLook) {
  return `${l.morph}|${l.color}|${l.aspect}|${l.features.join(',')}|${l.variant}|${l.bare ? 1 : 0}`;
}

export function cellSprite(look: CellLook): Sprite {
  const key = lookKey(look);
  const hit = cache.get(key);
  if (hit) return hit;
  if (cache.size > 80) cache.clear();
  const R = R0;
  const pad = 26;
  const halfW = (look.morph === 'rod' ? R * look.aspect : R * 1.1) + pad;
  const halfH = R * 1.1 + pad;
  const c = document.createElement('canvas');
  c.width = Math.ceil(halfW * 2);
  c.height = Math.ceil(halfH * 2);
  const ctx = c.getContext('2d')!;
  ctx.translate(c.width / 2, c.height / 2);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const r = rng(look.variant * 7.31 + look.morph.length * 1.7 + 0.13);
  const pts = outlinePts(look, R, r);
  const outline = new Path2D();
  smooth(outline, pts, true);
  drawCellArt(ctx, look, pts, outline, R, r);
  const s: Sprite = { c, w: c.width, h: c.height, R, outline, pts, morph: look.morph, aspect: look.aspect };
  cache.set(key, s);
  return s;
}

const U = R0 / 55; // one "line unit" in sprite px (~1 css px at typical size)

function stroke(ctx: CanvasRenderingContext2D, col: string, a: number, w: number) {
  ctx.strokeStyle = mix(col, a);
  ctx.lineWidth = w * U;
  ctx.stroke();
}

function pathOf(ctx: CanvasRenderingContext2D, pts: P[], closed = true) {
  ctx.beginPath();
  smooth(ctx, pts, closed);
}

/** A point inside the cell (rough, uses the bounding shape). */
function inside(look: CellLook, R: number, r: () => number, spread = 0.7): P {
  const a = r() * TAU;
  const d = Math.sqrt(r()) * spread;
  if (look.morph === 'rod') return { x: Math.cos(a) * d * R * (look.aspect - 0.35), y: Math.sin(a) * d * R * 0.8 };
  return { x: Math.cos(a) * d * R, y: Math.sin(a) * d * R * (look.morph === 'cyano' ? 0.85 : 1) };
}

function drawCellArt(ctx: CanvasRenderingContext2D, look: CellLook, pts: P[], outline: Path2D, R: number, r: () => number) {
  const W = '#ffffff';
  const A = look.color;
  const f = new Set(look.features);
  // body tint: a faint fill so the cell reads as a volume
  const g = ctx.createRadialGradient(-R * 0.35, -R * 0.4, R * 0.1, 0, 0, R * (look.morph === 'rod' ? look.aspect : 1.1));
  g.addColorStop(0, mix(A, 0.16));
  g.addColorStop(0.6, mix(A, 0.05));
  g.addColorStop(1, mix(A, 0.12));
  ctx.fillStyle = g;
  ctx.fill(outline);

  // outer layers (live cells draw their membrane themselves)
  if (!look.bare && (look.morph === 'rod' || look.morph === 'cyano')) {
    const wall = offset(pts, 5 * U);
    pathOf(ctx, wall);
    ctx.setLineDash([2.5 * U, 2.5 * U]);
    stroke(ctx, W, 0.28, 0.8);
    ctx.setLineDash([]);
  }
  // bilayer: two lines with lipid tails between
  const outer = pts;
  const inner = offset(pts, -6 * U);
  if (!look.bare) {
  pathOf(ctx, outer);
  stroke(ctx, W, 0.92, 1.25);
  pathOf(ctx, inner);
  stroke(ctx, W, 0.45, 0.7);
  ctx.beginPath();
  const step = look.morph === 'proto' ? 1 : 2;
  for (let i = 0; i < pts.length; i += step) {
    const o = outer[i];
    const n = inner[i];
    const mx = o.x + (n.x - o.x) * 0.38;
    const my = o.y + (n.y - o.y) * 0.38;
    ctx.moveTo(o.x + (n.x - o.x) * 0.15, o.y + (n.y - o.y) * 0.15);
    ctx.lineTo(mx, my);
    ctx.moveTo(o.x + (n.x - o.x) * 0.62, o.y + (n.y - o.y) * 0.62);
    ctx.lineTo(o.x + (n.x - o.x) * 0.85, o.y + (n.y - o.y) * 0.85);
  }
  stroke(ctx, W, 0.22, 0.5);
  if (look.morph === 'proto') {
    // lipid heads as tiny beads on both leaflets
    ctx.fillStyle = mix(W, 0.5);
    for (let i = 0; i < pts.length; i++) {
      const o = outer[i];
      const n = inner[i];
      ctx.beginPath();
      ctx.arc(o.x + (n.x - o.x) * 0.06, o.y + (n.y - o.y) * 0.06, 0.9 * U, 0, TAU);
      ctx.arc(o.x + (n.x - o.x) * 0.94, o.y + (n.y - o.y) * 0.94, 0.9 * U, 0, TAU);
      ctx.fill();
    }
  }
  }

  ctx.save();
  ctx.clip(outline);

  // cytoplasm specks
  ctx.fillStyle = mix(W, 0.18);
  for (let i = 0; i < 90; i++) {
    const p = inside(look, R, r, 0.88);
    ctx.fillRect(p.x, p.y, 0.9 * U, 0.9 * U);
  }

  if (look.morph === 'proto') drawProto(ctx, look, R, r, A);
  if (look.morph === 'rod') drawRod(ctx, look, R, r, A, f, pts);
  if (look.morph === 'cyano') drawCyano(ctx, look, R, r, A, pts);
  if (look.morph === 'euk') drawEuk(ctx, look, R, r, A, f);
  ctx.restore();

  // membrane machines sit across the membrane, drawn after the clip
  if (f.has('atps')) {
    const n = look.morph === 'rod' ? 10 : 12;
    for (let i = 0; i < n; i++) {
      const k = Math.floor((i / n) * pts.length + r() * 4) % pts.length;
      const o = outer[k];
      const nn = offset([pts[(k - 1 + pts.length) % pts.length], o, pts[(k + 1) % pts.length]], -1)[1];
      const dx = nn.x - o.x;
      const dy = nn.y - o.y;
      const L = Math.hypot(dx, dy) || 1;
      const ux = dx / L;
      const uy = dy / L;
      // rotor in the membrane, stalk, F1 head inside
      ctx.beginPath();
      ctx.moveTo(o.x - uy * 3 * U, o.y + ux * 3 * U);
      ctx.lineTo(o.x + uy * 3 * U, o.y - ux * 3 * U);
      stroke(ctx, ORG[0], 0.9, 1.6);
      ctx.beginPath();
      ctx.moveTo(o.x, o.y);
      ctx.lineTo(o.x + ux * 10 * U, o.y + uy * 10 * U);
      stroke(ctx, ORG[0], 0.8, 0.8);
      ctx.beginPath();
      ctx.arc(o.x + ux * 13 * U, o.y + uy * 13 * U, 3.4 * U, 0, TAU);
      ctx.fillStyle = mix(ORG[1], 0.25);
      ctx.fill();
      stroke(ctx, ORG[1], 0.95, 0.9);
    }
  }
}

function helixStrand(ctx: CanvasRenderingContext2D, path: P[], amp: number, col: string, alpha = 1) {
  // two backbones winding around a centre path, with base-pair rungs
  const a: P[] = [];
  const b: P[] = [];
  const rungs: [P, P][] = [];
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    const q = path[Math.min(path.length - 1, i + 1)];
    const o = path[Math.max(0, i - 1)];
    let nx = -(q.y - o.y);
    let ny = q.x - o.x;
    const L = Math.hypot(nx, ny) || 1;
    nx /= L;
    ny /= L;
    const s = Math.sin(i * 0.55);
    a.push({ x: p.x + nx * amp * s, y: p.y + ny * amp * s });
    b.push({ x: p.x - nx * amp * s, y: p.y - ny * amp * s });
    if (i % 2 === 0) rungs.push([a[a.length - 1], b[b.length - 1]]);
  }
  ctx.beginPath();
  for (const [p, q] of rungs) {
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
  }
  stroke(ctx, '#ffffff', 0.3 * alpha, 0.55);
  const grad = ctx.createLinearGradient(path[0].x, path[0].y, path[path.length - 1].x, path[path.length - 1].y);
  grad.addColorStop(0, mix(col, alpha));
  grad.addColorStop(1, mix(WARM[1], alpha));
  ctx.strokeStyle = grad;
  ctx.lineWidth = 1.1 * U;
  ctx.beginPath();
  smooth(ctx, a, false);
  ctx.stroke();
  ctx.beginPath();
  smooth(ctx, b, false);
  ctx.globalAlpha = 0.65;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function wander(start: P, n: number, step: number, r: () => number, bound: (p: P) => boolean, turn = 0.6): P[] {
  const out: P[] = [start];
  let a = r() * TAU;
  let p = start;
  for (let i = 0; i < n; i++) {
    a += (r() - 0.5) * turn;
    let q = { x: p.x + Math.cos(a) * step, y: p.y + Math.sin(a) * step };
    let tries = 0;
    while (!bound(q) && tries++ < 8) {
      a += Math.PI * (0.5 + r() * 0.5);
      q = { x: p.x + Math.cos(a) * step, y: p.y + Math.sin(a) * step };
    }
    out.push(q);
    p = q;
  }
  return out;
}

function drawProto(ctx: CanvasRenderingContext2D, look: CellLook, R: number, r: () => number, A: string) {
  const bound = (p: P) => Math.hypot(p.x, p.y) < R * 0.66;
  for (let s = 0; s < 3; s++) {
    const st = inside(look, R, r, 0.4);
    helixStrand(ctx, wander(st, 26, 4.2 * U, r, bound, 0.35), 3.4 * U, A, 0.95);
  }
  // free nucleotides: little pentagon rings with a phosphate tail
  for (let i = 0; i < 9; i++) {
    const p = inside(look, R, r, 0.72);
    const rot = r() * TAU;
    ctx.beginPath();
    for (let k = 0; k < 5; k++) ctx.lineTo(p.x + Math.cos(rot + (k / 5) * TAU) * 3 * U, p.y + Math.sin(rot + (k / 5) * TAU) * 3 * U);
    ctx.closePath();
    ctx.moveTo(p.x + Math.cos(rot) * 3 * U, p.y + Math.sin(rot) * 3 * U);
    ctx.lineTo(p.x + Math.cos(rot) * 7 * U, p.y + Math.sin(rot) * 7 * U);
    stroke(ctx, '#ffffff', 0.42, 0.6);
  }
}

function nucleoid(ctx: CanvasRenderingContext2D, rx: number, ry: number, r: () => number, cx = 0, cy = 0, alpha = 0.42) {
  const bound = (p: P) => ((p.x - cx) / rx) ** 2 + ((p.y - cy) / ry) ** 2 < 1;
  const path = wander({ x: cx, y: cy }, 150, 2.6 * U, r, bound, 1.1);
  ctx.beginPath();
  smooth(ctx, path, false);
  stroke(ctx, '#ffffff', alpha, 0.65);
  // supercoils: tiny loops on the strand
  ctx.beginPath();
  for (let i = 10; i < path.length; i += 14) {
    const p = path[i];
    ctx.moveTo(p.x + 2.2 * U, p.y);
    ctx.arc(p.x, p.y, 2.2 * U, 0, TAU);
  }
  stroke(ctx, '#ffffff', alpha * 0.7, 0.5);
}

function ribosomes(ctx: CanvasRenderingContext2D, look: CellLook, R: number, r: () => number, n: number) {
  ctx.fillStyle = mix('#ffffff', 0.55);
  for (let i = 0; i < n; i++) {
    const p = inside(look, R, r, 0.9);
    const a = r() * TAU;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.5 * U, 0, TAU);
    ctx.arc(p.x + Math.cos(a) * 2 * U, p.y + Math.sin(a) * 2 * U, 1 * U, 0, TAU);
    ctx.fill();
  }
}

function cube(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, col: string) {
  // isometric Fe–S cube
  const h = s * 0.5;
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.lineTo(x + s * 0.87, y - h);
  ctx.lineTo(x + s * 0.87, y + h);
  ctx.lineTo(x, y + s);
  ctx.lineTo(x - s * 0.87, y + h);
  ctx.lineTo(x - s * 0.87, y - h);
  ctx.closePath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y + s);
  ctx.moveTo(x, y);
  ctx.lineTo(x + s * 0.87, y - h);
  ctx.moveTo(x, y);
  ctx.lineTo(x - s * 0.87, y - h);
  stroke(ctx, col, 0.85, 0.7);
}

function drawRod(ctx: CanvasRenderingContext2D, look: CellLook, R: number, r: () => number, A: string, f: Set<string>, pts: P[]) {
  nucleoid(ctx, R * look.aspect * 0.55, R * 0.42, r);
  ribosomes(ctx, look, R, r, 70);
  if (f.has('fes')) for (let i = 0; i < 6; i++) {
    const p = inside(look, R, r, 0.75);
    cube(ctx, p.x, p.y, 3.2 * U, A);
  }
  if (f.has('glyc')) {
    for (let i = 0; i < 9; i++) {
      const p = inside(look, R, r, 0.8);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.4 * U, 0, TAU);
      ctx.fillStyle = mix(ORG[0], 0.12);
      ctx.fill();
      stroke(ctx, ORG[0], 0.75, 0.7);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.2 * U, 0, TAU);
      ctx.fillStyle = mix(ORG[0], 0.8);
      ctx.fill();
    }
  }
  // enzyme clusters in the accent colour (the metabolism)
  for (let i = 0; i < 14; i++) {
    const p = inside(look, R, r, 0.8);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.8 * U, 0, TAU);
    ctx.arc(p.x + 2.6 * U, p.y + 1 * U, 1.3 * U, 0, TAU);
    ctx.fillStyle = mix(A, 0.7);
    ctx.fill();
  }
  // flagellar motor rings at the rear pole
  if (f.has('flag')) {
    const x = -R * look.aspect + 9 * U;
    for (let k = 1; k <= 3; k++) {
      ctx.beginPath();
      ctx.ellipse(x, 0, 1.4 * k * U, 2.4 * k * U, 0, 0, TAU);
      stroke(ctx, A, 0.8 - k * 0.15, 0.7);
    }
  }
  void pts;
}

function drawCyano(ctx: CanvasRenderingContext2D, look: CellLook, R: number, r: () => number, A: string, pts: P[]) {
  // concentric thylakoid membranes (paired lines) with phycobilisome beads
  for (let k = 0; k < 4; k++) {
    const d = -(15 + k * 11) * U;
    const ring = offset(pts, d);
    const ring2 = offset(pts, d - 2.2 * U);
    const gapA = Math.floor(r() * ring.length);
    const cut = (arr: P[]) => [...arr.slice(gapA), ...arr.slice(0, gapA)].slice(4, arr.length - 4);
    pathOf(ctx, cut(ring), false);
    stroke(ctx, LIME, 0.75, 0.75);
    pathOf(ctx, cut(ring2), false);
    stroke(ctx, LIME, 0.4, 0.6);
    ctx.fillStyle = mix(A, 0.75);
    const c = cut(ring);
    for (let i = 0; i < c.length; i += 5) {
      ctx.beginPath();
      ctx.arc(c[i].x, c[i].y, 1.3 * U, 0, TAU);
      ctx.fill();
    }
  }
  nucleoid(ctx, R * 0.22, R * 0.18, r, 0, 0, 0.35);
  // carboxysomes: icosahedral protein shells holding RuBisCO
  for (let i = 0; i < 3; i++) {
    const p = inside(look, R, r, 0.3);
    const rot = r() * TAU;
    for (const s of [6.5, 4.2]) {
      ctx.beginPath();
      for (let k = 0; k < 6; k++) ctx.lineTo(p.x + Math.cos(rot + (k / 6) * TAU) * s * U, p.y + Math.sin(rot + (k / 6) * TAU) * s * U);
      ctx.closePath();
      stroke(ctx, ORG[0], s > 5 ? 0.9 : 0.45, 0.75);
    }
  }
}

function mito(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, a: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 1.7, s * 0.85, 0, 0, TAU);
  const g = ctx.createLinearGradient(-s * 1.7, 0, s * 1.7, 0);
  g.addColorStop(0, mix(ORG[0], 0.22));
  g.addColorStop(1, mix(ORG[1], 0.22));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = g;
  ctx.lineWidth = 0.9 * U;
  ctx.strokeStyle = mix(ORG[0], 0.95);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 1.45, s * 0.62, 0, 0, TAU);
  ctx.strokeStyle = mix(ORG[1], 0.55);
  ctx.lineWidth = 0.6 * U;
  ctx.stroke();
  // cristae: folded inner membrane
  ctx.beginPath();
  for (let k = -3; k <= 3; k++) {
    const xx = k * s * 0.4;
    const up = k % 2 === 0;
    ctx.moveTo(xx, up ? -s * 0.6 : s * 0.6);
    ctx.lineTo(xx + s * 0.06, up ? s * 0.15 : -s * 0.15);
  }
  ctx.strokeStyle = mix(ORG[1], 0.8);
  ctx.lineWidth = 0.7 * U;
  ctx.stroke();
  ctx.restore();
}

function chloro(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, a: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 1.6, s * 0.95, 0, 0, TAU);
  ctx.fillStyle = mix(LIME, 0.16);
  ctx.fill();
  ctx.strokeStyle = mix(LIME, 0.95);
  ctx.lineWidth = 0.9 * U;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 1.4, s * 0.78, 0, 0, TAU);
  ctx.strokeStyle = mix(LIME, 0.4);
  ctx.lineWidth = 0.55 * U;
  ctx.stroke();
  // grana: stacks of thylakoid discs joined by lamellae
  ctx.beginPath();
  ctx.moveTo(-s * 1.1, 0);
  ctx.lineTo(s * 1.1, 0);
  ctx.strokeStyle = mix(LIME, 0.5);
  ctx.stroke();
  for (const gx of [-0.75, 0, 0.75]) {
    for (let k = -2; k <= 2; k++) {
      ctx.beginPath();
      ctx.rect(gx * s - s * 0.2, k * s * 0.13 - s * 0.05, s * 0.4, s * 0.1);
      ctx.fillStyle = mix(LIME, 0.55);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawEuk(ctx: CanvasRenderingContext2D, look: CellLook, R: number, r: () => number, A: string, f: Set<string>) {
  // cytoskeleton: faint filaments
  ctx.beginPath();
  for (let i = 0; i < 16; i++) {
    const a = r() * TAU;
    const p = { x: Math.cos(a) * R * 0.15, y: Math.sin(a) * R * 0.15 };
    const q = { x: Math.cos(a + (r() - 0.5) * 0.6) * R * 1.05, y: Math.sin(a + (r() - 0.5) * 0.6) * R * 1.05 };
    ctx.moveTo(p.x, p.y);
    ctx.quadraticCurveTo((p.x + q.x) / 2 + (r() - 0.5) * 20, (p.y + q.y) / 2 + (r() - 0.5) * 20, q.x, q.y);
  }
  stroke(ctx, '#ffffff', 0.08, 0.5);
  const nx = -R * 0.14;
  const ny = -R * 0.08;
  const nR = R * 0.3;
  if (f.has('nucleus')) {
    // ER sheets wrapping the nucleus
    for (let k = 0; k < 3; k++) {
      const rr = nR + (8 + k * 7) * U;
      const a0 = r() * TAU;
      const span = Math.PI * (1 + r() * 0.6);
      const p: P[] = [];
      for (let i = 0; i <= 40; i++) {
        const a = a0 + (i / 40) * span;
        const w = rr + Math.sin(i * 1.3 + k) * 2.2 * U;
        p.push({ x: nx + Math.cos(a) * w, y: ny + Math.sin(a) * w });
      }
      pathOf(ctx, p, false);
      stroke(ctx, A, 0.55, 0.65);
      const p2 = p.map((q) => ({ x: nx + (q.x - nx) * 1.04, y: ny + (q.y - ny) * 1.04 }));
      pathOf(ctx, p2, false);
      stroke(ctx, A, 0.3, 0.5);
    }
    // nuclear envelope with pores
    ctx.beginPath();
    ctx.arc(nx, ny, nR, 0, TAU);
    ctx.fillStyle = mix(A, 0.08);
    ctx.fill();
    for (const [rr, al] of [
      [nR, 0.95],
      [nR - 3 * U, 0.5],
    ] as const) {
      const pores = 14;
      for (let i = 0; i < pores; i++) {
        const a0 = (i / pores) * TAU + 0.08;
        ctx.beginPath();
        ctx.arc(nx, ny, rr, a0, a0 + TAU / pores - 0.16);
        stroke(ctx, '#ffffff', al, rr === nR ? 1 : 0.6);
      }
    }
    nucleoid(ctx, nR * 0.75, nR * 0.75, r, nx, ny, 0.3);
    ctx.beginPath();
    ctx.arc(nx + nR * 0.25, ny - nR * 0.2, nR * 0.26, 0, TAU);
    ctx.fillStyle = mix(A, 0.3);
    ctx.fill();
    stroke(ctx, A, 0.9, 0.8);
  } else {
    nucleoid(ctx, R * 0.3, R * 0.26, r, nx, ny, 0.35);
  }
  ribosomes(ctx, look, R, r, 60);
  if (f.has('golgi')) {
    const gx = R * 0.36;
    const gy = R * 0.3;
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      ctx.arc(gx + k * 4 * U, gy + k * 4 * U, R * 0.17 - k * 1.5 * U, Math.PI * 0.9, Math.PI * 1.6);
      stroke(ctx, A, 0.75 - k * 0.12, 1.1);
    }
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.arc(gx + R * 0.05 + r() * R * 0.15, gy + R * 0.1 + r() * R * 0.12, 1.8 * U, 0, TAU);
      stroke(ctx, A, 0.6, 0.6);
    }
  }
  // organelles find free room: never on the nucleus, the Golgi, the vacuole or each other
  const placed: { x: number; y: number; r: number }[] = [];
  if (f.has('nucleus')) placed.push({ x: nx, y: ny, r: nR + 24 * U });
  else placed.push({ x: nx, y: ny, r: R * 0.3 });
  if (f.has('golgi')) placed.push({ x: R * 0.42, y: R * 0.36, r: R * 0.2 });
  if (f.has('vacuole')) placed.push({ x: R * 0.3, y: -R * 0.35, r: R * 0.2 });
  if (f.has('nitroplast')) placed.push({ x: -R * 0.42, y: R * 0.38, r: R * 0.12 });
  const findSpot = (rad: number) => {
    for (let tries = 0; tries < 60; tries++) {
      const a = r() * TAU;
      const d = R * (0.3 + r() * 0.5);
      const x = Math.cos(a) * d;
      const y = Math.sin(a) * d;
      if (Math.hypot(x, y) + rad > R * 0.86) continue;
      if (placed.every((q) => Math.hypot(q.x - x, q.y - y) > q.r + rad + 3 * U)) {
        placed.push({ x, y, r: rad });
        return { x, y, a };
      }
    }
    return null;
  };
  const nm = f.has('mito6') ? 5 : f.has('mito4') ? 4 : f.has('mito') ? 3 : 0;
  for (let i = 0; i < nm; i++) {
    const spot = findSpot(R * 0.085 * 1.75);
    if (spot) mito(ctx, spot.x, spot.y, R * 0.085, spot.a + Math.PI / 2 + (r() - 0.5) * 0.8);
  }
  const nc = f.has('chloro4') ? 4 : f.has('chloro') ? 3 : 0;
  for (let i = 0; i < nc; i++) {
    const spot = findSpot(R * 0.11 * 1.65);
    if (spot) chloro(ctx, spot.x, spot.y, R * 0.11, spot.a + Math.PI / 2);
  }
  if (f.has('vacuole')) {
    const p = { x: R * 0.3, y: -R * 0.35 };
    ctx.beginPath();
    ctx.arc(p.x, p.y, R * 0.16, 0, TAU);
    ctx.fillStyle = mix(ORG[2], 0.08);
    ctx.fill();
    stroke(ctx, ORG[2], 0.7, 0.8);
    // a half-digested bacterium inside
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(0.6);
    ctx.beginPath();
    ctx.roundRect(-R * 0.08, -R * 0.035, R * 0.16, R * 0.07, R * 0.035);
    ctx.setLineDash([1.5 * U, 1.5 * U]);
    stroke(ctx, '#ffffff', 0.5, 0.6);
    ctx.setLineDash([]);
    ctx.restore();
  }
  if (f.has('nitroplast')) {
    const p = { x: -R * 0.42, y: R * 0.38 };
    for (const [s, al] of [
      [0.09, 0.9],
      [0.065, 0.45],
    ] as const) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, R * s, 0, TAU);
      stroke(ctx, '#6fe3cf', al, 0.8);
    }
  }
}

// ---------- shared small sprites ----------
const glowCache = new Map<string, HTMLCanvasElement>();
/** A soft round glow in a colour, for additive halos and bokeh. */
export function glowSprite(col: string, core = 0.5): HTMLCanvasElement {
  const key = col + core;
  const hit = glowCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, mix(col, core));
  g.addColorStop(0.35, mix(col, core * 0.35));
  g.addColorStop(1, mix(col, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  glowCache.set(key, c);
  return c;
}

/** Line-art bacteriophage: icosahedral head, tail, legs. */
export function drawPhage(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, a: number, col: string, alpha = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.strokeStyle = mix(col, 0.9 * alpha);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let k = 0; k < 6; k++) ctx.lineTo(Math.cos((k / 6) * TAU + Math.PI / 6) * s, -s * 2.2 + Math.sin((k / 6) * TAU + Math.PI / 6) * s);
  ctx.closePath();
  ctx.moveTo(0, -s * 1.2);
  ctx.lineTo(0, 0);
  ctx.moveTo(-s * 0.35, -s * 1.1);
  ctx.lineTo(-s * 0.35, -s * 0.2);
  ctx.moveTo(s * 0.35, -s * 1.1);
  ctx.lineTo(s * 0.35, -s * 0.2);
  ctx.moveTo(0, 0);
  ctx.lineTo(-s * 0.9, s * 0.5);
  ctx.moveTo(0, 0);
  ctx.lineTo(s * 0.9, s * 0.5);
  ctx.stroke();
  ctx.restore();
}

/** Draw a sprite cell centred at x,y with radius r (css px), rotation a, plus rim light. */
export function drawSpriteCell(ctx: CanvasRenderingContext2D, sp: Sprite, x: number, y: number, r: number, a: number, alpha: number, accent: string, sx = 1, sy = 1, rim = true) {
  const k = r / sp.R;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.scale(k * sx, k * sy);
  ctx.globalAlpha = alpha;
  ctx.drawImage(sp.c, -sp.w / 2, -sp.h / 2);
  if (rim) {
    // rim light from the upper left, fixed in world space
    const la = -2.3 - a;
    const d = sp.R * (sp.morph === 'rod' ? sp.aspect : 1.1);
    const g = ctx.createLinearGradient(Math.cos(la) * d, Math.sin(la) * d, -Math.cos(la) * d, -Math.sin(la) * d);
    g.addColorStop(0, mix(accent, 0.95));
    g.addColorStop(0.35, mix(WARM[1], 0.55));
    g.addColorStop(0.7, mix(WARM[2], 0));
    ctx.strokeStyle = g;
    ctx.lineWidth = 2.6 / k;
    ctx.globalCompositeOperation = 'lighter';
    ctx.stroke(sp.outline);
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}


// ---------- living cells: live outline, division, lysis ----------
export interface Shape {
  amp: number[];
  ph: number[];
  w: number[];
  pods: { th: number; amp: number; ph: number }[];
  len: number;
  flat?: number; // 1 just after division, easing to 0
  flatDir?: number; // local angle of the face that was joined to the sister cell
}

/** A per-cell body shape, so no two cells look alike. */
export function randomShape(morph: Morph, rnd: () => number = Math.random): Shape {
  const k = morph === 'euk' ? 0.065 : morph === 'proto' ? 0.03 : morph === 'cyano' ? 0.02 : 0;
  return {
    amp: [0, 0, k * (0.6 + rnd()), k * (0.4 + rnd() * 0.8), k * rnd() * 0.7, k * rnd() * 0.5],
    ph: Array.from({ length: 6 }, () => rnd() * TAU),
    w: Array.from({ length: 6 }, () => (rnd() - 0.5) * 0.6),
    pods: morph === 'euk' ? Array.from({ length: 2 + Math.floor(rnd() * 2) }, () => ({ th: rnd() * TAU, amp: 0.1 + rnd() * 0.16, ph: rnd() * TAU })) : [],
    len: morph === 'rod' ? 0.82 + rnd() * 0.4 : 1,
  };
}

const smooth01 = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * The outline of a living cell in world coordinates.
 * div: 0..1 progress of division (pinching into two), burst: 0..1 swelling as it lyses.
 * podDir: world angle a pseudopod reaches toward (amoeboid cells), or null.
 */
export function liveOutline(sp: Sprite, x: number, y: number, r: number, angle: number, t: number, sh: Shape, div: number, burst: number, podDir: number | null): P[] {
  const pts: P[] = [];
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const swell = 1 + 0.22 * burst;
  const push = (lx: number, ly: number) => pts.push({ x: x + (lx * ca - ly * sa) * r * swell, y: y + (lx * sa + ly * ca) * r * swell });
  if (sp.morph === 'rod') {
    // capsule; dividing rods elongate, then a septum pinches the middle
    const L = sp.aspect * sh.len * (1 + 0.85 * div);
    const depth = smooth01(0.25, 1, div) * 0.985;
    const m = 34;
    const facing = Math.cos(sh.flatDir ?? 0) >= 0 ? 1 : -1;
    const wAt = (lx: number) => {
      let cap = Math.abs(lx) > L - 1 ? Math.sqrt(Math.max(0, 1 - (Math.abs(lx) - (L - 1)) ** 2)) : 1;
      // the new pole made by the septum starts blunt, then rounds
      if (sh.flat && sh.flat > 0 && lx * facing > 0) cap = Math.pow(cap, 1 - 0.8 * sh.flat);
      return cap * (1 - depth * Math.exp(-((lx / 0.5) ** 2))) * (1 + 0.012 * Math.sin(t * 2 + lx * 3 + sh.ph[2]));
    };
    for (let i = 0; i < m; i++) {
      const lx = L * Math.cos(Math.PI * (1 - i / (m - 1)));
      push(lx, -wAt(lx));
    }
    for (let i = 0; i < m; i++) {
      const lx = L * Math.cos((Math.PI * i) / (m - 1));
      push(lx, wAt(lx));
    }
  } else {
    const n = 72;
    // division as a smooth union of two circles moving apart: one round body
    // stretches, a furrow forms and thins to a thread, leaving two round halves
    // (about 0.72 r wide, 0.8 r from the middle), exactly where the daughters start
    const sy = sp.morph === 'cyano' ? 0.9 : 1;
    const calm = 1 - div;
    const dd = 0.8 * smooth01(0, 1, div);
    const rho = 1 - 0.28 * smooth01(0, 1, div);
    // blend width: large (one round body) → 0.33, where the bridge is a hair-thin thread at the split
    const kk = 1.4 - 1.07 * smooth01(0.15, 0.92, div);
    const field = (px: number, py: number) => {
      const a1 = Math.hypot(px - dd, py) - rho;
      const a2 = Math.hypot(px + dd, py) - rho;
      const h = Math.max(kk - Math.abs(a1 - a2), 0) / kk;
      return Math.min(a1, a2) - h * h * kk * 0.25;
    };
    for (let i = 0; i < n; i++) {
      const th = (i / n) * TAU;
      let rr = 1;
      if (div > 0) {
        // the outline along this direction, by bisection on the field
        let lo = 0;
        let hi = 2.2;
        const cx = Math.cos(th);
        const cy = Math.sin(th);
        for (let it = 0; it < 16; it++) {
          const mid = (lo + hi) / 2;
          if (field(cx * mid, cy * mid) < 0) lo = mid;
          else hi = mid;
        }
        rr = Math.max(0.02, lo);
      }
      let wob = 0;
      for (let k = 2; k < 6; k++) wob += sh.amp[k] * calm * Math.sin(k * th + sh.ph[k] + sh.w[k] * t);
      for (let j = 0; j < sh.pods.length; j++) {
        const pd = sh.pods[j];
        let th0 = pd.th + 0.15 * Math.sin(t * 0.13 + pd.ph);
        let amp = pd.amp * (0.45 + 0.55 * Math.sin(t * 0.45 + pd.ph));
        if (j === 0 && podDir !== null) {
          th0 = podDir - angle;
          amp = 0.26;
        }
        let d = th - th0;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        wob += Math.max(0, amp) * calm * Math.exp(-((d / 0.38) ** 2));
      }
      rr *= 1 + wob;
      if (sh.flat && sh.flat > 0) {
        // the face that was joined to the sister cell starts flat, then rounds out
        const c = Math.max(0, Math.cos(th - (sh.flatDir ?? 0)));
        rr *= 1 - 0.32 * sh.flat * c * c * c;
      }
      push(Math.cos(th) * rr, Math.sin(th) * rr * sy);
    }
  }
  return pts;
}

export interface LiveState {
  x: number;
  y: number;
  r: number;
  angle: number;
  t: number;
  shape: Shape;
  div: number;
  dying: number; // 1 alive .. 0 gone; < 1 means lysing
  alpha: number;
  accent: string;
  podDir: number | null;
  /** A newborn daughter: its outline starts as its half of the parent's pinched outline (local coordinates) and relaxes to its own shape as k falls from 1 to 0. */
  birth?: { pts: P[]; k: number };
}

/**
 * One daughter's half of the parent's fully pinched outline, in the daughter's
 * local frame (relative to its centre, unrotated). Used so a daughter's first
 * frame is exactly the shape it had as half of its parent.
 */
export function halfOutline(sp: Sprite, x: number, y: number, r: number, angle: number, t: number, shape: Shape, side: 1 | -1, cx: number, cy: number): P[] {
  const full = liveOutline(sp, x, y, r, angle, t, shape, 1, 0, null);
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const on = full.map((p) => ((p.x - x) * ca + (p.y - y) * sa) * side >= 0);
  // the half is one contiguous run of the closed loop: start it right after a switch
  let start = on.findIndex((v, i) => v && !on[(i - 1 + on.length) % on.length]);
  if (start < 0) start = 0;
  const out: P[] = [];
  for (let k = 0; k < full.length; k++) {
    const i = (start + k) % full.length;
    if (!on[i]) break;
    const dx = full[i].x - cx;
    const dy = full[i].y - cy;
    out.push({ x: dx * ca + dy * sa, y: -dx * sa + dy * ca });
  }
  return out;
}

/** Distance from c to the outline along direction phi (outermost crossing). */
function rayRadius(poly: P[], c: P, phi: number): number {
  const dx = Math.cos(phi);
  const dy = Math.sin(phi);
  let best = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-9) continue;
    const ax = a.x - c.x;
    const ay = a.y - c.y;
    const tt = (ax * ey - ay * ex) / den;
    const u = (ax * dy - ay * dx) / den;
    if (tt > 0 && u >= 0 && u <= 1) best = Math.max(best, tt);
  }
  return best;
}

/**
 * Blend a newborn daughter's own outline with its birth shape. Both are
 * sampled along the same directions from the centre (the directions of the
 * daughter's own outline points), so the blend ends exactly on the daughter's
 * own shape; the birth shape is smoothed more and more as it relaxes, so the
 * pinch point rounds off gradually.
 */
function blendBirth(pts: P[], st: LiveState): P[] {
  const b = st.birth!;
  const k = b.k * b.k * (3 - 2 * b.k);
  const ca = Math.cos(st.angle);
  const sa = Math.sin(st.angle);
  const c = { x: st.x, y: st.y };
  const birth = b.pts.map((q) => ({ x: c.x + q.x * ca - q.y * sa, y: c.y + q.x * sa + q.y * ca }));
  const n = pts.length;
  const phi = pts.map((p) => Math.atan2(p.y - c.y, p.x - c.x));
  const rn = pts.map((p) => Math.hypot(p.x - c.x, p.y - c.y));
  const rb = phi.map((f, i) => rayRadius(birth, c, f) || rn[i]);
  // widen the smoothing window as the shape relaxes: the pinch point rounds first
  const win = Math.round(Math.sqrt(1 - b.k) * 9);
  const rs = win > 0 ? rb.map((_, i) => {
    let sum = 0;
    for (let d = -win; d <= win; d++) sum += rb[(i + d + n) % n];
    return sum / (2 * win + 1);
  }) : rb;
  return pts.map((_, i) => {
    const rr = k * rs[i] + (1 - k) * rn[i];
    return { x: c.x + Math.cos(phi[i]) * rr, y: c.y + Math.sin(phi[i]) * rr };
  });
}

/** Draw a living cell: interior sprite clipped to the live outline, then membrane and rim light. */
export function drawLiveCell(ctx: CanvasRenderingContext2D, sp: Sprite, st: LiveState) {
  const lysing = st.dying < 1;
  const burst = lysing ? 1 - st.dying : 0;
  let pts = liveOutline(sp, st.x, st.y, st.r, st.angle, st.t, st.shape, st.div, burst, st.podDir);
  if (st.birth && st.birth.k > 0 && st.birth.pts.length > 8) pts = blendBirth(pts, st);
  const path = new Path2D();
  smooth(path, pts, true);
  const k = st.r / sp.R;
  const ca = Math.cos(st.angle);
  const sa = Math.sin(st.angle);
  // interior: one body, or two daughters separating as it divides
  const two = smooth01(0.2, 0.55, st.div);
  const inner = lysing ? st.alpha * st.dying * st.dying : st.alpha;
  ctx.save();
  ctx.clip(path);
  const blit = (cx: number, cy: number, scale: number, a: number) => {
    if (a <= 0.01) return;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(st.angle);
    ctx.scale(scale, scale);
    ctx.globalAlpha = a;
    ctx.drawImage(sp.c, -sp.w / 2, -sp.h / 2);
    ctx.restore();
  };
  blit(st.x, st.y, k * (1 + 0.1 * st.div + 0.1 * burst), inner * (1 - two));
  if (two > 0) {
    const off = sp.morph === 'rod' ? st.r * sp.aspect * st.shape.len * (1 + 0.85 * st.div) * 0.5 : st.r * 0.8 * smooth01(0.2, 1, st.div);
    const ks = k * (sp.morph === 'rod' ? 0.9 : 0.72);
    blit(st.x + ca * off, st.y + sa * off, ks, inner * two);
    blit(st.x - ca * off, st.y - sa * off, ks, inner * two);
  }
  ctx.restore();
  ctx.globalAlpha = 1;
  // membrane: bilayer lines with lipid tails; it tears open as the cell lyses
  const a = st.alpha * (lysing ? Math.max(0, st.dying * 1.4 - 0.2) : 1);
  if (a <= 0.01) return;
  const inn = offset(pts, -Math.max(2.5, st.r * 0.07));
  if (lysing) ctx.setLineDash([Math.max(1, 14 * st.dying), 4 + 16 * burst]);
  ctx.strokeStyle = mix('#ffffff', 0.9 * a);
  ctx.lineWidth = 1.2;
  ctx.stroke(path);
  ctx.beginPath();
  smooth(ctx, inn, true);
  ctx.strokeStyle = mix('#ffffff', 0.4 * a);
  ctx.lineWidth = 0.7;
  ctx.stroke();
  ctx.setLineDash([]);
  if (!lysing) {
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += 2) {
      const o = pts[i];
      const q = inn[i];
      ctx.moveTo(o.x + (q.x - o.x) * 0.2, o.y + (q.y - o.y) * 0.2);
      ctx.lineTo(o.x + (q.x - o.x) * 0.8, o.y + (q.y - o.y) * 0.8);
    }
    ctx.strokeStyle = mix('#ffffff', 0.2 * a);
    ctx.lineWidth = 0.5;
    ctx.stroke();
    if (sp.morph === 'rod' || sp.morph === 'cyano') {
      ctx.beginPath();
      smooth(ctx, offset(pts, 3.2), true);
      ctx.setLineDash([2.5, 2.5]);
      ctx.strokeStyle = mix('#ffffff', 0.25 * a);
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // rim light from the upper left
    const d = st.r * (sp.morph === 'rod' ? sp.aspect : 1.1);
    const g = ctx.createLinearGradient(st.x - d * 0.7, st.y - d * 0.7, st.x + d * 0.7, st.y + d * 0.7);
    g.addColorStop(0, mix(st.accent, 0.95 * a));
    g.addColorStop(0.45, mix(st.accent, 0.25 * a));
    g.addColorStop(0.75, mix(st.accent, 0));
    ctx.strokeStyle = g;
    ctx.lineWidth = 2.4;
    ctx.globalCompositeOperation = 'lighter';
    ctx.stroke(path);
    ctx.globalCompositeOperation = 'source-over';
  }
}

