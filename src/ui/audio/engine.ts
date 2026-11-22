// Generative, adaptive score. Ambient, neoclassical, cinematic: vast and sparse.
// Instrumentation grows as life grows. The life motif is the soundtrack's gene:
// each act re-harmonises it and its notes mutate one at a time as lineages
// sweep, so theme-and-variations becomes descent with modification.

type Voice = 'celesta' | 'piano' | 'strings' | 'choir' | 'brass' | 'wood' | 'pluck';

interface ActSound {
  root: number; // MIDI note of tonic
  scale: number[];
  progression: number[][]; // chords as scale degrees
  motif: Voice | null;
  motif2: Voice | null;
  pad: 'none' | 'soft' | 'strings' | 'choir';
  rhythm: number; // 0 = none
  perc: boolean;
  water: number; // filtered noise level
  tempo: number;
}

const MAJ = [0, 2, 4, 5, 7, 9, 11];
const MIN = [0, 2, 3, 5, 7, 8, 10];
const DOR = [0, 2, 3, 5, 7, 9, 10];
const LYD = [0, 2, 4, 6, 7, 9, 11];
const MIX = [0, 2, 4, 5, 7, 9, 10];

const ACTS: Record<number, ActSound> = {
  0: { root: 38, scale: MIN, progression: [[0, 4], [0, 3], [0, 4], [5, 2]], motif: null, motif2: null, pad: 'none', rhythm: 0, perc: false, water: 0.5, tempo: 50 },
  1: { root: 50, scale: LYD, progression: [[0, 2, 4], [1, 3, 5], [0, 2, 4], [4, 6, 1]], motif: 'celesta', motif2: null, pad: 'soft', rhythm: 0, perc: false, water: 0.25, tempo: 56 },
  2: { root: 50, scale: MIN, progression: [[0, 2, 4], [5, 0, 2], [3, 5, 0], [4, 6, 1]], motif: 'piano', motif2: null, pad: 'strings', rhythm: 0, perc: false, water: 0.12, tempo: 60 },
  3: { root: 50, scale: DOR, progression: [[0, 2, 4], [3, 5, 0], [1, 3, 5], [4, 6, 1]], motif: 'piano', motif2: null, pad: 'strings', rhythm: 1, perc: false, water: 0.06, tempo: 76 },
  4: { root: 53, scale: LYD, progression: [[0, 2, 4], [1, 3, 5], [4, 6, 1], [5, 0, 2]], motif: 'strings', motif2: null, pad: 'choir', rhythm: 0.6, perc: false, water: 0.08, tempo: 66 },
  5: { root: 46, scale: MAJ, progression: [[0, 2, 4], [5, 0, 2], [3, 5, 0], [4, 6, 1]], motif: 'piano', motif2: 'wood', pad: 'strings', rhythm: 0.5, perc: false, water: 0.05, tempo: 64 },
  6: { root: 55, scale: MIX, progression: [[0, 2, 4], [6, 1, 3], [3, 5, 0], [0, 2, 4]], motif: 'wood', motif2: 'celesta', pad: 'strings', rhythm: 0.6, perc: false, water: 0.2, tempo: 70 },
  7: { root: 50, scale: MIN, progression: [[0, 2, 4], [5, 0, 2], [6, 1, 3], [4, 6, 1]], motif: 'brass', motif2: 'strings', pad: 'choir', rhythm: 1, perc: true, water: 0.05, tempo: 80 },
  8: { root: 50, scale: MAJ, progression: [[0, 2, 4], [4, 6, 1], [5, 0, 2], [3, 5, 0]], motif: 'piano', motif2: 'strings', pad: 'choir', rhythm: 0.7, perc: true, water: 0.3, tempo: 68 },
};

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

