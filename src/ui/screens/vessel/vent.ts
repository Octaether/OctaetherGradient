// The alkaline hydrothermal vent: a chimney of Fe–S minerals, its plume, and a
// magnified micropore. Protons cross from the acidic ocean into the alkaline
// pores, rise with the vent fluid and leave the chimney top with H₂ and organics.
import { hash01 } from '../../hooks';
import { POOL, mix, MONO, SANS } from '../../theme';
import { TAU, WARM } from '../../art';
import type { Act0Snap } from '../../../sim/snapshot';
import { label } from './draw';

/** Particles that persist between frames. */
export interface VentScene {
  bubbles: { x: number; y: number; r: number; v: number; c: string }[];
  /** protons: 0 in the ocean beside the chimney, 1 rising in the pores, 2 hidden inside on the way up, 3 leaving the top */
  ventH: { x: number; y: number; v: number; st: 0 | 1 | 2 | 3; wait: number }[];
  /** the magnified pore, in units of its radius: protons (0 ocean side, 1 pore side) */
  poreH: { x: number; y: number; v: number; st: 0 | 1 }[];
  /** H₂ and organics riding the vent flow through the pore */
  poreRide: { x: number; y: number; v: number; kind: 0 | 1 }[];
}
export const newVentScene = (): VentScene => ({ bubbles: [], ventH: [], poreH: [], poreRide: [] });

