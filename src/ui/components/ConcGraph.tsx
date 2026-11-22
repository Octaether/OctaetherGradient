// A molecule's recent level inside the cell, with the levels at which it
// switches something on or off (from the pathway's regulation constants) and
// the level at which it becomes harmful (from the act's damage terms).
import { useGame } from '../store';
import { ACTS } from '../../content';
import { POOL } from '../theme';
import { fmt } from '../../sim/num';

export interface Threshold {
  value: number;
  text: string;
  kind: 'act' | 'inh' | 'harm';
}

/** Every level that matters for this molecule in the current act. */
export function thresholdsFor(act: number, id: string): Threshold[] {
  const spec = ACTS[act];
  if (!spec) return [];
  const out: Threshold[] = [];
  for (const r of spec.network.reactions)
    for (const m of r.mods ?? [])
      if (m.species === id) out.push({ value: m.K, kind: m.type, text: m.type === 'act' ? `above ${fmtC(m.K)}: switches on ${r.short}` : `above ${fmtC(m.K)}: slows ${r.short}` });
  for (const d of spec.damage ?? [])
    if (d.species === id && d.k > 0) {
      const v = spec.pacing.delta0 / d.k;
      out.push({ value: v, kind: 'harm', text: `above ${fmtC(v)}: harmful, doubles the death rate` });
    }
  return out;
}

export function fmtC(c: number) {
  if (c < 1e-8) return '≈ 0';
  return c >= 1 ? c.toFixed(2) + ' mM' : c >= 0.001 ? (c * 1000).toFixed(c >= 0.01 ? 0 : 1) + ' µM' : fmt(c * 1e6, 2) + ' nM';
}

const LINE: Record<Threshold['kind'], string> = { act: '#9fe0a8', inh: '#ff8f8f', harm: '#ff3b5c' };

export function ConcGraph({ id, width = 280, height = 64, compact = false }: { id: string; width?: number; height?: number; compact?: boolean }) {
  const hist = useGame((s) => s.concHist);
  const act = useGame((s) => s.snap?.act ?? 0);
  const spec = ACTS[act];
  const sp = spec?.network.species.find((x) => x.id === id);
  const col = sp ? POOL[sp.pool] : '#ffffff';
  const ys = hist.v[id] ?? [];
  const th = thresholdsFor(act, id);
  if (ys.length < 2) return <div className="faint" style={{ fontSize: 11 }}>Collecting history…</div>;
  const max = Math.max(...ys, ...th.map((x) => x.value * 1.15), 1e-9);
  const pad = compact ? 1 : 4;
  const x = (i: number) => pad + (i / (ys.length - 1)) * (width - pad * 2);
  const y = (v: number) => height - pad - (Math.min(v, max) / max) * (height - pad * 2);
  const d = ys.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ display: 'block', overflow: 'visible' }}>
        <rect x={0} y={0} width={width} height={height} fill="rgba(255,255,255,0.03)" />
        {th.map((t, i) => (
          <line key={i} x1={0} x2={width} y1={y(t.value)} y2={y(t.value)} stroke={LINE[t.kind]} strokeOpacity={0.7} strokeDasharray="3 3" />
        ))}
        <path d={`${d}L${x(ys.length - 1)},${height}L${x(0)},${height}Z`} fill={col} fillOpacity={0.12} />
        <path d={d} fill="none" stroke={col} strokeWidth={1.3} />
        <circle cx={x(ys.length - 1)} cy={y(ys[ys.length - 1])} r={2.4} fill={col} />
      </svg>
      {!compact && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-4)', fontFamily: 'var(--mono)', marginTop: 2 }}>
          <span>{Math.round((hist.t[hist.t.length - 1] - hist.t[Math.max(0, hist.t.length - ys.length)]) / 60) || '<1'} min ago</span>
          <span>now {fmtC(ys[ys.length - 1])}</span>
        </div>
      )}
      {!compact &&
        th.map((t, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, color: 'var(--text-2)', marginTop: 3 }}>
            <span style={{ width: 12, borderTop: `1px dashed ${LINE[t.kind]}` }} />
            {t.text}
          </div>
        ))}
    </div>
  );
}
