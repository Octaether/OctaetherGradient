// The shallow pond: wet–dry cycles evaporate the pool so nucleotides crowd
// together and join into RNA, then rain refills it. Vesicles of fatty acid
// drift in the water; a long strand inside one is a candidate replicator.
import { hash01 } from '../../hooks';
import { POOL, mix } from '../../theme';
import { TAU, WARM, glowSprite } from '../../art';
import type { Act0Snap } from '../../../sim/snapshot';
import { helix, label, vesicle } from './draw';

/** State that persists between frames: the eased water level and raindrops. */
export interface PondScene {
  level: number;
  rain: { x: number; y: number }[];
  /** The bowl's top edge, eased toward where the panels allow, so it never jumps. */
  top?: number;
}
export const newPondScene = (): PondScene => ({ level: 0, rain: [] });

/** Draw one frame. `panels` are the overlays the basin keeps below; `move` is 0 with reduced motion. */
export function drawPond(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, dt: number, s: Act0Snap, sc: PondScene, panels: (HTMLDivElement | null)[], move: number) {
  ctx.clearRect(0, 0, w, h);
  const lv = (id: string) => s.upgrades.find((u) => u.id === id)?.level ?? 0;
  const bottomOf = (el: HTMLDivElement | null) => (el ? el.offsetTop + el.offsetHeight : 0);
  const panelsB = Math.max(bottomOf(panels[0]), bottomOf(panels[1]), h * 0.2);
  // short windows: the panels keep their room, so the sky gap and the bowl shrink (and the sun is left out)
  const short = h < 600;
  const topTarget = Math.max(h * 0.36, panelsB + (short ? 24 : 58));
  // ease toward it (a resize or a panel tab change moves the bowl smoothly, never in jumps)
  sc.top = sc.top === undefined || Math.abs(sc.top - topTarget) > h * 0.5 ? topTarget : sc.top + (topTarget - sc.top) * Math.min(1, dt * 2.5);
  const basinTop = sc.top;
  const basinBot = Math.max(basinTop + (short ? 70 : 90), h - (short ? 150 : 192));
  const yb = (x: number) => basinTop + (basinBot - basinTop) * Math.pow(Math.max(0, Math.sin((Math.PI * x) / w)), 0.55);
  // cycle phase: evaporate, dry, rain
  const cycling = s.cycleT > 0;
  const p = cycling ? 1 - s.cycleT / 3 : 0;
  const full = basinTop + (basinBot - basinTop) * 0.12;
  const low = basinTop + (basinBot - basinTop) * 0.72;
  const target = !cycling ? full : p < 0.45 ? full + (low - full) * (p / 0.45) : p < 0.8 ? low : low + (full - low) * ((p - 0.8) / 0.2);
  if (!sc.level) sc.level = full;
  sc.level += (target - sc.level) * Math.min(1, dt * 6);
  const waterTop = sc.level;
  const dry = cycling && p > 0.3 && p < 0.85;
  // sky: stars, then the sun while it dries
  for (let i = 0; i < 46; i++) {
    const tw = 0.5 + 0.5 * Math.sin(t * 0.8 + i * 3);
    ctx.fillStyle = `rgba(232,236,255,${(0.06 + 0.14 * tw) * (dry ? 0.4 : 1)})`;
    ctx.fillRect(hash01(i) * w, panelsB + hash01(i + 99) * Math.max(0, basinTop - panelsB - 10), 1.2, 1.2);
  }
  const sunX = w - 46;
  const sunY = basinTop - 28;
  const sunA = dry ? 1 : cycling ? 0.4 : 0.15;
  if (!short) {
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = sunA;
  ctx.drawImage(glowSprite(POOL.light, 0.3), sunX - 70, sunY - 70, 140, 140);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = mix(POOL.light, 0.4 + 0.5 * sunA);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(sunX, sunY, 14, 0, TAU);
  ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i < 16; i++) {
    const an = (i / 16) * TAU + t * 0.05;
    ctx.moveTo(sunX + Math.cos(an) * 19, sunY + Math.sin(an) * 19);
    ctx.lineTo(sunX + Math.cos(an) * (i % 2 ? 24 : 28), sunY + Math.sin(an) * (i % 2 ? 24 : 28));
  }
  ctx.stroke();
  }
  // rock strata under the basin (clay band highlighted once built)
  for (let j = 0; j < 7; j++) {
    ctx.beginPath();
    for (let x = 0; x <= w; x += 8) {
      const y = yb(x) + 10 + j * 13 + Math.sin(x * 0.015 + j * 1.3) * 3;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    const clay = lv('clay') > 0 && j === 0;
    ctx.strokeStyle = clay ? mix(POOL.lipid, 0.6) : `rgba(255,255,255,${0.12 - j * 0.012})`;
    ctx.lineWidth = clay ? 1.4 : 0.8;
    ctx.stroke();
  }
  // basin wall
  ctx.beginPath();
  for (let x = 0; x <= w; x += 6) {
    const y = yb(x);
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  // water
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, waterTop);
  for (let x = 0; x <= w; x += 6) ctx.lineTo(x, Math.max(waterTop, yb(x)));
  ctx.lineTo(w, waterTop);
  ctx.closePath();
  const wg = ctx.createLinearGradient(0, waterTop, 0, basinBot);
  const ice = s.ice;
  wg.addColorStop(0, `rgba(${90 + 90 * ice},${200 + 30 * ice},${210 + 40 * ice},0.14)`);
  wg.addColorStop(1, 'rgba(40,80,100,0.05)');
  ctx.fillStyle = wg;
  ctx.fill();
  ctx.clip();
  // caustic lines underwater
  ctx.strokeStyle = 'rgba(160,240,240,0.06)';
  ctx.lineWidth = 1;
  for (let j = 0; j < 5; j++) {
    ctx.beginPath();
    for (let x = 0; x <= w; x += 10) {
      const y = waterTop + 14 + j * 18 + Math.sin(x * 0.04 + t * 0.9 * move + j * 2) * 4;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const depth = (x: number) => Math.max(0, yb(x) - waterTop - 6);
  // nucleotides crowd together as the water shrinks
  const nNu = Math.min(120, 12 + s.nu * 500);
  ctx.strokeStyle = mix(POOL.rna, 0.6);
  ctx.lineWidth = 0.7;
  for (let i = 0; i < nNu; i++) {
    const x = ((hash01(i * 1.3) * w + t * 5 * move * (hash01(i) - 0.5)) % w + w) % w;
    const d = depth(x);
    if (d <= 2) continue;
    const y = waterTop + 4 + hash01(i * 2.7) * d;
    const r = 2;
    const rot = i + t * 0.3 * move;
    ctx.beginPath();
    for (let k = 0; k < 5; k++) ctx.lineTo(x + Math.cos(rot + (k / 5) * TAU) * r, y + Math.sin(rot + (k / 5) * TAU) * r);
    ctx.closePath();
    ctx.stroke();
  }
  // RNA strands: double helices whose length follows the average strand
  const nStr = Math.min(22, Math.floor(s.rna * 160));
  const len = Math.min(90, 6 + s.L * 1.8);
  for (let i = 0; i < nStr; i++) {
    const x = ((hash01(i * 4.1) * w + t * 3 * move * (hash01(i * 2) - 0.5)) % w + w) % w;
    const d = depth(x);
    if (d <= 6) continue;
    const y = waterTop + 6 + hash01(i * 6.3) * d * 0.9;
    helix(ctx, x - len / 2, y, len * (0.5 + hash01(i * 8) * 0.8), (hash01(i * 5) - 0.5) * 0.8, t * move + i, 0.85, dry);
  }
  // vesicles, a few holding strands; the best candidate glows when a spark is possible
  const nV = Math.min(18, Math.floor(Math.sqrt(s.ves) * 1.8));
  let cand: { x: number; y: number; r: number } | null = null;
  for (let i = 0; i < nV; i++) {
    const x = ((hash01(i * 9.1) * w + t * 4 * move * (hash01(i * 3) - 0.5)) % w + w) % w;
    const d = depth(x);
    if (d <= 12) continue;
    const y = waterTop + 10 + hash01(i * 3.9) * (d - 12);
    const r = 7 + hash01(i * 2.1) * 8;
    const candidate = s.spark.ready && i === 0;
    vesicle(ctx, x, y, r, 0.9, candidate);
    if (candidate) {
      // the candidate always holds its long strand (45+ nt), folded back on itself to fit
      helix(ctx, x - r * 0.58, y - r * 0.26, r * 1.16, 0.1, t * move, 1, true);
      helix(ctx, x + r * 0.52, y + r * 0.28, r * 1.04, Math.PI - 0.1, t * move + 2, 0.95, true);
    } else if (hash01(i * 7.7) < 0.4 + 0.5 * Math.min(1, s.ves / 400)) helix(ctx, x - r * 0.55, y, r * 1.1, 0.2, t * move + i, 0.7, false);
    if (candidate) cand = { x, y, r };
  }
  // ice crystals
  if (ice > 0.05) {
    ctx.strokeStyle = `rgba(210,235,255,${0.5 * ice})`;
    ctx.lineWidth = 0.8;
    for (let i = 0; i < 24; i++) {
      const x = hash01(i * 8.8) * w;
      const y = waterTop + hash01(i * 3.3) * depth(x);
      const r = 3 + 6 * hash01(i);
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const an = (k * Math.PI) / 3;
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(an) * r, y + Math.sin(an) * r);
        ctx.moveTo(x + Math.cos(an) * r * 0.6, y + Math.sin(an) * r * 0.6);
        ctx.lineTo(x + Math.cos(an + 0.5) * r * 0.85, y + Math.sin(an + 0.5) * r * 0.85);
      }
      ctx.stroke();
    }
  }
  ctx.restore();
  // surface line with ripples, and the bathtub ring of residue left by drying
  ctx.strokeStyle = 'rgba(200,250,250,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  let started = false;
  for (let x = 0; x <= w; x += 5) {
    if (yb(x) <= waterTop) {
      started = false;
      continue;
    }
    const y = waterTop + Math.sin(x * 0.03 + t * 1.6 * move) * 1.4 + Math.sin(x * 0.011 - t * move) * 1.1;
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else ctx.lineTo(x, y);
  }
  ctx.stroke();
  if (waterTop > full + 4) {
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = mix(POOL.rna, 0.55);
    ctx.beginPath();
    let st = false;
    for (let x = 0; x <= w; x += 5) {
      if (yb(x) <= full) {
        st = false;
        continue;
      }
      if (!st) {
        ctx.moveTo(x, full);
        st = true;
      } else ctx.lineTo(x, full);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // rain refills the pool at the end of a cycle
  if (cycling && p > 0.78) {
    while (sc.rain.length < 70) sc.rain.push({ x: Math.random() * w, y: Math.random() * waterTop });
  }
  if (sc.rain.length) {
    ctx.strokeStyle = 'rgba(190,230,255,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const r of sc.rain) {
      r.y += 520 * dt;
      ctx.moveTo(r.x, r.y);
      ctx.lineTo(r.x - 2, r.y + 9);
    }
    ctx.stroke();
    sc.rain = cycling && p > 0.78 ? sc.rain.map((r) => (r.y > waterTop ? { x: Math.random() * w, y: 0 } : r)) : sc.rain.filter((r) => r.y < waterTop);
  }
  // the candidate's label sits above the water, so it is drawn outside the water clip (and below the panels)
  if (cand) {
    const y1 = Math.max(panelsB + 22, Math.min(cand.y - cand.r - 26, waterTop - 22));
    label(ctx, cand.x + cand.r, cand.y - cand.r, cand.x + cand.r + 24, y1, 'CANDIDATE REPLICATOR', 'A long strand inside a vesicle', WARM[1]);
  }
  if (s.sparkT > 0) drawSpark(ctx, w, h, t, 1 - s.sparkT / 5.5, waterTop, basinBot);
}

/**
 * The spark: one vesicle holding a long strand glows, the strand copies
 * itself, and the vesicle divides in two, each daughter with a copy.
 * u runs 0 → 1 over the scene.
 */
function drawSpark(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, u: number, waterTop: number, basinBot: number) {
  const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  const span = (a: number, b: number) => ease((u - a) / (b - a));
  // the rest of the pond dims so the eye goes to one vesicle
  ctx.fillStyle = `rgba(7,8,11,${0.6 * span(0, 0.12)})`;
  ctx.fillRect(0, 0, w, h);
  const cx = w / 2;
  const cy = Math.max(waterTop + 60, (waterTop + basinBot) / 2);
  const R = 28 + 22 * span(0, 0.15);
  const split = span(0.55, 0.9); // 0 one vesicle, 1 two daughters
  const off = split * R * 1.25;
  const r = R * (1 - 0.22 * split);
  const glow = 0.5 + 0.5 * Math.sin(t * 5);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.35 + 0.35 * glow;
  ctx.drawImage(glowSprite(WARM[1], 0.5), cx - R * 3, cy - R * 3, R * 6, R * 6);
  ctx.restore();
  if (split < 0.98) {
    // one membrane pinching at the waist
    ctx.save();
    ctx.translate(cx, cy);
    ctx.beginPath();
    const pinch = 1 - 0.85 * split;
    for (let i = 0; i <= 72; i++) {
      const th = (i / 72) * TAU;
      const sx = Math.cos(th) * (R + off * 0.8);
      const sy = Math.sin(th) * R * (0.45 + 0.55 * (Math.abs(Math.cos(th)) * (1 - pinch) + pinch));
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.closePath();
    ctx.strokeStyle = mix(POOL.lipid, 0.9);
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.restore();
  } else {
    vesicle(ctx, cx - off, cy, r, 1, false);
    vesicle(ctx, cx + off, cy, r, 1, false);
  }
  // the template strand, and its copy growing alongside, letter by letter
  const L = r * 1.3;
  const copy = span(0.15, 0.55);
  helix(ctx, cx - off - L / 2, cy - 5, L, 0.08, t, 1, true);
  if (copy > 0) helix(ctx, cx + off - L / 2, cy + 6, L * Math.max(0.05, copy), -0.08, t + 2, 1, true);
  // caption
  const a = span(0.2, 0.35) * (1 - span(0.93, 1));
  ctx.textAlign = 'center';
  ctx.fillStyle = `rgba(255,255,255,${0.95 * a})`;
  ctx.font = '600 15px "Chakra Petch", sans-serif';
  ctx.fillText(u < 0.55 ? 'A STRAND COPIES ITSELF' : 'HEREDITY BEGINS', cx, cy - R - 34);
  ctx.font = '500 12px "Inter Variable", Inter, sans-serif';
  ctx.fillStyle = `rgba(233,238,242,${0.75 * a})`;
  ctx.fillText(u < 0.55 ? 'A 45-letter ribozyme, inside a vesicle, builds a copy of itself' : 'The vesicle divides: two protocells, each with a copy', cx, cy + R + 44);
  ctx.textAlign = 'left';
}
