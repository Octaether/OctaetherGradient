import { useRef, useState } from 'react';
import { motion } from 'motion/react';
import { useCanvas } from './hooks';
import { TAU } from './art';
import { useGame } from './store';
import { hasSave, startSim } from './simClient';
import { audio } from './audio/engine';
import { Mark } from './components/Icons';
import { CARDS } from '../content';


export function Title() {
  const set = useGame((s) => s.set);
  const reduced = useGame((s) => s.settings.reducedMotion);
  const saved = hasSave();
  const [leaving, setLeaving] = useState(false);
  // Protons: 0 free on the proton-rich side, 1 climbing subunit a's entry channel,
  // 2 waiting for an empty c-subunit, 3 riding the ring, 4 leaving by the exit
  // channel, 5 free on the far side.
  type H = { x: number; y: number; v: number; ph: number; st: 0 | 1 | 2 | 3 | 4 | 5; pump: number; site: number; u: number; a0: number; hold: number };
  type Pump = { rot: number; prev: number; occ: boolean[]; busy: boolean; atp: number };
  const parts = useRef<H[]>([]);
  const pumps = useRef<Pump[]>([]);
  const atps = useRef<{ x: number; y: number; vx: number; vy: number; life: number }[]>([]);
  const canvas = useCanvas(
    (ctx, w, h, t, dt) => {
      ctx.clearRect(0, 0, w, h);
      const move = reduced ? 0 : 1;
      const mx = w * 0.5;
      const memX = (y: number) => mx + Math.sin(y * 0.012 + t * 0.4 * move) * 6;
      const u = Math.max(1, Math.min(1.5, w / 1100));
      // geometry of one pump, relative to its ring centre
      const RC = 10 * u; // c-ring centreline
      const RO = 12.8 * u;
      const RI = 7.2 * u;
      const A_TOP = RO + 1.5 * u; // subunit a sits under the ring, across the membrane
      const A_H = 9 * u;
      const A_W = 9.5 * u; // half width
      const entry = { x: -A_W, y: A_TOP + A_H * 0.55 };
      const exit = { x: A_W, y: A_TOP + A_H * 0.55 };
      const LA = Math.PI / 2 + 0.42; // load angle: bottom-left, over the entry channel
      const TRAVEL = TAU - 0.84; // ride almost a full turn to the exit channel
      const NC = 10;
      const n = Math.max(4, Math.min(7, Math.floor(h / 115)));
      const py = (i: number) => (h * (i + 0.5)) / n;
      while (pumps.current.length < n) pumps.current.push({ rot: Math.random() * TAU, prev: 0, occ: new Array(NC).fill(false), busy: false, atp: 0 });
      const P = pumps.current;
      const omega = 1.8;
      P.forEach((pm, i) => {
        pm.prev = pm.rot;
        if (i < n) pm.rot += omega * (1 + 0.06 * Math.sin(i * 2.1)) * dt * move;
      });
      const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
      const siteAng = (pm: Pump, k: number, rot = pm.rot) => rot + (k * TAU) / NC;

      // membrane: one quiet line, broken where each pump sits in it
      ctx.strokeStyle = 'rgba(207,214,224,0.13)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      let pen = false;
      for (let y = 0; y <= h; y += 4) {
        let gap = false;
        for (let i = 0; i < n; i++) if (y > py(i) - RO - 4 && y < py(i) + A_TOP + A_H + 4) gap = true;
        if (gap) {
          pen = false;
          continue;
        }
        if (!pen) ctx.moveTo(memX(y), y);
        else ctx.lineTo(memX(y), y);
        pen = true;
      }
      ctx.stroke();

      // protons
      const fresh = (x: number, st: 0 | 5): H => ({ x, y: Math.random() * h, v: 10 + Math.random() * 30, ph: Math.random() * TAU, st, pump: -1, site: -1, u: 0, a0: 0, hold: 4 + Math.pow(Math.random(), 1.5) * 46 });
      if (parts.current.length === 0) {
        // start mid-flow: a crowd already pressed against the membrane, a stream already through
        for (let k = 0; k < 560; k++) parts.current.push(fresh(mx - 6 - (k % 5 < 3 ? Math.random() * 70 : 70 + Math.random() * (mx - 80)), 0));
        for (let k = 0; k < 40; k++) parts.current.push(fresh(mx + 20 + Math.random() * w * 0.3, 5));
      }
      if (move && parts.current.filter((q) => q.st === 0).length < 560) for (let k = 0; k < 2; k++) parts.current.push(fresh(Math.random() * w * 0.3, 0));
      const near = (y: number) => {
        let best = 0;
        for (let i = 1; i < n; i++) if (Math.abs(py(i) - y) < Math.abs(py(best) - y)) best = i;
        return best;
      };
      for (const q of parts.current) {
        if (q.st === 0) {
          const j = near(q.y);
          const cy = py(j);
          const cx = memX(cy);
          const ex = cx + entry.x;
          const ey = cy + entry.y;
          const inGlyph = q.y > cy - RO - 6 && q.y < cy + A_TOP + A_H + 6;
          // crowd against the membrane: this crowd is the gradient
          const wall = inGlyph ? cx - RO - 4 - q.hold * 0.5 : memX(q.y) - 3 - q.hold;
          q.x += q.v * dt * move * (q.x > wall - 40 ? 0.15 : 1);
          q.y += (Math.sin(t * 0.8 + q.ph) * 5 + (Math.random() - 0.5) * 40) * dt * move;
          let lim = wall;
          if (Math.hypot(ex - q.x, ey - q.y) < 28 && q.x > wall - 30) {
            // drawn into the mouth of the entry channel, queueing in a short line
            q.y += (ey - q.y) * Math.min(1, dt * 2.4) * move;
            if (Math.abs(ey - q.y) < 3) {
              lim = ex - 1 - q.hold * 0.2;
              q.x = Math.min(lim, q.x + 24 * dt * move);
              if (q.x >= lim - 0.5 && !P[j].busy && move) {
                q.st = 1;
                q.pump = j;
                q.u = 0;
                P[j].busy = true;
              }
            }
          }
          if (q.st === 0 && q.x > lim) q.x = lim;
        } else if (q.st === 1 || q.st === 4) {
          // through subunit a: entry channel up to the ring, exit channel down and out
          const cy = py(q.pump);
          const cx = memX(cy);
          q.u = Math.min(1, q.u + (dt * move) / 0.32);
          const ring = q.st === 1 ? LA : LA + TRAVEL;
          const r0 = q.st === 1 ? entry : { x: Math.cos(ring) * RC, y: Math.sin(ring) * RC };
          const r1 = q.st === 1 ? { x: Math.cos(ring) * RC, y: Math.sin(ring) * RC } : exit;
          const e = q.u * q.u * (3 - 2 * q.u);
          q.x = cx + r0.x + (r1.x - r0.x) * e;
          q.y = cy + r0.y + (r1.y - r0.y) * e;
          if (q.u >= 1) {
            if (q.st === 1) q.st = 2;
            else {
              q.st = 5;
              q.v = 12 + Math.random() * 22;
            }
          }
        } else if (q.st === 2) {
          // wait at the binding site for the next empty c-subunit to swing past
          const pm = P[q.pump];
          const cy = py(q.pump);
          const cx = memX(cy);
          q.x = cx + Math.cos(LA) * RC;
          q.y = cy + Math.sin(LA) * RC;
          for (let k = 0; k < NC; k++) {
            const before = wrap(siteAng(pm, k, pm.prev) - LA);
            const after = wrap(siteAng(pm, k) - LA);
            if (before < 0 && after >= 0 && !pm.occ[k]) {
              pm.occ[k] = true;
              pm.busy = false;
              q.st = 3;
              q.site = k;
              q.a0 = pm.rot - after;
              break;
            }
          }
        } else if (q.st === 3) {
          // bound to its c-subunit, carried round by the turning ring
          const pm = P[q.pump];
          const cy = py(q.pump);
          const cx = memX(cy);
          const gone = pm.rot - q.a0;
          const an = LA + gone;
          q.x = cx + Math.cos(an) * RC;
          q.y = cy + Math.sin(an) * RC;
          if (gone >= TRAVEL) {
            pm.occ[q.site] = false;
            q.st = 4;
            q.u = 0;
          }
        } else {
          q.x += q.v * dt * move * 1.6;
          q.y += Math.sin(t * 0.8 + q.ph) * 4 * dt * move;
        }
      }
      parts.current = parts.current.filter((q) => q.x < Math.min(w + 10, mx + w * 0.36) && (q.st === 0 || q.pump < n));

      // pumps: subunit a (stator), the c-ring rotor of ten subunits, the central stalk
      for (let i = 0; i < n; i++) {
        const pm = P[i];
        const cy = py(i);
        const cx = memX(cy);
        // subunit a, with its two offset half-channels
        ctx.beginPath();
        ctx.roundRect(cx - A_W, cy + A_TOP, A_W * 2, A_H, 3 * u);
        ctx.fillStyle = 'rgba(0,229,255,0.04)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,229,255,0.4)';
        ctx.lineWidth = 0.9;
        ctx.stroke();
        ctx.strokeStyle = 'rgba(0,229,255,0.22)';
        ctx.beginPath();
        ctx.moveTo(cx + entry.x + 2 * u, cy + entry.y);
        ctx.lineTo(cx + Math.cos(LA) * (RO - 0.5 * u), cy + A_TOP + 1);
        ctx.moveTo(cx + exit.x - 2 * u, cy + exit.y);
        ctx.lineTo(cx + Math.cos(LA + TRAVEL) * (RO - 0.5 * u), cy + A_TOP + 1);
        ctx.stroke();
        // c-ring: ten subunits as segments of one ring
        const gapA = 0.07;
        for (let k = 0; k < NC; k++) {
          const a0 = siteAng(pm, k) - Math.PI / NC + gapA;
          const a1 = siteAng(pm, k) + Math.PI / NC - gapA;
          ctx.beginPath();
          ctx.arc(cx, cy, RO, a0, a1);
          ctx.arc(cx, cy, RI, a1, a0, true);
          ctx.closePath();
          if (pm.occ[k]) {
            ctx.fillStyle = 'rgba(0,229,255,0.14)';
            ctx.fill();
          }
          ctx.strokeStyle = 'rgba(0,229,255,0.5)';
          ctx.stroke();
        }
        // central stalk, keyed to the ring by one spoke so its turning shows
        ctx.strokeStyle = 'rgba(232,240,248,0.38)';
        ctx.beginPath();
        ctx.arc(cx, cy, 2.4 * u, 0, TAU);
        ctx.moveTo(cx + Math.cos(pm.rot) * 2.4 * u, cy + Math.sin(pm.rot) * 2.4 * u);
        ctx.lineTo(cx + Math.cos(pm.rot) * (RI - 1), cy + Math.sin(pm.rot) * (RI - 1));
        ctx.stroke();
        // every third of a turn the head above releases one ATP on the far side
        const thirds = Math.floor(pm.rot / (TAU / 3));
        if (thirds !== pm.atp) {
          if (pm.atp !== 0 && move) atps.current.push({ x: cx + RO + 3 * u, y: cy - 2 * u, vx: 16 + Math.random() * 10, vy: (Math.random() - 0.5) * 6, life: 1 });
          pm.atp = thirds;
        }
      }

      // protons on top: small white dots
      for (const q of parts.current) {
        if (q.st === 0) {
          ctx.fillStyle = 'rgba(214,232,246,0.62)';
          ctx.fillRect(q.x, q.y, 1.3, 1.3);
        } else if (q.st === 5) {
          const k = Math.max(0, Math.min(1, (q.x - mx) / (w * 0.36)));
          ctx.fillStyle = `rgba(240,248,252,${0.85 * (1 - k)})`;
          ctx.fillRect(q.x, q.y, 1.5, 1.2);
        } else {
          ctx.fillStyle = 'rgba(248,252,255,0.95)';
          ctx.beginPath();
          ctx.arc(q.x, q.y, 1.35 * u, 0, TAU);
          ctx.fill();
        }
      }
      atps.current = atps.current.filter((a) => a.life > 0);
      for (const a of atps.current) {
        a.x += a.vx * dt * move;
        a.y += a.vy * dt * move;
        a.life -= dt * 0.4 * (move || 1);
        ctx.fillStyle = `rgba(255,225,77,${0.85 * a.life})`;
        ctx.beginPath();
        ctx.arc(a.x, a.y, 1.6, 0, TAU);
        ctx.fill();
      }
    },
    [reduced],
  );
  const begin = (fresh: boolean) => {
    audio.loadMotif();
    audio.start();
    audio.click();
    setLeaving(true);
    startSim(fresh);
    setTimeout(() => set(fresh ? { started: true, transition: { from: -1, to: 0 } } : { started: true }), 650);
  };
  return (
    <motion.div className="title-screen" style={{ position: 'fixed', inset: 0, background: '#070a0d', overflow: 'hidden' }} animate={{ opacity: leaving ? 0 : 1 }} transition={{ duration: 0.6 }}>
      <canvas ref={canvas} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      <div className="backdrop" style={{ mixBlendMode: 'screen' }}>
        <div className="blob" style={{ left: '-14%', top: '-26%', background: 'radial-gradient(circle, rgba(124,200,240,0.14), transparent 62%)' }} />
        <div className="blob b2" style={{ right: '-16%', bottom: '-34%', background: 'radial-gradient(circle, rgba(0,229,255,0.16), transparent 62%)' }} />
      </div>
      <div style={{ position: 'relative', height: '100%', display: 'grid', placeItems: 'center', textAlign: 'center', padding: 16 }}>
        <div style={{ padding: '36px 44px', borderRadius: 28, background: 'radial-gradient(ellipse at center, rgba(7,10,13,0.86), rgba(7,10,13,0.55) 60%, transparent 80%)' }}>
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 1.4 }} style={{ display: 'flex', justifyContent: 'center' }}>
            <Mark size={52} />
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 14, filter: 'blur(10px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 1.8, ease: [0.2, 0.7, 0.2, 1] }}
            style={{
              fontSize: 'clamp(54px, 8.4vw, 112px)',
              fontWeight: 650,
              letterSpacing: '-0.045em',
              margin: '14px 0 0',
              lineHeight: 1.02,
              background: 'linear-gradient(100deg, #ffffff 0%, #ffffff 55%, #00e5ff 100%)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
              filter: 'none',
            }}
          >
            Gradient
          </motion.h1>
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.9, duration: 1.2 }} style={{ color: 'var(--text)', fontSize: 18, fontWeight: 450, letterSpacing: '-0.01em', margin: '18px 0 6px' }}>
            Evolve life from a puddle of chemistry to a living planet.
          </motion.p>
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.3, duration: 1.2 }} style={{ color: 'var(--text-3)', fontSize: 14, margin: 0 }}>
            Every rule is real biochemistry, from the first RNA strand to the biosphere.
          </motion.p>
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.7, duration: 1 }} style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 34 }}>
            {saved && (
              <button className="btn lg primary" onClick={() => begin(false)}>
                Continue
              </button>
            )}
            <button
              className={'btn lg' + (saved ? '' : ' primary')}
              onClick={() => {
                if (saved && !confirm('Start a new game? Your current save will be replaced.')) return;
                begin(true);
              }}
            >
              {saved ? 'New game' : 'Begin before life'}
            </button>
          </motion.div>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2.3, duration: 1.2 }} style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginTop: 28 }}>
            {['7 acts and a finale', `${Object.keys(CARDS).length} sourced science cards`, 'Generative score · best with sound'].map((t) => (
              <span key={t} className="chip" style={{ color: 'var(--text-2)', height: 26, padding: '0 11px', fontSize: 12 }}>
                {t}
              </span>
            ))}
          </motion.div>
        </div>
      </div>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 3, duration: 1.5 }} className="faint" style={{ position: 'absolute', left: 0, right: 0, bottom: 18, textAlign: 'center', fontSize: 12 }}>
        ATP synthase: protons flowing across the membrane turn the c-ring, and the turning stalk makes ATP. About 10 protons, one turn, 3 ATP.
      </motion.div>
    </motion.div>
  );
}
