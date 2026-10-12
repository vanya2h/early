import type { RNG } from '../rng.js'

/** World is a forward-declared interface to avoid circular imports. */
export interface WorldLike {
  readonly tick: number
}

let _actorCounter = 0

/** Generates a unique actor ID. */
export function nextActorId(prefix: string): string {
  return `${prefix}-${++_actorCounter}`
}

/**
 * Abstract base class for all simulation actors.
 * Holds accounting fields and forces subclasses to implement `step`.
 */
export abstract class Actor {
  readonly id: string
  usdcBalance: number
  totalUsdcEarned: number = 0
  totalUsdcSpent: number = 0
  realizedPnl: number = 0
  unrealizedPnl: number = 0

  constructor(id: string, usdcBalance: number) {
    this.id = id
    this.usdcBalance = usdcBalance
  }

  /** Execute one simulation tick. */
  abstract step(world: unknown, rng: RNG): void
}
