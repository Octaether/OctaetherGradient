// How many wet–dry cycles does the spark take? (For the "Lucky strike" achievement.)
import { Game } from '../../src/sim/game';
import { ACTS } from '../../src/content';
import { ACT0_UPGRADES, canAfford0 } from '../../src/sim/act0';
for (const style of ['clicker', 'idle-geyser']) {
  for (const seed of [1, 2, 3]) {
    const g = new Game(ACTS, null, seed);
    let t = 0;
    while (g.s.act === 0 && t < 3 * 3600) {
      g.tick(0.5);
      t += 0.5;
      const s0 = g.s.act0;
      if (style === 'clicker' && s0.cycleT <= 0) g.command({ type: 'act0', action: 'cycle' });
      if ((s0.up.ice ?? 0) > 0 && s0.freezeT <= 0 && style === 'clicker') g.command({ type: 'act0', action: 'freeze' });
      const opts = ACT0_UPGRADES.filter((u) => canAfford0(s0, u));
      if (opts.length) g.command({ type: 'act0', action: 'buy', id: opts[0].id });
    }
    console.log(style, 'seed', seed, 'spark at', (t / 60).toFixed(1), 'min, cycles', g.s.records.sparkCycles ?? g.s.act0.cycles, 'achievements', g.s.achievements.join(','));
  }
}
