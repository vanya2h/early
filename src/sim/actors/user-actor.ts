import { UserCohort } from '../../models.js'
import type { AcquisitionChannel, UserActor as UserActorData } from '../../models.js'
import { Actor, nextActorId } from './actor.js'
import type { RNG } from '../rng.js'
import { Poisson } from '../distributions.js'
import type { World } from '../world.js'

/** Simulation actor representing a platform user who pays per request. */
export class UserActor extends Actor {
  readonly cohort: UserCohort
  readonly priceThreshold: number
  readonly dailyRequestLambda: number
  readonly acquisitionChannel: AcquisitionChannel

  constructor(opts: {
    cohort: UserCohort
    usdcBalance: number
    priceThreshold: number
    dailyRequestLambda: number
    acquisitionChannel: AcquisitionChannel
  }) {
    super(nextActorId('user'), opts.usdcBalance)
    this.cohort = opts.cohort
    this.priceThreshold = opts.priceThreshold
    this.dailyRequestLambda = opts.dailyRequestLambda
    this.acquisitionChannel = opts.acquisitionChannel
  }

  // Probability of visiting any given app in a single tick.
  // Keeps per-user spending predictable across a growing app catalogue.
  private static readonly VISIT_PROB: Record<UserCohort, number> = {
    [UserCohort.PowerUser]: 0.65,
    [UserCohort.Casual]: 0.25,
    [UserCohort.PrivacyConscious]: 0.40,
    [UserCohort.Trial]: 0.15,
  }

  override step(world: unknown, rng: RNG): void {
    const w = world as World
    const requestDist = new Poisson(this.dailyRequestLambda)
    const visitProb = UserActor.VISIT_PROB[this.cohort] ?? 0.25

    for (const app of w.apps) {
      const d = app.data
      if (!d.isOnline) continue
      if (rng.next() > visitProb) continue      // cohort-based app affinity

      const pricePerRequest = d.pricingPerRequest
      if (pricePerRequest > this.priceThreshold) continue
      if (this.usdcBalance <= 0) break

      const requests = requestDist.sample(rng)
      if (requests <= 0) continue

      const cost = requests * pricePerRequest
      const actual = Math.min(cost, this.usdcBalance)
      const actualRequests = Math.floor(actual / pricePerRequest)
      if (actualRequests <= 0) continue

      const totalCost = actualRequests * pricePerRequest
      this.usdcBalance -= totalCost
      this.totalUsdcSpent += totalCost
      app.recordRequest(this.id, totalCost, w.tick)
    }
  }

  snapshot(): UserActorData {
    return {
      type: 'User',
      id: this.id,
      usdcBalance: this.usdcBalance,
      totalUsdcEarned: this.totalUsdcEarned,
      totalUsdcSpent: this.totalUsdcSpent,
      realizedPnl: this.realizedPnl,
      unrealizedPnl: this.unrealizedPnl,
      cohort: this.cohort,
      priceThreshold: this.priceThreshold,
      dailyRequestLambda: this.dailyRequestLambda,
      acquisitionChannel: this.acquisitionChannel,
    }
  }
}
