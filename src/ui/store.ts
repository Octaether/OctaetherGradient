import { create } from 'zustand';
import type { GameEvent, Snapshot } from '../sim/snapshot';

export type Screen = 'main' | 'map' | 'tree' | 'world' | 'records' | 'codex';
export type DrawerTab = 'evolve' | 'community' | 'expand' | 'control';

export interface Note {
  id: number;
  title: string;
  text?: string;
  color: string;
}
export interface Tutorial {
  id: string;
  title: string;
  text: string;
  card?: string;
  highlight?: string;
}
export interface Settings {
  master: number;
  music: number;
  sfx: number;
  muted: boolean;
  reducedMotion: boolean;
  labels: 'auto' | 'plain' | 'short';
}
export interface LineageMeta {
  parent: number;
  color: number;
  name: string;
  born: number;
  died?: number;
  peak: number;
  muts: string[];
  chance?: boolean; // arose by random mutation rather than your choice
  tag?: number;
}

const PREFS_KEY = 'gradient.prefs.v1';
const defaults: Settings = { master: 0.8, music: 0.7, sfx: 0.6, muted: false, reducedMotion: false, labels: 'auto' };

function loadPrefs(): { settings: Settings; seenLabels: Record<string, number> } {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return { settings: { ...defaults, ...(p.settings ?? {}) }, seenLabels: p.seenLabels ?? {} };
    }
  } catch {
    /* ignore */
  }
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return { settings: { ...defaults, reducedMotion: reduced }, seenLabels: {} };
}

type Listener = (e: GameEvent, snap: Snapshot) => void;
const listeners = new Set<Listener>();
export function onGameEvent(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export interface UIState {
  snap: Snapshot | null;
  started: boolean;
  screen: Screen;
  tab: DrawerTab;
  sel: { kind: 'rxn' | 'species' | null; id: string | null };
  notes: Note[];
  log: { n: number; title: string; color: string }[];
  tutorials: Tutorial[];
  tutorialLog: Tutorial[];
  cardOpen: string | null;
  transition: { from: number; to: number; carry?: { variation: number; biomass: string; reserves: number }; challenge?: string } | null;
  away: { seconds: number; summary: string[] } | null;
  settings: Settings;
  seenLabels: Record<string, number>;
  lineageMeta: Record<number, LineageMeta>;
  /** Recent history of every molecule in the viewed cell: one sample per in-game second, about 3 minutes. */
  concHist: { t: number[]; v: Record<string, number[]> };
  highlight: string | null;
  showSettings: boolean;
  showVirus: boolean;
  newScreens: string[];
  names: Record<string, string>;
  rename: (key: string, name: string) => void;
  ingest: (s: Snapshot) => void;
  set: (p: Partial<UIState>) => void;
  notify: (title: string, text?: string, color?: string) => void;
  dismissNote: (id: number) => void;
  dismissTutorial: () => void;
  setAway: (a: { seconds: number; summary: string[] }) => void;
  setSettings: (p: Partial<Settings>) => void;
  bumpLabel: (id: string) => void;
}

let noteId = 1;
const NAMES_KEY = 'gradient.names.v1';
function loadNames(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(NAMES_KEY) ?? '{}');
  } catch {
    return {};
  }
}
/** Key for a player-chosen variant name: survives in-place upgrades via the tag. */
export function nameKey(act: number, tag: number | undefined, id: number) {
  return `${act}:${tag ?? id}`;
}
/** The name to show for a variant: the player's name if they gave one. */
export function variantName(names: Record<string, string>, act: number, l: { id: number; tag?: number; name: string }) {
  return names[nameKey(act, l.tag, l.id)] ?? (l.name === 'Founders' ? 'Original cells' : l.name);
}
const prefs = loadPrefs();
function savePrefs(s: UIState) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ settings: s.settings, seenLabels: s.seenLabels }));
  } catch {
    /* ignore */
  }
}

