import type { SimResult } from "./simulate";
import type { Leg } from "./types";

/** Number of 32-bit words needed to hold N bits. */
export function wordsFor(n: number): number {
  return (n + 31) >>> 5;
}

/**
 * Build a bitset over simulations for a leg: bit s = 1 iff the leg's
 * outcome occurred in simulation s. This is the bridge from the sim to
 * correlation-aware parlay math.
 */
export function buildLegBitset(sim: SimResult, leg: Leg): Uint32Array {
  const N = sim.N;
  const words = wordsFor(N);
  const bits = new Uint32Array(words);
  const base = leg.simIndex * N;

  const set = (s: number) => {
    bits[s >>> 5] |= 1 << (s & 31);
  };

  switch (leg.market) {
    case "division":
      for (let s = 0; s < N; s++) if (sim.wonDivision[base + s]) set(s);
      break;
    case "playoffs":
      for (let s = 0; s < N; s++) if (sim.madePlayoffs[base + s]) set(s);
      break;
    case "conference":
      for (let s = 0; s < N; s++) if (sim.wonConference[base + s]) set(s);
      break;
    case "superbowl":
      for (let s = 0; s < N; s++) if (sim.wonSuperbowl[base + s]) set(s);
      break;
    case "winsOver": {
      const line = leg.line ?? 0;
      for (let s = 0; s < N; s++) if (sim.winCounts[base + s] > line) set(s);
      break;
    }
    case "winsUnder": {
      const line = leg.line ?? 0;
      for (let s = 0; s < N; s++) if (sim.winCounts[base + s] < line) set(s);
      break;
    }
  }
  return bits;
}

function popcount(x: number): number {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return (Math.imul(x, 0x01010101) >>> 24) & 0x3f;
}

/** Count sims where ALL provided bitsets are set (logical AND). */
export function jointCount(bitsets: Uint32Array[]): number {
  if (bitsets.length === 0) return 0;
  const words = bitsets[0].length;
  let count = 0;
  for (let w = 0; w < words; w++) {
    let acc = bitsets[0][w];
    for (let b = 1; b < bitsets.length && acc !== 0; b++) acc &= bitsets[b][w];
    if (acc !== 0) count += popcount(acc);
  }
  return count;
}

/** AND two bitsets into a fresh bitset. */
export function andBitset(a: Uint32Array, b: Uint32Array): Uint32Array {
  const out = new Uint32Array(a.length);
  for (let w = 0; w < a.length; w++) out[w] = a[w] & b[w];
  return out;
}

/** Count set bits in a bitset. */
export function countBits(a: Uint32Array): number {
  let c = 0;
  for (let w = 0; w < a.length; w++) if (a[w]) c += popcount(a[w]);
  return c;
}
