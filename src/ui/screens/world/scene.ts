// The World scene: a technical cross-section of a shore. Sky, the sunlit and
// dim water, a layered microbial mat on the sediment, and rock with banded
// iron. Light fades with depth; an oxycline marks where oxygen runs out;
// marine snow drifts down, O₂ bubbles rise from phototrophs and methane from
// the archaea (oxygen destroys it on the way up). Each species is a loose
// band of line-art cells (the same sprites as the Cells view), labelled with
// a leader line; the species in focus wears FUI corner brackets.
import { cellSprite, type CellLook, type Sprite } from '../../art';
import { hash01 } from '../../hooks';
import { MONO, POOL, SANS, guildColor, mix } from '../../theme';
import type { WorldGuildSnap, WorldSnap } from '../../../sim/snapshot';

/** Layer bands as fractions of the scene height: sky, sunlit, dim, sediment, rock. */
export const BAND = { sky: 0.11, sunlit: 0.37, dim: 0.63, sediment: 0.86 } as const;
const LAYER_Y: [number, number][] = [
  [BAND.sky, BAND.sunlit],
  [BAND.sunlit, BAND.dim],
  [BAND.dim, BAND.sediment],
];

interface Particle {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  t: number;
  col: string;
  bend: number;
  flake: boolean;
}
interface Bubble {
  x: number;
  y: number;
  r: number;
  v: number;
  kind: 'o2' | 'ch4';
  top: number;
}
export interface Home {
  x: number;
  y: number;
  rx: number;
  ry: number;
}

/** Everything the scene keeps between frames. */
export interface WorldScene {
  homes: Record<string, Home>;
  parts: Particle[];
  bubbles: Bubble[];
  spawn: Record<string, number>;
  tex: { key: string; c: HTMLCanvasElement } | null;
}
export const newWorldScene = (): WorldScene => ({ homes: {}, parts: [], bubbles: [], spawn: {}, tex: null });

/** What each species looks like under the microscope. */
function lookOf(g: WorldGuildSnap, variant: number): CellLook {
  const color = guildColor(g);
  const v = variant + g.id.length * 3;
  switch (g.id) {
    case 'archaea':
      return { morph: 'rod', color, aspect: 1.12, features: [], variant: v };
    case 'lact':
      return { morph: 'rod', color, aspect: 1.7, features: ['flag'], variant: v };
    case 'debris':
      return { morph: 'rod', color, aspect: 1.4, features: ['glyc'], variant: v };
    case 'photo':
      return g.look === 'purple' ? { morph: 'rod', color, aspect: 1.8, features: ['atps'], variant: v } : { morph: 'cyano', color, aspect: 1, features: ['atps'], variant: v };
    case 'resp':
      return { morph: 'rod', color, aspect: 1.55, features: ['atps', 'flag'], variant: v };
    case 'euk':
      return { morph: 'euk', color, aspect: 1, features: ['nucleus', 'mito'], variant: v };
    case 'alga':
      return { morph: 'euk', color, aspect: 1, features: ['nucleus', 'chloro'], variant: v };
    case 'hunter':
      return { morph: 'euk', color, aspect: 1, features: ['nucleus', 'mito', 'golgi', 'vacuole'], variant: v };
    case 'body':
      return g.look === 'seaweed' ? { morph: 'euk', color, aspect: 1, features: ['nucleus', 'chloro'], variant: v } : { morph: 'euk', color, aspect: 1, features: ['nucleus', 'mito'], variant: v };
    default:
      return { morph: 'rod', color, aspect: 1.9, features: ['glyc'], variant: v };
  }
}
/** Big enough that the line art reads; the number of cells, not their size, shows abundance. */
const cellSize = (g: WorldGuildSnap) => (g.domain === 'eukaryote' ? (g.id === 'body' ? 7 : 12) : g.id === 'archaea' ? 6.4 : g.id === 'photo' && g.look !== 'purple' ? 8 : 7.2);
const cellCount = (g: WorldGuildSnap) => Math.round((g.domain === 'eukaryote' ? 7 : 14) * Math.min(1.2, Math.max(0.04, g.B))) + (g.domain === 'eukaryote' ? 2 : 3);

