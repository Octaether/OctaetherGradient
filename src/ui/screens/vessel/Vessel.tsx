// Act 0: the chemistry vessel, drawn as two technical illustrations. Science
// has not chosen between them, so both run: an alkaline hydrothermal chimney
// (energy, gradients, simple organics) and a shallow pond on land (wet–dry
// cycles that join nucleotides into RNA). The scenes are drawn by vent.ts and
// pond.ts; this file holds the overlays, feedback and controls.
import { useEffect, useRef, useState } from 'react';
import { useGame } from '../../store';
import { useCanvas, useMoreBelow } from '../../hooks';
import { send } from '../../simClient';
import { audio } from '../../audio/engine';
import { fmt, roman } from '../../../sim/num';
import { AVOGADRO_ML } from '../../../sim/act0';
import { POOL } from '../../theme';
import { drawVent, newVentScene } from './vent';
import { drawPond, newPondScene } from './pond';
import { StrandChart, lenColor } from './StrandChart';

const AV = AVOGADRO_ML;

export function Vessel() {
  const ok = useGame((s) => !!s.snap?.act0);
  return ok ? <VesselInner /> : null;
}

function VesselInner() {
  const snap = useGame((s) => s.snap)!;
  const a = snap.act0!;
  const reduced = useGame((s) => s.settings.reducedMotion);
  const state = useRef(a);
  state.current = a;
  const move = reduced ? 0 : 1;
  const ventPanel = useRef<HTMLDivElement>(null);
  const pondPanel = useRef<HTMLDivElement>(null);
  const libPanel = useRef<HTMLDivElement>(null);

  // ---------- vent ----------
  const ventScene = useRef(newVentScene());
  const vent = useCanvas((ctx, w, h, t, dt) => drawVent(ctx, w, h, t, dt, state.current, ventScene.current, ventPanel.current, move), [reduced]);

  // ---------- pond ----------
  const pondScene = useRef(newPondScene());
  const pond = useCanvas((ctx, w, h, t, dt) => drawPond(ctx, w, h, t, dt, state.current, pondScene.current, [pondPanel.current, libPanel.current], move), [reduced]);

  // ---------- feedback: what each cycle and each upgrade actually did ----------
  const highlight = useGame((s) => s.highlight);
  const [floats, setFloats] = useState<{ id: number; site: 'vent' | 'pond'; text: string; sub?: string }[]>([]);
  const prev = useRef<{ cycleT: number; levels: Record<string, number> } | null>(null);
  const cycStart = useRef<{ L: number } | null>(null);
  const floatId = useRef(1);
  const lastMeh = useRef(-99);
  const [library, setLibrary] = useState<string[]>(a.strands.slice(0, 14));
  const [libView, setLibView] = useState<'odds' | 'sample'>('odds');
  const oddsRef = useRef<HTMLDivElement>(null);
  const oddsMore = useMoreBelow(oddsRef, libView);
  const libT = useRef(0);
  useEffect(() => {
    const levels = Object.fromEntries(a.upgrades.map((u) => [u.id, u.level]));
    const p = prev.current;
    const add = (site: 'vent' | 'pond', text: string, sub?: string) => {
      const id = floatId.current++;
      setFloats((f) => [...f.filter((x) => x.site !== site).slice(-2), { id, site, text, sub }]);
      setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 3000);
    };
    const now = performance.now();
    if (p) {
      if (p.cycleT <= 0 && a.cycleT > 0) cycStart.current = { L: a.L };
      if (p.cycleT > 0 && a.cycleT <= 0) {
        // refresh the sample once per cycle so it reads calmly
        setLibrary(a.strands.slice(0, 14));
        libT.current = now;
        const c = cycStart.current;
        if (c && !a.auto) {
          const dL = a.L - c.L;
          if (dL >= 0.05) add('pond', `Strands grew ${dL.toFixed(2)} nucleotides longer`, `average length now ${a.L.toFixed(1)}`);
          else if (a.cycles - lastMeh.current >= 5) {
            lastMeh.current = a.cycles;
            add('pond', 'Strands barely grew', 'more nucleotides or clay would help');
          }
        }
        cycStart.current = null;
      }
      for (const u of a.upgrades) {
        if ((p.levels[u.id] ?? 0) < u.level) {
          const eff = u.text.includes(':') ? u.text.split(':').pop()!.trim() : u.text;
          if (u.site === 'vent' || u.site === 'both') add('vent', u.name, eff);
          if (u.site === 'pond' || u.site === 'both') add('pond', u.name, eff);
        }
      }
    }
    if (now - libT.current > 6000) {
      setLibrary(a.strands.slice(0, 14));
      libT.current = now;
    }
    prev.current = { cycleT: a.cycleT, levels };
  });
  const siteStyle = (site: 'vent' | 'pond'): React.CSSProperties => ({
    position: 'relative',
    overflow: 'hidden',
    boxShadow: highlight === 'site:' + site || highlight === 'site:both' ? 'inset 0 0 0 1px rgb(var(--acc) / .7), inset 0 0 80px rgb(var(--acc) / .12)' : 'none',
    transition: 'box-shadow .25s',
  });
  const bottomOfPanels = () => Math.max(...[pondPanel.current, libPanel.current].map((el) => (el ? el.offsetTop + el.offsetHeight : 300)));
  const floatsFor = (site: 'vent' | 'pond') => (
    <>
      {floats
        .filter((f) => f.site === site)
        .map((f) => (
          <div key={f.id} className="float-txt" style={{ left: '50%', top: site === 'pond' ? Math.max(bottomOfPanels() + 14, 0) : '44%', textAlign: 'center' }}>
            {f.text}
            {f.sub && <div style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--text-2)', textShadow: 'none' }}>{f.sub}</div>}
          </div>
        ))}
    </>
  );
  const builtFor = (site: 'vent' | 'pond') => {
    const list = a.upgrades.filter((u) => u.level > 0 && (u.site === site || u.site === 'both'));
    // one row, always the same height: the panel never grows, so the pond below never moves
    const all = list.map((u) => u.name + (u.levels > 1 ? ' ' + roman(u.level) : '')).join(' · ');
    return (
      <div className="built-row" title={list.length ? 'Built here: ' + all : undefined}>
        {list.length === 0 && <span className="faint" style={{ fontSize: 11 }}>Nothing built here yet</span>}
        {list.map((u) => (
          <span key={u.id} className="chip" title={u.text}>
            {u.name.split(' ')[0]}
            {u.levels > 1 ? ' ' + roman(u.level) : ''}
          </span>
        ))}
      </div>
    );
  };
  const cycleProgress = a.cycleT > 0 ? 1 - a.cycleT / 3 : 0;
  const freezeProgress = a.freezeT > 0 ? 1 - a.freezeT / 4 : 0;
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
      <div style={siteStyle('vent')}>
        <canvas ref={vent} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
        <div ref={ventPanel} className="overlay-chip" style={{ left: 16, top: 16, width: 236 }}>
          <div className="site-h" style={{ color: POOL.proton }}>Hydrothermal vent</div>
          <Stock col={POOL.carbon} name="Simple organics" v={fmt(a.org * AV)} r={`+${fmt(a.rates.org * AV)}/s from H₂ + CO₂`} />
          <Stock col={POOL.lipid} name="Fatty acids" v={fmt(a.fa * AV)} r={`+${fmt(a.rates.fa * AV)}/s`} />
          {builtFor('vent')}
        </div>
        {floatsFor('vent')}
      </div>
      <div style={{ ...siteStyle('pond'), borderLeft: '1px solid var(--line)' }}>
        <canvas ref={pond} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
        <div ref={pondPanel} className="overlay-chip" style={{ left: 16, top: 16, width: 'min(236px, calc(50% - 24px))' }}>
          <div className="site-h" style={{ color: POOL.nad }}>Shallow pond</div>
          {/* drying moves nucleotides into strands: say so, so the falling number does not look like a cost */}
          <Stock col={POOL.rna} name="Nucleotides" v={fmt(a.nu * AV)} r={a.rates.join - a.rates.unjoin > a.rates.nu * 0.5 ? `−${fmt((a.rates.join - a.rates.unjoin - a.rates.nu) * AV)}/s joining into RNA` : `+${fmt(a.rates.nu * AV)}/s`} />
          <Stock col={POOL.rna} name="RNA strands" v={fmt((a.rna / Math.max(1, a.L)) * AV)} r={`average ${a.L.toFixed(1)} nucleotides long`} />
          <Stock col={POOL.lipid} name="Vesicles" v={fmt(a.ves * 1e6)} r="bubbles of fatty acid" />
          {builtFor('pond')}
        </div>
        <div ref={libPanel} className={'overlay-chip lib view-' + libView} style={{ right: 16, top: 16, width: 'min(248px, calc(50% - 24px))' }}>
          <div className="site-h">RNA strands</div>
          {/* on shorter screens the chart and the sample share the space: pick one */}
          <div className="lib-tabs">
            <button className={libView === 'odds' ? 'on' : ''} onClick={() => setLibView('odds')}>
              Odds
            </button>
            <button className={libView === 'sample' ? 'on' : ''} onClick={() => setLibView('sample')}>
              Sample
            </button>
          </div>
          <div className="pane-odds" ref={oddsRef}>
            <StrandChart a={a} />
            {oddsMore && <div className="more-below">▾ more</div>}
          </div>
          <div className="lib-h pane-sample">SAMPLE · LONGEST FIRST</div>
          <div className="lib-list pane-sample">
            {[...library].sort((x, y) => y.length - x.length).map((s, i) => (
              <div key={i} className={'strand' + (s.length >= 45 ? ' long' : '')} style={{ color: lenColor(s.length) }}>
                {s || '·'}
                <span className="len">{s.length}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="faint pond-caption" style={{ visibility: a.sparkT > 0 ? 'hidden' : 'visible', position: 'absolute', left: '50%', bottom: 148, transform: 'translateX(-50%)', fontSize: 11.5, textAlign: 'center', width: 300, zIndex: 3 }}>
          {a.auto
            ? `Geysers run the cycles now · ${a.cycles} cycles`
            : a.cycleT > 0
              ? cycleProgress < 0.45
                ? 'The sun evaporates the pool; nucleotides crowd together'
                : cycleProgress < 0.8
                  ? 'Crowded on the dry rim, nucleotides join into strands'
                  : 'Rain refills the pool and frees the strands'
              : 'Drying concentrates nucleotides so they join into longer RNA'}
        </div>
        <div style={{ position: 'absolute', left: '50%', bottom: 30, transform: 'translateX(-50%)', display: 'flex', gap: 22, alignItems: 'center', zIndex: 3 }}>
          <CycleButton busy={a.cycleT > 0} p={cycleProgress} color={POOL.nad} idle={['Run a', 'wet–dry cycle']} busyText="Cycling…" onClick={() => send({ type: 'act0', action: 'cycle' })} />
          {a.iceUnlocked && <CycleButton busy={a.freezeT > 0} p={freezeProgress} color="#cfe6ff" idle={['Freeze', 'and thaw']} busyText="Freezing…" onClick={() => send({ type: 'act0', action: 'freeze' })} />}
        </div>
        {!(a.sparkT > 0) && floatsFor('pond')}
      </div>
    </div>
  );
}

function Stock({ col, name, v, r }: { col: string; name: string; v: string; r: string }) {
  return (
    <div className="stock">
      <span className="sw" style={{ background: col }} />
      <span>{name}</span>
      <span className="v">{v}</span>
      <span className="r">{r}</span>
    </div>
  );
}

function CycleButton({ busy, p, color, idle, busyText, onClick }: { busy: boolean; p: number; color: string; idle: [string, string]; busyText: string; onClick: () => void }) {
  const R = 52;
  const C = 2 * Math.PI * R;
  return (
    <button
      className="cycle-btn"
      disabled={busy}
      onClick={() => {
        audio.click();
        onClick();
      }}
    >
      <svg viewBox="0 0 118 118">
        <circle cx="59" cy="59" r={R} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1" strokeDasharray="2 4" />
        <circle cx="59" cy="59" r={R} fill="none" stroke={color} strokeWidth="2" strokeDasharray={`${C * p} ${C}`} transform="rotate(-90 59 59)" strokeLinecap="round" style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
        {Array.from({ length: 24 }, (_, i) => {
          const an = (i / 24) * Math.PI * 2;
          const r1 = 56;
          const r2 = i % 6 === 0 ? 60 : 58;
          return <line key={i} x1={59 + Math.cos(an) * r1} y1={59 + Math.sin(an) * r1} x2={59 + Math.cos(an) * r2} y2={59 + Math.sin(an) * r2} stroke="rgba(255,255,255,0.3)" strokeWidth="1" />;
        })}
      </svg>
      {busy ? (
        busyText
      ) : (
        <span>
          {idle[0]}
          <br />
          {idle[1]}
        </span>
      )}
    </button>
  );
}

