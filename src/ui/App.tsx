import { Component, Suspense, lazy, useEffect, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useGame, onGameEvent } from './store';
import { Title } from './Title';
import { TopBar, Nav, StatusStrip, GoalBar } from './components/Chrome';
import { Panel } from './components/Panel';
import { AlertBanner, AwayModal, CardModal, Notifications, SettingsModal, TransitionCinematic, TutorialCard } from './components/Overlays';
import { Vessel } from './screens/vessel/Vessel';
import { CellView } from './screens/CellView';
import { VirusGame } from './screens/VirusGame';

// Screens beyond the first view load on demand, so the opening download stays small.
const TreeView = lazy(() => import('./screens/TreeView').then((m) => ({ default: m.TreeView })));
const MapScreen = lazy(() => import('./screens/MapView').then((m) => ({ default: m.MapScreen })));
const Body = lazy(() => import('./screens/Body').then((m) => ({ default: m.Body })));
const Planet = lazy(() => import('./screens/Planet').then((m) => ({ default: m.Planet })));
const Codex = lazy(() => import('./screens/Codex').then((m) => ({ default: m.Codex })));
const WorldView = lazy(() => import('./screens/WorldView').then((m) => ({ default: m.WorldView })));
const Records = lazy(() => import('./screens/Records').then((m) => ({ default: m.Records })));
import { audio } from './audio/engine';
import { toggleFullscreen, useMobile } from './hooks';
import { devBoot } from './simClient';
import { DevPanel } from './components/DevPanel';
import { MOODS, POOL, RUST, lerpColor, mix, rgbTriplet } from './theme';
import type { Snapshot } from '../sim/snapshot';

