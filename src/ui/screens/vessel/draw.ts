// Canvas helpers shared by the vent and pond scenes: leader-line labels,
// RNA double helices and fatty-acid vesicles drawn as line art.
import { POOL, mix, MONO, SANS } from '../../theme';
import { TAU, WARM, glowSprite } from '../../art';

export function label(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, text: string, sub: string, col: string) {
  const W = ctx.canvas.clientWidth;
  if (x1 >= x0 && x1 + 130 > W) x1 = W - 130;
  const right = x1 >= x0;
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.lineTo(x1 + (right ? 110 : -110), y1);
  ctx.stroke();
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.arc(x0, y0, 2.2, 0, TAU);
  ctx.fill();
  ctx.textAlign = right ? 'left' : 'right';
  ctx.font = `600 9px ${MONO}`;
  ctx.fillText(text, x1 + (right ? 4 : -4), y1 - 6);
  ctx.font = `500 10.5px ${SANS}`;
  ctx.fillStyle = 'rgba(233,238,242,0.7)';
  ctx.fillText(sub, x1 + (right ? 4 : -4), y1 + 13);
  ctx.textAlign = 'left';
}

export function helix(ctx: CanvasRenderingContext2D, x: number, y: number, len: number, a: number, t: number, alpha: number, bright: boolean) {
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const n = Math.max(3, Math.round(len / 3));
  const amp = 2.2;
  const pa: [number, number][] = [];
  const pb: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const u = (i / n) * len;
    const wv = Math.sin(i * 0.4 + t * 0.8) * 2;
    const s = Math.sin(i * 0.9 + t * 1.5) * amp;
    pa.push([x + u * ca - (wv + s) * sa, y + u * sa + (wv + s) * ca]);
    pb.push([x + u * ca - (wv - s) * sa, y + u * sa + (wv - s) * ca]);
  }
  ctx.strokeStyle = `rgba(255,255,255,${0.25 * alpha})`;
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  for (let i = 0; i <= n; i += 2) {
    ctx.moveTo(pa[i][0], pa[i][1]);
    ctx.lineTo(pb[i][0], pb[i][1]);
  }
  ctx.stroke();
  const g = ctx.createLinearGradient(x, y, x + len * ca, y + len * sa);
  g.addColorStop(0, mix(POOL.rna, alpha));
  g.addColorStop(1, mix(bright ? WARM[1] : POOL.rna, alpha));
  ctx.strokeStyle = g;
  ctx.lineWidth = bright ? 1.3 : 0.9;
  ctx.beginPath();
  pa.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.stroke();
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  pb.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.stroke();
  ctx.globalAlpha = 1;
}

export function vesicle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, alpha: number, glow = false) {
  if (glow) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(glowSprite(WARM[1], 0.4), x - r * 3, y - r * 3, r * 6, r * 6);
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.strokeStyle = mix(POOL.lipid, 0.85 * alpha);
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = mix(POOL.lipid, 0.35 * alpha);
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.arc(x, y, r - 2.4, 0, TAU);
  ctx.stroke();
  // lipid tails between the leaflets
  ctx.beginPath();
  const n = Math.round(r * 1.4);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    ctx.moveTo(x + Math.cos(a) * (r - 0.6), y + Math.sin(a) * (r - 0.6));
    ctx.lineTo(x + Math.cos(a) * (r - 1.8), y + Math.sin(a) * (r - 1.8));
  }
  ctx.strokeStyle = mix(POOL.lipid, 0.3 * alpha);
  ctx.lineWidth = 0.5;
  ctx.stroke();
}
