// Bridge to the simulation worker. Saves are versioned JSON, compressed, in
// localStorage, with an export string. Offline progress is computed on load.
import LZ from 'lz-string';
import type { Command, Snapshot } from '../sim/snapshot';
import type { GameState } from '../sim/state';
import { useGame } from './store';

const SAVE_KEY = 'gradient.save.v1';
let worker: Worker | null = null;
let reqId = 1;
const pending = new Map<number, (v: unknown) => void>();
let lastSave: GameState | null = null;
let saveTimer: ReturnType<typeof setInterval> | null = null;

export function hasSave(): boolean {
  try {
    return !!localStorage.getItem(SAVE_KEY);
  } catch {
    return false;
  }
}

export function loadSave(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const json = LZ.decompressFromUTF16(raw);
    return json ? (JSON.parse(json) as GameState) : null;
  } catch {
    return null;
  }
}

function writeSave(state: GameState) {
  lastSave = state;
  try {
    localStorage.setItem(SAVE_KEY, LZ.compressToUTF16(JSON.stringify(state)));
  } catch {
    /* storage full or blocked: keep playing */
  }
}

export function exportSave(): string {
  const s = lastSave ?? loadSave();
  return s ? LZ.compressToBase64(JSON.stringify(s)) : '';
}

export function importSave(code: string): boolean {
  try {
    const json = LZ.decompressFromBase64(code.trim());
    if (!json) return false;
    const s = JSON.parse(json) as GameState;
    if (!s || typeof s.act !== 'number') return false;
    writeSave(s);
    return true;
  } catch {
    return false;
  }
}

/** Dev: restore a saved slot right away (no offline catch-up). */
export function loadSlot(code: string): boolean {
  try {
    const json = LZ.decompressFromBase64(code.trim());
    if (!json) return false;
    const s = JSON.parse(json) as GameState;
    s.saved = Date.now();
    writeSave(s);
    useGame.setState({ lineageMeta: {} });
    startSim(false);
    return true;
  } catch {
    return false;
  }
}

/** Dev: `?dev&act=3` starts a fresh game straight in that act, with currencies granted. */
export function devBoot(): boolean {
  if (typeof location === 'undefined' || !/[?&]dev/.test(location.search)) return false;
  const m = location.search.match(/[?&]act=(\d+)/);
  if (!m) return false;
  const act = Math.min(8, Math.max(0, Number(m[1])));
  startSim(true);
  setTimeout(() => {
    send({ type: 'dev', jump: act });
    send({ type: 'dev', grant: true });
  }, 300);
  return true;
}

export function wipeSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
  lastSave = null;
}

export function startSim(fresh: boolean) {
  if (worker) worker.terminate();
  worker = new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' });
  const save = fresh ? null : loadSave();
  const away = save ? Math.max(0, (Date.now() - (save.saved || Date.now())) / 1000) : 0;
  worker.onmessage = (e) => {
    const m = e.data;
    switch (m.type) {
      case 'snap':
        useGame.getState().ingest(m.snap as Snapshot);
        break;
      case 'ready':
        if (m.away && m.away.summary?.length) useGame.getState().setAway(m.away);
        break;
      case 'away':
        useGame.getState().setAway(m.away);
        break;
      case 'save':
        writeSave(m.state as GameState);
        pending.get(m.id)?.(m.state);
        pending.delete(m.id);
        break;
      case 'result':
        pending.get(m.id)?.(m.result);
        pending.delete(m.id);
        break;
      case 'error':
        console.error('[sim]', m.message);
        break;
    }
  };
  worker.postMessage({ type: 'init', save, away, seed: Math.floor(Math.random() * 1e9) });
  if (saveTimer) clearInterval(saveTimer);
  saveTimer = setInterval(() => requestSave(), 15000);
}

export function send(cmd: Command) {
  worker?.postMessage({ type: 'cmd', cmd });
}

export function ask<T = unknown>(cmd: Command): Promise<T> {
  return new Promise((res) => {
    const id = reqId++;
    pending.set(id, res as (v: unknown) => void);
    worker?.postMessage({ type: 'cmd', cmd, id });
  });
}

export function askDesigns<T = unknown>(code?: string): Promise<T> {
  return new Promise((res) => {
    const id = reqId++;
    pending.set(id, res as (v: unknown) => void);
    worker?.postMessage({ type: 'designs', code, id });
  });
}

export function requestSave(): Promise<unknown> {
  return new Promise((res) => {
    const id = reqId++;
    pending.set(id, res);
    worker?.postMessage({ type: 'save', id });
  });
}

if (typeof window !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') requestSave();
  });
  window.addEventListener('beforeunload', () => {
    if (lastSave) {
      lastSave.saved = Date.now();
      try {
        localStorage.setItem(SAVE_KEY, LZ.compressToUTF16(JSON.stringify(lastSave)));
      } catch {
        /* ignore */
      }
    }
  });
}

// Dev hook for automated screenshots (only with ?dev in the URL).
if (typeof location !== 'undefined' && /[?&]dev/.test(location.search)) Object.assign(globalThis, { __send: send, __ui: useGame });
