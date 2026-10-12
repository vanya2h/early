import {
  UserCohort,
  CreatorCohort,
  InvestorCohort,
  TraderCohort,
  AcquisitionChannel,
  HostingPlan,
  PrivacyLevel,
} from '../models.js'
import type { SimConfig, InvestorStrategy, TraderStrategy, AppSpec } from '../models.js'
import type { RNG } from './rng.js'
import {
  Pareto, LogNormal, Uniform, Beta, Categorical, Derived,
} from './distributions.js'
import { UserActor } from './actors/user-actor.js'
import { CreatorActor } from './actors/creator-actor.js'
import { InvestorActor } from './actors/investor-actor.js'
import { TraderActor } from './actors/trader-actor.js'
import { AppMarket } from './app-market.js'
import { createBehavior } from './strategies/trader-behavior.js'
import type { World } from './world.js'

/** Builds actors and deploys apps with per-cohort distributions. */
export class Spawner {
  private readonly config: SimConfig
  private readonly rng: RNG

  constructor(config: SimConfig, rng: RNG) {
    this.config = config
    this.rng = rng
  }

  // ─── Users ────────────────────────────────────────────────────────────────

  spawnUser(world: World, tick: number): UserActor {
    void tick
    const α = this.config.paretoAlpha

    const cohortDist = new Categorical<UserCohort>(
      [UserCohort.PowerUser, UserCohort.Casual, UserCohort.PrivacyConscious, UserCohort.Trial],
      [0.15, 0.55, 0.20, 0.10],
    )
    const channelDist = new Categorical<AcquisitionChannel>(
      [AcquisitionChannel.SEO, AcquisitionChannel.Social],
      [0.6, 0.4],
    )

    const cohort = cohortDist.sample(this.rng)
    const channel = channelDist.sample(this.rng)

    // Pareto xMin for usdcBalance. Users are SaaS subscribers — budget represents
    // their total API spend capacity (lifetime, not monthly). Set high enough that
    // a user survives many ticks even at $0.20/request across several apps.
    const budgetByCoort: Record<UserCohort, number> = {
      [UserCohort.PowerUser]: 500,
      [UserCohort.Casual]: 100,
      [UserCohort.PrivacyConscious]: 300,
      [UserCohort.Trial]: 50,
    }
    // Willingness-to-pay threshold (LogNormal mu/sigma).
    // Median thresholds: PowerUser≈$0.80, Casual≈$0.25, PrivacyConscious≈$0.50, Trial≈$0.10
    // Matched to pricingPerRequest distribution (LogNormal(-1.6,0.9), median≈$0.20).
    const thresholdByCoort: Record<UserCohort, [number, number]> = {
      [UserCohort.PowerUser]:        [ -0.22, 0.7],
      [UserCohort.Casual]:           [ -1.39, 0.5],
      [UserCohort.PrivacyConscious]: [ -0.69, 0.5],
      [UserCohort.Trial]:            [ -2.30, 0.4],
    }
    // Poisson lambda for requests per app per tick. Intentionally moderate:
    // users spread activity across multiple apps so per-app rates stay realistic.
    const lambdaByCoort: Record<UserCohort, [number, number]> = {
      [UserCohort.PowerUser]: [3, 8],
      [UserCohort.Casual]: [1, 3],
      [UserCohort.PrivacyConscious]: [2, 5],
      [UserCohort.Trial]: [1, 2],
    }

    const xMin = budgetByCoort[cohort] ?? 10
    const usdcBalance = new Pareto(xMin, α).sample(this.rng)

    const [mu, sigma] = thresholdByCoort[cohort] ?? [-1.90, 0.5]
    const priceThreshold = new LogNormal(mu, sigma).sample(this.rng)

    const [lo, hi] = lambdaByCoort[cohort] ?? [1, 5]
    const dailyRequestLambda = new Uniform(lo, hi).sample(this.rng)

    const actor = new UserActor({ cohort, usdcBalance, priceThreshold, dailyRequestLambda, acquisitionChannel: channel })
    world.users.push(actor)
    return actor
  }

  // ─── Creators ─────────────────────────────────────────────────────────────

