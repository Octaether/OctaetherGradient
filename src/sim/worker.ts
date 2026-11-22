/// <reference lib="webworker" />
// The simulation lives here. The UI never mutates sim state: it sends
// commands and renders snapshots (about 10 per second).
import { Game } from './game';
import type { GameState } from './state';
import { ACTS } from '../content';
import type { Command } from './snapshot';
import { designs } from './designs';

let game: Game | null = null;
let last = 0;
let snapAcc = 0;
let timer: ReturnType<typeof setInterval> | null = null;

function post(msg: unknown) {
  (self as unknown as Worker).postMessage(msg);
}

function loop() {
  if (!game) return;
  const now = performance.now();
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 8) {
    // The tab slept: treat the gap as offline time.
    const away = game.offline(dt);
    if (away.summary.length) post({ type: 'away', away });
    dt = 0.05;
  }
  dt = Math.min(dt, 0.5);
  try {
    game.tick(dt);
  } catch (e) {
    post({ type: 'error', message: String((e as Error)?.stack ?? e) });
  }
  snapAcc += dt;
  if (snapAcc >= 0.16) {
    snapAcc = 0;
    post({ type: 'snap', snap: game.snapshot() });
  }
}

self.onmessage = (e: MessageEvent) => {
  const m = e.data;
  switch (m.type) {
    case 'init': {
      game = new Game(ACTS, (m.save as GameState) ?? null, m.seed);
      let away = null;
      if (m.save && m.away > 30) away = game.offline(m.away);
      last = performance.now();
      post({ type: 'ready', away });
      post({ type: 'snap', snap: game.snapshot() });
      if (timer) clearInterval(timer);
      timer = setInterval(loop, 50);
      break;
    }
    case 'cmd': {
      if (!game) return;
      try {
        const r = game.command(m.cmd as Command);
        if (m.id) post({ type: 'result', id: m.id, result: r === undefined ? null : JSON.parse(JSON.stringify(r)) });
      } catch (err) {
        post({ type: 'error', message: String(err) });
      }
      break;
    }
    case 'designs': {
      if (!game) return;
      post({ type: 'result', id: m.id, result: designs(game, m.code) });
      break;
    }
    case 'save': {
      if (!game) return;
      post({ type: 'save', id: m.id, state: game.serialize() });
      break;
    }
  }
};
