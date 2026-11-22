// Finale: the planet. Producers, consumers, microbes and viruses cycle carbon,
// nitrogen and oxygen on light alone. Keep the closed loop stable.
//
// The globe is drawn per pixel from a surface baked once (3D noise on the
// sphere, so there is no seam), recoloured live: vegetation follows the
// producers, ice follows CO₂. Each frame only looks the baked surface up
// through a precomputed projection, so it stays cheap. Around it: a
// segmented stability ring, the sun's direction, and four instrument pods
// (one per guild) with their safe bands, joined by labelled flows.
import { useMemo, useRef } from 'react';
import { useGame } from '../store';
import { useCanvas, hash01 } from '../hooks';
import { POOL, mix, MONO, SANS } from '../theme';
import { cellSprite, drawPhage, type CellLook, type Sprite } from '../art';
import type { FinaleSnap } from '../../sim/snapshot';

const TW = 512;
const TH = 256;

// ---------- surface: 3D value noise on the sphere ----------
function hash3(x: number, y: number, z: number) {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}
function vnoise(x: number, y: number, z: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz);
  return l(l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v), l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v), w);
}
function fbm(x: number, y: number, z: number, oct: number) {
  let a = 0.5;
  let f = 1;
  let s = 0;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise(x * f, y * f, z * f);
    f *= 2.03;
    a *= 0.5;
  }
  return s;
}

/** Per-texel height, latitude and cloud cover, computed once. */
function bakeSurface() {
  const height = new Float32Array(TW * TH);
  const cloud = new Float32Array(TW * TH);
  for (let j = 0; j < TH; j++) {
    const lat = (0.5 - (j + 0.5) / TH) * Math.PI;
    for (let i = 0; i < TW; i++) {
      const lon = ((i + 0.5) / TW) * Math.PI * 2;
      const x = Math.cos(lat) * Math.cos(lon);
      const y = Math.sin(lat);
      const z = Math.cos(lat) * Math.sin(lon);
      // domain warp for coastlines that look like coastlines
      const wx = fbm(x * 1.6 + 5.2, y * 1.6, z * 1.6, 3) - 0.5;
      const wy = fbm(x * 1.6, y * 1.6 + 9.1, z * 1.6, 3) - 0.5;
      height[j * TW + i] = fbm(x * 1.8 + wx * 1.4, y * 1.8 + wy * 1.4, z * 1.8, 6);
      cloud[j * TW + i] = fbm(x * 3 + 11, y * 5.5, z * 3 - 4, 5);
    }
  }
  return { height, cloud };
}

/** Colour the surface for the current state (cheap; redone when life or climate shift). */
function colorSurface(surf: ReturnType<typeof bakeSurface>, out: Uint8ClampedArray, green: number, ice: number) {
  const SEA = 0.5;
  for (let j = 0; j < TH; j++) {
    const lat = Math.abs((0.5 - (j + 0.5) / TH) * Math.PI);
    for (let i = 0; i < TW; i++) {
      const k = j * TW + i;
      const h = surf.height[k];
      let r: number;
      let g: number;
      let b: number;
      let water = 0;
      const iceLine = ice + 0.06 * Math.sin(i * 0.05);
      if (lat > iceLine || (h > 0.69 && lat > 0.4)) {
        r = 214;
        g = 226;
        b = 234;
      } else if (h < SEA) {
        // deep ocean to bright shallows along the coast
        const d = Math.min(1, (SEA - h) * 6);
        const sh = Math.pow(1 - d, 3);
        r = 8 + 14 * (1 - d) + 40 * sh;
        g = 30 + 52 * (1 - d) + 90 * sh;
        b = 54 + 48 * (1 - d) + 70 * sh;
        water = 1;
      } else {
        const e = Math.min(1, (h - SEA) * 5);
        const dry = Math.max(0, Math.min(1, 1 - green * 1.2 + (lat < 0.35 ? 0.25 : 0)));
        // lowlands green with life, ochre without; highlands rock
        r = (46 + 96 * dry) * (1 - e) + 118 * e;
        g = (110 + 14 * dry) * (1 - e) + 108 * e;
        b = (64 + 6 * dry) * (1 - e) + 96 * e;
      }
      const o = k * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = water ? 255 : 254; // alpha marks water for the ocean glint
    }
  }
}

