import { RNG } from './rng.js'

// ─── Core Interface ───────────────────────────────────────────────────────────

/** A probability distribution that can produce samples given an RNG. */
export interface Distribution<T = number> {
  sample(rng: RNG): T
}

/** A parameter that is either a fixed value or a sampled distribution. */
export type DistParam<T> = T | Distribution<T>

function isDistribution<T>(p: DistParam<T>): p is Distribution<T> {
  return typeof p === 'object' && p !== null && 'sample' in p
}

/** Resolves a DistParam to a concrete value at sample time. */
function resolve<T>(p: DistParam<T>, rng: RNG): T {
  return isDistribution(p) ? p.sample(rng) : p
}

// ─── Uniform ─────────────────────────────────────────────────────────────────

/** Uniform distribution over [lo, hi). */
export class Uniform implements Distribution<number> {
  constructor(
    private readonly lo: DistParam<number>,
    private readonly hi: DistParam<number>,
  ) {}

  sample(rng: RNG): number {
    const lo = resolve(this.lo, rng)
    const hi = resolve(this.hi, rng)
    return lo + rng.next() * (hi - lo)
  }
}

// ─── Pareto ───────────────────────────────────────────────────────────────────

/** Pareto distribution. Output >= xMin. */
export class Pareto implements Distribution<number> {
  constructor(
    private readonly xMin: DistParam<number>,
    private readonly alpha: DistParam<number>,
  ) {}

  sample(rng: RNG): number {
    const xMin = resolve(this.xMin, rng)
    const alpha = resolve(this.alpha, rng)
    const u = rng.next()
    // Inverse CDF: xMin / (1 - u)^(1/alpha)
    return xMin / Math.pow(1 - u, 1 / alpha)
  }
}

// ─── Beta ─────────────────────────────────────────────────────────────────────

/** Beta distribution via Johnk's method. Output in [0, 1]. */
export class Beta implements Distribution<number> {
  constructor(
    private readonly alpha: DistParam<number>,
    private readonly beta: DistParam<number>,
  ) {}

  sample(rng: RNG): number {
    const alpha = resolve(this.alpha, rng)
    const beta = resolve(this.beta, rng)
    const x = this._gamma(alpha, rng)
    const y = this._gamma(beta, rng)
    return x / (x + y)
  }

  /** Gamma(shape, 1) via Marsaglia-Tsang or simple method. */
  private _gamma(shape: number, rng: RNG): number {
    if (shape < 1) {
      return this._gamma(1 + shape, rng) * Math.pow(rng.next(), 1 / shape)
    }
    const d = shape - 1 / 3
    const c = 1 / Math.sqrt(9 * d)
    for (;;) {
      let x: number
      let v: number
      do {
        x = this._normalSample(rng)
        v = 1 + c * x
      } while (v <= 0)
      v = v * v * v
      const u = rng.next()
      if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v
    }
  }

  private _normalSample(rng: RNG): number {
    const u = rng.next()
    const v = rng.next()
    return Math.sqrt(-2 * Math.log(u + 1e-300)) * Math.cos(2 * Math.PI * v)
  }
}

// ─── LogNormal ────────────────────────────────────────────────────────────────

/** Log-Normal distribution via Box-Muller. */
export class LogNormal implements Distribution<number> {
  constructor(
    private readonly mu: DistParam<number>,
    private readonly sigma: DistParam<number>,
  ) {}

  sample(rng: RNG): number {
    const mu = resolve(this.mu, rng)
    const sigma = resolve(this.sigma, rng)
    const u1 = rng.next()
    const u2 = rng.next()
    const z = Math.sqrt(-2 * Math.log(u1 + 1e-300)) * Math.cos(2 * Math.PI * u2)
    return Math.exp(mu + sigma * z)
  }
}

// ─── Normal ───────────────────────────────────────────────────────────────────

/** Normal (Gaussian) distribution via Box-Muller. */
export class Normal implements Distribution<number> {
  constructor(
    private readonly mu: DistParam<number>,
    private readonly sigma: DistParam<number>,
  ) {}

  sample(rng: RNG): number {
    const mu = resolve(this.mu, rng)
    const sigma = resolve(this.sigma, rng)
    const u1 = rng.next()
    const u2 = rng.next()
    const z = Math.sqrt(-2 * Math.log(u1 + 1e-300)) * Math.cos(2 * Math.PI * u2)
    return mu + sigma * z
  }
}

// ─── Exponential ─────────────────────────────────────────────────────────────

/** Exponential distribution. */
export class Exponential implements Distribution<number> {
  constructor(private readonly mean: DistParam<number>) {}

  sample(rng: RNG): number {
    const mean = resolve(this.mean, rng)
    return -mean * Math.log(rng.next() + 1e-300)
  }
}

// ─── Poisson ──────────────────────────────────────────────────────────────────

/** Poisson distribution via Knuth's algorithm. */
export class Poisson implements Distribution<number> {
  constructor(private readonly lambda: DistParam<number>) {}

  sample(rng: RNG): number {
    const lambda = resolve(this.lambda, rng)
    if (lambda <= 0) return 0
    const L = Math.exp(-lambda)
    let k = 0
    let p = 1
    do {
      k++
      p *= rng.next()
    } while (p > L)
    return k - 1
  }
}

// ─── Categorical ──────────────────────────────────────────────────────────────

/** Categorical distribution: picks one item with given weights. */
export class Categorical<T> implements Distribution<T> {
  private readonly cumWeights: number[]
  private readonly total: number

  constructor(
    private readonly items: readonly T[],
    weights: readonly DistParam<number>[],
  ) {
    // Pre-resolve only constant weights; variable weights sampled at call time
    // Here we require items.length === weights.length
    this.cumWeights = weights.map(Number) as number[]
    let sum = 0
    for (let i = 0; i < this.cumWeights.length; i++) {
      sum += this.cumWeights[i] ?? 0
      this.cumWeights[i] = sum
    }
    this.total = sum
  }

  sample(rng: RNG): T {
    const r = rng.next() * this.total
    for (let i = 0; i < this.cumWeights.length; i++) {
      if (r < (this.cumWeights[i] ?? 0)) {
        return this.items[i] as T
      }
    }
    return this.items[this.items.length - 1] as T
  }
}

// ─── Constant ─────────────────────────────────────────────────────────────────

/** Constant distribution — always returns the same value. */
export class Constant<T> implements Distribution<T> {
  constructor(private readonly value: T) {}

  sample(_rng: RNG): T {
    return this.value
  }
}

// ─── Derived ──────────────────────────────────────────────────────────────────

/** Derived distribution — applies an arbitrary function using the RNG. */
export class Derived<T> implements Distribution<T> {
  constructor(private readonly fn: (rng: RNG) => T) {}

  sample(rng: RNG): T {
    return this.fn(rng)
  }
}
