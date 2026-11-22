// Play the virus: an optional side campaign. New verbs: burst size, latency,
// host range, and lysis versus lysogeny (hiding in the host genome when hosts
// are scarce). Survive three host crashes; the reward is transfer genes.
import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { useGame } from '../store';
import { send } from '../simClient';
import { audio } from '../audio/engine';
import { useCanvas } from '../hooks';
import { POOL } from '../theme';
import { IconClose } from '../components/Icons';

interface S {
  H: number;
  I: number;
  L: number;
  V: number;
  t: number;
  crashes: number;
  nextCrash: number;
  hist: number[][];
  dead: boolean;
  won: boolean;
}

const GOAL = 180;

function fresh(): S {
  return { H: 0.6, I: 0, L: 0, V: 0.02, t: 0, crashes: 0, nextCrash: 45, hist: [], dead: false, won: false };
}

export function VirusGame() {
  const show = useGame((s) => s.showVirus);
  const set = useGame((s) => s.set);
  const done = useGame((s) => s.snap?.virusCampaign.done);
  const [burst, setBurst] = useState(60);
  const [latency, setLatency] = useState(0.5);
  const [range, setRange] = useState(0.4);
  const [lyso, setLyso] = useState(0.2);
  const [running, setRunning] = useState(false);
  const st = useRef<S>(fresh());
  const params = useRef({ burst, latency, range, lyso });
  params.current = { burst, latency, range, lyso };
  const [, force] = useState(0);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const s = st.current;
      if (s.dead || s.won) return;
      const p = params.current;
      const a = 0.6 + 2.4 * p.range; // adsorption
      const b = p.burst * (1 - 0.45 * p.range); // broad host range costs burst size
      const tau = 0.6 + 2.6 * p.latency; // latency (time to burst)
      const K = 1;
      for (let k = 0; k < 10; k++) {
        const dt = 0.02;
        const N = s.H + s.I + s.L;
        const inf = a * s.H * s.V;
        const dH = 0.9 * s.H * (1 - N / K) - inf;
        const dI = inf * (1 - p.lyso) - s.I / tau;
        const dL = inf * p.lyso + 0.8 * s.L * (1 - N / K) - 0.03 * s.L;
        const dV = (b * s.I) / tau + b * 0.03 * s.L * 0.3 - a * (s.H + s.L) * s.V - 0.35 * s.V;
        s.H = Math.max(0, s.H + dH * dt);
        s.I = Math.max(0, s.I + dI * dt);
        s.L = Math.max(0, s.L + dL * dt);
        s.V = Math.max(0, s.V + dV * dt * 0.05);
        s.t += dt;
      }
      if (s.t >= s.nextCrash) {
        s.H *= 0.08;
        s.I *= 0.08;
        s.L *= 0.25;
        s.V *= 0.3;
        s.crashes++;
        s.nextCrash = s.t + 40 + Math.random() * 15;
        audio.chime('event');
      }
      if (s.H < 1e-4 && s.L < 1e-4 && s.I < 1e-4) s.H = 0.002; // hosts recolonise from elsewhere
      if (s.V < 1e-5 && s.L < 1e-5 && s.I < 1e-5) {
        s.dead = true;
        audio.chime('crash');
      }
      if (s.t >= GOAL && s.crashes >= 3 && !s.dead) {
        s.won = true;
        audio.chime('win');
        send({ type: 'virusDone' });
      }
      s.hist.push([s.t, s.H, s.I + s.L, s.V]);
      if (s.hist.length > 400) s.hist.shift();
      force((x) => x + 1);
    }, 100);
    return () => clearInterval(id);
  }, [running]);

  const canvas = useCanvas((ctx, w, h) => {
    const s = st.current;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,.05)';
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath();
      ctx.moveTo(0, (h * i) / 4);
      ctx.lineTo(w, (h * i) / 4);
      ctx.stroke();
    }
    const hist = s.hist;
    if (hist.length < 2) return;
    const t0 = hist[0][0];
    const t1 = Math.max(t0 + 1, hist[hist.length - 1][0]);
    const line = (k: number, col: string, scale: number) => {
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      hist.forEach((p, i) => {
        const x = ((p[0] - t0) / (t1 - t0)) * w;
        const y = h - Math.min(1, Math.log10(1 + p[k] * scale) / Math.log10(1 + scale)) * h * 0.92 - 4;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    };
    line(1, POOL.carbon, 100);
    line(2, POOL.atp, 100);
    line(3, POOL.oxygen, 100);
  }, []);

  if (!show) return null;
  const s = st.current;
  const Slider = ({ label, v, set: sv, lo, hi, step, fmt, hint }: { label: string; v: number; set: (n: number) => void; lo: number; hi: number; step: number; fmt: (n: number) => string; hint: string }) => (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', fontSize: 12.5 }}>
        <span>{label}</span>
        <span className="num faint" style={{ marginLeft: 'auto' }}>{fmt(v)}</span>
      </div>
      <input type="range" min={lo} max={hi} step={step} value={v} style={{ ['--fill' as string]: ((v - lo) / (hi - lo)) * 100 + '%', ['--track-fill' as string]: 'var(--oxygen)' }} onChange={(e) => sv(Number(e.target.value))} />
      <div className="faint" style={{ fontSize: 11 }}>{hint}</div>
    </div>
  );
  return (
    <div className="overlay">
      <motion.div className="modal" style={{ width: 'min(880px, calc(100vw - 32px))' }} initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div>
            <div className="caps" style={{ color: 'var(--oxygen)' }}>Side campaign</div>
            <h2 style={{ marginTop: 4 }}>Play the virus</h2>
          </div>
          <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={() => set({ showVirus: false })}>
            <IconClose size={16} />
          </button>
        </div>
        <p>
          You are a phage. Burst too hard and you burn through your hosts; hide too much and you never spread. Survive {GOAL} seconds and at least three host crashes.
          {done ? ' You have already earned the transfer genes.' : ' Reward: genes that boost transfer between lineages (Variation ×1.15).'}
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 20, marginTop: 10 }}>
          <div>
            <Slider label="Burst size" v={burst} set={setBurst} lo={10} hi={200} step={5} fmt={(n) => n + ' virions'} hint="More offspring per infected cell" />
            <Slider label="Latency" v={latency} set={setLatency} lo={0} hi={1} step={0.05} fmt={(n) => (n < 0.33 ? 'short' : n < 0.66 ? 'medium' : 'long')} hint="Waiting longer before bursting" />
            <Slider label="Host range" v={range} set={setRange} lo={0} hi={1} step={0.05} fmt={(n) => (n < 0.33 ? 'narrow' : n < 0.66 ? 'medium' : 'broad')} hint="Infect more hosts, but burst smaller" />
            <Slider label="Lysogeny" v={lyso} set={setLyso} lo={0} hi={0.95} step={0.05} fmt={(n) => Math.round(n * 100) + '% hide'} hint="Integrate into the host genome instead of bursting" />
            <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
              {!running || s.dead || s.won ? (
                <button
                  className="btn primary"
                  style={{ ['--c' as string]: 'var(--oxygen)' }}
                  onClick={() => {
                    st.current = fresh();
                    setRunning(true);
                    audio.click();
                  }}
                >
                  {s.dead || s.won ? 'Try again' : 'Release the virus'}
                </button>
              ) : (
                <button className="btn" onClick={() => setRunning(false)}>
                  Pause
                </button>
              )}
            </div>
          </div>
          <div>
            <div className="card" style={{ position: 'relative', height: 250 }}>
              <canvas ref={canvas} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 12 }}>
              <span style={{ color: POOL.carbon }}>— Hosts</span>
              <span style={{ color: POOL.atp }}>— Infected and lysogens</span>
              <span style={{ color: POOL.oxygen }}>— Free virions</span>
              <span className="num faint" style={{ marginLeft: 'auto' }}>
                {Math.floor(s.t)}s / {GOAL}s · crashes {s.crashes}/3
              </span>
            </div>
            {s.dead && <div style={{ color: 'var(--oxygen)', marginTop: 10, fontSize: 13 }}>Extinct. Without lysogens to hide in, a crash leaves nothing to infect. Try hiding more, or bursting less.</div>}
            {s.won && <div style={{ color: 'var(--light)', marginTop: 10, fontSize: 13 }}>You persisted. Your genes now ride between lineages in the main game.</div>}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