class Engine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  music!: GainNode;
  sfx!: GainNode;
  duck!: GainNode;
  verb!: ConvolverNode;
  verbIn!: GainNode;
  droneGain!: GainNode;
  padGain!: GainNode;
  waterGain!: GainNode;
  rhythmGain!: GainNode;
  motifGain!: GainNode;
  drones: OscillatorNode[] = [];
  droneFilter!: BiquadFilterNode;
  act = 0;
  motif = [0, 4, 2, 5, 4];
  motif2 = [4, 3, 1, 2, 0];
  level = { flux: 0.5, diversity: 0.3, crash: 0 };
  private nextChord = 0;
  private chordIdx = 0;
  private nextMotif = 6;
  private nextStep = 0;
  private step = 0;
  timer: ReturnType<typeof setInterval> | null = null;
  private settings = { master: 0.8, music: 0.7, sfx: 0.6, muted: false };
  private chord: number[] = [0, 2, 4];

  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    comp.attack.value = 0.02;
    comp.release.value = 0.4;
    this.master = ctx.createGain();
    this.master.connect(comp).connect(ctx.destination);
    this.music = ctx.createGain();
    this.duck = ctx.createGain();
    this.music.connect(this.duck).connect(this.master);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.verb = ctx.createConvolver();
    this.verb.buffer = this.impulse(6.5);
    this.verbIn = ctx.createGain();
    this.verbIn.gain.value = 0.9;
    const verbOut = ctx.createGain();
    verbOut.gain.value = 0.55;
    this.verbIn.connect(this.verb).connect(verbOut).connect(this.music);
    // layers
    this.droneGain = this.bus(0.0);
    this.padGain = this.bus(0.0);
    this.waterGain = this.bus(0.0);
    this.rhythmGain = this.bus(0.0);
    this.motifGain = this.bus(0.9);
    this.buildDrone();
    this.buildWater();
    this.applySettings();
    this.setAct(this.act, true);
    this.timer = setInterval(() => this.schedule(), 100);
  }

  private bus(v: number) {
    const g = this.ctx!.createGain();
    g.gain.value = v;
    g.connect(this.music);
    return g;
  }

  private impulse(seconds: number) {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const n = Math.random() * 2 - 1;
        lp = lp + (n - lp) * (0.25 + 0.6 * (1 - t)); // darker tail
        d[i] = lp * Math.pow(1 - t, 2.6) * (i < 300 ? i / 300 : 1);
      }
    }
    return buf;
  }

  private buildDrone() {
    const ctx = this.ctx!;
    this.droneFilter = ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.value = 320;
    this.droneFilter.Q.value = 0.6;
    this.droneFilter.connect(this.droneGain);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.035;
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = 140;
    lfo.connect(lfoAmt).connect(this.droneFilter.frequency);
    lfo.start();
    for (const [mult, type, g, det] of [
      [1, 'sine', 0.3, 0],
      [1.5, 'sine', 0.12, 3],
      [2, 'triangle', 0.06, -4],
      [0.5, 'sine', 0.22, 0],
    ] as [number, OscillatorType, number, number][]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.detune.value = det;
      (o as unknown as { mult: number }).mult = mult;
      const gg = ctx.createGain();
      gg.gain.value = g;
      o.connect(gg).connect(this.droneFilter);
      o.start();
      this.drones.push(o);
    }
  }

  private buildWater() {
    const ctx = this.ctx!;
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 700;
    bp.Q.value = 0.7;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const amt = ctx.createGain();
    amt.gain.value = 450;
    lfo.connect(amt).connect(bp.frequency);
    lfo.start();
    const g = ctx.createGain();
    g.gain.value = 0.05;
    src.connect(bp).connect(g).connect(this.waterGain);
    src.start();
  }

  setSettings(s: { master: number; music: number; sfx: number; muted: boolean }) {
    this.settings = s;
    this.applySettings();
  }
  private applySettings() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.settings.muted ? 0 : this.settings.master, t, 0.1);
    this.music.gain.setTargetAtTime(this.settings.music * 0.9, t, 0.2);
    this.sfx.gain.setTargetAtTime(this.settings.sfx * 0.7, t, 0.1);
  }

  get spec() {
    return ACTS[Math.min(this.act, 8)] ?? ACTS[0];
  }

  setAct(act: number, instant = false) {
    this.act = act;
    if (!this.ctx) return;
    const s = this.spec;
    const t = this.ctx.currentTime;
    const tc = instant ? 0.5 : 4;
    const root = mtof(s.root - 12);
    this.drones.forEach((o) => o.frequency.setTargetAtTime(root * ((o as unknown as { mult: number }).mult ?? 1), t, tc));
    this.droneGain.gain.setTargetAtTime(act === 0 ? 0.5 : 0.28, t, tc);
    this.padGain.gain.setTargetAtTime(s.pad === 'none' ? 0 : 0.55, t, tc);
    this.waterGain.gain.setTargetAtTime(s.water, t, tc);
    this.nextMotif = this.ctx.currentTime + (act === 0 ? 1e9 : 8);
  }

  setLevels(l: Partial<{ flux: number; diversity: number; crash: number }>) {
    Object.assign(this.level, l);
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const crash = this.level.crash;
    // A crash thins everything to the drone.
    this.padGain.gain.setTargetAtTime(this.spec.pad === 'none' ? 0 : 0.55 * (1 - crash * 0.9) * (0.6 + 0.6 * this.level.diversity), t, 1.5);
    this.rhythmGain.gain.setTargetAtTime(this.spec.rhythm * (1 - crash) * (0.25 + 0.75 * this.level.flux) * 0.5, t, 1.5);
    this.motifGain.gain.setTargetAtTime(0.9 * (1 - crash * 0.8), t, 1);
  }

  private scaleNote(deg: number, octave = 0) {
    const s = this.spec;
    const n = s.scale.length;
    const o = Math.floor(deg / n);
    const d = ((deg % n) + n) % n;
    return s.root + s.scale[d] + 12 * (o + octave);
  }

  /** Main look-ahead scheduler. */
  private schedule() {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const s = this.spec;
    const ahead = now + 0.35;
    // Pad chords every ~16 s with randomised voicing
    if (now >= this.nextChord - 0.2) {
      const chord = s.progression[this.chordIdx % s.progression.length];
      this.chordIdx += Math.random() < 0.8 ? 1 : 2;
      this.chord = chord;
      const dur = 14 + Math.random() * 8;
      if (s.pad !== 'none') this.padChord(chord, Math.max(now, this.nextChord), dur + 4, s.pad);
      if (this.act === 0) this.pureTone(now + Math.random() * 3);
      this.nextChord = Math.max(now, this.nextChord) + dur;
    }
    // Rhythm ostinato: density follows flux
    if (s.rhythm > 0) {
      const stepDur = 60 / s.tempo / 2;
      if (this.nextStep < now) this.nextStep = now + 0.05;
      while (this.nextStep < ahead) {
        const pat = [1, 0.35, 0.6, 0.35, 0.85, 0.35, 0.6, 0.5];
        const p = pat[this.step % 8] * (0.25 + 0.75 * this.level.flux);
        if (Math.random() < p) {
          const deg = this.chord[(this.step >> 1) % this.chord.length] + (this.step % 8 === 0 ? 0 : 7);
          this.voice('pluck', mtof(this.scaleNote(deg, -1)), this.nextStep, 0.35, this.rhythmGain, 0.5);
        }
        if (s.perc && this.step % 8 === 0) this.tom(this.nextStep, 0.5);
        if (s.perc && this.step % 4 === 2 && Math.random() < 0.6) this.shaker(this.nextStep);
        this.nextStep += stepDur * (1 + (Math.random() - 0.5) * 0.04);
        this.step++;
      }
    }
    // The life motif, with long silences between
    if (s.motif && now >= this.nextMotif) {
      this.playMotif(now + 0.1);
      this.nextMotif = now + 22 + Math.random() * 30;
    }
  }

  playMotif(t: number, big = false) {
    const s = this.spec;
    if (!this.ctx || !s.motif) return;
    const beat = 60 / s.tempo;
    const octave = s.motif === 'brass' || s.motif === 'strings' ? 0 : 1;
    this.motif.forEach((deg, i) => {
      const tt = t + i * beat * (i === this.motif.length - 1 ? 1.4 : 1) * (1 + (Math.random() - 0.5) * 0.08);
      this.voice(s.motif!, mtof(this.scaleNote(deg, octave)), tt, i === this.motif.length - 1 ? beat * 3 : beat * 1.6, this.motifGain, big ? 1 : 0.8);
    });
    if (s.motif2) {
      // the second motif interlocks, offset by half a beat
      this.motif2.forEach((deg, i) => {
        const tt = t + beat * 0.5 + i * beat * 1.05;
        this.voice(s.motif2!, mtof(this.scaleNote(deg + 2, s.motif2 === 'celesta' ? 2 : 0)), tt, beat * 1.8, this.motifGain, 0.55);
      });
    }
  }

  /** A sweep mutates one note of the motif: descent with modification. */
  mutateMotif() {
    const i = Math.floor(Math.random() * this.motif.length);
    const step = [-2, -1, 1, 2][Math.floor(Math.random() * 4)];
    this.motif = this.motif.map((d, k) => (k === i ? Math.max(-2, Math.min(9, d + step)) : d));
    try {
      localStorage.setItem('gradient.motif', JSON.stringify(this.motif));
    } catch {
      /* ignore */
    }
  }
  loadMotif() {
    try {
      const m = JSON.parse(localStorage.getItem('gradient.motif') ?? 'null');
      if (Array.isArray(m) && m.length === 5) this.motif = m;
    } catch {
      /* ignore */
    }
  }

  private padChord(chord: number[], t: number, dur: number, kind: 'soft' | 'strings' | 'choir') {
    const ctx = this.ctx!;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = kind === 'soft' ? 700 : kind === 'choir' ? 1300 : 1000;
    filt.Q.value = 0.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(kind === 'soft' ? 0.05 : 0.04, t + dur * 0.35);
    g.gain.linearRampToValueAtTime(0, t + dur);
    filt.connect(g);
    g.connect(this.padGain);
    const send = ctx.createGain();
    send.gain.value = 0.7;
    g.connect(send).connect(this.verbIn);
    const notes = chord.map((d, i) => this.scaleNote(d, i === 0 ? -1 : 0));
    notes.push(this.scaleNote(chord[0], 1));
    for (const n of notes) {
      for (const det of kind === 'soft' ? [0] : [-7, 6]) {
        const o = ctx.createOscillator();
        o.type = kind === 'soft' ? 'triangle' : 'sawtooth';
        o.frequency.value = mtof(n);
        o.detune.value = det + (Math.random() - 0.5) * 4;
        if (kind === 'choir') {
          const bp = ctx.createBiquadFilter();
          bp.type = 'bandpass';
          bp.frequency.value = 750 + Math.random() * 300;
          bp.Q.value = 2.5;
          o.connect(bp).connect(filt);
        } else o.connect(filt);
        o.start(t);
        o.stop(t + dur + 0.1);
      }
    }
  }

  private pureTone(t: number) {
    const ctx = this.ctx!;
    const harm = [3, 4, 5, 6, 8][Math.floor(Math.random() * 5)];
    const f = mtof(this.spec.root - 12) * harm;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.025, t + 2.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 9);
    o.connect(g);
    g.connect(this.verbIn);
    g.connect(this.music);
    o.start(t);
    o.stop(t + 9.2);
  }

  private voice(v: Voice, f: number, t: number, dur: number, out: AudioNode, vel = 0.8) {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    const send = ctx.createGain();
    send.gain.value = v === 'pluck' ? 0.35 : 0.8;
    g.connect(out);
    g.connect(send).connect(this.verbIn);
    const oscs: OscillatorNode[] = [];
    const add = (type: OscillatorType, freq: number, gain: number, det = 0, dest: AudioNode = g) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = det;
      const gg = ctx.createGain();
      gg.gain.value = gain;
      o.connect(gg).connect(dest);
      oscs.push(o);
      return o;
    };
    let end = t + dur;
    const a = vel * 0.16;
    switch (v) {
      case 'celesta': {
        add('sine', f, 1);
        add('sine', f * 4, 0.12);
        add('sine', f * 2.01, 0.2);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(a * 0.8, t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
        end = t + 2.3;
        break;
      }
      case 'piano': {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(2800, t);
        lp.frequency.exponentialRampToValueAtTime(700, t + 2);
        lp.connect(g);
        add('triangle', f, 0.8, 0, lp);
        add('sine', f * 2, 0.25, 2, lp);
        add('sine', f, 0.6, -3, lp);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(a, t + 0.008);
        g.gain.exponentialRampToValueAtTime(a * 0.35, t + 0.6);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 3.6);
        end = t + 3.7;
        break;
      }
      case 'strings': {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 1600;
        lp.connect(g);
        add('sawtooth', f, 0.35, -6, lp);
        add('sawtooth', f, 0.35, 7, lp);
        add('sawtooth', f / 2, 0.15, 0, lp);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(a * 0.55, t + Math.min(0.6, dur * 0.4));
        g.gain.linearRampToValueAtTime(0, t + dur + 1.2);
        end = t + dur + 1.3;
        break;
      }
      case 'choir': {
        for (const fm of [700, 1150]) {
          const bp = ctx.createBiquadFilter();
          bp.type = 'bandpass';
          bp.frequency.value = fm;
          bp.Q.value = 3;
          bp.connect(g);
          add('sawtooth', f, 0.6, (Math.random() - 0.5) * 10, bp);
        }
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(a * 0.9, t + 0.8);
        g.gain.linearRampToValueAtTime(0, t + dur + 1.5);
        end = t + dur + 1.6;
        break;
      }
      case 'brass': {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(400, t);
        lp.frequency.linearRampToValueAtTime(1800, t + 0.25);
        lp.frequency.linearRampToValueAtTime(900, t + dur);
        lp.connect(g);
        add('sawtooth', f, 0.5, -4, lp);
        add('sawtooth', f, 0.5, 5, lp);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(a * 0.6, t + 0.18);
        g.gain.linearRampToValueAtTime(0, t + dur + 0.6);
        end = t + dur + 0.7;
        break;
      }
      case 'wood': {
        const o = add('triangle', f, 0.9);
        add('sine', f * 2, 0.15);
        const vib = ctx.createOscillator();
        vib.frequency.value = 5;
        const va = ctx.createGain();
        va.gain.value = f * 0.006;
        vib.connect(va).connect(o.frequency);
        vib.start(t);
        vib.stop(t + dur + 0.6);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(a * 0.7, t + 0.09);
        g.gain.linearRampToValueAtTime(0, t + dur + 0.5);
        end = t + dur + 0.6;
        break;
      }
      case 'pluck': {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(2400, t);
        lp.frequency.exponentialRampToValueAtTime(300, t + 0.3);
        lp.connect(g);
        add('triangle', f, 1, 0, lp);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(a * 0.5, t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
        end = t + 0.5;
        break;
      }
    }
    for (const o of oscs) {
      o.start(t);
      o.stop(end);
    }
  }

  private tom(t: number, vel: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.35);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.22 * vel, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(g).connect(this.rhythmGain);
    const s = ctx.createGain();
    s.gain.value = 0.5;
    g.connect(s).connect(this.verbIn);
    o.start(t);
    o.stop(t + 0.65);
  }

  private shaker(t: number) {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * 0.08);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6000;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    src.connect(hp).connect(g).connect(this.rhythmGain);
    src.start(t);
  }

  /** Music ducks briefly under event sounds. */
  private duckMusic(amount = 0.55, time = 1.2) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.duck.gain.cancelScheduledValues(t);
    this.duck.gain.setTargetAtTime(amount, t, 0.05);
    this.duck.gain.setTargetAtTime(1, t + time, 0.6);
  }

  // ---------- UI sounds, in key ----------
  click() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const deg = [0, 2, 4][Math.floor(Math.random() * 3)];
    const f = mtof(this.scaleNote(deg, 2));
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.1);
  }

  chime(kind: 'buy' | 'unlock' | 'sweep' | 'crash' | 'event' | 'win' = 'buy') {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.01;
    const out = this.sfx;
    const play = (deg: number, dt: number, voice: Voice = 'celesta', oct = 1, dur = 1) => {
      this.voice(voice, mtof(this.scaleNote(deg, oct)), t + dt, dur, out, 0.7);
    };
    switch (kind) {
      case 'buy':
        play(0, 0);
        play(4, 0.09);
        break;
      case 'unlock':
        this.duckMusic(0.6, 1.5);
        play(0, 0);
        play(2, 0.12);
        play(4, 0.24);
        play(7, 0.4, 'celesta', 1, 2);
        break;
      case 'sweep':
        play(4, 0, 'piano', 0);
        play(7, 0.18, 'piano', 0);
        break;
      case 'crash': {
        this.duckMusic(0.35, 3);
        const o = this.ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(80, t);
        o.frequency.exponentialRampToValueAtTime(36, t + 1.2);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.25, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
        o.connect(g).connect(out);
        o.start(t);
        o.stop(t + 1.7);
        play(1, 0.1, 'strings', -1, 1.5);
        break;
      }
      case 'event':
        this.duckMusic(0.6, 1.2);
        play(0, 0, 'wood', 0, 1.2);
        play(3, 0.25, 'wood', 0, 1.6);
        break;
      case 'win':
        this.duckMusic(0.5, 6);
        [0, 2, 4, 7, 9, 11, 14].forEach((d, i) => play(d, i * 0.18, 'celesta', 1, 2));
        break;
    }
  }

  /** Scripted cue at act transitions: a slow crescendo timed to the cinematic. */
  transitionCue() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.duckMusic(0.3, 2.5);
    const chord = this.spec.progression[0];
    this.padChord(chord, t + 0.2, 9, 'strings');
    this.padChord([chord[0] + 7, chord[1] + 7], t + 1.2, 8, 'choir');
    setTimeout(() => this.playMotif(this.ctx!.currentTime + 0.1, true), 1800);
    if (this.act >= 4) [0, 0.5, 1, 1.4, 1.7, 1.9].forEach((dt, i) => this.tom(t + 2.5 + dt, 0.4 + i * 0.1));
  }

  /**
   * The spark scene (about 5.5 s): the music ducks, a chord swells while the
   * strand copies itself letter by letter (the life motif, note by note),
   * and an open chord lands as the vesicle divides in two.
   */
  sparkScene() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.duckMusic(0.15, 6);
    const prevAct = this.act;
    this.act = 1;
    const ch = this.spec.progression[0];
    this.padChord(ch, t + 0.1, 5, 'choir');
    this.motif.forEach((deg, i) => this.voice('celesta', mtof(this.scaleNote(deg, 1)), t + 0.9 + i * 0.42, 1.0, this.sfx, 0.85));
    this.padChord([ch[0] + 12, ch[1] + 12], t + 3.6, 3, 'strings');
    this.act = prevAct;
  }
}

export const audio = new Engine();
