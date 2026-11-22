import type { ActSpec, ScienceCard } from '../sim/types';
import act1 from './acts/act1.json';
import act2 from './acts/act2.json';
import act3 from './acts/act3.json';
import act4 from './acts/act4.json';
import act5 from './acts/act5.json';
import act6 from './acts/act6.json';
import act7 from './acts/act7.json';
import cards from './cards.json';

export const ACTS: Record<number, ActSpec> = {
  1: act1 as unknown as ActSpec,
  2: act2 as unknown as ActSpec,
  3: act3 as unknown as ActSpec,
  4: act4 as unknown as ActSpec,
  5: act5 as unknown as ActSpec,
  6: act6 as unknown as ActSpec,
  7: act7 as unknown as ActSpec,
};

export const CARDS: Record<string, ScienceCard> = Object.fromEntries((cards as ScienceCard[]).map((c) => [c.id, c]));