  spawnCreator(world: World): CreatorActor {
    const α = this.config.paretoAlpha

    const cohortDist = new Categorical<CreatorCohort>(
      [CreatorCohort.SoloDev, CreatorCohort.Startup, CreatorCohort.Agency, CreatorCohort.WhaleCreator],
      [0.50, 0.30, 0.15, 0.05],
    )
    const cohort = cohortDist.sample(this.rng)

    const capitalByCoort: Record<CreatorCohort, number> = {
      [CreatorCohort.SoloDev]: 100,
      [CreatorCohort.Startup]: 500,
      [CreatorCohort.Agency]: 2000,
      [CreatorCohort.WhaleCreator]: 10000,
    }
    const xMin = capitalByCoort[cohort] ?? 500
    const usdcBalance = new Pareto(xMin, α).sample(this.rng)

    const actor = new CreatorActor({
      cohort,
      usdcBalance,
      reinvestmentRate: new Uniform(0.1, 0.5).sample(this.rng),
      vestingSellFraction: new Uniform(0.0, 0.5).sample(this.rng),
      marketingSpendMultiplier: new Uniform(1.0, 3.0).sample(this.rng),
    })
    world.creators.push(actor)
    return actor
  }

  // ─── Investors ────────────────────────────────────────────────────────────

  spawnInvestor(): InvestorActor {
    const α = this.config.paretoAlpha

    const cohortDist = new Categorical<InvestorCohort>(
      [InvestorCohort.Retail, InvestorCohort.Whale, InvestorCohort.DeFiVeteran, InvestorCohort.YieldHunter, InvestorCohort.Speculator],
      [0.50, 0.05, 0.20, 0.15, 0.10],
    )
    const cohort = cohortDist.sample(this.rng)

    type CohortParams = {
      xMin: number
      momentumLo: number
      momentumHi: number
      riskFloor: number
      patience: number
      rotation: number
      lockPref: number
      maxSingle: number
      psAlpha: number
      psBeta: number
    }

    const params: Record<InvestorCohort, CohortParams> = {
      [InvestorCohort.Retail]: { xMin: 500, momentumLo: 2, momentumHi: 5, riskFloor: 5, patience: 14, rotation: 2, lockPref: 4, maxSingle: 0.4, psAlpha: 2, psBeta: 8 },
      [InvestorCohort.Whale]: { xMin: 50000, momentumLo: 8, momentumHi: 15, riskFloor: 3, patience: 30, rotation: 0, lockPref: 8, maxSingle: 0.2, psAlpha: 2, psBeta: 10 },
      [InvestorCohort.DeFiVeteran]: { xMin: 5000, momentumLo: 3, momentumHi: 6, riskFloor: 8, patience: 7, rotation: 3, lockPref: 2, maxSingle: 0.5, psAlpha: 4, psBeta: 6 },
      [InvestorCohort.YieldHunter]: { xMin: 2000, momentumLo: 5, momentumHi: 10, riskFloor: 6, patience: 60, rotation: 0, lockPref: 10, maxSingle: 0.3, psAlpha: 3, psBeta: 5 },
      [InvestorCohort.Speculator]: { xMin: 1000, momentumLo: 1.5, momentumHi: 2, riskFloor: 0, patience: 5, rotation: 5, lockPref: 1, maxSingle: 0.6, psAlpha: 6, psBeta: 4 },
    }

    const p = params[cohort]
    const usdcBalance = new Pareto(p.xMin, α).sample(this.rng)
    const strategy: InvestorStrategy = {
      momentumTarget: new Uniform(p.momentumLo, p.momentumHi).sample(this.rng),
      riskFloorYield: p.riskFloor,
      yieldPatience: p.patience,
      rotationPremium: p.rotation,
      lockPreferenceMonths: p.lockPref,
      maxSingleAppPct: p.maxSingle,
      positionSizingAlpha: p.psAlpha,
      positionSizingBeta: p.psBeta,
    }

    return new InvestorActor({ cohort, usdcBalance, strategy })
  }

  // ─── Traders ──────────────────────────────────────────────────────────────