/** Orthographic projection of a disc of S×S pixels: latitude row and base longitude per pixel. */
function projection(S: number) {
  const n = S * S;
  const row = new Int16Array(n).fill(-1);
  const fy = new Float32Array(n);
  const lon = new Float32Array(n);
  const nx = new Float32Array(n);
  const ny = new Float32Array(n);
  const nz = new Float32Array(n);
  for (let py = 0; py < S; py++) {
    const y = (py + 0.5) / S * 2 - 1;
    for (let px = 0; px < S; px++) {
      const x = (px + 0.5) / S * 2 - 1;
      const r2 = x * x + y * y;
      if (r2 > 1) continue;
      const z = Math.sqrt(1 - r2);
      const k = py * S + px;
      const lat = Math.asin(-y);
      const v = Math.min(TH - 1.001, Math.max(0, (0.5 - lat / Math.PI) * TH - 0.5));
      row[k] = Math.floor(v);
      fy[k] = v - row[k];
      lon[k] = Math.atan2(x, z);
      nx[k] = x;
      ny[k] = -y;
      nz[k] = z;
    }
  }
  return { S, row, fy, lon, nx, ny, nz };
}

const GUILDS = [
  { key: 'Pr', name: 'Producers', color: POOL.nitrogen, pos: [-1, 1] as const, members: ['photo', 'alga', 'body:seaweed'] },
  { key: 'Co', name: 'Consumers', color: POOL.atp, pos: [-1, -1] as const, members: ['hunter', 'euk', 'body:animal'] },
  { key: 'Mi', name: 'Microbes', color: POOL.nad, pos: [1, -1] as const, members: ['ferm', 'archaea', 'lact', 'debris', 'resp'] },
  { key: 'Vi', name: 'Viruses', color: POOL.oxygen, pos: [1, 1] as const, members: [] as string[] },
];
const FLOWS: [string, string, string][] = [
  ['Pr', 'Co', 'grazing'],
  ['Co', 'Mi', 'detritus'],
  ['Pr', 'Mi', 'dead matter'],
  ['Mi', 'Pr', 'nutrients'],
  ['Vi', 'Mi', 'lysis'],
];
const ICON: Record<string, CellLook> = {
  Pr: { morph: 'euk', color: POOL.nitrogen, aspect: 1, features: ['nucleus', 'chloro'], variant: 61 },
  Co: { morph: 'euk', color: POOL.atp, aspect: 1, features: ['nucleus', 'mito', 'golgi'], variant: 62 },
  Mi: { morph: 'rod', color: POOL.nad, aspect: 1.8, features: ['flag'], variant: 63 },
};

export function Planet() {
  const ok = useGame((s) => !!s.snap?.finale);
  return ok ? <PlanetInner /> : null;
}