const NOTE_COLOR: Record<string, string> = {
  sweep: 'var(--accent)',
  mutation: 'var(--violet)',
  event: 'var(--amber)',
  goe: 'var(--oxygen)',
  crash: 'var(--danger)',
  milestone: 'var(--light)',
  strikes: 'var(--accent)',
  toast: 'var(--text-3)',
  achievement: 'var(--atp)',
  lost: 'var(--danger)',
};

export const useGame = create<UIState>((set, get) => ({
  snap: null,
  started: false,
  screen: 'main',
  tab: 'evolve',
  sel: { kind: null, id: null },
  notes: [],
  log: [],
  tutorials: [],
  tutorialLog: [],
  cardOpen: null,
  transition: null,
  away: null,
  settings: prefs.settings,
  seenLabels: prefs.seenLabels,
  lineageMeta: {},
  concHist: { t: [], v: {} },
  highlight: null,
  showSettings: false,
  showVirus: false,
  newScreens: [],
  names: loadNames(),
  rename: (key, name) => {
    const names = { ...get().names };
    if (name.trim()) names[key] = name.trim().slice(0, 40);
    else delete names[key];
    set({ names });
    try {
      localStorage.setItem(NAMES_KEY, JSON.stringify(names));
    } catch {
      /* ignore */
    }
  },
  set: (p) => set(p),
  notify: (title, text, color = 'var(--text-3)') => {
    const n: Note = { id: noteId++, title, text, color };
    set((s) => ({ notes: [...s.notes, n].slice(-12), log: [...s.log, { n: n.id, title, color }].slice(-60) }));
  },
  dismissNote: (id) => set((s) => ({ notes: s.notes.filter((n) => n.id !== id) })),
  dismissTutorial: () => {
    const [, ...rest] = get().tutorials;
    set({ tutorials: rest, highlight: rest[0]?.highlight ?? null });
  },
  setAway: (a) => set({ away: a }),
  setSettings: (p) => {
    set((s) => ({ settings: { ...s.settings, ...p } }));
    savePrefs(get());
  },
  bumpLabel: (id) => {
    const n = (get().seenLabels[id] ?? 0) + 1;
    set((s) => ({ seenLabels: { ...s.seenLabels, [id]: n } }));
    if (n % 3 === 0) savePrefs(get());
  },
  ingest: (snap) => {
    const st = get();
    const prev = st.snap;
    const patch: Partial<UIState> = { snap };
    const newAct = !!prev && prev.act !== snap.act;
    // Lineage history for the evolution tree
    let meta = newAct ? {} : st.lineageMeta;
    if (snap.lineages.length) {
      let changed = newAct;
      const copy: Record<number, LineageMeta> = { ...meta };
      const alive = new Set<number>();
      for (const l of snap.lineages) {
        alive.add(l.id);
        const m = copy[l.id];
        if (!m) {
          copy[l.id] = { parent: l.parent, color: l.color, name: l.name, born: l.born, peak: l.freq, muts: l.muts.map((x) => x.label), chance: !!l.muts[l.muts.length - 1]?.background, tag: l.tag };
          changed = true;
        } else if (l.freq > m.peak + 0.02 || m.died !== undefined) {
          // the tree is a history: a variant keeps the parent it was born from, even after the sim re-roots it
          copy[l.id] = { ...m, peak: Math.max(m.peak, l.freq), died: undefined };
          changed = true;
        }
      }
      for (const [id, m] of Object.entries(copy)) {
        if (!alive.has(Number(id)) && m.died === undefined) {
          copy[Number(id)] = { ...m, died: snap.actTime };
          changed = true;
        }
      }
      const ids = Object.keys(copy).map(Number);
      if (ids.length > 70) {
        const doomed = ids.filter((id) => copy[id].died !== undefined && copy[id].peak < 0.05 && !ids.some((o) => copy[o].parent === id)).slice(0, ids.length - 70);
        for (const d of doomed) delete copy[d];
        changed = true;
      }
      if (changed) meta = copy;
    }
    if (meta !== st.lineageMeta) patch.lineageMeta = meta;
    // molecule history for the concentration graphs
    if (snap.cell) {
      const h = newAct ? { t: [], v: {} } : st.concHist;
      const last = h.t[h.t.length - 1];
      if (last === undefined || snap.actTime - last >= 1 || snap.actTime < last) {
        const keep = 180;
        const t = [...h.t, snap.actTime].slice(-keep);
        const v: Record<string, number[]> = {};
        snap.cell.ids.forEach((id, i) => {
          v[id] = [...(h.v[id] ?? []), snap.cell!.conc[i]].slice(-keep);
        });
        patch.concHist = { t, v };
      }
    }
    if (newAct) {
      patch.sel = { kind: null, id: null };
      patch.screen = 'main';
      patch.notes = [];
    }
    if (prev) {
      const fresh = snap.reveals.filter((r) => !prev.reveals.includes(r));
      if (fresh.length) patch.newScreens = [...st.newScreens, ...fresh];
    }
    const tutorials = newAct ? [] : [...st.tutorials];
    const tutorialLog = [...st.tutorialLog];
    for (const e of snap.events) {
      for (const fn of listeners) fn(e, snap);
      switch (e.kind) {
        case 'unlock': {
          const d = (e.data ?? {}) as { card?: string; highlight?: string };
          const tut = { id: e.id ?? String(Math.random()), title: e.title ?? '', text: e.text ?? '', card: d.card, highlight: d.highlight };
          if (!snap.seenCards.includes('tut:' + e.id)) tutorials.push(tut);
          if (!tutorialLog.some((x) => x.id === tut.id)) tutorialLog.push(tut);
          break;
        }
        case 'transition':
          // coming back from a challenge restores the game quietly
          if (!(e.data as { restored?: boolean })?.restored) patch.transition = e.data as UIState['transition'];
          break;
        case 'achievement':
        case 'lost':
          get().notify(e.title ?? '', e.text, NOTE_COLOR[e.kind]);
          break;
        case 'win':
          patch.transition = { from: 8, to: 9 };
          break;
        case 'sweep': {
          const label = (e.data as { label?: string })?.label;
          if (label) get().notify('Took over: ' + label, 'This variant now makes up most of your population.', NOTE_COLOR.sweep);
          break;
        }
        case 'toast':
          if (e.id === 'rebalance' || !e.title) break;
          get().notify(e.title, e.text, e.title.startsWith('Selection rejected') ? 'var(--danger)' : NOTE_COLOR.toast);
          break;
        case 'crash':
          // The drawer's alert already shows a crash with its fix; keep it in the history only.
          set((st2) => ({ log: [...st2.log, { n: noteId++, title: e.title ?? 'Crash', color: NOTE_COLOR.crash }].slice(-60) }));
          break;
        case 'mutation':
        case 'event':
        case 'goe':
        case 'milestone':
        case 'strikes':
          get().notify(e.title ?? '', e.text, NOTE_COLOR[e.kind]);
          break;
      }
    }
    if (tutorials.length !== st.tutorials.length || newAct) {
      patch.tutorials = tutorials;
      patch.highlight = tutorials[0]?.highlight ?? null;
    }
    if (tutorialLog.length !== st.tutorialLog.length) patch.tutorialLog = tutorialLog;
    set(patch);
  },
}));

/** Plain words first, jargon second: after a few encounters a label shortens. */
export function useLabel() {
  const labels = useGame((s) => s.settings.labels);
  const seen = useGame((s) => s.seenLabels);
  return (id: string, plain: string | undefined, short: string) => {
    if (!plain || labels === 'short') return short;
    if (labels === 'plain') return plain;
    return (seen[id] ?? 0) >= 3 ? short : plain;
  };
}
