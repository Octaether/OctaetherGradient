// Headless bot players (greedy / random / idle) for pacing. Usage:
//   npx tsx scripts/bot.ts [bot=greedy] [startAct=0] [endAct=8] [maxHours=40]
import { Game } from '../src/sim/game';
import { FINALE_INDEX } from '../src/sim/state';
import { ACTS } from '../src/content';
import { ACT0_UPGRADES, canAfford0 } from '../src/sim/act0';
import { FINALE_TRAITS, traitCost } from '../src/sim/finale';
import { Rng } from '../src/sim/rng';

const bot = process.argv[2] ?? 'greedy';
const startAct = Number(process.argv[3] ?? 0);
const endAct = Number(process.argv[4] ?? 8);
const maxHours = Number(process.argv[5] ?? 40);
const seed = Number(process.argv[6] ?? 1);
const verbose = process.env.V === '1';

const g = new Game(ACTS, null, seed);
const rng = new Rng(seed * 7 + 1);
if (startAct > 0) g.jumpTo(startAct);
const dt = 0.5;
let t = 0;
let actStart = 0;
let lastEvent = 0;
let longestQuiet = 0;
let nextAct = -1;
const log = (...a: unknown[]) => console.log(`[${(t / 60).toFixed(1)}m]`, ...a);
let decisionT = 0;
while (t < maxHours * 3600) {
  const before = g.s.a ? JSON.stringify({ P: g.s.a.P, env: g.s.a.env, f: g.s.a.lineages.map((l) => [l.id, l.freq, l.drive]) }) : '';
  g.tick(dt);
  t += dt;
  if (process.env.NANCHECK && g.s.a && !Number.isFinite(Number(g.s.a.P))) {
    console.log('NaN after tick at', t, 'before:', before);
    console.log('after:', JSON.stringify({ P: g.s.a.P, env: g.s.a.env, f: g.s.a.lineages.map((l) => [l.id, l.freq, l.drive, l.name]) }));
    const d = (g as any).derived;
    console.log([...d.perLineage.entries()].map(([k, v]: any) => k + ' mu=' + v.mu + ' d=' + v.delta + ' ec=' + v.ec).join(' ; '));
    process.exit(1);
  }
  const act = g.s.act;
  if (act !== nextAct) {
    if (nextAct >= 0) log(`=== Act ${nextAct} done in ${((t - actStart) / 60).toFixed(1)} min; longest quiet ${(longestQuiet / 60).toFixed(1)} min`);
    if (act > endAct) break;
    nextAct = act;
    actStart = t;
    longestQuiet = 0;
    lastEvent = t;
  }
  const snapEvents = (g as any).events as { kind: string; title?: string; text?: string }[];
  for (const e of snapEvents) {
    if (['sweep', 'unlock', 'purchase', 'event', 'milestone', 'mutation', 'crash', 'goe', 'win'].includes(e.kind)) {
      longestQuiet = Math.max(longestQuiet, t - lastEvent);
      lastEvent = t;
      if (verbose || ['unlock', 'event', 'milestone', 'crash', 'goe', 'win'].includes(e.kind)) log(e.kind, e.title ?? '', e.kind === 'crash' ? e.text : '');
      if (e.kind === 'crash' && process.env.DUMPCRASH && !(globalThis as any).dumped) {
        (globalThis as any).dumped = true;
        const sn = g.snapshot();
        const c = sn.cell!;
        console.log('CRASH DUMP env', JSON.stringify(sn.env), 'chores', JSON.stringify(sn.chores.map((x) => [x.id, x.value, x.automated])));
        console.log(' dominant muts:', sn.lineages.find((l) => l.id === sn.dominant)!.muts.map((m) => m.label).join(' | '));
        console.log(' conc:', c.ids.map((id, i) => id + '=' + c.conc[i].toPrecision(3)).join(' '));
        console.log(' flux:', c.rx.map((id, i) => id + '=' + c.v[i].toPrecision(3)).join(' '));
      }
    }
  }
  (g as any).events = [];
  decisionT -= dt;
  if (process.env.DUMPAT && Math.abs(t - Number(process.env.DUMPAT) * 60) < dt / 2) {
    const sn = g.snapshot();
    console.log('DUMP block', sn.block.toFixed(1), 'V', sn.variation.toFixed(0));
    for (const l of g.s.a!.lineages) console.log('  lin', l.id, 'parent', l.parent, 'freq', l.freq.toFixed(4), 'drive', !!l.drive, l.muts.filter((m) => m.adaptation).map((m) => m.adaptation).join(','));
    for (const s of sn.shop) console.log('  shop', s.id.padEnd(14), s.state.padEnd(10), 'cost', s.cost.toFixed(0), 'block', s.block, 'afford', s.affordable, 'rej', s.rejected);
  }
  if (bot === 'idle' || decisionT > 0) continue;
  decisionT = bot === 'random' ? 20 : 5;
  if (act === 0) {
    const s0 = g.s.act0;
    if (s0.cycleT <= 0) g.command({ type: 'act0', action: 'cycle' });
    if ((s0.up.ice ?? 0) > 0 && s0.freezeT <= 0) g.command({ type: 'act0', action: 'freeze' });
    const opts = ACT0_UPGRADES.filter((u) => canAfford0(s0, u));
    if (opts.length) g.command({ type: 'act0', action: 'buy', id: bot === 'random' ? rng.pick(opts).id : opts[0].id });
    continue;
  }
  if (act >= FINALE_INDEX) {
    const f = g.s.finale!;
    const opts = FINALE_TRAITS.filter((x) => (f.traits[x.id] ?? 0) < x.levels && f.variation >= traitCost(x, f.traits[x.id] ?? 0));
    if (opts.length) g.command({ type: 'finaleBuy', id: bot === 'random' ? rng.pick(opts).id : opts.sort((a, b) => traitCost(a, f.traits[a.id] ?? 0) - traitCost(b, f.traits[b.id] ?? 0))[0].id });
    if (f.won) { log('WIN'); break; }
    continue;
  }
  const snap = g.snapshot();
  (g as any).events = snap.events; // keep events for logging
  // chores
  for (const ch of snap.chores) {
    if (ch.automated) continue;
    if (ch.control === 'choice') {
      const o = ch.options.find((o) => !o.chosen && o.affordable);
      if (o) g.command({ type: 'chore', id: ch.id, value: o.id });
    } else if (ch.control === 'toggle') {
      const spec = ACTS[act].chores.find((c) => c.id === ch.id)!;
      const want = choose(g, spec.id, ch.options.map((o) => o.id));
      if (want && want !== ch.value) g.command({ type: 'chore', id: ch.id, value: want });
    }
  }
  // buy adaptations
  // Retry rejected traits only when rich (a player would retry too).
  const avail = snap.shop.filter((s) => s.state === 'available' && s.affordable && (s.rejected < 2 || snap.variation > s.cost * 5));
  if (avail.length) {
    let pick = avail.sort((a, b) => a.cost - b.cost)[0];
    if (bot === 'greedy') {
      const top = snap.cell?.bottleneck;
      const struct = avail.filter((s) => ['gene', 'tier', 'regulator', 'stage', 'defence'].includes(s.kind));
      const cc = snap.cell?.control ?? {};
      const useful = avail.filter((s) => !s.target || (cc[s.target] ?? 0) > 0.08 || s.target === top);
      // Save up for an unaffordable structural step instead of spending on tuning.
      const saving = snap.shop.some((s) => s.state === 'available' && !s.affordable && s.rejected < 2 && ['gene', 'tier', 'regulator', 'stage', 'defence'].includes(s.kind) && snap.block >= s.block && s.cost > snap.variation && s.cost <= snap.variation + snap.vIncome * 300);
      const fid = avail.find((s) => s.id === 'a1-fid');
      if (fid && (snap.genome?.errorRatio ?? 0) > 0.85) pick = fid;
      else if (struct.length) pick = struct.sort((a, b) => a.cost - b.cost)[0];
      else if (useful.length && !saving) pick = useful.sort((a, b) => (cc[b.target!] ?? 0) / b.cost - (cc[a.target!] ?? 0) / a.cost)[0];
      else pick = null as any;
    } else if (bot === 'random') pick = rng.pick(avail);
    if (pick) {
      g.command({ type: 'select', lineage: snap.dominant });
      g.command({ type: 'buy', id: pick.id });
    }
  }
  for (const n of snap.niches) if (n.affordable) g.command({ type: 'niche', id: n.id });
  // community traits: found and move species first, then improve them when there is spare Variation
  const wt = snap.worldTraits.filter((x) => x.state === 'available' && x.affordable);
  const urgent = wt.filter((x) => x.founds || x.relocate !== undefined || x.id === 'w7-seaweed');
  const spare = wt.filter((x) => !x.founds && x.relocate === undefined && !x.id.startsWith('w7-') && snap.variation > x.cost * (bot === 'greedy' ? 2.5 : 1));
  for (const x of [...urgent, ...spare.sort((p, q) => p.cost - q.cost).slice(0, 1)]) g.command({ type: 'worldBuy', id: x.id });
  if (snap.advance?.ready) {
    const adv = snap.advance;
    log(`ready after ${((t - actStart) / 60).toFixed(1)} min · unbought ${adv.unbought.length}${adv.unbought.length ? ' (' + adv.unbought.join(', ') + ')' : ''} · carry V ${adv.carry.variation.toFixed(0)}, reserves +${adv.carry.reserves.toFixed(0)}`);
    g.command({ type: 'advance' });
  }
  if (verbose && Math.floor(t) % 600 === 0 && process.env.SHOP) {
    log('shop', snap.shop.filter((s) => s.state !== 'owned').map((s) => `${s.id}:${s.state}${s.affordable ? '$' : ''} c${Math.round(s.cost)} b${s.block} rej${s.rejected} sh${s.share.toFixed(2)} needs[${s.needs.join('|')}]`).join('  '));
  }
  if (process.env.WORLD && Math.floor(t) % 60 === 0 && snap.world) {
    const w = snap.world;
    log(`world ${w.guilds.map((x) => `${x.id}${x.alive ? '' : '✝'}:${x.B.toFixed(2)}@${x.layer}`).join(' ')} | ${Object.entries(w.res).map(([k, v]) => k + ':' + (v as number).toFixed(2)).join(' ')} | coexist ${w.coexist} occ ${(snap as any).world ? '' : ''}x=${(g as any).derived.occupancy.toFixed(2)} wmu=${(g as any).worldMu.toFixed(2)} wd=${(g as any).worldDelta.toFixed(3)} waves=${w.waves?.toFixed(2) ?? '-'} flux=${snap.flux.toFixed(2)}/${snap.gate?.fluxNeed} gate=${snap.gate?.conds.map((c) => (c.ok ? '✓' : '✗') + c.text.slice(0, 24)).join(', ')}`);
  }
  if (verbose && Math.floor(t) % 120 === 0) {
    log(`env=${Object.entries(snap.env).map(([k, v]) => k + ':' + (v as number).toFixed(2)).join(',')} P=1e${Math.log10(Number(snap.P)).toFixed(2)} flux=${snap.flux.toFixed(2)}/${snap.gate?.fluxNeed} V=${snap.variation.toFixed(0)} food=${snap.foodLevel.toFixed(2)} ec=${snap.ec.toFixed(2)} lineages=${snap.lineages.length} gate=${snap.gate?.conds.map((c) => (c.ok ? '✓' : '✗') + c.text).join(', ')}`);
  }
}
log('end', 'act', g.s.act, 'total', (t / 3600).toFixed(2), 'h');
if (g.s.act >= 1 && g.s.act < FINALE_INDEX) {
  const sn = g.snapshot();
  log('gate at end:', `flux ${sn.flux.toFixed(2)}/${sn.gate?.fluxNeed}`, (sn.gate?.conds ?? []).map((c) => (c.ok ? '✓' : '✗') + c.text).join(', '), `V ${sn.variation.toFixed(0)} food ${sn.foodLevel.toFixed(2)}`);
}

function choose(g: Game, id: string, opts: string[]): string | null {
  // Chore heuristics: pick the option with highest growth right now (cheap probe via stat)
  const a = g.s.a!;
  if (id === 'diet') return (a.env.glucose ?? 0) > 0.15 ? 'sugar' : 'fix';
  if (id === 'daynight') return g.snapshot().dayPhase! < 0.5 ? 'day' : 'night';
  return opts[0];
}
