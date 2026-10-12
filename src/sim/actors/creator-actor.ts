import type { CreatorCohort, CreatorActor as CreatorActorData } from '../../models.js'
import { Actor, nextActorId } from './actor.js'
import type { RNG } from '../rng.js'
import type { World } from '../world.js'

/** Simulation actor for an app creator. */
export class CreatorActor extends Actor {
  readonly cohort: CreatorCohort
  ownedAppIds: string[]
  readonly reinvestmentRate: number
  readonly vestingSellFraction: number
  readonly marketingSpendMultiplier: number

  constructor(opts: {
    cohort: CreatorCohort
    usdcBalance: number
    reinvestmentRate: number
    vestingSellFraction: number
    marketingSpendMultiplier: number
  }) {
    super(nextActorId('creator'), opts.usdcBalance)
    this.cohort = opts.cohort
    this.ownedAppIds = []
    this.reinvestmentRate = opts.reinvestmentRate
    this.vestingSellFraction = opts.vestingSellFraction
    this.marketingSpendMultiplier = opts.marketingSpendMultiplier
  }

  override step(world: unknown, rng: RNG): void {
    const w = world as World
    // Every 30 ticks, claim payouts from owned apps
    if (w.tick % 30 === 0) {
      for (const appId of this.ownedAppIds) {
        const market = w.getApp(appId)
        if (!market) continue
        const payout = market.claimPayout(this.id)
        if (payout > 0) {
          this.usdcBalance += payout
          this.totalUsdcEarned += payout
        }
      }
    }
    void rng // suppress unused param warning
  }

  snapshot(): CreatorActorData {
    return {
      type: 'Creator',
      id: this.id,
      usdcBalance: this.usdcBalance,
      totalUsdcEarned: this.totalUsdcEarned,
      totalUsdcSpent: this.totalUsdcSpent,
      realizedPnl: this.realizedPnl,
      unrealizedPnl: this.unrealizedPnl,
      cohort: this.cohort,
      ownedAppIds: this.ownedAppIds.slice(),
      reinvestmentRate: this.reinvestmentRate,
      vestingSellFraction: this.vestingSellFraction,
      marketingSpendMultiplier: this.marketingSpendMultiplier,
    }
  }
}