function PlanetInner() {
  const snap = useGame((s) => s.snap)!;
  const f = snap.finale!;
  const ref = useRef<FinaleSnap>(f);
  ref.current = f;
  const branch = useGame((s) => s.snap!.branch);
  const reduced = useGame((s) => s.settings.reducedMotion);
  const surf = useMemo(bakeSurface, []);
  const tex = useRef<{ data: Uint8ClampedArray; green: number; ice: number } | null>(null);
  const proj = useRef<ReturnType<typeof projection> | null>(null);
  const off = useRef<{ c: HTMLCanvasElement; img: ImageData } | null>(null);
  const parts = useRef<{ i: number; t: number }[]>([]);
  const frame = useRef(0);
  // which of your species fill each guild
  const members = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const g of GUILDS) {
      out[g.key] = g.members
        .map((m) => {
          const [id, look] = m.split(':');
          const r = f.roster?.find((x) => x.id === id);
          if (!r || !r.alive) return '';
          if (look === 'seaweed' && branch !== 'alga') return '';
          if (look === 'animal' && branch === 'alga') return '';
          return r.name;
        })
        .filter(Boolean);
    }
    return out;
  }, [f.roster, branch]);
  const memRef = useRef(members);
  memRef.current = members;

  const canvas = useCanvas(
    (ctx, w, h, t, dt) => {
      const s = ref.current;
      const move = reduced ? 0 : 1;
      ctx.clearRect(0, 0, w, h);
      // ---- sky: stars and a few slow bokeh orbs ----
      for (let i = 0; i < 110; i++) {
        const tw = 0.5 + 0.5 * Math.sin(t * 0.7 * move + i * 1.7);
        ctx.fillStyle = `rgba(232,236,245,${0.05 + 0.12 * tw * hash01(i * 3.1)})`;
        ctx.fillRect(hash01(i * 12.9) * w, hash01(i * 78.2) * h, 1, 1);
      }
      for (let i = 0; i < 4; i++) {
        const bx = (hash01(i * 5.5) * w + t * 3 * move * (i % 2 ? 1 : -1)) % (w + 200) - 100;
        const by = hash01(i * 8.1) * h;
        const br = 60 + 90 * hash01(i * 2.2);
        const g = ctx.createRadialGradient(bx, by, 0, bx, by, br);
        g.addColorStop(0, mix(i % 2 ? POOL.nad : POOL.proton, 0.05));
        g.addColorStop(1, 'transparent');
        ctx.fillStyle = g;
        ctx.fillRect(bx - br, by - br, br * 2, br * 2);
      }
      // on a narrow screen two guilds sit above the globe and two below it, labels under each
      const narrow = w < 600;
      const nTop = 172;
      const nBot = h - 76 - 116;
      const R = narrow ? Math.max(60, Math.min(w * 0.28, (nBot - nTop) / 2 / 1.2)) : Math.max(80, Math.min(w * 0.17, h * 0.27));
      const cx = w / 2;
      const cy = narrow ? (nTop + nBot) / 2 : h * 0.47;
      const vals = s.vals as Record<string, number>;
      // ---- the globe ----
      const green = Math.round(Math.min(1, vals.Pr / 2.5) * 20) / 20;
      const co2 = vals.CO2 ?? 1;
      // more CO₂ is warmer: the ice retreats; less, it advances
      const ice = Math.round((1.18 + 0.16 * Math.max(-1, Math.min(1, (co2 - 1) / 1.2))) * 40) / 40;
      if (!tex.current || tex.current.green !== green || tex.current.ice !== ice) {
        const data = tex.current?.data ?? new Uint8ClampedArray(TW * TH * 4);
        colorSurface(surf, data, green, ice);
        tex.current = { data, green, ice };
      }
      const S = Math.min(640, Math.round(R * 2 * Math.min(1.5, devicePixelRatio || 1)));
      if (!proj.current || proj.current.S !== S) {
        proj.current = projection(S);
        const c = document.createElement('canvas');
        c.width = S;
        c.height = S;
        off.current = { c, img: c.getContext('2d')!.createImageData(S, S) };
      }
      const P = proj.current;
      const o = off.current!;
      // light: the day circles the planet; the sun sits to the upper left
      const la = t * 0.05 * move + 0.6;
      let lx = Math.cos(la) * 0.75;
      let ly = 0.3;
      let lz = 0.6 + 0.25 * Math.sin(la);
      const ll = Math.hypot(lx, ly, lz);
      lx /= ll;
      ly /= ll;
      lz /= ll;
      // half vector for the ocean glint (viewer along +z)
      let hx = lx;
      let hy = ly;
      let hz = lz + 1;
      const hl = Math.hypot(hx, hy, hz);
      hx /= hl;
      hy /= hl;
      hz /= hl;
      frame.current++;
      if (frame.current % 2 === 1 || !move) {
        const rot = reduced ? 0.6 : t * 0.03;
        const crot = rot * 1.35 + 0.8;
        const d = o.img.data;
        const T = tex.current.data;
        const light = s.light;
        const n = S * S;
        for (let k = 0; k < n; k++) {
          const row = P.row[k];
          const q = k * 4;
          if (row < 0) {
            d[q + 3] = 0;
            continue;
          }
          // bilinear lookups keep coastlines smooth at any size
          let u = (P.lon[k] + rot) / (Math.PI * 2);
          u -= Math.floor(u);
          const fxu = u * TW - 0.5;
          const c0 = (Math.floor(fxu) + TW) % TW;
          const c1 = (c0 + 1) % TW;
          const ax = fxu - Math.floor(fxu);
          const ay = P.fy[k];
          const r1 = row + 1;
          const i00 = (row * TW + c0) * 4;
          const i01 = (row * TW + c1) * 4;
          const i10 = (r1 * TW + c0) * 4;
          const i11 = (r1 * TW + c1) * 4;
          const w00 = (1 - ax) * (1 - ay);
          const w01 = ax * (1 - ay);
          const w10 = (1 - ax) * ay;
          const w11 = ax * ay;
          let cu = (P.lon[k] + crot) / (Math.PI * 2);
          cu -= Math.floor(cu);
          const cxu = cu * TW - 0.5;
          const d0 = (Math.floor(cxu) + TW) % TW;
          const d1 = (d0 + 1) % TW;
          const bx = cxu - Math.floor(cxu);
          const cl = (surf.cloud[row * TW + d0] * (1 - bx) + surf.cloud[row * TW + d1] * bx) * (1 - ay) + (surf.cloud[r1 * TW + d0] * (1 - bx) + surf.cloud[r1 * TW + d1] * bx) * ay;
          const cloud = Math.max(0, Math.min(1, (cl - 0.56) * 4.5));
          const nd = P.nx[k] * lx + P.ny[k] * ly + P.nz[k] * lz;
          // soft terminator; a little ambient so the night side still has shape
          const tt = Math.max(0, Math.min(1, (nd + 0.12) / 0.4));
          const L = 0.07 + 0.93 * tt * tt * (3 - 2 * tt) * (0.55 + 0.45 * light);
          let r = (T[i00] * w00 + T[i01] * w01 + T[i10] * w10 + T[i11] * w11) * L;
          let g = (T[i00 + 1] * w00 + T[i01 + 1] * w01 + T[i10 + 1] * w10 + T[i11 + 1] * w11) * L;
          let b = (T[i00 + 2] * w00 + T[i01 + 2] * w01 + T[i10 + 2] * w10 + T[i11 + 2] * w11) * L;
          const wet = (T[i00 + 3] & 1) * w00 + (T[i01 + 3] & 1) * w01 + (T[i10 + 3] & 1) * w10 + (T[i11 + 3] & 1) * w11;
          if (wet > 0 && nd > 0) {
            const sp = Math.max(0, P.nx[k] * hx + P.ny[k] * hy + P.nz[k] * hz);
            const gl = Math.pow(sp, 260) * 90 * wet * (1 - cloud);
            r += gl;
            g += gl;
            b += gl * 0.95;
          }
          const cw = cloud * (0.15 + 0.85 * L);
          r = r * (1 - cloud * 0.85) + 225 * cw;
          g = g * (1 - cloud * 0.85) + 232 * cw;
          b = b * (1 - cloud * 0.85) + 240 * cw;
          // limb darkening
          const limb = 0.55 + 0.45 * Math.pow(P.nz[k], 0.5);
          d[q] = r * limb;
          d[q + 1] = g * limb;
          d[q + 2] = b * limb;
          d[q + 3] = 255;
        }
        o.c.getContext('2d')!.putImageData(o.img, 0, 0);
      }
      // atmosphere: a soft outer glow and a crisp rim; amber when CO₂ runs high
      const haze = Math.min(1, Math.max(0, (co2 - 1.2) / 1.2));
      const atm = haze > 0 ? [110 + 130 * haze, 180 - 60 * haze, 235 - 160 * haze] : [110, 190, 240];
      const ag = ctx.createRadialGradient(cx, cy, R * 0.96, cx, cy, R * 1.22);
      ag.addColorStop(0, `rgba(${atm[0]},${atm[1]},${atm[2]},0.32)`);
      ag.addColorStop(1, `rgba(${atm[0]},${atm[1]},${atm[2]},0)`);
      ctx.fillStyle = ag;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(o.c, cx - R, cy - R, R * 2, R * 2);
      ctx.strokeStyle = `rgba(${atm[0]},${atm[1]},${atm[2]},0.75)`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(cx, cy, R + 0.5, 0, Math.PI * 2);
      ctx.stroke();
      // graticule: hairline latitude and longitude, turning with the planet
      const rot = reduced ? 0.6 : t * 0.03;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.clip();
      ctx.strokeStyle = 'rgba(230,240,255,0.07)';
      ctx.lineWidth = 1;
      for (let latD = -60; latD <= 60; latD += 30) {
        const lat = (latD * Math.PI) / 180;
        // seen from the equator, parallels are straight lines
        ctx.beginPath();
        ctx.moveTo(cx - Math.cos(lat) * R, cy - Math.sin(lat) * R);
        ctx.lineTo(cx + Math.cos(lat) * R, cy - Math.sin(lat) * R);
        ctx.stroke();
      }
      for (let m = 0; m < 12; m++) {
        const lon = (m / 12) * Math.PI * 2 + rot;
        const sx = Math.sin(lon);
        if (Math.cos(lon) < 0) continue; // only the near side
        ctx.beginPath();
        ctx.ellipse(cx, cy, Math.abs(sx) * R, R, 0, -Math.PI / 2, Math.PI / 2, sx < 0);
        ctx.stroke();
      }
      ctx.restore();

      // ---- stability ring: one segment per 1/72 of the goal ----
      const ringR = R * 1.2;
      const segs = 72;
      const pct = Math.min(1, s.stable / s.win);
      for (let i = 0; i < segs; i++) {
        const a0 = -Math.PI / 2 + (i / segs) * Math.PI * 2 + 0.012;
        const a1 = a0 + (Math.PI * 2) / segs - 0.024;
        const on = i < Math.round(pct * segs);
        ctx.strokeStyle = on ? (s.won ? POOL.light : mix('#9ff6ff', 0.85)) : 'rgba(230,240,255,0.09)';
        ctx.lineWidth = on ? 2.4 : 1.6;
        ctx.beginPath();
        ctx.arc(cx, cy, ringR, a0, a1);
        ctx.stroke();
      }
      ctx.font = `600 9px ${MONO}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = s.won ? mix(POOL.light, 0.9) : 'rgba(230,240,255,0.6)';
      ctx.fillText(s.won ? 'LOOP CLOSED' : `STABLE ${Math.floor(s.stable)} / ${s.win} S`, cx, cy - ringR - 9);
      // the sun's direction on an outer ring
      const sunA = Math.atan2(-ly, lx);
      const sR = R * 1.32;
      const sxp = cx + Math.cos(sunA) * sR;
      const syp = cy + Math.sin(sunA) * sR;
      ctx.strokeStyle = mix(POOL.light, 0.8);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(sxp, syp, 4.5, 0, Math.PI * 2);
      ctx.stroke();
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(sxp + Math.cos(a) * 7, syp + Math.sin(a) * 7);
        ctx.lineTo(sxp + Math.cos(a) * 9.5, syp + Math.sin(a) * 9.5);
        ctx.stroke();
      }

      // ---- guild pods and the flows between them ----
      // pods sit out on the diagonals, close enough to the edge that their text still fits
      const px = Math.max(R * 1.45, Math.min(R * 2.05, cx - 215));
      const pyy = R * 0.9;
      const pos: Record<string, { x: number; y: number }> = {};
      for (const g of GUILDS)
        pos[g.key] = narrow ? { x: cx + g.pos[0] * w * 0.26, y: g.pos[1] < 0 ? 62 : cy + ringR + 50 } : { x: cx + g.pos[0] * px, y: cy + g.pos[1] * pyy };
      const ctrl = (pa: { x: number; y: number }, pb: { x: number; y: number }): [number, number] => {
        let dx = (pa.x + pb.x) / 2 - cx;
        let dy = (pa.y + pb.y) / 2 - cy;
        if (Math.hypot(dx, dy) < R * 0.6) {
          dx = -(pb.y - pa.y);
          dy = pb.x - pa.x;
        }
        const k = Math.hypot(dx, dy) || 1;
        return [cx + (dx / k) * R * 1.55, cy + (dy / k) * R * 1.45];
      };
      // flows pass behind the planet: everything inside the atmosphere is masked out
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      ctx.arc(cx, cy, R * 1.06, 0, Math.PI * 2, true);
      ctx.clip();
      const placed: [number, number][] = [];
      FLOWS.forEach(([a, b, label], i) => {
        const pa = pos[a];
        const pb = pos[b];
        const [mx, my] = ctrl(pa, pb);
        ctx.strokeStyle = 'rgba(230,240,255,0.1)';
        ctx.setLineDash([2, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.quadraticCurveTo(mx, my, pb.x, pb.y);
        ctx.stroke();
        ctx.setLineDash([]);
        // label where the curve is clear of the planet and of the ring's title
        const at = (q: number) => [(1 - q) * (1 - q) * pa.x + 2 * (1 - q) * q * mx + q * q * pb.x, (1 - q) * (1 - q) * pa.y + 2 * (1 - q) * q * my + q * q * pb.y];
        // no clear spot (crowded narrow layouts): the label is left out rather than drawn over text
        let lpt: number[] | null = narrow ? null : at(0.5);
        for (const q of [0.5, 0.36, 0.64, 0.25, 0.75, 0.18, 0.82]) {
          const [qx, qy] = at(q);
          const clearGlobe = Math.hypot(qx - cx, qy - cy) > R * 1.3;
          const clearTitle = !(Math.abs(qx - cx) < 90 && Math.abs(qy - (cy - R * 1.2 - 12)) < 22);
          const clearLabels = placed.every(([px2, py2]) => Math.abs(qx - px2) > 70 || Math.abs(qy - py2) > 13);
          // narrow: pods carry their text underneath, so keep clear of that block too
          const clearPods = !narrow || Object.values(pos).every((pp) => Math.abs(qx - pp.x) > 85 || qy < pp.y - 40 || qy > pp.y + 112);
          if (clearGlobe && clearTitle && clearLabels && clearPods) {
            lpt = [qx, qy];
            break;
          }
        }
        ctx.font = `600 8px ${MONO}`;
        ctx.fillStyle = 'rgba(230,240,255,0.34)';
        ctx.textAlign = 'center';
        if (lpt) {
          placed.push([lpt[0], lpt[1]]);
          ctx.fillText(label.toUpperCase(), lpt[0], lpt[1] - 5);
        }
        const strength = Math.min(1, Math.sqrt((vals[a] ?? 0) * (vals[b] ?? 0)) / 1.2);
        if (move && Math.random() < strength * dt * 6) parts.current.push({ i, t: 0 });
      });
      parts.current = parts.current.filter((p) => p.t < 1);
      for (const p of parts.current) {
        p.t += dt * 0.32;
        const [a, b] = FLOWS[p.i];
        const pa = pos[a];
        const pb = pos[b];
        const [mx, my] = ctrl(pa, pb);
        const u = 1 - p.t;
        const x = u * u * pa.x + 2 * u * p.t * mx + p.t * p.t * pb.x;
        const y = u * u * pa.y + 2 * u * p.t * my + p.t * p.t * pb.y;
        ctx.fillStyle = mix(GUILDS.find((g) => g.key === a)!.color, 0.85 * Math.min(1, p.t * 5, (1 - p.t) * 5));
        ctx.beginPath();
        ctx.arc(x, y, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      for (const g of GUILDS) pod(ctx, g, pos[g.key], cx, cy, R, s, memRef.current[g.key] ?? [], t, move, narrow);

      // ---- a perturbation in progress ----
      if (s.perturb) {
        ctx.font = `600 10px ${MONO}`;
        const txt = '⚠ ' + s.perturb.toUpperCase();
        const tw = ctx.measureText(txt).width + 24;
        const bx = cx - tw / 2;
        const by = narrow ? cy + R + 2 : Math.min(cy + ringR + 22, h - 112);
        ctx.fillStyle = 'rgba(255,77,109,0.12)';
        ctx.strokeStyle = mix(POOL.oxygen, 0.75);
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + tw - 8, by);
        ctx.lineTo(bx + tw, by + 8);
        ctx.lineTo(bx + tw, by + 24);
        ctx.lineTo(bx, by + 24);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = mix(POOL.oxygen, 0.95);
        ctx.textAlign = 'center';
        ctx.fillText(txt, cx, by + 16);
      }
      ctx.textAlign = 'left';
    },
    [reduced, surf],
  );
  const meters: [string, string, string][] = [
    ['CO2', 'CO₂', POOL.carbon],
    ['O2', 'O₂', POOL.oxygen],
    ['N', 'Fixed nitrogen', POOL.nitrogen],
  ];
  return (
    <div className="planet">
      <canvas ref={canvas} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      <div className="overlay-chip planet-meters" style={{ left: '50%', bottom: 16, transform: 'translateX(-50%)', display: 'flex', gap: 22, padding: '12px 18px' }}>
        {meters.map(([k, name, color]) => {
          const [lo, hi] = f.bands[k];
          const v = f.vals[k];
          const max = hi * 1.6;
          const ok = f.inBand[k];
          return (
            <div key={k} className="pm" style={{ width: 170 }}>
              <div style={{ display: 'flex', fontSize: 11 }}>
                <span className="muted">{name}</span>
                <span className="num" style={{ marginLeft: 'auto', color: ok ? 'var(--text-2)' : 'var(--oxygen)' }}>{v.toFixed(2)}</span>
              </div>
              <div className="bar" style={{ marginTop: 5 }}>
                <span style={{ position: 'absolute', left: (lo / max) * 100 + '%', width: ((hi - lo) / max) * 100 + '%', top: 0, bottom: 0, background: 'rgba(143,214,164,0.12)' }} />
                <i style={{ width: Math.min(100, (v / max) * 100) + '%', background: ok ? color : 'var(--oxygen)', opacity: 0.85 }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="overlay-chip planet-goal" style={{ left: 16, top: 16, maxWidth: 320 }}>
        <div className="caps" style={{ color: f.won ? 'var(--light)' : undefined }}>{f.challenge ? 'Challenge seed' : f.won ? 'The loop is closed' : 'Close the loop'}</div>
        <div className="muted" style={{ fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>
          {f.challenge
            ? f.challenges.find((c) => c.id === f.challenge)?.text
            : f.won
              ? 'You won. The postgame is staying stable under assault: pick a challenge seed in the panel.'
              : `Hold every guild and gas inside its band for ${f.win} seconds straight. Light is the only input.`}
        </div>
      </div>
    </div>
  );
}

/**
 * One guild as an instrument: a segmented gauge (its safe band marked), its
 * cell in line art, the value, and which of your species fill it.
 */
function pod(ctx: CanvasRenderingContext2D, g: (typeof GUILDS)[number], p: { x: number; y: number }, cx: number, cy: number, R: number, s: FinaleSnap, members: string[], t: number, move: number, narrow = false) {
  const v = (s.vals as Record<string, number>)[g.key] ?? 0;
  const [lo, hi] = s.bands[g.key] ?? [0, 1];
  const ok = s.inBand[g.key];
  const max = hi * 1.4;
  const pr = narrow ? 22 : 30;
  const col = ok ? g.color : '#ff6b5e';
  // leader to the planet's rim
  const ang = Math.atan2(p.y - cy, p.x - cx);
  ctx.strokeStyle = 'rgba(230,240,255,0.14)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(ang) * R * 1.24, cy + Math.sin(ang) * R * 1.24);
  ctx.lineTo(p.x - Math.cos(ang) * (pr + 12), p.y - Math.sin(ang) * (pr + 12));
  ctx.stroke();
  // glow
  const gl = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, pr * 2.4);
  gl.addColorStop(0, mix(g.color, 0.12 + 0.06 * Math.sin(t * 1.3 * move)));
  gl.addColorStop(1, 'transparent');
  ctx.fillStyle = gl;
  ctx.fillRect(p.x - pr * 2.4, p.y - pr * 2.4, pr * 4.8, pr * 4.8);
  // gauge: 270° of segments; the safe band is drawn brighter
  const segs = 30;
  const a0 = Math.PI * 0.75;
  const span = Math.PI * 1.5;
  for (let i = 0; i < segs; i++) {
    const f0 = i / segs;
    const f1 = (i + 1) / segs;
    const mid = ((f0 + f1) / 2) * max;
    const inBand = mid >= lo && mid <= hi;
    const filled = mid <= v;
    ctx.strokeStyle = filled ? mix(col, 0.95) : inBand ? mix(g.color, 0.22) : 'rgba(230,240,255,0.08)';
    ctx.lineWidth = filled ? 3 : 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, pr + 8, a0 + f0 * span + 0.02, a0 + f1 * span - 0.02);
    ctx.stroke();
  }
  // band edges as ticks
  for (const bv of [lo, hi]) {
    const a = a0 + Math.min(1, bv / max) * span;
    ctx.strokeStyle = mix(g.color, 0.7);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.x + Math.cos(a) * (pr + 3), p.y + Math.sin(a) * (pr + 3));
    ctx.lineTo(p.x + Math.cos(a) * (pr + 14), p.y + Math.sin(a) * (pr + 14));
    ctx.stroke();
  }
  // the cell inside
  ctx.strokeStyle = mix(g.color, 0.35);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(p.x, p.y, pr, 0, Math.PI * 2);
  ctx.stroke();
  const ik = narrow ? 0.75 : 1;
  if (g.key === 'Vi') drawPhage(ctx, p.x, p.y + 4 * ik, 15 * ik, Math.sin(t * 0.6 * move) * 0.2, g.color, 0.95);
  else {
    const sp = cellSprite(ICON[g.key]);
    iconCell(ctx, sp, p.x, p.y, (g.key === 'Mi' ? 11 : 16) * ik, t * 0.15 * move, g.color);
  }
  const memberLine = members.length ? (members.length <= 2 && members.slice(0, 2).join(' · ').length <= 26 ? members.slice(0, 2).join(' · ') : `${members[0]} +${members.length - 1}`) : g.key === 'Vi' ? 'Phages and giant viruses' : '';
  if (narrow) {
    // labels centred under the pod
    ctx.textAlign = 'center';
    const y0 = p.y + pr + 22;
    ctx.font = `600 9px ${MONO}`;
    ctx.fillStyle = mix(g.color, 0.95);
    ctx.fillText(g.name.toUpperCase(), p.x, y0);
    ctx.font = `600 14px ${MONO}`;
    ctx.fillStyle = ok ? 'rgba(232,236,242,0.95)' : '#ff8a7e';
    ctx.fillText(v.toFixed(2), p.x, y0 + 16);
    ctx.font = `500 9px ${MONO}`;
    ctx.fillStyle = 'rgba(232,236,242,0.38)';
    ctx.fillText(`BAND ${lo}–${hi}`, p.x, y0 + 29);
    if (memberLine) {
      ctx.font = `500 10px ${SANS}`;
      ctx.fillStyle = 'rgba(232,236,242,0.55)';
      ctx.fillText(memberLine.length > 24 ? memberLine.slice(0, 22) + '…' : memberLine, p.x, y0 + 43);
    }
    return;
  }
  // labels
  const right = p.x > cx;
  ctx.textAlign = right ? 'left' : 'right';
  const tx = p.x + (right ? 1 : -1) * (pr + 22);
  ctx.font = `600 9.5px ${MONO}`;
  ctx.fillStyle = mix(g.color, 0.95);
  ctx.fillText(g.name.toUpperCase(), tx, p.y - 10);
  ctx.font = `600 16px ${MONO}`;
  ctx.fillStyle = ok ? 'rgba(232,236,242,0.95)' : '#ff8a7e';
  ctx.fillText(v.toFixed(2), tx, p.y + 9);
  ctx.font = `500 9.5px ${MONO}`;
  ctx.fillStyle = 'rgba(232,236,242,0.38)';
  ctx.fillText(`BAND ${lo}–${hi}`, tx, p.y + 22);
  if (memberLine) {
    // first species by name, the rest as a count, so the line never runs off the screen
    ctx.font = `500 10.5px ${SANS}`;
    ctx.fillStyle = members.length ? 'rgba(232,236,242,0.6)' : 'rgba(232,236,242,0.45)';
    ctx.fillText(memberLine, tx, p.y + 37);
  }
}

/** A guild's cell, drawn crisp at icon size. */
function iconCell(ctx: CanvasRenderingContext2D, sp: Sprite, x: number, y: number, r: number, a: number, col: string) {
  const k = r / sp.R;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.scale(k, k);
  ctx.fillStyle = mix(col, 0.12);
  ctx.fill(sp.outline);
  ctx.globalAlpha = 0.35;
  ctx.drawImage(sp.c, -sp.w / 2, -sp.h / 2);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = mix(col, 0.95);
  ctx.lineWidth = 1.3 / k;
  ctx.stroke(sp.outline);
  ctx.restore();
}

