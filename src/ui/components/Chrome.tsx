import { useEffect, useRef, useState } from 'react';
import { AVOGADRO_ML } from '../../sim/act0';
import { useGame, type Screen } from '../store';
import { ACTS } from '../../content';
import { ACT_TITLES, ROMAN } from '../theme';
import { Num } from './Num';
import { fmt, prettyPow } from '../../sim/num';
import { audio } from '../audio/engine';
import { send } from '../simClient';
import type { Snapshot } from '../../sim/snapshot';
import { IconBiomass, IconBlock, IconBody, IconCell, IconCodex, IconFullscreen, IconGoal, IconMap, IconPlanet, IconRecords, IconSettings, IconSound, IconTree, IconVariation, IconVessel, IconWorld, Mark } from './Icons';
import { toggleFullscreen, useFullscreen } from '../hooks';

export function actTitle(act: number) {
  if (act === 0 || act >= 8) return ACT_TITLES[act >= 8 ? 8 : 0].title;
  return ACTS[act]?.title ?? '';
}

const FOOD_NAME: Record<string, string> = {
  H2: 'Hydrogen (H₂)',
  glucose: 'Sugar',
  light: 'Sunlight',
  organics: 'Organics',
  prey: 'Prey bacteria',
  food: 'Food',
  nucleotides: 'Nucleotides',
};

const STAT_TEXT: Record<string, string> = {
  energyRatio: 'Fill the genome up to its energy-per-gene limit',
  errorRatio: 'Push the genome to its error threshold',
};

export interface GoalLine {
  text: string;
  short: string;
  ok: boolean;
  progress?: number;
}

