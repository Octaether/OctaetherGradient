import Decimal from 'break_eternity.js';

export { Decimal };
export type D = Decimal;

export const D0 = () => new Decimal(0);
export const dec = (x: number | string | Decimal) => new Decimal(x);

const SUFFIX = ['', 'K', 'M', 'B', 'T'];
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
/** Superscript digits, for powers of ten in text. */
export const sup = (n: number) => (n < 0 ? '⁻' : '') + String(Math.abs(n)).split('').map((c) => SUP[+c]).join('');

/** Compact human formatting for numbers and Decimals. */
export function fmt(x: number | Decimal, digits = 2): string {
  const d = x instanceof Decimal ? x : new Decimal(x);
  if (d.sign < 0) return '−' + fmt(d.neg(), digits);
  const n = d.toNumber();
  if (Number.isFinite(n)) {
    if (n === 0) return '0';
    if (n < 1e-3) {
      const e = Math.floor(Math.log10(n));
      return (n / Math.pow(10, e)).toFixed(1) + '×10' + sup(e);
    }
    if (n < 10) return n.toFixed(digits);
    if (n < 1000) return n.toFixed(n < 100 ? 1 : 0);
    const e3 = Math.floor(Math.log10(n) / 3);
    if (e3 < SUFFIX.length) return (n / Math.pow(10, e3 * 3)).toFixed(2) + ' ' + SUFFIX[e3];
  }
  const e = d.log10().floor().toNumber();
  const m = d.div(Decimal.pow(10, e)).toNumber();
  return m.toFixed(2) + '×10' + sup(e);
}

/** Roman numerals for levels (1 → I). */
export function roman(n: number) {
  return ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n] ?? String(n);
}

export function fmtNum(n: number, digits = 2): string {
  return fmt(n, digits);
}

export function fmtTime(s: number): string {
  if (s < 60) return Math.round(s) + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm ' + String(Math.round(s % 60)).padStart(2, '0') + 's';
  const h = Math.floor(s / 3600);
  return h + 'h ' + String(Math.floor((s % 3600) / 60)).padStart(2, '0') + 'm';
}

/** Turn "10^15.2" in prose into a readable number like "1.58×10¹⁵". */
export function prettyPow(text: string): string {
  return text.replace(/10\^(-?[\d.]+)/g, (_, x: string) => fmt(Math.pow(10, parseFloat(x))));
}