/** Static textures (sediment stipple, rock strata, mat laminae), rebuilt only on resize. */
function textures(sc: WorldScene, W: number, sh: number) {
  const key = `${W}x${sh}`;
  if (sc.tex?.key === key) return sc.tex.c;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(W));
  c.height = Math.max(1, Math.round(sh));
  const g = c.getContext('2d')!;
  const y0 = BAND.dim * sh;
  const y1 = BAND.sediment * sh;
  // sediment: fine stipple, denser with depth
  for (let i = 0; i < (W * (y1 - y0)) / 70; i++) {
    const x = hash01(i * 1.7) * W;
    const fy = Math.pow(hash01(i * 3.3 + 7), 0.7);
    const y = y0 + 10 + fy * (y1 - y0 - 10);
    g.fillStyle = `rgba(214,190,160,${0.05 + 0.1 * fy})`;
    g.fillRect(x, y, 1, 1);
  }
  // rock: faint strata
  g.strokeStyle = 'rgba(255,255,255,0.035)';
  g.lineWidth = 1;
  for (let k = 0; k < 9; k++) {
    const yy = y1 + ((sh - y1) * (k + 0.5)) / 9;
    g.beginPath();
    for (let x = 0; x <= W; x += 10) g.lineTo(x, yy + Math.sin(x * 0.012 + k * 1.9) * 2.2);
    g.stroke();
  }
  sc.tex = { key, c };
  return c;
}

export interface DrawOpts {
  X0: number; // the scene starts right of the side panel
  sh: number; // scene height (above the chart)
  move: number; // 0 with reduced motion
  accent: string;
  hover: string | null;
  dayPhase: number | null;
}