  spawnTrader(): TraderActor {
    const α = this.config.paretoAlpha

    const cohortDist = new Categorical<TraderCohort>(
      [TraderCohort.RSITrader, TraderCohort.MACrossover, TraderCohort.BollingerBand, TraderCohort.Arbitrageur, TraderCohort.AuctionSniper],
      [0.30, 0.35, 0.20, 0.10, 0.05],
    )
    const cohort = cohortDist.sample(this.rng)

    const capitalByCoort: Record<TraderCohort, number> = {
      [TraderCohort.RSITrader]: 500,
      [TraderCohort.MACrossover]: 1000,
      [TraderCohort.BollingerBand]: 500,
      [TraderCohort.Arbitrageur]: 2000,
      [TraderCohort.AuctionSniper]: 1000,
    }
    const psAlphaByCoort: Record<TraderCohort, number> = {
      [TraderCohort.RSITrader]: 3,
      [TraderCohort.MACrossover]: 4,
      [TraderCohort.BollingerBand]: 3,
      [TraderCohort.Arbitrageur]: 5,
      [TraderCohort.AuctionSniper]: 4,
    }
    const psBetaByCoort: Record<TraderCohort, number> = {
      [TraderCohort.RSITrader]: 7,
      [TraderCohort.MACrossover]: 6,
      [TraderCohort.BollingerBand]: 7,
      [TraderCohort.Arbitrageur]: 5,
      [TraderCohort.AuctionSniper]: 6,
    }

    const xMin = capitalByCoort[cohort] ?? 500
    const usdcBalance = new Pareto(xMin, α).sample(this.rng)
    const psAlpha = psAlphaByCoort[cohort] ?? 3
    const psBeta = psBetaByCoort[cohort] ?? 7

    const strategyDist = new Derived<TraderStrategy>(rng => {
      switch (cohort) {
        case TraderCohort.RSITrader:
          return {
            type: 'RSI',
            rsiPeriod: Math.round(new Uniform(10, 20).sample(rng)),
            buyThreshold: new Uniform(25, 40).sample(rng),
            sellThreshold: new Uniform(60, 75).sample(rng),
          }
        case TraderCohort.MACrossover:
          return {
            type: 'MACrossover',
            maFast: Math.round(new Uniform(5, 10).sample(rng)),
            maSlow: Math.round(new Uniform(20, 40).sample(rng)),
          }
        case TraderCohort.BollingerBand:
          return {
            type: 'BollingerBand',
            bbPeriod: Math.round(new Uniform(15, 25).sample(rng)),
            bbWidth: new Uniform(1.5, 2.5).sample(rng),
          }
        case TraderCohort.Arbitrageur:
          return {
            type: 'Arbitrageur',
            entryRatio: new Uniform(0.55, 0.70).sample(rng),
          }
        case TraderCohort.AuctionSniper:
          return {
            type: 'AuctionSniper',
            targetMultiple: new Uniform(1.3, 2.0).sample(rng),
          }
      }
    })

    const strategy = strategyDist.sample(this.rng)
    const behavior = createBehavior(strategy)

    return new TraderActor({ cohort, usdcBalance, strategy, positionSizingAlpha: psAlpha, positionSizingBeta: psBeta, behavior })
  }

  // ─── App Deployment ───────────────────────────────────────────────────────

  deployApp(creator: CreatorActor, world: World, tick: number): AppMarket {
    const hostingDist = new Categorical<HostingPlan>(
      [HostingPlan.Nano, HostingPlan.Small, HostingPlan.Medium, HostingPlan.Large, HostingPlan.Dedicated],
      creator.cohort === CreatorCohort.WhaleCreator
        ? [0.0, 0.1, 0.3, 0.4, 0.2]
        : creator.cohort === CreatorCohort.Agency
          ? [0.0, 0.2, 0.4, 0.3, 0.1]
          : [0.3, 0.4, 0.2, 0.1, 0.0],
    )

    const spec: AppSpec = {
      creatorId: creator.id,
      cohort: creator.cohort,
      hostingPlan: hostingDist.sample(this.rng),
      pricingPerRequest: new LogNormal(-1.6, 0.9).sample(this.rng),
      opsTreasurySeed: new Uniform(100, 500).sample(this.rng),
      appQuality: new Beta(2, 5).sample(this.rng),
      seoFraction: new Uniform(0.3, 0.8).sample(this.rng),
      auctionDuration: this.config.defaultAuctionDuration,
      auctionFloor: this.config.defaultAuctionFloor,
      auctionSize: this.config.defaultAuctionSize,
      sellingFeeRate: this.config.defaultSellingFeeRate,
      lockMaxMonths: this.config.defaultLockMaxMonths,
      lockWeightMax: this.config.defaultLockWeightMax,
      reserveRatio: this.config.defaultReserveRatio,
    }

    const market = new AppMarket(spec, tick)
    world.apps.push(market)
    creator.ownedAppIds.push(market.data.id)

    // Creator submits initial auction bid
    const bidAmount = Math.min(creator.usdcBalance * 0.3, 2000)
    const bidShares = bidAmount / spec.auctionFloor
    market.submitAuctionBid(creator.id, spec.auctionFloor * 2, bidShares)

    return market
  }

  // ─── User Arrivals ────────────────────────────────────────────────────────

  /**
   * Network-effect user arrival: more apps → larger addressable audience.
   * Capacity = 8 × appCount × logistic(tick) + 5.
   * One app at tick 0 ≈ 5 users; 20 apps at tick 200 ≈ 120 users.
   */
  arriveUsers(world: World, tick: number): void {
    const appCount = Math.max(world.apps.length, 1)
    const capacity = Math.round(8 * appCount * (tick / (tick + 90)) + 5)
    const perTick = Math.min(8, Math.max(0, capacity - world.users.length + 1))
    for (let i = 0; i < perTick; i++) {
      this.spawnUser(world, tick)
    }
  }
}
