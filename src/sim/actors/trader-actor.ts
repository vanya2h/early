import type {
  TraderCohort,
  TraderStrategy,
  HolderPosition,
  TraderActor as TraderActorData,
} from '../../models.js'
import { Actor, nextActorId } from './actor.js'
import type { RNG } from '../rng.js'
import { Beta } from '../distributions.js'
import type { World } from '../world.js'
import type { TraderBehavior } from '../strategies/trader-behavior.js'

/** Simulation actor for a technical signal trader. */
export class TraderActor extends Actor {
  readonly cohort: TraderCohort
  readonly strategy: TraderStrategy
  readonly positionSizingAlpha: number
  readonly positionSizingBeta: number
  readonly behavior: TraderBehavior
  holdingsMap: Map<string, { shares: number; entryPrice: number }>

  constructor(opts: {
    cohort: TraderCohort
    usdcBalance: number
    strategy: TraderStrategy
    positionSizingAlpha: number
    positionSizingBeta: number
    behavior: TraderBehavior
  }) {
    super(nextActorId('trader'), opts.usdcBalance)
    this.cohort = opts.cohort
    this.strategy = opts.strategy
    this.positionSizingAlpha = opts.positionSizingAlpha
    this.positionSizingBeta = opts.positionSizingBeta
    this.behavior = opts.behavior
    this.holdingsMap = new Map()
  }

  override step(world: unknown, rng: RNG): void {
    const w = world as World

    // Claim payouts
    for (const appId of this.holdingsMap.keys()) {
      const market = w.getApp(appId)
      if (!market) continue
      const payout = market.claimPayout(this.id)
      if (payout > 0) {
        this.usdcBalance += payout
        this.totalUsdcEarned += payout
      }
    }

    for (const market of w.apps) {
      const d = market.data
      if (!d.auctionCleared) {
        // Auction snipers bid during auction
        if (this.strategy.type === 'AuctionSniper' && !d.auctionCleared) {
          const bidAmount = Math.min(this.usdcBalance * 0.2, 500)
          if (bidAmount > d.auctionFloor) {
            market.submitAuctionBid(this.id, d.auctionFloor * 1.5, bidAmount / (d.auctionFloor * 1.5))
          }
        }
        continue
      }

      const inPosition = this.holdingsMap.has(d.id)
      const priceHistory = d.priceHistory

      if (inPosition) {
        const pos = this.holdingsMap.get(d.id)!
        const shouldExit = this.behavior.shouldExit(priceHistory, pos.entryPrice)
        if (shouldExit) {
          const proceeds = market.sell(this.id, pos.shares)
          if (proceeds > 0) {
            const pnl = proceeds - pos.shares * pos.entryPrice
            this.realizedPnl += pnl
            this.usdcBalance += proceeds
            this.totalUsdcEarned += proceeds
          }
          this.holdingsMap.delete(d.id)
        }
      } else {
        const shouldEnter = this.behavior.shouldEnter(priceHistory, market.reservePrice / Math.max(d.currentPrice, 0.01))
        if (shouldEnter && this.usdcBalance > 100) {
          const fraction = new Beta(this.positionSizingAlpha, this.positionSizingBeta).sample(rng)
          const amount = this.usdcBalance * Math.min(fraction, 0.5)
          if (amount < 10) continue

          const shares = market.buy(this.id, amount, rng)
          if (shares > 0) {
            this.usdcBalance -= amount
            this.totalUsdcSpent += amount
            this.holdingsMap.set(d.id, {
              shares,
              entryPrice: d.currentPrice,
            })
          }
        }
      }
    }
  }

  snapshot(): TraderActorData {
    const holdings: Record<string, HolderPosition> = {}
    for (const [appId, pos] of this.holdingsMap) {
      holdings[appId] = {
        sharesUnlocked: pos.shares,
        sharesLocked: 0,
        avgCostBasis: pos.entryPrice,
      }
    }
    return {
      type: 'Trader',
      id: this.id,
      usdcBalance: this.usdcBalance,
      totalUsdcEarned: this.totalUsdcEarned,
      totalUsdcSpent: this.totalUsdcSpent,
      realizedPnl: this.realizedPnl,
      unrealizedPnl: this.unrealizedPnl,
      cohort: this.cohort,
      holdings,
      strategy: this.strategy,
      positionSizingAlpha: this.positionSizingAlpha,
      positionSizingBeta: this.positionSizingBeta,
    }
  }
}
