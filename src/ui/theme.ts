import type { PoolColor } from '../sim/types';

export const POOL: Record<PoolColor, string> = {
  atp: '#ffe14d',
  nad: '#2de2c4',
  proton: '#8b5cff',
  carbon: '#dfe8f1',
  oxygen: '#ff4d6d',
  light: '#fff27a',
  nitrogen: '#a8ff3e',
  rna: '#d06bff',
  lipid: '#ff9a4d',
  sulfur: '#e8d43a',
};

export const POOL_NAME: Record<PoolColor, string> = {
  atp: 'Spendable energy',
  nad: 'Electrons in transit',
  proton: 'Stored potential',
  carbon: 'Building material',
  oxygen: 'Danger, then fuel',
  light: 'Light',
  nitrogen: 'Nitrogen',
  rna: 'Information',
  lipid: 'Membrane',
  sulfur: 'Sulfur',
};

/** Muted lineage palette for the Muller plot and the protocell sea. */
export const LINEAGE = ['#00e5ff', '#ff3ec8', '#b7ff3c', '#ffb020', '#8b5cff', '#ff4d6d', '#2de2c4', '#ff8a3d', '#4d8bff', '#f4ff4d', '#c77dff', '#3dff9a'];

export interface Mood {
  bg: string;
  accent: string;
  glow: string;
}

/** Each act has its own neon theme: the accent drives buttons, tabs, focus and that act's raw material. */
export const MOODS: Record<number, Mood> = {
  0: { bg: '#08070d', accent: '#8b5cff', glow: 'rgba(139,92,255,0.12)' },
  1: { bg: '#06090c', accent: '#00e5ff', glow: 'rgba(0,229,255,0.1)' },
  2: { bg: '#060a09', accent: '#00ffb2', glow: 'rgba(0,255,178,0.09)' },
  3: { bg: '#0b0807', accent: '#ff8a3d', glow: 'rgba(255,138,61,0.09)' },
  4: { bg: '#0b0a06', accent: '#ffd84d', glow: 'rgba(255,216,77,0.08)' },
  5: { bg: '#07080e', accent: '#4d7cff', glow: 'rgba(77,124,255,0.11)' },
  6: { bg: '#060b07', accent: '#2dff7a', glow: 'rgba(45,255,122,0.09)' },
  7: { bg: '#0c0708', accent: '#ff5f6d', glow: 'rgba(255,95,109,0.09)' },
  8: { bg: '#060a0c', accent: '#9ff6ff', glow: 'rgba(159,246,255,0.09)' },
};

/** "r g b" for use as rgb(var(--acc) / a) in CSS. */
export function rgbTriplet(hex: string) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(' ');
}

export const RUST = '#140a09';

/** Font stacks for canvas text (CSS uses the same families via variables). */
export const MONO = '"JetBrains Mono Variable", "JetBrains Mono", monospace';
export const SANS = '"Inter Variable", Inter, sans-serif';

export const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'Finale'];

export const ACT_TITLES: Record<number, { title: string; quote: string; era: string }> = {
  0: { title: 'The spark', quote: 'Empty, before anything.', era: 'Prebiotic chemistry: simple organics, nucleotides, fatty-acid vesicles' },
  8: { title: 'Biosphere', quote: 'The whole journey, closing the loop.', era: 'Producers, consumers, microbes and viruses on light alone' },
};

export function mix(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function lerpColor(a: string, b: string, t: number): string {
  const pa = a.replace('#', '');
  const pb = b.replace('#', '');
  const c = [0, 2, 4].map((i) => Math.round(parseInt(pa.slice(i, i + 2), 16) * (1 - t) + parseInt(pb.slice(i, i + 2), 16) * t));
  return '#' + c.map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Colour of a World species: purple sulfur bacteria are purple, cyanobacteria blue-green. */
export function guildColor(g: { id: string; color: string; look?: string }) {
  if (g.id === 'photo') return g.look === 'purple' ? '#c45cff' : '#4de8b0';
  if (g.id === 'body' && g.look === 'seaweed') return '#7ddc5a';
  return (POOL as Record<string, string>)[g.color] ?? '#dfe8f1';
}