export function App() {
  const started = useGame((s) => s.started);
  const settings = useGame((s) => s.settings);
  useEffect(() => {
    audio.setSettings(settings);
  }, [settings]);
  useEffect(() => {
    document.documentElement.classList.toggle('reduced', settings.reducedMotion);
  }, [settings.reducedMotion]);
  useEffect(() => wireAudio(), []);
  useEffect(() => {
    if (devBoot()) useGame.getState().set({ started: true });
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // F toggles fullscreen (not while typing a name)
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if ((e.key === 'f' || e.key === 'F') && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        toggleFullscreen();
        return;
      }
      if (e.key === 'Escape') {
        const s = useGame.getState();
        if (s.cardOpen) s.set({ cardOpen: null });
        else if (s.showSettings) s.set({ showSettings: false });
        else if (s.showVirus) s.set({ showVirus: false });
        else if (s.sel.id) s.set({ sel: { kind: null, id: null } });
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  return (
    <>
      <AnimatePresence>{!started && <Title key="title" />}</AnimatePresence>
      {started && <Game />}
      {started && <DevPanel />}
    </>
  );
}

/** How far through the current act you are (0..1), for the backdrop. */
function progress(s: Snapshot) {
  if (s.act === 0 && s.act0) return Math.min(1, s.act0.L / 45);
  if (s.finale) return Math.min(1, s.finale.stable / Math.max(1, s.finale.win));
  const g = s.gate;
  if (!g) return 0;
  const conds = g.conds.length ? g.conds.filter((c) => c.ok).length / g.conds.length : 1;
  const flux = g.fluxNeed > 0 ? Math.min(1, Math.max(0, (s.flux - (g.fluxNeed - 3)) / 3)) : 1;
  return Math.max(0, Math.min(1, 0.5 * conds + 0.5 * flux));
}

const FOOD_POOL: Record<string, keyof typeof POOL> = {
  H2: 'nad',
  glucose: 'carbon',
  light: 'light',
  organics: 'carbon',
  prey: 'oxygen',
  food: 'carbon',
  nucleotides: 'rna',
};

/** Soft pools of colour behind everything. They drift toward the next act's colour as you progress, dim when food runs short, and follow day and night. */
function Backdrop({ snap }: { snap: Snapshot }) {
  const act = Math.min(snap.act, 8);
  const mood = MOODS[act] ?? MOODS[0];
  const next = MOODS[Math.min(8, act + 1)] ?? mood;
  const p = progress(snap);
  let bg = lerpColor(mood.bg, next.bg, p * 0.5);
  if (snap.act === 4 && snap.goe > 0) bg = lerpColor(bg, RUST, snap.goe);
  const day = snap.dayPhase === null ? 1 : 0.55 + 0.45 * Math.max(0, Math.sin(snap.dayPhase * Math.PI * 2));
  const c1 = lerpColor(mood.accent, next.accent, p * 0.75);
  const food = Math.max(0.15, Math.min(1, snap.foodLevel || 0.6));
  const c2 = POOL[FOOD_POOL[snap.food] ?? 'carbon'];
  const stress = snap.alert?.kind === 'crash' ? 1 : 0;
  return (
    <div className="backdrop" style={{ background: bg }}>
      <div className="blob" style={{ left: '-12%', top: '-30%', background: `radial-gradient(circle, ${mix(c1, 0.22 * day)}, transparent 62%)` }} />
      <div className="blob b2" style={{ right: '-18%', bottom: '-38%', background: `radial-gradient(circle, ${mix(stress ? '#ff8a8a' : c2, (stress ? 0.16 : 0.1) * food * day)}, transparent 62%)` }} />
      <div className="blob" style={{ left: '30%', top: '20%', width: '40vmax', height: '40vmax', opacity: 0.35 + 0.4 * p, background: `radial-gradient(circle, ${mix(next.accent, 0.1 * p)}, transparent 65%)`, animationDuration: '95s' }} />
    </div>
  );
}

function Game() {
  const snap = useGame((s) => s.snap);
  const screen = useGame((s) => s.screen);
  const sheet = useGame((s) => s.sheet);
  const mobile = useMobile();
  if (!snap) {
    return (
      <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center' }} className="faint">
        Waking the chemistry…
      </div>
    );
  }
  const wide = screen === 'codex';
  const showStatus = screen === 'main' || screen === 'map';
  return (
    <div
      className={'app' + (wide ? ' wide' : '') + (sheet ? ' sheet-open' : '')}
      style={{ ['--accent' as string]: (MOODS[Math.min(snap.act, 8)] ?? MOODS[1]).accent, ['--acc' as string]: rgbTriplet((MOODS[Math.min(snap.act, 8)] ?? MOODS[1]).accent) } as React.CSSProperties}
    >
      <Backdrop snap={snap} />
      <TopBar />
      <GoalBar />
      <Nav />
      <main className="hero">
        <AnimatePresence mode="wait">
          <motion.div key={screen + ':' + snap.act} style={{ position: 'absolute', inset: 0 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            <Boundary key={screen + snap.act}>
              <Suspense fallback={null}>
                <ScreenBody screen={screen} act={snap.act} />
              </Suspense>
            </Boundary>
          </motion.div>
        </AnimatePresence>
        {showStatus && <StatusStrip />}
        {screen !== 'codex' && <Notifications />}
        {mobile && !wide && (
          <div className="m-cards">
            <TutorialCard />
            <AlertBanner />
          </div>
        )}
      </main>
      {!wide && (
        <Boundary fallback={<aside className="drawer" />}>
          <Panel />
        </Boundary>
      )}
      <CardModal />
      <AwayModal />
      <SettingsModal />
      <VirusGame />
      <TransitionCinematic />
    </div>
  );
}

function ScreenBody({ screen, act }: { screen: string; act: number }) {
  if (screen === 'codex') return <Codex />;
  if (screen === 'records') return <Records />;
  if (screen === 'world') return <WorldView />;
  if (screen === 'map' && act >= 1 && act < 8) return <MapScreen />;
  if (screen === 'tree' && act >= 1 && act < 8) return <TreeView />;
  if (act === 0) return <Vessel />;
  if (act === 7) return <Body />;
  if (act >= 8) return <Planet />;
  return <CellView />;
}

/** Game events drive the adaptive score. */
function wireAudio() {
  let lastAct = -1;
  const offEvents = onGameEvent((e) => {
    switch (e.kind) {
      case 'unlock':
        audio.chime('unlock');
        break;
      case 'sweep':
        audio.mutateMotif();
        audio.chime('sweep');
        break;
      case 'mutation':
        audio.chime('sweep');
        break;
      case 'crash':
        audio.chime('crash');
        break;
      case 'event':
      case 'goe':
        audio.chime('event');
        break;
      case 'milestone':
      case 'achievement':
        audio.chime('unlock');
        break;
      case 'lost':
        audio.chime('crash');
        break;
      case 'spark':
        audio.sparkScene();
        break;
    }
  });
  const offState = useGame.subscribe((s) => {
    const snap = s.snap;
    if (!snap) return;
    if (snap.act !== lastAct) {
      if (lastAct === -1) audio.setAct(snap.act, true);
      lastAct = snap.act;
    }
    const nLin = snap.lineages.length;
    audio.setLevels({
      flux: snap.gate ? Math.max(0, Math.min(1, snap.flux / snap.gate.fluxNeed)) : snap.act0 ? Math.min(1, snap.act0.L / 45) : 0.6,
      diversity: Math.min(1, nLin / 6),
      crash: snap.alert?.kind === 'crash' ? 1 : 0,
    });
  });
  return () => {
    offEvents();
    offState();
  };
}

class Boundary extends Component<{ children: ReactNode; fallback?: ReactNode }, { err: string | null }> {
  state = { err: null as string | null };
  static getDerivedStateFromError(e: Error) {
    return { err: e.message };
  }
  componentDidCatch(e: Error) {
    console.error('[ui]', e);
  }
  render() {
    if (this.state.err && this.props.fallback) return this.props.fallback;
    if (this.state.err)
      return (
        <div className="faint" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
          <div>
            This view hit a snag and was reset.
            <div style={{ marginTop: 12 }}>
              <button className="btn sm" onClick={() => this.setState({ err: null })}>
                Try again
              </button>
            </div>
          </div>
        </div>
      );
    return this.props.children;
  }
}