export function drawWorld(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, dt: number, s: WorldSnap, sc: WorldScene, o: DrawOpts) {
  const { X0, sh, move, accent } = o;
  const y = (f: number) => f * sh;
  const sx = (f: number) => X0 + (W - X0 - 24) * f;
  ctx.clearRect(0, 0, W, H);
  const O2 = s.res.O2 ?? 0;
  const CH4 = s.res.CH4 ?? 0;
  const day = s.surface && o.dayPhase !== null ? Math.max(0, Math.sin(o.dayPhase * Math.PI * 2)) : 1;

  // ---- sky: methane haze before oxygen, blue once the air holds O₂ ----
  const sky = ctx.createLinearGradient(0, 0, 0, y(BAND.sky));
  sky.addColorStop(0, '#04060a');
  sky.addColorStop(1, mix(O2 > 0.3 ? '#3d78b8' : '#c8763c', (O2 > 0.3 ? Math.min(0.32, O2 * 0.2) : Math.min(0.3, 0.06 + CH4 * 0.12)) * (0.35 + 0.65 * day)));
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, y(BAND.sky));
  if (day < 0.5) {
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(230,236,255,${(0.5 - day) * (0.2 + 0.3 * hash01(i * 9.1))})`;
      ctx.fillRect(hash01(i * 4.7) * W, hash01(i * 2.3) * y(BAND.sky) * 0.9, 1, 1);
    }
  }
  // the sun crosses the sky with the day
  const sunF = o.dayPhase !== null && s.surface ? o.dayPhase * 2 : 0.82;
  if (sunF <= 1) {
    const sxp = sx(0.08 + 0.84 * sunF);
    const syp = y(BAND.sky) * (0.75 - 0.5 * Math.sin(Math.PI * Math.min(1, sunF)));
    const glow = ctx.createRadialGradient(sxp, syp, 0, sxp, syp, 70);
    glow.addColorStop(0, mix(POOL.light, 0.28));
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow;
    ctx.fillRect(sxp - 70, Math.max(0, syp - 70), 140, 140);
    ctx.strokeStyle = mix(POOL.light, 0.75);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(sxp, syp, 7, 0, Math.PI * 2);
    ctx.stroke();
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2 + t * 0.05 * move;
      ctx.beginPath();
      ctx.moveTo(sxp + Math.cos(a) * 10, syp + Math.sin(a) * 10);
      ctx.lineTo(sxp + Math.cos(a) * (k % 2 ? 13 : 16), syp + Math.sin(a) * (k % 2 ? 13 : 16));
      ctx.stroke();
    }
  }

  // ---- water: light fades with depth ----
  const wat = ctx.createLinearGradient(0, y(BAND.sky), 0, y(BAND.dim));
  wat.addColorStop(0, mix('#14506a', 0.55 + 0.25 * day));
  wat.addColorStop(0.45, '#0a2230');
  wat.addColorStop(1, '#060f16');
  ctx.fillStyle = wat;
  ctx.fillRect(0, y(BAND.sky), W, y(BAND.dim) - y(BAND.sky));
  // light shafts, only by day where the sun reaches
  if (s.surface && day > 0.05) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 9; i++) {
      const x0 = sx(i * 0.12 - 0.04) + Math.sin(t * 0.17 * move + i * 1.3) * 14;
      const g = ctx.createLinearGradient(0, y(BAND.sky), 0, y(BAND.dim));
      g.addColorStop(0, mix(POOL.light, 0.06 * day));
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x0, y(BAND.sky));
      ctx.lineTo(x0 + 22 + (i % 3) * 8, y(BAND.sky));
      ctx.lineTo(x0 + 90, y(BAND.dim));
      ctx.lineTo(x0 + 46, y(BAND.dim));
      ctx.fill();
    }
    ctx.restore();
  }
  // surface ripples
  ctx.strokeStyle = 'rgba(200,250,250,0.4)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= W; x += 5) {
    const yy = y(BAND.sky) + Math.sin(x * 0.028 + t * 1.1 * move) * 1.3 + Math.sin(x * 0.009 - t * 0.6 * move) * 1;
    if (x === 0) ctx.moveTo(x, yy);
    else ctx.lineTo(x, yy);
  }
  ctx.stroke();

  // ---- sediment and microbial mat ----
  const sedTop = y(BAND.dim);
  const sed = ctx.createLinearGradient(0, sedTop, 0, y(BAND.sediment));
  sed.addColorStop(0, '#16100c');
  sed.addColorStop(1, '#0b0807');
  ctx.fillStyle = sed;
  ctx.fillRect(0, sedTop, W, y(BAND.sediment) - sedTop);
  // laminae: the mat's coloured layers (phototrophs on top, then purple bacteria, then the dark anaerobes)
  const lam = ['rgba(77,232,176,0.28)', 'rgba(196,92,255,0.22)', 'rgba(255,154,77,0.16)', 'rgba(45,226,196,0.12)'];
  lam.forEach((c, k) => {
    ctx.strokeStyle = c;
    ctx.lineWidth = k === 0 ? 1.4 : 1;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 6) ctx.lineTo(x, sedTop + 2 + k * 4 + Math.sin(x * 0.04 + k * 1.3) * 1.6 + Math.sin(x * 0.011 + k) * 1.2);
    ctx.stroke();
  });
  // ---- rock and banded iron ----
  const rockTop = y(BAND.sediment);
  ctx.fillStyle = '#0a0a0d';
  ctx.fillRect(0, rockTop, W, sh - rockTop);
  ctx.drawImage(textures(sc, W, sh), 0, 0);
  const rust = 1 - (s.res.iron ?? 1);
  const bands = Math.round(rust * 22);
  const bh = (sh - rockTop - 4) / 23;
  for (let i = 0; i < bands; i++) {
    const yy = sh - 2 - (i + 1) * bh;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(178,70,40,0.62)' : 'rgba(92,96,110,0.42)';
    ctx.beginPath();
    for (let x = 0; x <= W; x += 10) ctx.lineTo(x, yy + Math.sin(x * 0.017 + i * 0.7) * 1.4);
    for (let x = W; x >= 0; x -= 10) ctx.lineTo(x, yy + bh * 0.82 + Math.sin(x * 0.017 + i * 0.7 + 0.4) * 1.4);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.beginPath();
  ctx.moveTo(0, rockTop);
  ctx.lineTo(W, rockTop);
  ctx.stroke();

  // ---- oxygen: tint and the oxycline ----
  for (let l = 0; l < 2; l++) {
    const o2 = s.o2Layers[l] ?? 0;
    if (o2 > 0.01) {
      ctx.fillStyle = mix(POOL.oxygen, Math.min(0.06, o2 * 0.05));
      ctx.fillRect(0, y(LAYER_Y[l][0]), W, y(LAYER_Y[l][1]) - y(LAYER_Y[l][0]));
    }
  }
  if (O2 > 0.04) {
    const oy = sedTop - 6;
    ctx.strokeStyle = mix(POOL.oxygen, 0.55);
    ctx.setLineDash([6, 5]);
    ctx.lineDashOffset = -t * 4 * move;
    ctx.beginPath();
    ctx.moveTo(X0, oy);
    ctx.lineTo(W, oy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = `600 8.5px ${MONO}`;
    ctx.fillStyle = mix(POOL.oxygen, 0.8);
    ctx.textAlign = 'right';
    ctx.fillText('OXYCLINE · OXYGEN ENDS HERE', W - 28, oy - 5);
  }

  // ---- depth scale: zone names on a hairline ruler ----
  const rx = X0 + 14;
  ctx.strokeStyle = 'rgba(233,238,242,0.18)';
  ctx.beginPath();
  ctx.moveTo(rx, y(BAND.sky));
  ctx.lineTo(rx, sh - 4);
  ctx.stroke();
  const zones: [number, string, string][] = [
    [BAND.sky, s.layers[0], 'PHOTIC'],
    [BAND.sunlit, s.layers[1], 'TWILIGHT'],
    [BAND.dim, s.layers[2], 'ANOXIC'],
    [BAND.sediment, 'Rock', bands > 0 ? 'BANDED IRON' : 'BASALT'],
  ];
  ctx.textAlign = 'left';
  zones.forEach(([f, name, tag], k) => {
    const yy = y(f);
    ctx.strokeStyle = 'rgba(233,238,242,0.35)';
    ctx.beginPath();
    ctx.moveTo(rx - 4, yy);
    ctx.lineTo(rx + 6, yy);
    ctx.stroke();
    for (let m = 1; m < 4; m++) {
      const ym = yy + ((y(zones[k + 1]?.[0] ?? 1) - yy) * m) / 4;
      ctx.beginPath();
      ctx.moveTo(rx - 2, ym);
      ctx.lineTo(rx + 2, ym);
      ctx.stroke();
    }
    ctx.font = `600 8.5px ${MONO}`;
    ctx.fillStyle = k === 3 && bands > 0 ? 'rgba(233,160,130,0.6)' : 'rgba(233,238,242,0.42)';
    ctx.fillText(`${tag}`, rx + 9, yy + 12);
    ctx.font = `500 10px ${SANS}`;
    ctx.fillStyle = 'rgba(233,238,242,0.28)';
    ctx.fillText(name, rx + 9, yy + 24);
    const o2 = s.o2Layers[k] ?? 0;
    if (k < 3 && o2 > 0.01) {
      ctx.font = `600 8.5px ${MONO}`;
      ctx.fillStyle = mix(POOL.oxygen, 0.75);
      ctx.fillText(`O₂ ${o2.toFixed(2)}`, rx + 9, yy + 36);
    }
  });

  // ---- species homes: loose bands inside their layer ----
  const byLayer: WorldGuildSnap[][] = [[], [], []];
  for (const g of s.guilds) byLayer[g.layer]?.push(g);
  const homes: Record<string, Home> = {};
  for (let l = 0; l < 3; l++) {
    const list = byLayer[l];
    const [a, b] = LAYER_Y[l];
    const n = list.length;
    list.forEach((g, i) => {
      const x = sx(0.13 + (0.82 * (i + 0.5)) / Math.max(1, n));
      const lh = y(b) - y(a);
      const yy = y(a) + lh * (n > 2 ? (i % 2 ? 0.66 : 0.4) : 0.55);
      const rxw = Math.max(26, Math.min(((W - X0) * 0.8) / Math.max(1, n) / 2 - 8, 30 + 44 * Math.sqrt(Math.max(0.02, g.B))));
      const ry = Math.max(12, Math.min(lh * 0.24, 10 + 16 * Math.sqrt(Math.max(0.02, g.B))));
      const prev = sc.homes[g.id];
      const k = Math.min(1, dt * 1.4);
      homes[g.id] = prev ? { x: prev.x + (x - prev.x) * k, y: prev.y + (yy - prev.y) * k, rx: prev.rx + (rxw - prev.rx) * k, ry: prev.ry + (ry - prev.ry) * k } : { x, y: yy, rx: rxw, ry };
    });
  }
  sc.homes = homes;

  // ---- marine snow: dead cells drifting down ----
  const snow = Math.round(20 + 40 * Math.min(1, (s.res.organics ?? 0) / 2));
  ctx.fillStyle = 'rgba(220,214,200,0.22)';
  for (let i = 0; i < snow; i++) {
    const x = X0 + hash01(i * 5.1) * (W - X0) + Math.sin(t * 0.3 * move + i) * 6;
    const span = sedTop - y(BAND.sky);
    const yy = y(BAND.sky) + ((hash01(i * 2.9) * span + t * (6 + 6 * hash01(i)) * move) % span);
    ctx.fillRect(x, yy, 1.4, 1.4);
  }

  // ---- bubbles: oxygen from phototrophs, methane from archaea ----
  const photo = s.guilds.find((g) => g.alive && (g.id === 'alga' || (g.id === 'photo' && g.look === 'cyano')));
  const arch = s.guilds.find((g) => g.alive && g.id === 'archaea');
  if (move) {
    if (photo && homes[photo.id] && Math.random() < dt * 3 * Math.min(1, photo.B)) {
      const h = homes[photo.id];
      sc.bubbles.push({ x: h.x + (Math.random() - 0.5) * h.rx * 1.6, y: h.y, r: 1.2 + Math.random() * 1.4, v: 14 + Math.random() * 10, kind: 'o2', top: y(BAND.sky) });
    }
    if (arch && homes[arch.id] && Math.random() < dt * 2.5 * Math.min(1, arch.B + 0.2)) {
      const h = homes[arch.id];
      // oxygen destroys methane: bubbles dissolve at the oxycline once there is oxygen
      sc.bubbles.push({ x: h.x + (Math.random() - 0.5) * h.rx * 1.6, y: h.y, r: 1.4 + Math.random() * 1.6, v: 10 + Math.random() * 8, kind: 'ch4', top: O2 > 0.05 ? sedTop - 10 : y(BAND.sky) });
    }
  }
  sc.bubbles = sc.bubbles.filter((b) => b.y > b.top && sc.bubbles.length < 220);
  for (const b of sc.bubbles) {
    b.y -= b.v * dt;
    b.x += Math.sin(b.y * 0.08) * 0.2;
    const life = Math.min(1, (b.y - b.top) / 30);
    ctx.strokeStyle = b.kind === 'o2' ? `rgba(255,140,160,${0.55 * life})` : `rgba(45,226,196,${0.5 * life})`;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // ---- flows between species ----
  for (const f of s.flows) {
    const a = homes[f.from];
    const b = homes[f.to];
    if (!a || !b || !move) continue;
    const key = f.from + f.to;
    sc.spawn[key] = (sc.spawn[key] ?? 0) + dt * Math.min(9, f.rate * 12);
    while (sc.spawn[key] >= 1 && sc.parts.length < 300) {
      sc.spawn[key] -= 1;
      sc.parts.push({
        ax: a.x + (Math.random() - 0.5) * a.rx,
        ay: a.y + (Math.random() - 0.5) * a.ry,
        bx: b.x + (Math.random() - 0.5) * b.rx,
        by: b.y + (Math.random() - 0.5) * b.ry,
        t: 0,
        col: (POOL as Record<string, string>)[f.color] ?? '#fff',
        bend: (Math.random() - 0.5) * 70,
        flake: f.what === 'dead cells',
      });
    }
  }
  sc.parts = sc.parts.filter((p) => p.t < 1);
  for (const p of sc.parts) {
    p.t += dt / 2.8;
    const u = p.t;
    const mx = (p.ax + p.bx) / 2 + p.bend;
    const my = Math.min(p.ay, p.by) - 26;
    const px = (1 - u) * (1 - u) * p.ax + 2 * (1 - u) * u * mx + u * u * p.bx;
    const py = (1 - u) * (1 - u) * p.ay + 2 * (1 - u) * u * my + u * u * p.by;
    ctx.globalAlpha = Math.sin(Math.PI * u) * (p.flake ? 0.4 : 0.8);
    ctx.fillStyle = p.col;
    if (p.flake) ctx.fillRect(px - 1.5, py - 0.7, 3, 1.4);
    else {
      ctx.beginPath();
      ctx.arc(px, py, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  // ---- the species: cells first, then every label placed clear of the others ----
  for (const g of s.guilds) {
    const h = homes[g.id];
    if (!h) continue;
    const col = guildColor(g);
    if (!g.alive) {
      brackets(ctx, h.x - 26, h.y - 14, 52, 28, 'rgba(233,238,242,0.25)', 6, true);
      continue;
    }
    const n = cellCount(g);
    const r = cellSize(g);
    const hov = o.hover === g.id;
    for (let k = 0; k < n; k++) {
      const s1 = hash01(k * 7.3 + g.id.charCodeAt(0) * 0.37);
      const s2 = hash01(k * 3.1 + g.id.charCodeAt(1) * 0.53);
      // a loose elliptical band, each cell drifting on its own slow orbit
      const an = s2 * Math.PI * 2 + t * 0.05 * move * (s1 - 0.5);
      const d = 0.15 + 0.85 * Math.sqrt(s1);
      const cx = h.x + Math.cos(an) * d * (h.rx - r) + Math.sin(t * 0.4 * move + k) * 2.5;
      const cy = h.y + Math.sin(an) * d * (h.ry - r * 0.5) + Math.cos(t * 0.35 * move + k * 1.7) * 2;
      const rot = s1 * 6.28 + t * 0.12 * move * (s2 - 0.5);
      const look = lookOf(g, k % 3);
      if (g.id === 'body') {
        // bodies: little clusters of cells
        for (let m = 0; m < 5; m++) {
          const am = (m / 5) * Math.PI * 2 + rot;
          const dm = m === 0 ? 0 : r * 1.5;
          miniCell(ctx, cellSprite(look), cx + Math.cos(am) * dm, cy + Math.sin(am) * dm, r, am, col, hov ? 1 : 0.9, true);
        }
      } else miniCell(ctx, cellSprite(look), cx, cy, r * (0.88 + 0.24 * s2), rot, col, hov || g.protagonist ? 1 : 0.88, g.domain === 'eukaryote', g.protagonist ? accent : undefined);
    }
    // brackets: the species in focus (accent), one in danger (red, blinking), the hovered one
    const bw = h.rx * 2 + 18;
    const bhh = h.ry * 2 + 16;
    if (g.danger) brackets(ctx, h.x - bw / 2, h.y - bhh / 2, bw, bhh, mix(POOL.oxygen, 0.45 + 0.4 * Math.abs(Math.sin(t * 4))), 9, false);
    else if (g.protagonist) brackets(ctx, h.x - bw / 2, h.y - bhh / 2, bw, bhh, mix(accent, 0.85), 9, false);
    else if (hov) brackets(ctx, h.x - bw / 2, h.y - bhh / 2, bw, bhh, 'rgba(233,238,242,0.4)', 7, false);
  }
  // labels: the species in focus first, then the biggest; each takes the free spot nearest its swarm
  type Box = { x: number; y: number; w: number; h: number };
  const overlap = (p: Box, q: Box) => Math.max(0, Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x)) * Math.max(0, Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y));
  // swarms (with room for their brackets) are obstacles for every label but their own
  const swarms: (Box & { id: string })[] = s.guilds.filter((g) => homes[g.id]).map((g) => ({ id: g.id, x: homes[g.id].x - homes[g.id].rx - 10, y: homes[g.id].y - homes[g.id].ry - 9, w: homes[g.id].rx * 2 + 20, h: homes[g.id].ry * 2 + 18 }));
  const placed: Box[] = [];
  const order = s.guilds.filter((g) => homes[g.id]).sort((p, q) => Number(q.protagonist) - Number(p.protagonist) || q.B - p.B);
  for (const g of order) {
    const h = homes[g.id];
    const col = guildColor(g);
    const title = g.name.toUpperCase();
    const sub = g.alive ? `${(g.share * 100).toFixed(0)}% · ${g.danger ? 'oxygen is killing them' : g.status}` : 'lost';
    ctx.font = `600 9px ${MONO}`;
    const titleW = ctx.measureText(title).width;
    ctx.font = `500 10.5px ${SANS}`;
    const tw = Math.max(titleW, ctx.measureText(sub).width) + 8;
    const up = h.y - h.ry - 16;
    const down = h.y + h.ry + 26;
    const cand: { lx: number; ly: number; side: 1 | -1 }[] = [
      { lx: h.x + h.rx * 0.35, ly: up, side: 1 },
      { lx: h.x - h.rx * 0.35, ly: up, side: -1 },
      { lx: h.x + h.rx * 0.35, ly: down, side: 1 },
      { lx: h.x - h.rx * 0.35, ly: down, side: -1 },
      { lx: h.x + h.rx * 0.6, ly: up - 22, side: 1 },
      { lx: h.x - h.rx * 0.6, ly: up - 22, side: -1 },
      { lx: h.x + h.rx + 6, ly: h.y - 4, side: 1 },
      { lx: h.x - h.rx - 6, ly: h.y - 4, side: -1 },
      { lx: h.x + h.rx * 0.6, ly: down + 22, side: 1 },
      { lx: h.x - h.rx * 0.6, ly: down + 22, side: -1 },
    ];
    let best = cand[0];
    let bestScore = Infinity;
    cand.forEach((c, i) => {
      const box: Box = { x: c.side > 0 ? c.lx + 10 : c.lx - 10 - tw, y: c.ly - 15, w: tw + 4, h: 32 };
      let score = i * 30; // prefer the nearer spots
      if (box.x < X0 + 64 || box.x + box.w > W - 8 || box.y < 4 || box.y + box.h > sh - 4) score += 1e6;
      for (const q of placed) score += overlap(box, q) * 50;
      for (const q of swarms) score += overlap(box, q) * (q.id === g.id ? 3 : 6);
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    });
    const bx = best.side > 0 ? best.lx + 10 : best.lx - 10 - tw;
    placed.push({ x: bx, y: best.ly - 15, w: tw + 4, h: 32 });
    // leader: from the swarm's edge to the label
    const ang = Math.atan2(best.ly - h.y, best.lx - h.x);
    const ex = h.x + Math.cos(ang) * h.rx * 0.75;
    const ey = h.y + Math.sin(ang) * h.ry * 0.75;
    ctx.strokeStyle = 'rgba(233,238,242,0.36)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(best.lx, best.ly);
    ctx.lineTo(best.lx + best.side * (tw + 12), best.ly);
    ctx.stroke();
    ctx.fillStyle = g.alive ? col : 'rgba(233,238,242,0.4)';
    ctx.beginPath();
    ctx.arc(ex, ey, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = best.side > 0 ? 'left' : 'right';
    const tx = best.lx + best.side * 12;
    ctx.font = `600 9px ${MONO}`;
    ctx.fillStyle = !g.alive ? 'rgba(233,238,242,0.45)' : g.protagonist ? mix(accent, 0.95) : g.danger ? mix(POOL.oxygen, 0.95) : mix(col, 0.92);
    ctx.fillText(title, tx, best.ly - 5);
    ctx.font = `500 10.5px ${SANS}`;
    ctx.fillStyle = 'rgba(233,238,242,0.66)';
    ctx.fillText(sub, tx, best.ly + 12);
  }
  ctx.textAlign = 'left';
}

/**
 * A small cell for the World: the sprite's outline drawn crisp in the species'
 * colour with a faint fill (at this size the full interior reads as noise);
 * eukaryotes keep a hint of their nucleus and organelles.
 */
function miniCell(ctx: CanvasRenderingContext2D, sp: Sprite, x: number, y: number, r: number, a: number, col: string, alpha: number, interior: boolean, glow?: string) {
  const k = r / sp.R;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.scale(k, k);
  ctx.fillStyle = mix(col, 0.13 * alpha);
  ctx.fill(sp.outline);
  if (interior) {
    ctx.globalAlpha = 0.42 * alpha;
    ctx.drawImage(sp.c, -sp.w / 2, -sp.h / 2);
    ctx.globalAlpha = 1;
  }
  if (glow) {
    // the species in focus: a soft accent halo under the outline
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = mix(glow, 0.35);
    ctx.lineWidth = 3.2 / k;
    ctx.stroke(sp.outline);
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.strokeStyle = mix(col, 0.92 * alpha);
  ctx.lineWidth = 1.15 / k;
  ctx.stroke(sp.outline);
  ctx.restore();
}

/** FUI corner brackets around a box. */
function brackets(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, col: string, L: number, dashed: boolean) {
  ctx.strokeStyle = col;
  ctx.lineWidth = 1.2;
  if (dashed) ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(x, y + L);
  ctx.lineTo(x, y);
  ctx.lineTo(x + L, y);
  ctx.moveTo(x + w - L, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + L);
  ctx.moveTo(x + w, y + h - L);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + w - L, y + h);
  ctx.moveTo(x + L, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + h - L);
  ctx.stroke();
  ctx.setLineDash([]);
}
