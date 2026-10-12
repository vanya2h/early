import type {
  InvestorCohort,
  InvestorStrategy,
  HolderPosition,
  InvestorActor as InvestorActorData,
} from '../../models.js'
import { Actor, nextActorId } from './actor.js'
import type { RNG } from '../rng.js'
import { Beta } from '../distributions.js'
import type { World } from '../world.js'

/** Simulation actor for a share investor. */
export class InvestorActor extends Actor {
  readonly cohort: InvestorCohort
  readonly strategy: InvestorStrategy
  /** Shares held per app id. */
  holdingsMap: Map<string, { shares: number; avgCost: number; locked: boolean }>
  /** Consecutive ticks below yield floor per app. */
  ticksBelowFloor: Map<string, number>

  constructor(opts: {
    cohort: InvestorCohort
    usdcBalance: number
    strategy: InvestorStrategy
  }) {
    super(nextActorId('investor'), opts.usdcBalance)
    this.cohort = opts.cohort
    this.strategy = opts.strategy
    this.holdingsMap = new Map()
    this.ticksBelowFloor = new Map()
  }

  override step(world: unknown, rng: RNG): void {
    const w = world as World

    // 1. Claim pending payouts from all held apps
    for (const appId of this.holdingsMap.keys()) {
      const market = w.getApp(appId)
      if (!market) continue
      const payout = market.claimPayout(this.id)
      if (payout > 0) {
        this.usdcBalance += payout
        this.totalUsdcEarned += payout
      }
    }

    // 2. Check exit conditions on existing holdings
    for (const [appId, pos] of this.holdingsMap) {
      const market = w.getApp(appId)
      if (!market) {
        this.holdingsMap.delete(appId)
        continue
      }

      const d = market.data
      const currentPrice = d.currentPrice
      const avgCost = pos.avgCost

      // Momentum exit: price has reached target multiple
      if (avgCost > 0 && currentPrice / avgCost >= this.strategy.momentumTarget) {
        const proceeds = market.sell(this.id, pos.shares)
        if (proceeds > 0) {
          const pnl = proceeds - pos.shares * avgCost
          this.realizedPnl += pnl
          this.usdcBalance += proceeds
          this.totalUsdcEarned += proceeds
          this.holdingsMap.delete(appId)
          this.ticksBelowFloor.delete(appId)
          continue
        }
      }

      // Yield floor check
      const annualYield = pos.shares > 0 && d.monthlyRevenue > 0
        ? (d.monthlyRevenue * 12 * (pos.shares / Math.max(1, d.sharesSold))) /
          (pos.shares * currentPrice) * 100
        : 0

      if (annualYield < this.strategy.riskFloorYield) {
        const prev = this.ticksBelowFloor.get(appId) ?? 0
        this.ticksBelowFloor.set(appId, prev + 1)
        if (prev + 1 >= this.strategy.yieldPatience) {
          const proceeds = market.sell(this.id, pos.shares)
          if (proceeds > 0) {
            const pnl = proceeds - pos.shares * avgCost
            this.realizedPnl += pnl
            this.usdcBalance += proceeds
            this.totalUsdcEarned += proceeds
          }
          this.holdingsMap.delete(appId)
          this.ticksBelowFloor.delete(appId)
          continue
        }
      } else {
        this.ticksBelowFloor.set(appId, 0)
      }
    }

    // 3. Enter new positions
    if (this.usdcBalance > 500) {
      for (const market of w.apps) {
        const d = market.data
        if (!d.auctionCleared) continue
        if (this.holdingsMap.has(d.id)) continue

        // Position sizing
        const fraction = new Beta(this.strategy.positionSizingAlpha, this.strategy.positionSizingBeta).sample(rng)
        const totalPortfolio = this._estimatePortfolioValue(w)
        const maxAmount = Math.min(
          this.strategy.maxSingleAppPct * totalPortfolio,
          this.usdcBalance * fraction,
          this.usdcBalance * 0.5,
        )
        if (maxAmount < 10) continue

        const shares = market.buy(this.id, maxAmount, rng)
        if (shares > 0) {
          const spent = maxAmount * (shares / Math.max(shares, 0.001)) // approximate
          const actualSpent = Math.min(maxAmount, spent)
          this.usdcBalance -= actualSpent
          this.totalUsdcSpent += actualSpent
          this.holdingsMap.set(d.id, {
            shares,
            avgCost: actualSpent / shares,
            locked: false,
          })
          break // Only enter one new position per tick
        }
      }
    }

    // 4. Lock unlocked shares in existing positions
    for (const [appId, pos] of this.holdingsMap) {
      if (pos.locked) continue
      const market = w.getApp(appId)
      if (!market) continue
      const lockMonths = Math.min(this.strategy.lockPreferenceMonths, market.data.lockMaxMonths)
      const lock = market.lock(this.id, pos.shares, lockMonths)
      if (lock) {
        pos.locked = true
      }
    }
  }

  private _estimatePortfolioValue(w: World): number {
    let total = this.usdcBalance
    for (const [appId, pos] of this.holdingsMap) {
      const market = w.getApp(appId)
      if (market) {
        total += pos.shares * market.data.currentPrice
      }
    }
    return Math.max(total, this.usdcBalance)
  }

  snapshot(): InvestorActorData {
    const holdings: Record<string, HolderPosition> = {}
    for (const [appId, pos] of this.holdingsMap) {
      holdings[appId] = {
        sharesUnlocked: pos.locked ? 0 : pos.shares,
        sharesLocked: pos.locked ? pos.shares : 0,
        avgCostBasis: pos.avgCost,
      }
    }
    const ticksBelowFloor: Record<string, number> = {}
    for (const [k, v] of this.ticksBelowFloor) {
      ticksBelowFloor[k] = v
    }
    return {
      type: 'Investor',
      id: this.id,
      usdcBalance: this.usdcBalance,
      totalUsdcEarned: this.totalUsdcEarned,
      totalUsdcSpent: this.totalUsdcSpent,
      realizedPnl: this.realizedPnl,
      unrealizedPnl: this.unrealizedPnl,
      cohort: this.cohort,
      holdings,
      strategy: this.strategy,
      ticksBelowFloor,
    }
  }
}