export function goalLines(snap: Snapshot): { title: string; lines: GoalLine[] } {
  if (snap.act === 0 && snap.act0) {
    const a = snap.act0;
    return {
      title: 'Spark the first replicator',
      lines: [
        { text: `Grow RNA strands to 6 letters on average (now ${a.L.toFixed(1)})`, short: `Avg strand ${a.L.toFixed(1)} / 6`, ok: a.L >= 6, progress: a.L / 6 },
        { text: 'Form fatty-acid vesicles to hold them', short: `Vesicles ${Math.floor(a.ves)} / 40`, ok: a.ves >= 40, progress: a.ves / 40 },
        { text: 'Stock up an RNA library', short: 'RNA library', ok: a.rna > 0.05, progress: a.rna / 0.05 },
        { text: a.spark.ready ? `Wait for the spark: ${((1 - Math.exp(-a.spark.lambda)) * 100).toFixed(0)}% chance in the next minute, rising` : 'Then a self-copying strand can appear', short: a.spark.ready ? `Spark ${((1 - Math.exp(-a.spark.lambda)) * 100).toFixed(0)}% next min` : 'The spark', ok: false },
      ],
    };
  }
  if (snap.act >= 8 && snap.finale) {
    const f = snap.finale;
    return {
      title: f.won ? 'Postgame: stay stable under assault' : `Keep the planet in balance for ${f.win} s`,
      lines: [
        { text: `Every guild and gas inside its band (${Object.values(f.inBand).filter(Boolean).length}/7 now)`, short: `In band ${Object.values(f.inBand).filter(Boolean).length} / 7`, ok: Object.values(f.inBand).every(Boolean) },
        { text: `Hold it for ${f.win} seconds straight (${Math.floor(f.stable)} s so far)`, short: `Stable ${Math.floor(f.stable)} / ${f.win} s`, ok: f.stable >= f.win, progress: f.stable / f.win },
      ],
    };
  }
  const g = snap.gate;
  if (!g) return { title: '', lines: [] };
  const lines: GoalLine[] = g.conds.map((c) => {
    const m = c.text.match(/^(\w+) (>=|>|<|<=) ([\d.]+)$/);
    const text = m ? STAT_TEXT[m[1]] ?? c.text : c.text;
    // labelled World conditions: keep the chip short ("Three or more species coexist")
    const short = m ? (m[1] === 'energyRatio' ? 'Energy per gene' : m[1] === 'errorRatio' ? 'Error threshold' : text) : text.replace(/^Evolve /, '').replace(/^Stage \d · /, '').split(/ \(| for a /)[0];
    return { text, short, ok: c.ok };
  });
  lines.push({ short: `${snap.act === 1 ? 'RNA copying' : 'ATP flow'} ${fmt(Math.pow(10, g.flux))} / ${fmt(Math.pow(10, g.fluxNeed))}`, text: snap.act === 1 ? `RNA copying above ${fmt(Math.pow(10, g.fluxNeed))} per second (now ${fmt(Math.pow(10, g.flux))})` : `Energy flow above ${fmt(Math.pow(10, g.fluxNeed))} ATP per second (now ${fmt(Math.pow(10, g.flux))})`, ok: g.flux >= g.fluxNeed, progress: Math.pow(10, g.flux - g.fluxNeed) });
  const next = lines.find((l) => !l.ok);
  return { title: next ? next.text : 'Goal complete: the next act begins', lines };
}

const GOAL_SHORT: Record<number, string> = {
  0: 'Spark the first replicator',
  1: 'Build the first ribosome',
  2: 'Become LUCA',
  3: 'Survive the crash together',
  4: 'Through the oxygen you made',
  5: 'Two of yours become one',
  6: 'Algae and hunters',
  7: 'Grow a body',
  8: 'Balance the planet',
};

/** Always-visible objective: every condition as a chip, plus the guide. */
/** The snapshot, refreshed at most once per interval, so text does not jitter. */
function useCalmSnap(ms: number) {
  const live = useGame((s) => s.snap)!;
  const [calm, setCalm] = useState(live);
  const last = useRef(0);
  useEffect(() => {
    const now = performance.now();
    if (now - last.current >= ms || live.act !== calm.act) {
      last.current = now;
      setCalm(live);
    }
  }, [live, ms, calm.act]);
  return calm;
}

export function GoalBar() {
  const snap = useCalmSnap(1000);
  const tutorialLog = useGame((s) => s.tutorialLog);
  const set = useGame((s) => s.set);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    addEventListener('mousedown', h);
    return () => removeEventListener('mousedown', h);
  }, []);
  const { title, lines } = goalLines(snap);
  const done = lines.filter((l) => l.ok).length;
  const heading = snap.act === 2 ? (snap.flags.includes('luca') ? 'Stage 2 · Outlast the H₂ crash' : 'Stage 1 · Assemble LUCA') : (GOAL_SHORT[Math.min(snap.act, 8)] ?? title);
  return (
    <div className="goalbar" ref={ref}>
      {snap.challengeRun && (
        <span className="ch-banner" title={snap.challengeRun.text}>
          Challenge · {snap.challengeRun.name}
          <button
            className="btn ghost sm"
            title="Leave the challenge; your game comes back where you left it"
            onClick={() => {
              if (confirm('Abandon this challenge? Your game comes back where you left it.')) send({ type: 'abandonChallenge' });
            }}
          >
            Abandon
          </button>
        </span>
      )}
      <span className="gk">
        <IconGoal size={15} /> Goal <span className="num">{done}/{lines.length}</span>
      </span>
      <span className="gt" title={snap.act >= 1 && snap.act < 8 ? ACTS[snap.act].gate.text : title}>
        {heading}
      </span>
      <div className="gchips">
        {lines.map((l, i) => (
          <span key={i} className={'gchip' + (l.ok ? ' ok' : '')} title={l.text}>
            <span className="box">{l.ok ? '✓' : ''}</span>
            <span className="gtx">{l.short}</span>
            {!l.ok && l.progress !== undefined && (
              <span className="gbar">
                <i style={{ width: Math.min(100, Math.max(3, l.progress * 100)) + '%' }} />
              </span>
            )}
          </span>
        ))}
      </div>
      {snap.advance?.ready && (
        <button
          className="btn primary sm"
          title="Goals met. Advance when you are ready; you can keep evolving first."
          onClick={() => {
            audio.click();
            send({ type: 'advance' });
          }}
        >
          {snap.challengeRun ? 'Finish the challenge' : `Advance to ${snap.advance.next >= 8 ? 'the finale' : `Act ${ROMAN[snap.advance.next]}`}`}
        </button>
      )}
      <button className="btn ghost sm" onClick={() => setOpen(!open)}>
        Guide ▾
      </button>
      {open && (
        <div className="goal-drop">
          <div className="label">{snap.act >= 8 ? 'Finale' : `Act ${ROMAN[snap.act]} · ${actTitle(snap.act)}`}</div>
          <div style={{ fontWeight: 650, fontSize: 15, margin: '2px 0 8px' }}>{snap.act >= 1 && snap.act < 8 ? prettyPow(ACTS[snap.act].gate.text) : title}</div>
          {lines.map((l, i) => (
            <div key={i} className={'check' + (l.ok ? ' ok' : '')}>
              <span className="box">{l.ok ? '✓' : ''}</span>
              <div className="t">{l.text}</div>
            </div>
          ))}
          <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>When every line is ticked, an Advance button appears. There is no rush: you can keep evolving first.</div>
          {snap.advance && (
            <>
              <div className="label" style={{ marginTop: 14 }}>When you advance</div>
              <div className="muted" style={{ fontSize: 12.5, marginTop: 4, lineHeight: 1.55 }}>
                Carries over: <b style={{ color: 'var(--cur-v)' }}>{fmt(snap.advance.carry.variation)} Variation</b> (half of what you hold),{' '}
                <b style={{ color: 'var(--cur-b)' }}>{fmt(Number(snap.advance.carry.biomass))} Biomass</b> (a tenth), and{' '}
                <b style={{ color: 'var(--atp)' }}>+{fmt(snap.advance.carry.reserves)} Reserves</b> from leftover {snap.act >= 1 && snap.act < 8 ? ACTS[snap.act].blockName.toLowerCase() : 'material'}.
              </div>
              <div className="muted" style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.55 }}>
                {snap.advance.complete ? (
                  <>Every upgrade owned: advancing now gives a permanent <b>+10% Variation income</b>.</>
                ) : (
                  <>
                    Not yet owned ({snap.advance.unbought.length}): {snap.advance.unbought.slice(0, 6).join(', ')}{snap.advance.unbought.length > 6 ? `, and ${snap.advance.unbought.length - 6} more` : ''}. Own them all before advancing for a permanent +10% Variation income.
                  </>
                )}
              </div>
            </>
          )}
          {tutorialLog.length > 0 && (
            <>
              <div className="label" style={{ marginTop: 14 }}>Guide</div>
              {tutorialLog.slice(-8).map((t) => (
                <details key={t.id} style={{ padding: '5px 0', borderTop: '1px solid var(--line)' }}>
                  <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 550 }}>{t.title}</summary>
                  <div className="muted" style={{ fontSize: 12.5, margin: '5px 0 4px' }}>
                    {t.text}
                  </div>
                  {t.card && (
                    <button className="btn ghost sm" onClick={() => set({ cardOpen: t.card! })}>
                      Read the science
                    </button>
                  )}
                </details>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** The journey: Act 0 to the finale. */
function Journey() {
  const snap = useGame((s) => s.snap)!;
  return (
    <div className="journey" title="Your journey: Act 0 to the finale">
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className={'jseg' + (i < snap.act ? ' done' : i === snap.act ? ' now' : '')} title={i === 8 ? 'Finale' : `Act ${ROMAN[i]} · ${actTitle(i)}`}>
          <i />
          <b>{i === 8 ? 'F' : ROMAN[i]}</b>
        </span>
      ))}
    </div>
  );
}

function Coin({ icon, value, name, tip, color, onClick }: { icon: React.ReactNode; value: React.ReactNode; name: string; tip: React.ReactNode; color?: string; onClick?: () => void }) {
  return (
    <div className={'coin has-tip' + (onClick ? ' clickable' : '')} style={{ ['--cc' as string]: color } as React.CSSProperties} onClick={onClick}>
      {icon}
      <div className="stack">
        <span className="v">{value}</span>
        <span className="n">{name}</span>
      </div>
      <div className="tip">{tip}</div>
    </div>
  );
}

function Wallet() {
  const snap = useGame((s) => s.snap)!;
  if (snap.act === 0 && snap.act0) {
    const a = snap.act0;
    const AV = AVOGADRO_ML;
    return (
      <div className="wallet">
        <Coin color="var(--carbon)" icon={<IconBlock color="var(--carbon)" />} value={<Num value={a.org * AV} />} name="Organics" tip={<><b>Simple organics</b>, made at the vent. Spent on upgrades.</>} />
        <Coin color="var(--rna)" icon={<IconBlock color="var(--rna)" />} value={<Num value={a.nu * AV} />} name="Nucleotides" tip={<><b>Nucleotides</b>, the letters of RNA. Made in the pond from organics.</>} />
        <Coin color="var(--lipid)" icon={<IconBlock color="var(--lipid)" />} value={<Num value={a.fa * AV} />} name="Fatty acids" tip={<><b>Fatty acids</b> close into vesicles, the first compartments.</>} />
      </div>
    );
  }
  if (snap.act >= 8 && snap.finale) {
    return (
      <div className="wallet">
        <Coin color="var(--cur-v)" icon={<IconVariation size={18} />} value={<Num value={snap.finale.variation} digits={0} />} name="Variation" tip={<><b>Variation</b> grows with the diversity of life on the planet. Spend it on traits.</>} />
      </div>
    );
  }
  const act = ACTS[snap.act];
  return (
    <div className="wallet">
      <Coin
        color="var(--cur-v)"
        icon={<IconVariation size={18} />}
        value={<Num value={snap.variation} digits={1} />}
        name="Variation"
        tip={
          <>
            <b>Variation</b> is the genetic variety your population builds up as it copies itself (+{fmt(snap.vIncome, 2)}/s). Spend it in <b>Evolve</b> to make selection favour a trait.
          </>
        }
      />
      <Coin
        color="var(--cur-b)"
        icon={<IconBiomass size={18} />}
        value={<Num value={snap.biomass} />}
        name="Biomass"
        tip={
          <>
            <b>Biomass</b> is the living matter your population makes. Spend it in <b>Expand</b> to colonise new ground, so more {act.unit[1]} can live.
          </>
        }
      />
      <Coin
        color="var(--accent)"
        icon={<IconBlock size={18} color="var(--accent)" />}
        value={<Num value={snap.block} digits={0} />}
        name={act.blockName}
        tip={
          <>
            <b>{act.blockName}</b>: this act’s raw material. Some big steps need it as well as Variation. Whatever is left when the act ends is stored as Reserves.
          </>
        }
      />
      {snap.reserves > 0.5 && (
        <Coin
          color="var(--atp)"
          icon={<IconBlock size={18} color="var(--atp)" />}
          value={<Num value={snap.reserves} digits={0} />}
          name="Reserves"
          onClick={() => {
            audio.click();
            send({ type: 'reserves', amount: Math.min(snap.reserves, Math.max(20, snap.reserves * 0.25)) });
          }}
          tip={
            <>
              <b>Reserves</b>: energy and material stored from earlier acts, the way cells keep polyphosphate, glycogen or lipid droplets for hard times. <b>Click</b> to draw a quarter (at least 20) into {act.blockName.toLowerCase()}, at half efficiency.
            </>
          }
        />
      )}
    </div>
  );
}

export function TopBar() {
  const snap = useGame((s) => s.snap)!;
  return (
    <header className="top">
      <div className="brand">
        <Mark size={28} />
        <div className="actname">
          <b>{actTitle(snap.act)}</b>
          <span>{snap.act >= 8 ? 'Finale' : `Act ${ROMAN[snap.act]}`} · T+{String(Math.floor((snap.act0?.time ?? snap.actTime) / 60)).padStart(2, '0')}:{String(Math.floor((snap.act0?.time ?? snap.actTime) % 60)).padStart(2, '0')}</span>
        </div>
      </div>
      <Journey />
      <Wallet />
    </header>
  );
}

interface NavItem {
  id: Screen;
  label: string;
  icon: React.ReactNode;
}

export function Nav() {
  const snap = useGame((s) => s.snap)!;
  const screen = useGame((s) => s.screen);
  const set = useGame((s) => s.set);
  const settings = useGame((s) => s.settings);
  const setSettings = useGame((s) => s.setSettings);
  const full = useFullscreen();
  const act = snap.act;
  const items: NavItem[] = [];
  if (act === 0) items.push({ id: 'main', label: 'Vessel', icon: <IconVessel /> });
  else if (act >= 8) items.push({ id: 'main', label: 'Planet', icon: <IconPlanet /> });
  else items.push({ id: 'main', label: act === 7 ? 'Body' : 'Cells', icon: act === 7 ? <IconBody /> : <IconCell /> });
  if (act >= 1 && act < 8) {
    items.push({ id: 'map', label: 'Pathway', icon: <IconMap /> });
    items.push({ id: 'tree', label: 'Lineages', icon: <IconTree /> });
  }
  if (snap.world) items.push({ id: 'world', label: 'World', icon: <IconWorld /> });
  if (act >= 1 || snap.achievements.some((a) => a.done)) items.push({ id: 'records', label: 'Records', icon: <IconRecords /> });
  items.push({ id: 'codex', label: 'Codex', icon: <IconCodex /> });
  return (
    <nav className="nav">
      {items.map((it) => (
        <button
          key={it.id}
          className={'nav-btn' + (screen === it.id ? ' on' : '')}
          onClick={() => {
            audio.click();
            set({ screen: it.id });
          }}
        >
          {it.icon}
          {it.label}
        </button>
      ))}
      <div className="nav-spacer" />
      <button className="nav-btn" onClick={toggleFullscreen} title="Fullscreen (F)">
        <IconFullscreen on={full} />
        {full ? 'Exit full' : 'Full · F'}
      </button>
      <button className="nav-btn" onClick={() => setSettings({ muted: !settings.muted })}>
        <IconSound muted={settings.muted} />
        {settings.muted ? 'Muted' : 'Sound'}
      </button>
      <button className="nav-btn" onClick={() => set({ showSettings: true })}>
        <IconSettings />
        Settings
      </button>
    </nav>
  );
}

function Stat({ label, value, bar, color, title }: { label: React.ReactNode; value: React.ReactNode; bar?: number; color?: string; title?: string }) {
  return (
    <div className="stat" title={title}>
      <span className="label">{label}</span>
      <span className="val">{value}</span>
      {bar !== undefined && (
        <div className="bar">
          <i style={{ width: Math.max(0, Math.min(1, bar)) * 100 + '%', background: color ?? 'var(--accent)' }} />
        </div>
      )}
    </div>
  );
}

/** Bottom status strip over the hero: the few numbers that matter right now. */
export function StatusStrip() {
  const snap = useGame((s) => s.snap)!;
  if (snap.act === 0 || snap.act >= 8) return null;
  const act = ACTS[snap.act];
  const g = snap.growth * 100;
  const ecColor = snap.ec > 0.6 ? 'var(--atp)' : snap.ec > 0.3 ? 'var(--amber)' : 'var(--danger)';
  const gauges: { k: string; label: string; v: number; max: number; color: string; pct?: boolean }[] = [];
  if (snap.act === 4) {
    gauges.push({ k: 'O2', label: 'Oxygen in the air', v: snap.env.O2 ?? 0, max: 1.5, color: 'var(--oxygen)' });
    gauges.push({ k: 'H2S', label: 'Sulfide', v: snap.env.H2S ?? 0, max: 2.5, color: 'var(--sulfur)' });
  }
  if (snap.act === 6) gauges.push({ k: 'nitrate', label: 'Nitrate', v: snap.env.nitrate ?? 0, max: 2, color: 'var(--nitrogen)' });
  if (snap.act === 2) gauges.push({ k: 'H2', label: 'H₂ from the vent', v: snap.env.H2 ?? 0, max: 2, color: 'var(--nad)' });
  if (snap.act === 2) gauges.push({ k: 'vent', label: 'Vent gradient', v: snap.env.vent ?? 0, max: 1, color: 'var(--proton)' });
  if (snap.act === 3 && !(snap.cell?.flags ?? []).includes('heterotrophy')) gauges.push({ k: 'H2', label: 'H₂ left', v: snap.env.H2 ?? 0, max: 0.5, color: 'var(--nad)' });
  // what the community is doing to the world
  for (const gz of snap.world?.gauges ?? []) {
    if (!['sugar', 'lactate', 'iron', 'partner', 'waves', 'cheat'].includes(gz.id)) continue;
    gauges.push({ k: 'w' + gz.id, label: gz.label, v: gz.unit === 'pct' ? gz.v / gz.max : gz.v, max: gz.unit === 'pct' ? 1 : gz.max, color: gz.color, pct: gz.unit === 'pct' });
  }
  const day = snap.dayPhase !== null ? snap.dayPhase < 0.5 : null;
  return (
    <div className="status">
      <Stat label={act.unit[1][0].toUpperCase() + act.unit[1].slice(1)} value={<Num value={snap.P} />} />
      <Stat label="Growth" value={<span style={{ color: g < -0.01 ? 'var(--danger)' : 'var(--text)' }}>{Math.abs(g) < 0.005 ? '0.00' : (g > 0 ? '+' : '−') + Math.abs(g).toFixed(Math.abs(g) < 1 ? 2 : 1)}%/s</span>} title="Net growth of your population per second" />
      {act.network.ec && <Stat label="Energy" value={`${(snap.ec * 100).toFixed(0)}%`} bar={snap.ec} color={ecColor} title="Energy charge: how full the cells' ATP battery is. Below 25% they go dormant." />}
      <Stat label={FOOD_NAME[snap.food] ?? 'Food'} value={`${Math.min(999, snap.foodLevel * 100).toFixed(0)}%`} bar={snap.foodLevel} color="var(--carbon)" title="How much food is left in the environment, relative to the supply" />
      {gauges.map((x) => (
        <Stat key={x.k} label={x.label} value={x.pct ? `${Math.round(x.v * 100)}%` : x.v < 0.01 ? 'trace' : x.v.toFixed(2)} bar={x.v / x.max} color={x.color} />
      ))}
      {day !== null && <Stat label="Time of day" value={day ? '☀ Day' : '☾ Night'} />}
      {snap.virus?.active && <Stat label={'Virus · ' + snap.virus.name} value={<span style={{ color: 'var(--oxygen)' }}>{(snap.virus.pressure * 100).toFixed(0)}%</span>} bar={snap.virus.pressure} color="var(--oxygen)" title="A virus is attacking your commonest variant. Rarer variants escape it; a defence trait stops it." />}
    </div>
  );
}
