// Shareable genomes: a design exports as a short string. The histogram compares
// your design with an imported one and with random designs drawn from the same
// set of adaptations (an honest stand-in for "other players" with no server).
import type { Game } from './game';
import { compile, paramsFor, steadyState, carrierFlux } from './cell';
import { Rng } from './rng';
import type { Mutation } from './types';

export function encodeDesign(act: number, ids: string[]): string {
  const json = JSON.stringify({ a: act, m: ids });
  const b64 = btoa(unescape(encodeURIComponent(json))).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return 'GRD1-' + b64;
}

export function decodeDesign(code: string): { act: number; ids: string[] } | null {
  try {
    const s = code.trim().replace(/^GRD1-/, '').replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(escape(atob(s + '==='.slice((s.length + 3) % 4))));
    const o = JSON.parse(json);
    if (typeof o.a !== 'number' || !Array.isArray(o.m)) return null;
    return { act: o.a, ids: o.m.map(String) };
  } catch {
    return null;
  }
}

export interface DesignPoint {
  flux: number; // growth relative to the founders
  atpCost: number; // ATP spent per new cell (relative)
  enzymes: number;
  label: string;
}

export function designs(game: Game, code?: string): {
  code: string;
  mine: DesignPoint | null;
  imported: DesignPoint | null;
  random: DesignPoint[];
  error?: string;
} {
  const act = game.act;
  const a = game.s.a;
  if (!act || !a) return { code: '', mine: null, imported: null, random: [] };
  const dom = game.dominant();
  const ids = dom.muts.filter((m) => m.adaptation).map((m) => m.adaptation!) as string[];
  const myCode = encodeDesign(act.index, ids);
  const evalIds = (list: string[], label: string): DesignPoint => {
    const muts: Mutation[] = [];
    for (const id of list) {
      const ad = act.adaptations.find((x) => x.id === id);
      if (ad) muts.push({ id: id + muts.length, adaptation: id, label: ad.name, effects: ad.effects });
    }
    const p = paramsFor(act.network, { muts }, a.flags);
    game.finishParams(p);
    const { key, foodIn } = game.foodKey();
    const { c, s } = compile(act.network, p, { ...a.env, [key]: foodIn });
    const ss = steadyState(c, s);
    const carrier = carrierFlux(c, ss.v);
    const enzymes = c.rx.filter((r) => act.network.reactions[r.idx].gene).length;
    return { flux: ss.mu / a.ref.mu, atpCost: carrier / Math.max(ss.mu, 1e-9) / (a.ref.carrier / a.ref.mu), enzymes, label };
  };
  const mine = evalIds(ids, 'You');
  let imported: DesignPoint | null = null;
  let error: string | undefined;
  if (code) {
    const d = decodeDesign(code);
    if (!d) error = 'That string is not a Gradient design.';
    else if (d.act !== act.index) error = `That design is from Act ${d.act}; you are in Act ${act.index}.`;
    else imported = evalIds(d.ids, 'Imported');
  }
  // Random designs: the same number of purchases drawn at random from what
  // the act offers, respecting prerequisites.
  const rng = new Rng(act.index * 7919 + ids.length);
  const random: DesignPoint[] = [];
  const n = Math.max(3, ids.length);
  for (let k = 0; k < 48; k++) {
    const chosen: string[] = [];
    const counts: Record<string, number> = {};
    for (let tries = 0; tries < n * 6 && chosen.length < n; tries++) {
      const ad = rng.pick(act.adaptations);
      if (ad.needsFlag && !a.flags.includes(ad.needsFlag) && !ids.includes(ad.id)) continue;
      if ((ad.requires ?? []).some((r) => !chosen.includes(r))) continue;
      if ((counts[ad.id] ?? 0) >= (ad.levels ?? 1)) continue;
      if ((ad.excludes ?? []).some((x) => chosen.includes(x))) continue;
      counts[ad.id] = (counts[ad.id] ?? 0) + 1;
      chosen.push(ad.id);
    }
    random.push(evalIds(chosen, 'Random'));
  }
  return { code: myCode, mine, imported, random, error };
}
