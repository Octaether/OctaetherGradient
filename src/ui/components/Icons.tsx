// Hairline icon set, drawn to match the map grammar.
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size = 20): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
});

export const IconMap = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <circle cx="5" cy="7" r="2.2" />
    <circle cx="12" cy="16" r="3" />
    <circle cx="19" cy="7" r="2.2" />
    <path d="M7 8.2l3.2 5.4M17 8.2l-3.2 5.4M7.2 7h9.6" />
  </svg>
);
export const IconVessel = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M9 3h6M10 3v5.5L5 18a2 2 0 001.8 3h10.4a2 2 0 001.8-3l-5-9.5V3" />
    <path d="M7.5 14.5h9" />
    <circle cx="11" cy="17.5" r=".8" />
    <circle cx="14" cy="16.7" r=".6" />
  </svg>
);
export const IconSea = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <circle cx="8" cy="9" r="4" />
    <circle cx="16.5" cy="14.5" r="3.5" />
    <circle cx="8.5" cy="18" r="2" />
    <path d="M7 8.5c.6.8 1.6.8 2 0" />
  </svg>
);
export const IconPopulation = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M3 20V4M3 20h18" />
    <path d="M3 12c4 0 5-6 9-6s5 4 9 4" />
    <path d="M9 20c1-4 3-5 6-5s4 1 6 1" />
  </svg>
);
export const IconBench = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M4 20h16M6 20V10M18 20V10M4 10h16" />
    <path d="M9 10V6h6v4" />
    <circle cx="12" cy="14.5" r="2" />
  </svg>
);
export const IconNotebook = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <path d="M7 16l3-4 3 2 4-6" />
  </svg>
);
export const IconGenome = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M7 3c0 6 10 6 10 12s-10 3-10 6" />
    <path d="M17 3c0 6-10 6-10 12" />
    <path d="M8.5 6.5h7M8.5 11.5h7M9 17h6" />
  </svg>
);
export const IconCodex = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M4 5.5A2.5 2.5 0 016.5 3H20v15H6.5A2.5 2.5 0 004 20.5z" />
    <path d="M4 20.5A2.5 2.5 0 006.5 23H20" />
    <path d="M9 8h7M9 11.5h5" />
  </svg>
);
export const IconPlanet = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <circle cx="12" cy="12" r="6.5" />
    <path d="M3 15c3 2 15-2 18-6" />
  </svg>
);
/** The World: water layers over the seafloor. */
export const IconWorld = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M3 7c2-1.2 4-1.2 6 0s4 1.2 6 0 4-1.2 6 0" />
    <path d="M3 12c2-1.2 4-1.2 6 0s4 1.2 6 0 4-1.2 6 0" opacity="0.7" />
    <path d="M3 18h18" />
    <circle cx="8" cy="15" r="1" />
    <circle cx="15" cy="9.5" r="1" />
  </svg>
);
/** Records: a medal. */
export const IconRecords = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <circle cx="12" cy="14" r="5" />
    <path d="M9 9.5 7 3h4l1 3 1-3h4l-2 6.5" />
    <path d="m12 11.8.7 1.5 1.6.2-1.2 1.1.3 1.6-1.4-.8-1.4.8.3-1.6-1.2-1.1 1.6-.2z" />
  </svg>
);
export const IconBody = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <circle cx="12" cy="12" r="2.5" />
    <circle cx="12" cy="5.5" r="2" />
    <circle cx="18" cy="9" r="2" />
    <circle cx="17" cy="16" r="2" />
    <circle cx="7" cy="16" r="2" />
    <circle cx="6" cy="9" r="2" />
  </svg>
);
export const IconSound = ({ size, muted, ...p }: P & { muted?: boolean }) => (
  <svg {...base(size)} {...p}>
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
    {muted ? <path d="M16 9.5l5 5M21 9.5l-5 5" /> : <path d="M16 9a4.5 4.5 0 010 6M18.5 6.5a8 8 0 010 11" />}
  </svg>
);
export const IconSettings = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4L5.3 5.3" />
  </svg>
);
export const IconFullscreen = ({ size, on, ...p }: P & { on?: boolean }) => (
  <svg {...base(size)} {...p}>
    {on ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /> : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
  </svg>
);
export const IconClose = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
export const IconArrow = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);
export const IconDna = IconGenome;
export const IconVirus = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M12 3l7.5 4.5v9L12 21l-7.5-4.5v-9z" />
    <path d="M12 21v2M12 1v2M4.5 7.5L3 6.5M19.5 7.5L21 6.5" />
    <circle cx="12" cy="12" r="2.5" />
  </svg>
);
export const IconSpark = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M12 2v5M12 17v5M2 12h5M17 12h5M5 5l3 3M16 16l3 3M19 5l-3 3M8 16l-3 3" />
  </svg>
);
export const IconBolt = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M13 2L5 14h6l-1 8 8-12h-6z" />
  </svg>
);
export const IconLeaf = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M5 19C5 10 11 4 20 4c0 9-6 15-15 15z" />
    <path d="M5 19l8-8" />
  </svg>
);