/** Draw one frame. `panel` is the stock overlay the chimney keeps clear of; `move` is 0 with reduced motion. */
export function drawVent(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, dt: number, s: Act0Snap, sc: VentScene, panel: HTMLDivElement | null, move: number) {
  ctx.clearRect(0, 0, w, h);
  const lv = (id: string) => s.upgrades.find((u) => u.id === id)?.level ?? 0;
  // keep the chimney and its plume clear of the stock panel
  const vp = panel;
  const panelR = vp ? vp.offsetLeft + vp.offsetWidth : 252;
  const panelB = vp ? vp.offsetTop + vp.offsetHeight : 190;
  const cx = Math.min(w - w * 0.17 - 12, Math.max(w * 0.6, panelR + 64));
  const base = h - 40;
  const top = Math.max(h * 0.3, panelB + 46);
  const N = 36;
  const wid = (k: number) => w * 0.17 * (1 - k * 0.68) + Math.sin(k * 23 + 1) * 4 + hash01(Math.round(k * N)) * 3;
  const yAt = (k: number) => base - (base - top) * k;
  const kAt = (y: number) => Math.max(0, Math.min(1, (base - y) / (base - top)));
  // seafloor strata
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  for (let j = 0; j < 4; j++) {
    ctx.beginPath();
    for (let x = 0; x <= w; x += 12) {
      const y = base + 6 + j * 9 + Math.sin(x * 0.02 + j) * 2;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // plume: a narrow column of tendrils rising from the chimney
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 9; i++) {
    const g = ctx.createLinearGradient(cx, top, cx, 0);
    g.addColorStop(0, mix(WARM[0], 0.25));
    g.addColorStop(0.5, mix(WARM[1], 0.14));
    g.addColorStop(1, mix(WARM[2], 0));
    ctx.strokeStyle = g;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = 0; k <= 30; k++) {
      const u = k / 30;
      const y = top - u * top;
      const x = cx + (i - 4) * 2 * (1 + u * 3) + Math.sin(u * 6 + t * 0.6 * move + i) * 12 * u;
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
  // chimney body
  const L: [number, number][] = [];
  const R: [number, number][] = [];
  for (let i = 0; i <= N; i++) {
    const k = i / N;
    L.push([cx - wid(k), yAt(k)]);
    R.push([cx + wid(k), yAt(k)]);
  }
  ctx.beginPath();
  L.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  for (let i = R.length - 1; i >= 0; i--) ctx.lineTo(R[i][0], R[i][1]);
  ctx.closePath();
  const body = ctx.createLinearGradient(cx - w * 0.2, 0, cx + w * 0.2, 0);
  body.addColorStop(0, 'rgba(14,16,22,0.92)');
  body.addColorStop(0.55, 'rgba(24,26,34,0.92)');
  body.addColorStop(1, 'rgba(10,12,16,0.92)');
  ctx.fillStyle = body;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 1.1;
  ctx.stroke();
  // lathe contours give it volume
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 0.8;
  for (const f of [-0.75, -0.45, -0.15, 0.2, 0.55]) {
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const k = i / N;
      const x = cx + wid(k) * Math.sin((f * Math.PI) / 2);
      if (i === 0) ctx.moveTo(x, yAt(k));
      else ctx.lineTo(x, yAt(k));
    }
    ctx.stroke();
  }
  for (let i = 2; i < N; i += 4) {
    const k = i / N;
    ctx.beginPath();
    ctx.ellipse(cx, yAt(k), wid(k), wid(k) * 0.16, 0, 0, Math.PI);
    ctx.stroke();
  }
  // cut-away window into the micropores, open to the ocean on the left
  const k0 = 0.12;
  const k1 = 0.52;
  const winL = (y: number) => cx - wid(kAt(y)) * 0.82;
  const winR = (y: number) => cx + wid(kAt(y)) * 0.2;
  const ys = yAt(k1);
  const ye = yAt(k0);
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i <= 20; i++) {
    const k = k0 + ((k1 - k0) * i) / 20;
    ctx.lineTo(cx - wid(k) * 0.82 + Math.sin(i * 2.7) * 3, yAt(k));
  }
  for (let i = 20; i >= 0; i--) {
    const k = k0 + ((k1 - k0) * i) / 20;
    ctx.lineTo(cx + wid(k) * 0.2 + Math.sin(i * 1.9) * 4, yAt(k));
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(6,7,12,0.9)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.clip();
  const hs = 9;
  let n = 0;
  for (let y = ys; y < ye + hs; y += hs * 1.5) {
    for (let x = cx - w * 0.2; x < cx + w * 0.1; x += hs * 1.732) {
      const ox = (Math.round((y - ys) / (hs * 1.5)) % 2) * hs * 0.866;
      const px = x + ox;
      ctx.beginPath();
      for (let k = 0; k < 6; k++) ctx.lineTo(px + Math.cos((k / 6) * TAU + Math.PI / 6) * hs, y + Math.sin((k / 6) * TAU + Math.PI / 6) * hs);
      ctx.closePath();
      const pulse = 0.5 + 0.5 * Math.sin(t * 1.4 * move + n * 1.7);
      ctx.fillStyle = mix(POOL.proton, 0.05 + 0.12 * pulse * hash01(n));
      ctx.fill();
      ctx.strokeStyle = mix(POOL.proton, 0.55);
      ctx.lineWidth = 0.7;
      ctx.stroke();
      n++;
    }
  }
  // protons: in from the ocean through the pore walls, then up with the vent fluid
  const VH = sc.ventH;
  while (VH.filter((q) => q.st === 0).length < 26) {
    const y = ys + Math.random() * (ye - ys);
    VH.push({ x: winL(y) - 4 - Math.random() * 22, y, v: 5 + Math.random() * 8, st: 0, wait: 0 });
  }
  for (const q of VH) {
    if (q.st === 0) {
      q.x += q.v * dt * move;
      q.y += Math.sin(t * 1.3 + q.v * 7) * 3 * dt * move;
      if (q.x >= winL(q.y) + 2) {
        q.st = 1;
        q.v = 16 + Math.random() * 14;
      }
    } else if (q.st === 1) {
      q.y -= q.v * dt * move;
      q.x = Math.min(winR(q.y) - 3, q.x + 4 * dt * move);
      if (q.y <= ys + 2) {
        q.st = 2;
        q.wait = (ys - top) / 40;
      }
    } else if (q.st === 2) {
      q.wait -= dt * move;
      if (q.wait <= 0) {
        q.st = 3;
        q.x = cx + (Math.random() - 0.5) * 14;
        q.y = top;
        q.v = 26 + Math.random() * 18;
        q.wait = 1;
      }
    } else {
      q.y -= q.v * dt * move;
      q.x += Math.sin(t * 2 + q.v) * 8 * dt * move;
      q.wait -= dt * 0.32 * move;
    }
  }
  sc.ventH = VH.filter((q) => q.st !== 3 || (q.wait > 0 && q.y > -6));
  ctx.fillStyle = POOL.proton;
  for (const q of sc.ventH) {
    if (q.st !== 1) continue;
    ctx.beginPath();
    ctx.arc(q.x, q.y, 1.5, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
  for (const q of sc.ventH) {
    if (q.st === 0) {
      ctx.globalAlpha = 0.85;
    } else if (q.st === 3) {
      ctx.globalAlpha = Math.max(0, q.wait);
    } else continue;
    ctx.fillStyle = POOL.proton;
    ctx.beginPath();
    ctx.arc(q.x, q.y, 1.5, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // Fe–S minerals glinting: more as the walls are upgraded
  const nFes = 6 + lv('fes') * 5;
  for (let i = 0; i < nFes; i++) {
    const k = 0.05 + hash01(i * 13.3) * 0.85;
    const side = hash01(i * 2.2) < 0.5 ? -1 : 1;
    const x = cx + side * wid(k) * (0.88 + hash01(i) * 0.12);
    const y = yAt(k);
    const sz = 2.6;
    ctx.strokeStyle = mix(WARM[0], 0.5 + 0.5 * Math.max(0, Math.sin(t * 2 * move + i * 1.7)));
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(x, y - sz);
    ctx.lineTo(x + sz * 0.87, y - sz / 2);
    ctx.lineTo(x + sz * 0.87, y + sz / 2);
    ctx.lineTo(x, y + sz);
    ctx.lineTo(x - sz * 0.87, y + sz / 2);
    ctx.lineTo(x - sz * 0.87, y - sz / 2);
    ctx.closePath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + sz);
    ctx.stroke();
  }
  // H2 bubbles and organics leave the top with the protons
  const rate = 5 + 22 * Math.min(1, s.rates.org * 20);
  if (move && Math.random() < rate * dt) sc.bubbles.push({ x: cx + (Math.random() - 0.5) * 18, y: top, r: 1.2 + Math.random() * 2.4, v: 22 + Math.random() * 30, c: Math.random() < 0.65 ? POOL.nad : Math.random() < 0.6 ? POOL.carbon : POOL.lipid });
  sc.bubbles = sc.bubbles.filter((b) => b.y > -10);
  ctx.lineWidth = 0.9;
  for (const b of sc.bubbles) {
    b.y -= b.v * dt * move;
    b.x += Math.sin(t * 2 + b.r * 10) * 8 * dt * move;
    ctx.strokeStyle = mix(b.c, 0.75);
    ctx.beginPath();
    if (b.c === POOL.lipid) {
      ctx.arc(b.x, b.y, 1.4, 0, TAU);
      ctx.moveTo(b.x, b.y + 1.4);
      ctx.lineTo(b.x + Math.sin(t * 4 + b.r) * 1.5, b.y + 6);
    } else ctx.arc(b.x, b.y, b.r, 0, TAU);
    ctx.stroke();
  }
  // label for the chemistry at the top, on the open side below the panel
  label(ctx, cx - wid(0.98), top + 6, cx - wid(0.98) - 24, top + 26, 'H₂ + CO₂ ON Fe–S', 'Simple organics form', WARM[0]);

  // magnified inset, to the left of the window it magnifies
  const insetTop = top + 70;
  const capH = 62;
  const R0 = Math.min(84, (base - 12 - insetTop - capH) / 2);
  const edge = cx - wid(kAt(insetTop + 2 * R0)) - 26;
  const RR = Math.min(R0, (edge - 16) / 2);
  if (RR >= 42) {
    const ix = (16 + edge) / 2;
    const iy = insetTop + RR;
    const tx = winL((ys + ye) / 2) + 14;
    const ty = (ys + ye) / 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(tx, ty, 10, 0, TAU);
    ctx.moveTo(tx - 10, ty);
    ctx.lineTo(ix + RR, iy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.save();
    ctx.beginPath();
    ctx.arc(ix, iy, RR, 0, TAU);
    ctx.fillStyle = 'rgba(7,8,11,0.96)';
    ctx.fill();
    ctx.strokeStyle = mix(POOL.proton, 0.8);
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.clip();
    // acidic ocean (left), alkaline vent fluid in the pore (right)
    ctx.fillStyle = mix(POOL.oxygen, 0.06);
    ctx.fillRect(ix - RR, iy - RR, RR, RR * 2);
    ctx.fillStyle = mix(POOL.nad, 0.06);
    ctx.fillRect(ix, iy - RR, RR, RR * 2);
    // the vent fluid streams upward through the pore
    ctx.strokeStyle = mix(POOL.nad, 0.16);
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 9]);
    ctx.lineDashOffset = t * 26 * move;
    ctx.beginPath();
    for (const f of [0.32, 0.58, 0.82]) {
      ctx.moveTo(ix + f * RR, iy + RR);
      ctx.lineTo(ix + f * RR, iy - RR);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
    // the thin Fe–S wall between them
    const wallX = (yy: number) => ix + Math.sin(yy * 0.08) * 3;
    ctx.strokeStyle = mix(WARM[0], 0.75);
    for (const off of [-4, 4]) {
      ctx.beginPath();
      for (let yy = iy - RR; yy <= iy + RR; yy += 4) {
        if (yy === iy - RR) ctx.moveTo(wallX(yy) + off, yy);
        else ctx.lineTo(wallX(yy) + off, yy);
      }
      ctx.stroke();
    }
    ctx.fillStyle = mix(POOL.atp, 0.7);
    for (let k = 0; k < 7; k++) {
      const yy = iy - RR + ((k + 0.5) / 7) * RR * 2;
      ctx.fillRect(wallX(yy) - 1.5, yy - 1.5, 3, 3);
    }
    // H2 and fresh organics ride the same stream
    const PR = sc.poreRide;
    if (PR.length === 0) for (let k = 0; k < 10; k++) PR.push({ x: 0.15 + Math.random() * 0.78, y: Math.random() * 2 - 1, v: 0.3 + Math.random() * 0.2, kind: Math.random() < 0.6 ? 0 : 1 });
    while (PR.length < 10) PR.push({ x: 0.15 + Math.random() * 0.78, y: 1.05, v: 0.3 + Math.random() * 0.2, kind: Math.random() < 0.6 ? 0 : 1 });
    for (const b of PR) {
      b.y -= b.v * dt * move;
      b.x += Math.sin(t * 1.7 + b.v * 30) * 0.02 * dt * move;
      const bx = ix + b.x * RR;
      const by = iy + b.y * RR;
      ctx.strokeStyle = b.kind === 0 ? mix(POOL.nad, 0.75) : mix(POOL.carbon, 0.7);
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      if (b.kind === 0) ctx.arc(bx, by, 2.6, 0, TAU);
      else {
        for (let k = 0; k < 6; k++) ctx.lineTo(bx + Math.cos((k / 6) * TAU) * 2.4, by + Math.sin((k / 6) * TAU) * 2.4);
        ctx.closePath();
      }
      ctx.stroke();
    }
    sc.poreRide = PR.filter((b) => b.y > -1.05);
    // protons: crowded on the acidic side, through the wall, then swept up and out
    const PH = sc.poreH;
    if (PH.length === 0) {
      for (let k = 0; k < 40; k++) {
        const left = k < 30;
        PH.push({ x: left ? -0.92 + Math.random() * 0.84 : 0.12 + Math.random() * 0.8, y: Math.random() * 1.8 - 0.9, v: 0.32 + Math.random() * 0.2, st: left ? 0 : 1 });
      }
    }
    for (const q of PH) {
      if (q.st === 0) {
        q.x += (0.05 + (Math.random() - 0.4) * 0.5) * dt * move;
        q.y += (Math.random() - 0.5) * 0.5 * dt * move;
        q.x = Math.max(-0.97, q.x);
        q.y = Math.max(-0.92, Math.min(0.92, q.y));
        if (q.x > -0.06) {
          q.st = 1;
          q.x = 0.1;
        }
      } else {
        q.y -= q.v * dt * move;
        q.x = Math.max(0.1, Math.min(0.95, q.x + (Math.random() - 0.45) * 0.12 * dt * move));
        if (q.y < -Math.sqrt(Math.max(0, 1 - q.x * q.x)) - 0.04) {
          // out of view upward: the same number arrive from the open ocean
          q.st = 0;
          q.x = -0.95 + Math.random() * 0.3;
          q.y = Math.random() * 1.6 - 0.8;
        }
      }
      ctx.fillStyle = POOL.proton;
      ctx.beginPath();
      ctx.arc(ix + q.x * RR, iy + q.y * RR, 1.9, 0, TAU);
      ctx.fill();
    }
    ctx.font = `600 9px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.78)';
    ctx.fillText('pH 6', ix - RR * 0.5, iy - RR * 0.6);
    ctx.fillText('pH 10', ix + RR * 0.5, iy - RR * 0.6);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillText('OCEAN', ix - RR * 0.5, iy + RR * 0.74);
    ctx.fillText('PORE', ix + RR * 0.5, iy + RR * 0.74);
    ctx.restore();
    ctx.textAlign = 'left';
    ctx.font = `600 9px ${MONO}`;
    ctx.fillStyle = POOL.proton;
    ctx.fillText('MICROPORE · ×1000', ix - RR, iy + RR + 16);
    ctx.font = `500 10.5px ${SANS}`;
    ctx.fillStyle = 'rgba(233,238,242,0.72)';
    const words = 'H⁺ crosses the thin wall from the acidic ocean, then rises with the vent fluid and leaves the chimney top.'.split(' ');
    const maxW = Math.max(RR * 2, edge - (ix - RR));
    let line = '';
    let ly = iy + RR + 31;
    for (const wd of words) {
      const next = line ? line + ' ' + wd : wd;
      if (ctx.measureText(next).width > maxW && line) {
        ctx.fillText(line, ix - RR, ly);
        ly += 14;
        line = wd;
      } else line = next;
    }
    if (line) ctx.fillText(line, ix - RR, ly);
  }
}
