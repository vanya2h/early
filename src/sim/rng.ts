/**
 * Xoshiro128+ seeded pseudo-random number generator.
 * Deterministic given the same seed; pass by injection for reproducible Monte Carlo runs.
 */
export class RNG {
  private s: [number, number, number, number]

  constructor(seed: number) {
    // SplitMix32 to initialise the four state words from a single seed
    let h = seed >>> 0
    const sm = (): number => {
      h = (h + 0x9e3779b9) >>> 0
      let v = h
      v = Math.imul(v ^ (v >>> 16), 0x85ebca6b) >>> 0
      v = Math.imul(v ^ (v >>> 13), 0xc2b2ae35) >>> 0
      return (v ^ (v >>> 16)) >>> 0
    }
    this.s = [sm(), sm(), sm(), sm()]
  }

  /** Returns a float in [0, 1). */
  next(): number {
    const [s0, s1, s2, s3] = this.s
    const result = ((s0 + s3) >>> 0)
    const t = (s1 << 9) >>> 0
    // Compute new state using intermediate values (not the captured old ones)
    const ns2 = (s2 ^ s0) >>> 0
    const ns3 = (s3 ^ s1) >>> 0
    this.s[0] = (s0 ^ ns3) >>> 0
    this.s[1] = (s1 ^ ns2) >>> 0
    this.s[2] = (ns2 ^ t) >>> 0
    this.s[3] = ((ns3 << 11) | (ns3 >>> 21)) >>> 0   // rotl(ns3, 11)
    return result / 4294967296
  }

  /** Returns a random integer in [min, max] inclusive. */
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min
  }

  /** Returns a new shuffled copy of the array (Fisher-Yates). */
  shuffle<T>(arr: readonly T[]): T[] {
    const out = arr.slice()
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1))
      const tmp = out[i]
      const jv = out[j]
      if (tmp !== undefined && jv !== undefined) {
        out[i] = jv
        out[j] = tmp
      }
    }
    return out
  }
}