/** The Gradient mark: a membrane ring with one charged carrier. */
export const Mark = ({ size = 28, spin = false }: { size?: number; spin?: boolean }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" style={spin ? { animation: 'spin 24s linear infinite' } : undefined}>
    <defs>
      <linearGradient id="mk" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#9d95ff" />
        <stop offset="0.55" stopColor="#7fe3cf" />
        <stop offset="1" stopColor="#ffcb6b" />
      </linearGradient>
    </defs>
    <circle cx="16" cy="16" r="10.5" fill="none" stroke="url(#mk)" strokeWidth="1.5" />
    <circle cx="16" cy="16" r="6.4" fill="none" stroke="rgba(232,228,218,.18)" strokeWidth="1" strokeDasharray="1.5 2.5" />
    <circle cx="16" cy="5.5" r="2.1" fill="#ffcb6b" />
    <circle cx="16" cy="16" r="2" fill="#7fe3cf" />
  </svg>
);

/** Variation: a double helix. */
export const IconVariation = ({ size = 16, color = 'var(--cur-v)' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round">
    <path d="M7 3c0 5 10 6 10 9s-10 4-10 9" />
    <path d="M17 3c0 5-10 6-10 9s10 4 10 9" />
    <path d="M9 7.5h6M8.5 16.5h7" opacity=".6" />
  </svg>
);
/** Biomass: a little cluster of cells. */
export const IconBiomass = ({ size = 16, color = 'var(--cur-b)' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7">
    <circle cx="9" cy="9" r="5" />
    <circle cx="16" cy="15" r="5" />
    <circle cx="9" cy="9" r="1.4" fill={color} stroke="none" />
    <circle cx="16" cy="15" r="1.4" fill={color} stroke="none" />
  </svg>
);
/** Building block: a hexagon in the act's colour. */
export const IconBlock = ({ size = 16, color = 'var(--amber)' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round">
    <path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z" />
    <circle cx="12" cy="12" r="2.2" fill={color} stroke="none" />
  </svg>
);
export const IconGoal = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.8">
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="4.5" />
    <circle cx="12" cy="12" r="1.2" fill="var(--accent)" stroke="none" />
  </svg>
);
export const IconTree = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <circle cx="5" cy="12" r="2" />
    <circle cx="19" cy="5" r="2" />
    <circle cx="19" cy="12" r="2" />
    <circle cx="19" cy="19" r="2" />
    <path d="M7 12h3c2 0 2-7 7-7M10 12h7M10 12c2 0 2 7 7 7" />
  </svg>
);
export const IconCell = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <ellipse cx="12" cy="12" rx="9" ry="7" />
    <circle cx="10" cy="11" r="2.6" />
    <path d="M15 14.5c1-.4 1.6-1 2-2" />
  </svg>
);
export const IconInfo = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v6M12 7.5v.5" />
  </svg>
);
