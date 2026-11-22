// Numbers that roll instead of jump, in tabular monospace so counters never
// jitter as digits change.
import { useEffect, useRef, useState } from 'react';
import { Decimal, fmt } from '../../sim/num';

export function useRolling(target: number, ms = 450): number {
  const [v, setV] = useState(target);
  const from = useRef(target);
  const start = useRef(0);
  const goal = useRef(target);
  const raf = useRef(0);
  useEffect(() => {
    if (!Number.isFinite(target)) {
      setV(target);
      return;
    }
    from.current = v;
    goal.current = target;
    start.current = performance.now();
    cancelAnimationFrame(raf.current);
    const step = (t: number) => {
      const k = Math.min(1, (t - start.current) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      // roll in log space for big ranges
      const a = from.current;
      const b = goal.current;
      let x: number;
      if (a > 0 && b > 0 && Math.abs(Math.log10(b / a)) > 0.3) x = Math.pow(10, Math.log10(a) + (Math.log10(b) - Math.log10(a)) * e);
      else x = a + (b - a) * e;
      setV(x);
      if (k < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, ms]);
  return v;
}

export function Num({ value, digits = 2, className = '' }: { value: number | string; digits?: number; className?: string }) {
  const isStr = typeof value === 'string';
  const d = isStr ? new Decimal(value) : null;
  const n = d ? d.toNumber() : (value as number);
  const finite = Number.isFinite(n) && n < 1e300;
  const rolled = useRolling(finite ? n : 0);
  return <span className={'num ' + className}>{finite ? fmt(rolled, digits) : fmt(d ?? new Decimal(value as number), digits)}</span>;
}

export function Pct({ value, className = '' }: { value: number; className?: string }) {
  const r = useRolling(value);
  return <span className={'num ' + className}>{(r * 100).toFixed(0)}%</span>;
}
