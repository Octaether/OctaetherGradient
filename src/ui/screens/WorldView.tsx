// The World: one ocean cross-section that fills up act by act. Every swarm is
// a species you raised, in the layer it lives in (sunlit surface, dim middle
// water, dark sediment). Particles show what passes between them (H₂,
// lactate, dead cells, oxygen); gauges show what the community is doing to
// the world; the chart shows their numbers over the last five minutes.
import { useMemo, useRef, useState } from 'react';
import { useGame } from '../store';
import { useCanvas } from '../hooks';
import { guildColor } from '../theme';
import type { WorldSnap } from '../../sim/snapshot';
import { drawWorld, newWorldScene, type WorldScene } from './world/scene';

const PANEL_W = 268;
const CHART_H = 118;


export function WorldView() {
  const has = useGame((s) => !!s.snap?.world);
  if (!has)
    return (
      <div className="faint" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center', padding: 24 }}>
        The World opens in Act III, when your bacteria start feeding others.
      </div>
    );
  return <WorldInner />;
}

function WorldInner() {
  const w = useGame((s) => s.snap!.world!);
  const dayPhase = useGame((s) => s.snap!.dayPhase);
  const reduced = useGame((s) => s.settings.reducedMotion);
  const set = useGame((s) => s.set);
  const ref = useRef<WorldSnap>(w);
  ref.current = w;
  const dayRef = useRef(dayPhase);
  dayRef.current = dayPhase;
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const scene = useRef<WorldScene>(newWorldScene());
  const hoverId = useRef<string | null>(null);
  hoverId.current = hover?.id ?? null;

  const canvas = useCanvas((ctx, W, H, t, dt) => {
    const X0 = Math.min(W * 0.45, PANEL_W + 12);
    const sh = Math.max(200, H - CHART_H - 28);
    drawWorld(ctx, W, H, t, dt, ref.current, scene.current, { X0, sh, move: reduced ? 0 : 1, accent: getAccent(), hover: hoverId.current, dayPhase: dayRef.current });
  });

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    const yy = e.clientY - r.top;
    let best: string | null = null;
    for (const [id, h] of Object.entries(scene.current.homes)) {
      const dx = (x - h.x) / (h.rx + 14);
      const dy = (yy - h.y) / (h.ry + 14);
      if (dx * dx + dy * dy < 1) best = id;
    }
    setHover(best ? { id: best, x, y: yy } : null);
  };
  const hg = hover ? w.guilds.find((g) => g.id === hover.id) : null;

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <canvas ref={canvas} onMouseMove={onMove} onMouseLeave={() => setHover(null)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      {hg && hover && (
        <div className="world-tip" style={{ left: Math.max(PANEL_W + 20, hover.x - 290 > PANEL_W ? (hover.x > 700 ? hover.x - 280 : hover.x + 16) : hover.x + 16), top: hover.y + 12 }}>
          <b style={{ color: guildColor(hg) }}>{hg.name}</b>
          <div className="faint">{hg.sci}</div>
          <div>
            <span className="faint">Eats </span>
            {hg.eats}
          </div>
          <div>
            <span className="faint">Makes </span>
            {hg.makes}
          </div>
          <div className="faint">
            {w.layers[hg.layer]} · {hg.alive ? `${(hg.share * 100).toFixed(1)}% of the community` : 'lost'}
          </div>
          {hg.danger && <div style={{ color: 'var(--oxygen)' }}>Oxygen is killing them here. Move them to the sediment (Evolve, Community).</div>}
        </div>
      )}
      <div className="overlay-chip world-side" style={{ left: 16, top: 16, width: PANEL_W - 16, bottom: 16 }}>
        <div className="site-h" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>The world</span>
          <span className="faint" title="Species that each make up at least 5% of the community">{w.coexist} coexisting</span>
        </div>
        {w.gauges.map((gz) => (
          <div key={gz.id} className="wg" title={gz.text}>
            <div className="wg-h">
              <span>{gz.label}</span>
              <b>{gz.unit === 'pct' ? `${Math.round((gz.v / gz.max) * 100)}%` : gz.v.toFixed(2)}</b>
            </div>
            <div className="wg-bar">
              <i style={{ width: `${Math.min(100, (gz.v / gz.max) * 100)}%`, background: gz.color }} />
              {gz.lines.map((ln) => (
                <em key={ln.label} className={ln.kind} style={{ left: `${Math.min(100, (ln.v / gz.max) * 100)}%` }} title={ln.label} />
              ))}
            </div>
            {gz.lines.length > 0 && <div className="wg-note">{gz.lines.map((ln) => `${ln.kind === 'toxic' ? '▲' : '◆'} ${ln.label}`).join(' · ')}</div>}
          </div>
        ))}
        {w.partner && (
          <div className="wg" title="The host's genome grows as the partner's shrinks">
            <div className="wg-h">
              <span>Genomes</span>
              <b>
                host {w.partner.hostGenes} · partner {w.partner.partnerGenes}
              </b>
            </div>
          </div>
        )}
        <div className="site-h" style={{ marginTop: 12 }}>
          Community
        </div>
        {w.guilds.map((g) => (
          <div key={g.id} className={'wrow' + (g.alive ? '' : ' lost') + (g.danger ? ' danger' : '')} title={`${g.sci}. Eats: ${g.eats}. Makes: ${g.makes}.`} onMouseEnter={() => setHover(null)}>
            <i style={{ background: guildColor(g) }} />
            <span className="nm">{g.name}</span>
            <span className="wbar">
              <b style={{ width: `${Math.min(100, g.B * 80)}%`, background: guildColor(g) }} />
            </span>
            <span className={'st ' + g.status.replace(' ', '-')}>{g.danger ? 'O₂!' : g.status}</span>
          </div>
        ))}
        {w.log.length > 0 && (
          <details className="wlog">
            <summary>Chronicle · {w.log.length}</summary>
            {w.log
              .slice()
              .reverse()
              .map((e, i) => (
                <div key={i}>
                  <span className="faint">Act {['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'F'][e.act]}</span> {e.text}
                </div>
              ))}
          </details>
        )}
        <button className="btn ghost sm" style={{ marginTop: 10, width: '100%' }} onClick={() => set({ tab: 'community' })}>
          Community traits in Evolve →
        </button>
      </div>
      <PopChart w={w} />
    </div>
  );
}

let accCache = { t: 0, v: '#ff8a3d' };
/** The act's accent colour (read from CSS at most twice a second). */
function getAccent(): string {
  const now = performance.now();
  if (now - accCache.t > 500) {
    const el = document.querySelector('.app') as HTMLElement | null;
    accCache = { t: now, v: (el && getComputedStyle(el).getPropertyValue('--accent').trim()) || accCache.v };
  }
  return accCache.v;
}

/** Every species' numbers over the last five minutes. */
function PopChart({ w }: { w: WorldSnap }) {
  const rows = w.hist;
  const series = useMemo(() => {
    if (rows.length < 2) return [];
    const t0 = rows[0][0];
    const t1 = rows[rows.length - 1][0];
    const out: { id: string; d: string; col: string; name: string; last: number }[] = [];
    w.guilds.forEach((g) => {
      const k = 1 + w.histKeys.indexOf(g.id);
      if (k < 1) return;
      const vals = rows.map((r) => r[k] ?? 0);
      if (!vals.some((v) => v > 0)) return;
      const d = rows.map((r, i) => `${i ? 'L' : 'M'}${(((r[0] - t0) / Math.max(1, t1 - t0)) * 100).toFixed(2)},${(100 - Math.min(1.25, r[k] ?? 0) * 76).toFixed(2)}`).join(' ');
      out.push({ id: g.id, d, col: guildColor(g), name: g.name, last: vals[vals.length - 1] });
    });
    return out;
  }, [rows, w.guilds, w.histKeys]);
  const span = rows.length > 1 ? rows[rows.length - 1][0] - rows[0][0] : 0;
  return (
    <div className="overlay-chip world-chart" style={{ left: PANEL_W + 12, right: 16, bottom: 16, height: CHART_H }}>
      <div className="wc-h">
        <span className="site-h" style={{ margin: 0 }}>
          Populations
        </span>
        <span className="faint">last {Math.max(1, Math.round(span / 60))} min</span>
      </div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="wc-svg">
        <line x1="0" x2="100" y1="24" y2="24" className="wc-grid" />
        <line x1="0" x2="100" y1="62" y2="62" className="wc-grid" />
        {series.map((s) => (
          <path key={s.id} d={s.d} stroke={s.col} fill="none" strokeWidth={1.4} vectorEffect="non-scaling-stroke" opacity={0.9} />
        ))}
      </svg>
      <div className="wc-key">
        {series.map((s) => (
          <span key={s.id}>
            <i style={{ background: s.col }} />
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}
