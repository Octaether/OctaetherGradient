// The RNA strand panel: spark chance, average length on the same scale as the
// Flory distribution of lengths, and how rare 45-letter strands are.
import { fmt, sup } from '../../../sim/num';
import { AVOGADRO_ML as AV } from '../../../sim/act0';
import { POOL } from '../../theme';
import type { Act0Snap } from '../../../sim/snapshot';

/** One colour per length band, shared by the chart, the bars and the sample. */
export const REP = '#ff5e8a';
export function lenColor(L: number) {
  return L >= 45 ? REP : L >= 20 ? POOL.rna : 'rgba(205,179,255,0.5)';
}

/**
 * Strand lengths at a glance: the average length on the same scale as the
 * distribution under it, how rare 45-letter strands are, and the spark chance.
 */
export function StrandChart({ a }: { a: Act0Snap }) {
  const W = 220;
  const G = 30; // gutter for the y labels
  const N = 60;
  const bw = (W - G) / N;
  const x = (L: number) => Math.min(W, G + (L - 0.5) * bw);
  const p = Math.min(0.9999, Math.max(0.0001, a.p));
  const lp = Math.log10(p);
  const l1 = Math.log10(1 - p);
  // the scale reaches just past the rarest length shown, so the fall-off always reads
  const lo = Math.max(-24, Math.min(-3, Math.floor(l1 + (N - 1) * lp - 0.5)));
  const mid = Math.round(lo / 2);
  const top = 12;
  const H = 40; // chart height
  const yOf = (lg: number) => top + H - Math.max(0, Math.min(1, (lg - lo) / -lo)) * H;
  const strands = (a.rna / Math.max(1, a.L)) * AV;
  const long = strands * a.longShare;
  const ready = a.spark.ready;
  const chance = 1 - Math.exp(-a.spark.lambda);
  const needs = a.L < 6 ? 'needs avg 6+' : a.ves < 40 ? 'needs 40 vesicles' : a.rna <= 0.05 ? 'needs RNA' : 'not yet';
  const bars = [];
  for (let L = 1; L <= N; L++) {
    const y = yOf(l1 + (L - 1) * lp);
    bars.push(<rect key={L} x={G + (L - 1) * bw + 0.3} y={y} width={Math.max(0.8, bw - 0.6)} height={top + H - y} fill={lenColor(L)} />);
  }
  const avgX = x(Math.min(N, a.L));
  return (
    <div className="strandchart">
      <div className="sc-row" style={{ marginTop: 0 }} title="Chance that a self-copying strand appears inside a vesicle within the next minute">
        <span>Spark / min</span>
        <b className="num" style={{ color: ready ? REP : 'var(--text-3)', fontWeight: ready ? 600 : 500 }}>{ready ? `${(chance * 100).toFixed(chance < 0.1 ? 1 : 0)}%` : needs}</b>
      </div>
      <div className="sc-bar">
        <i style={{ width: (ready ? Math.max(0.02, chance) : 0) * 100 + '%' }} />
      </div>
      <div className="sc-row big">
        <span>Average length</span>
        <b className="num">{a.L.toFixed(1)} nt</b>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${top + H + 13}`} style={{ display: 'block', overflow: 'visible' }}>
        {/* average length as a bar on the same scale as the chart below */}
        <rect x={G} y={2} width={W - G} height={4} fill="rgba(255,255,255,0.08)" />
        <rect x={G} y={2} width={Math.max(0, avgX - G)} height={4} fill={POOL.rna} />
        <text x={G - 3} y={7} fill="rgba(255,255,255,0.45)" fontSize={7} textAnchor="end" fontFamily="JetBrains Mono, monospace">
          AVG
        </text>
        <line x1={x(6)} x2={x(6)} y1={0} y2={8} stroke="rgba(255,255,255,0.5)" />
        <line x1={x(45)} x2={x(45)} y1={0} y2={8} stroke={REP} />
        {/* the 45+ zone */}
        <rect x={x(45) - bw / 2} y={top} width={W - x(45) + bw / 2} height={H} fill={REP} fillOpacity={0.07} />
        {[0, mid, lo].map((lg) => (
          <g key={lg}>
            <line x1={G} x2={W} y1={yOf(lg)} y2={yOf(lg)} stroke="rgba(255,255,255,0.07)" />
            <text x={G - 3} y={yOf(lg) + 3} fill="rgba(255,255,255,0.45)" fontSize={7} textAnchor="end" fontFamily="JetBrains Mono, monospace">
              {lg === 0 ? '1' : '10' + sup(lg)}
            </text>
          </g>
        ))}
        {bars}
        <line x1={x(45) - bw / 2} x2={x(45) - bw / 2} y1={top} y2={top + H} stroke={REP} strokeDasharray="2 2" />
        {/* where the average sits */}
        <line x1={avgX} x2={avgX} y1={2} y2={top + H} stroke="rgba(255,255,255,0.75)" strokeWidth={0.8} />
        <line x1={G} x2={W} y1={top + H} y2={top + H} stroke="rgba(255,255,255,0.25)" />
        {[1, 10, 20, 30, 45, 60].map((L) => (
          <text key={L} x={x(L)} y={top + H + 10} fill={L === 45 ? REP : 'rgba(255,255,255,0.45)'} fontSize={8} textAnchor="middle" fontFamily="JetBrains Mono, monospace">
            {L}
          </text>
        ))}
      </svg>
      <div className="sc-key" title={`Bar height: the share of strands of each length (log scale). Each next letter joins with chance p = ${p.toFixed(3)}; wet–dry cycles raise p.`}>
        <span>
          <i style={{ background: lenColor(1) }} />
          &lt;20
        </span>
        <span>
          <i style={{ background: lenColor(20) }} />
          20–44
        </span>
        <span style={{ color: REP }}>
          <i style={{ background: REP }} />
          45+ copies
        </span>
      </div>
      <div className="sc-note">Bar = share at that length · join chance p = {p.toFixed(2)}</div>
      <div className="sc-row" title={long >= 1 ? `${fmt(long)} strands of 45+ letters in the pond right now` : 'Not one strand of 45+ letters in the pond yet'}>
        <span>
          45+ <span className="faint">· {long >= 1 ? `${fmt(long)} now` : 'none yet'}</span>
        </span>
        <b className="num" style={{ color: long >= 1 ? REP : undefined }}>{a.longShare > 0 ? '1 in ' + fmt(1 / a.longShare) : 'none'}</b>
      </div>
    </div>
  );
}
