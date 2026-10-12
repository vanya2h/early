import type { App, AppSpec, HostingPlan, LockEntry } from '../models.js'
import { BondingCurve } from './bonding-curve.js'
import { AuctionEngine } from './auction-engine.js'
import type { RNG } from './rng.js'
import type { SimEvent } from './sim-event.js'

/** Monthly hosting cost by plan in USDC. */
const HOSTING_COST: Record<string, number> = {
  Nano: 5.33,
  Small: 10.59,
  Medium: 21.17,
  Large: 42.34,
  Dedicated: 109.5,
}

/** App name pool per creator cohort type. */
const UTILITY_NAMES = [
  'PDF Converter', 'Image Resizer', 'Audio Transcoder',
  'File Compressor', 'Text Summariser', 'Code Formatter',
]
const DEFI_NAMES = [
  'DeFi Bridge', 'DEX Aggregator', 'Yield Optimizer',
  'LP Manager', 'Token Swapper', 'Cross-chain Router',
]

let _appCounter = 0

/** Returns a deterministic app name based on index and cohort. */
export function nameForApp(index: number, cohort: string): string {
  const isDefi = cohort === 'Agency' || cohort === 'WhaleCreator'
  const pool = isDefi ? DEFI_NAMES : UTILITY_NAMES
  return pool[index % pool.length] ?? `App #${index}`
}

/** Per-holder PnL snapshot for an app market. */
export type HolderStat = {
  actorId: string
  shares: number
  costBasis: number
  realizedPnl: number
  unrealizedPnl: number
  totalPnl: number
}

/**
 * Wraps an `App` data object with all market logic:
 * bonding curve buys/sells, lock registry, profit distribution, and CCA auction.
 */
export class AppMarket {
  private _data: App
  private _auction: AuctionEngine | null
  /** Daily revenue per tick (last 30 entries). */
  private _dailyRevenueHistory: number[]
  /** Per-user request counts per tick (last 30 entries). */
  private _dailyUserSets: Set<string>[]
  /** Accumulated variable costs for 30-day window. */
  private _dailyVarCostHistory: number[]
  /** Count of shares held per actor (mutable). */
  private _holdings: Map<string, number>
  /** All-time unique user IDs that have ever sent a request. */
  private _allTimeUsers: Set<string>
  /** Cost basis and realized PnL per actor (kept even after full exit). */
  private _holderPnl: Map<string, { costBasis: number; realizedPnl: number }>
  /** Simulation events logged for this app. */
  private _events: SimEvent[] = []
  /** Current simulation tick (set by simulation before each step). */
  private _tick = 0
  /** Online state from the previous tick (for transition detection). */
  private _wasOnline = true

  constructor(spec: AppSpec, tick: number) {
    const id = `app-${++_appCounter}`
    const monthlyCost = HOSTING_COST[spec.hostingPlan] ?? 10.59
    const isDefi = spec.cohort === 'Agency' || spec.cohort === 'WhaleCreator'
    const namePool = isDefi ? DEFI_NAMES : UTILITY_NAMES
    const name = namePool[(_appCounter - 1) % namePool.length] ?? `App #${id}`

    this._data = {
      id,
      creatorId: spec.creatorId,
      deployedAt: tick,
      totalShares: 1000,
      sharesSold: 0,
      auctionCleared: false,
      auctionClearingPrice: 0,
      currentPrice: spec.auctionFloor,
      auctionDuration: spec.auctionDuration,
      auctionFloor: spec.auctionFloor,
      auctionSize: spec.auctionSize,
      sellingFeeRate: spec.sellingFeeRate,
      lockMaxMonths: spec.lockMaxMonths,
      lockWeightMax: spec.lockWeightMax,
      reserveRatio: spec.reserveRatio,
      pricingPerRequest: spec.pricingPerRequest,
      reserveBalance: 0,
      lockRegistry: {},
      monthlyRevenue: 0,
      variableCosts30d: 0,
      opsTreasury: spec.opsTreasurySeed,
      opsTreasuryTarget: monthlyCost * 3,
      protocolFeeRate: 0.01,
      dailyRequests: 0,
      activeUsers30d: 0,
      uniqueUsers: 0,
      shareholderCount: 0,
      priceHistory: [],
      hostingPlan: spec.hostingPlan,
      privacyLevel: 'Sealed' as App['privacyLevel'],
      isOnline: true,
    }
    // Supress ts complaint about name (not on App type) — it's stored via label
    void name

    this._auction = new AuctionEngine()
    this._dailyRevenueHistory = []
    this._dailyUserSets = []
    this._dailyVarCostHistory = []
    this._holdings = new Map()
    this._allTimeUsers = new Set()
    this._holderPnl = new Map()
    this._events.push({ tick, kind: 'DEPLOYED', label: `App deployed, auction opened (${spec.auctionSize} shares)` })
  }

  /** Set the current simulation tick — call once per tick before step(). */
  setTick(tick: number): void {
    this._tick = tick
  }

  /** All simulation events for this app, oldest first. */
  get events(): SimEvent[] {
    return this._events.slice()
  }

  /** Current snapshot of App data. */
  get data(): App {
    return { ...this._data }
  }

  /** Current price on bonding curve. */
  get currentPrice(): number {
    return this._data.currentPrice
  }

  /** Reserve price per share. */
  get reservePrice(): number {
    return this._data.sharesSold > 0
      ? this._data.reserveBalance / this._data.sharesSold
      : 0
  }

  /** Submit a bid to the active auction. */
  submitAuctionBid(bidderId: string, maxPrice: number, amount: number): void {
    this._auction?.submitBid(bidderId, maxPrice, amount)
  }

  /**
   * Buy shares on the bonding curve with `usdcAmount` USDC.
   * Returns number of shares acquired.
   */
  buy(actorId: string, usdcAmount: number, _rng: RNG): number {
    if (!this._data.auctionCleared) return 0
    if (usdcAmount <= 0) return 0

    const from = this._data.sharesSold
    const available = this._data.totalShares - from
    if (available <= 0) return 0

    // Binary search for the number of shares buyable with usdcAmount
    let lo = 0
    let hi = Math.min(available, usdcAmount / this._data.currentPrice * 2)
    for (let i = 0; i < 64; i++) {
      const mid = (lo + hi) / 2
      const cost = BondingCurve.costToAcquire(from, mid, this._data.auctionFloor)
      if (cost <= usdcAmount) {
        lo = mid
      } else {
        hi = mid
      }
      if (hi - lo < 0.0001) break
    }

    const shares = Math.max(0, Math.min(lo, available))
    if (shares <= 0) return 0
    const cost = BondingCurve.costToAcquire(from, shares, this._data.auctionFloor)

    const reserveContrib = cost * this._data.reserveRatio
    this._data.reserveBalance += reserveContrib
    this._data.sharesSold += shares
    this._data.currentPrice = BondingCurve.price(this._data.sharesSold, this._data.auctionFloor)

    const prev = this._holdings.get(actorId) ?? 0
    this._holdings.set(actorId, prev + shares)
    this._data.shareholderCount = this._holdings.size

    const existingPnl = this._holderPnl.get(actorId) ?? { costBasis: 0, realizedPnl: 0 }
    this._holderPnl.set(actorId, { costBasis: existingPnl.costBasis + cost, realizedPnl: existingPnl.realizedPnl })

    if (cost >= 200) {
      this._events.push({
        tick: this._tick, kind: 'LARGE_BUY',
        label: `Buy ${shares.toFixed(1)} shares for $${cost.toFixed(0)}`,
        value: cost,
      })
    }

    return shares
  }

  /**
   * Sell `shares` at the reserve price minus selling fee.
   * Fee is distributed to locked holders.
   * Returns USDC received.
   */
  sell(actorId: string, shares: number): number {
    if (shares <= 0) return 0
    const held = this._holdings.get(actorId) ?? 0
    const sellable = Math.min(shares, held)
    if (sellable <= 0) return 0

    // Check not locked
    const lock = this._data.lockRegistry[actorId]
    const lockedShares = lock?.shares ?? 0
    const unlockedHeld = Math.max(0, held - lockedShares)
    const actualSell = Math.min(sellable, unlockedHeld)
    if (actualSell <= 0) return 0

    const reservePerShare = this.reservePrice
    const grossProceeds = actualSell * reservePerShare
    const fee = grossProceeds * this._data.sellingFeeRate
    const net = grossProceeds - fee

    // Deduct from reserve
    this._data.reserveBalance = Math.max(0, this._data.reserveBalance - grossProceeds)
    this._data.sharesSold = Math.max(0, this._data.sharesSold - actualSell)
    this._data.currentPrice = BondingCurve.price(this._data.sharesSold, this._data.auctionFloor)

    const newHeld = held - actualSell
    if (newHeld <= 0) {
      this._holdings.delete(actorId)
    } else {
      this._holdings.set(actorId, newHeld)
    }
    this._data.shareholderCount = this._holdings.size

    // Update per-holder PnL: proportional cost basis reduction + realized gain/loss
    {
      const pnl = this._holderPnl.get(actorId) ?? { costBasis: 0, realizedPnl: 0 }
      const costOfSold = held > 0 ? pnl.costBasis * (actualSell / held) : 0
      this._holderPnl.set(actorId, {
        costBasis: Math.max(0, pnl.costBasis - costOfSold),
        realizedPnl: pnl.realizedPnl + (net - costOfSold),
      })
    }

    // Distribute fee to locked holders
    this._distributeFeeToLocked(fee)

    if (net >= 100) {
      this._events.push({
        tick: this._tick, kind: 'LARGE_SELL',
        label: `Sell ${actualSell.toFixed(1)} shares for $${net.toFixed(0)}`,
        value: net,
      })
    }

    return net
  }

  /** Lock `shares` for `months` months. Returns the LockEntry created. */
  lock(actorId: string, shares: number, months: number): LockEntry | null {
    const held = this._holdings.get(actorId) ?? 0
    const existing = this._data.lockRegistry[actorId]
    const alreadyLocked = existing?.shares ?? 0
    const available = Math.max(0, held - alreadyLocked)
    const toLock = Math.min(shares, available)
    if (toLock <= 0) return null

    const clampedMonths = Math.min(months, this._data.lockMaxMonths)
    const weight = 1.0 + (this._data.lockWeightMax - 1.0) * (clampedMonths / this._data.lockMaxMonths)
    const lockedUntil = Math.ceil(this._data.deployedAt) + clampedMonths * 30

    const entry: LockEntry = { shares: toLock, lockedUntil, weight }
    this._data.lockRegistry = { ...this._data.lockRegistry, [actorId]: entry }

    this._events.push({
      tick: this._tick, kind: 'LOCK',
      label: `${toLock.toFixed(1)} shares locked for ${clampedMonths}mo (weight ${weight.toFixed(1)}×)`,
    })

    return entry
  }

  /** Reset per-tick request counter. Called once at the start of each tick. */
  resetDailyRequests(): void {
    this._data.dailyRequests = 0
  }

  /**
   * Record a user request payment (for revenue accounting).
   * Called from user actor steps.
   */
  recordRequest(actorId: string, amount: number, tick: number): void {
    if (!this._data.isOnline) return
    this._data.dailyRequests++

    // Accumulate daily revenue (index = position in current tick's bucket)
    const last = this._dailyRevenueHistory[this._dailyRevenueHistory.length - 1]
    // We accumulate intra-tick; finalized in distributeProfit
    if (last !== undefined && this._currentAccumTick === tick) {
      this._dailyRevenueHistory[this._dailyRevenueHistory.length - 1] = last + amount
    } else {
      this._dailyRevenueHistory.push(amount)
      this._currentAccumTick = tick
    }

    // Track user for activeUsers30d and all-time uniqueUsers
    let userSet = this._dailyUserSets[this._dailyUserSets.length - 1]
    if (userSet === undefined || this._currentAccumTick !== tick) {
      userSet = new Set<string>()
      this._dailyUserSets.push(userSet)
    }
    userSet.add(actorId)
    if (!this._allTimeUsers.has(actorId)) {
      this._allTimeUsers.add(actorId)
      this._data.uniqueUsers = this._allTimeUsers.size
    }

    // Credit app ops treasury
    this._data.opsTreasury += amount
  }

  private _currentAccumTick = -1

  /**
   * Distribute profits to shareholders (called once per tick).
   * Steps: deduct variable costs, top up ops treasury, take protocol fee, distribute remainder.
   */
  distributeProfit(tick: number): number {
    // Finalise this tick's revenue entry
    if (this._currentAccumTick !== tick) {
      this._dailyRevenueHistory.push(0)
      this._dailyUserSets.push(new Set<string>())
      this._currentAccumTick = tick
    }

    // Trim history to 30 entries
    while (this._dailyRevenueHistory.length > 30) {
      this._dailyRevenueHistory.shift()
    }
    while (this._dailyUserSets.length > 30) {
      this._dailyUserSets.shift()
    }

    // Update monthly revenue
    this._data.monthlyRevenue = this._dailyRevenueHistory.reduce((s, v) => s + v, 0)

    // Variable costs = 20% of revenue
    const todayRevenue = this._dailyRevenueHistory[this._dailyRevenueHistory.length - 1] ?? 0
    const varCost = todayRevenue * 0.20
    this._dailyVarCostHistory.push(varCost)
    while (this._dailyVarCostHistory.length > 30) this._dailyVarCostHistory.shift()
    this._data.variableCosts30d = this._dailyVarCostHistory.reduce((s, v) => s + v, 0)

    // Deduct daily fixed costs from ops treasury
    const monthlyCost = HOSTING_COST[this._data.hostingPlan] ?? 10.59
    const dailyFixed = monthlyCost / 30
    this._data.opsTreasury = Math.max(0, this._data.opsTreasury - dailyFixed)

    // Go offline if ops treasury is depleted
    this._data.isOnline = this._data.opsTreasury > 0 || todayRevenue > dailyFixed

    if (!this._data.isOnline && this._wasOnline) {
      this._events.push({ tick, kind: 'OFFLINE', label: 'App went offline — ops treasury depleted' })
    } else if (this._data.isOnline && !this._wasOnline) {
      this._events.push({ tick, kind: 'ONLINE', label: 'App came back online' })
    }
    this._wasOnline = this._data.isOnline

    const netRevenue = todayRevenue - varCost
    if (netRevenue <= 0) {
      // Record price and return
      this._recordPrice()
      this._updateActiveUsers()
      return 0
    }

    // Top up ops treasury target
    const opsDelta = Math.max(0, this._data.opsTreasuryTarget - this._data.opsTreasury)
    const opsTopUp = Math.min(opsDelta, netRevenue * 0.1)
    this._data.opsTreasury += opsTopUp
    const afterOps = netRevenue - opsTopUp

    // Protocol fee
    const protocolFee = afterOps * this._data.protocolFeeRate
    const afterProtocol = afterOps - protocolFee

    // Distribute to all holders proportionally by shares * lock weight
    const totalWeight = this._computeTotalHolderWeight()
    if (totalWeight > 0) {
      for (const [holderId, heldShares] of this._holdings) {
        if (heldShares <= 0) continue
        const lock = this._data.lockRegistry[holderId]
        const weight = lock ? lock.weight : 1.0
        const share = (heldShares * weight) / totalWeight
        // Payouts go to reserveBalance (backing the bonding curve) — callers
        // must pull payouts from the world by checking their actor balance
        // We encode payouts as pending on the world via a side-channel set
        // Instead, credit directly to opsTreasury to keep app liquid, and
        // let investors track via AppMarket.claimPayout
        this._pendingPayouts.set(holderId, (this._pendingPayouts.get(holderId) ?? 0) + afterProtocol * share)
      }
    }

    this._recordPrice()
    this._updateActiveUsers()
    return protocolFee
  }

  private _pendingPayouts: Map<string, number> = new Map()

  /** Claim accumulated payouts for an actor. Returns USDC amount. */
  claimPayout(actorId: string): number {
    const amount = this._pendingPayouts.get(actorId) ?? 0
    this._pendingPayouts.delete(actorId)
    return amount
  }

  /** Settle the auction if its window has closed. */
  settleAuction(tick: number, _rng: RNG): void {
    if (this._data.auctionCleared) return
    if (this._auction === null) return

    const closeTick = this._data.deployedAt + this._data.auctionDuration
    if (tick < closeTick) return

    const result = this._auction.settle(this._data.auctionSize, this._data.reserveRatio)
    this._data.auctionCleared = true
    this._data.auctionClearingPrice = result.winners.length > 0
      ? result.totalProceeds / result.winners.reduce((s, w) => s + w.shares, 0)
      : this._data.auctionFloor

    for (const winner of result.winners) {
      const prev = this._holdings.get(winner.actorId) ?? 0
      this._holdings.set(winner.actorId, prev + winner.shares)
      this._data.sharesSold += winner.shares

      const pnl = this._holderPnl.get(winner.actorId) ?? { costBasis: 0, realizedPnl: 0 }
      this._holderPnl.set(winner.actorId, { costBasis: pnl.costBasis + winner.paid, realizedPnl: pnl.realizedPnl })
    }
    this._data.shareholderCount = this._holdings.size

    this._data.reserveBalance += result.reserveAmount
    this._data.currentPrice = BondingCurve.price(this._data.sharesSold, this._data.auctionFloor)
    this._auction = null

    this._events.push({
      tick,
      kind: 'AUCTION_CLEARED',
      label: `Auction cleared — ${this._data.sharesSold} shares @ $${this._data.auctionClearingPrice.toFixed(2)}`,
      value: result.totalProceeds,
    })
  }

  /** Push an event directly (used by scenario engine). */
  logEvent(ev: SimEvent): void {
    this._events.push(ev)
  }

  /**
   * Inject shares for a scenario actor without USDC exchange.
   * Increases sharesSold and credits reserve as if bought through the bonding curve.
   * Scenario use only — models a whale who accumulated shares over prior ticks.
   */
  injectHolding(actorId: string, shares: number): void {
    if (!this._data.auctionCleared) return
    const available = this._data.totalShares - this._data.sharesSold
    const toInject = Math.min(shares, available)
    if (toInject <= 0) return

    const from = this._data.sharesSold
    const impliedCost = BondingCurve.costToAcquire(from, toInject, this._data.auctionFloor)
    this._data.reserveBalance += impliedCost * this._data.reserveRatio
    this._data.sharesSold += toInject
    this._data.currentPrice = BondingCurve.price(this._data.sharesSold, this._data.auctionFloor)

    const prev = this._holdings.get(actorId) ?? 0
    this._holdings.set(actorId, prev + toInject)
    this._data.shareholderCount = this._holdings.size

    const pnl = this._holderPnl.get(actorId) ?? { costBasis: 0, realizedPnl: 0 }
    this._holderPnl.set(actorId, { costBasis: pnl.costBasis + impliedCost, realizedPnl: pnl.realizedPnl })
  }

  /** Remove a specific actor's lock entry (scenario use only). */
  forceUnlock(actorId: string): void {
    const { [actorId]: _dropped, ...rest } = this._data.lockRegistry
    this._data.lockRegistry = rest
  }

  /** Clear all locks immediately regardless of expiry (scenario use only). */
  expireAllLocks(): void {
    this._data.lockRegistry = {}
  }

  /**
   * Add revenue to the current tick's bucket (scenario use only).
   * Affects the next distributeProfit call's monthly revenue calculation.
   */
  injectRevenue(amount: number): void {
    const len = this._dailyRevenueHistory.length
    if (len > 0) {
      this._dailyRevenueHistory[len - 1] = (this._dailyRevenueHistory[len - 1] ?? 0) + amount
      this._data.monthlyRevenue = this._dailyRevenueHistory.reduce((s, v) => s + v, 0)
    }
    this._data.opsTreasury += amount
  }

  /** Reduce the ops treasury by amount (scenario use only). Takes app offline if drained. */
  drainTreasury(amount: number): void {
    this._data.opsTreasury = Math.max(0, this._data.opsTreasury - amount)
    if (this._data.opsTreasury <= 0) {
      this._data.isOnline = false
    }
  }

  /** Unlock expired locks. */
  expireLocks(tick: number): void {
    const updated: Record<string, LockEntry> = {}
    for (const [id, entry] of Object.entries(this._data.lockRegistry)) {
      if (tick < entry.lockedUntil) {
        updated[id] = entry
      }
    }
    this._data.lockRegistry = updated
  }

  /** Expose holdings for actor decisions. */
  getHoldings(actorId: string): number {
    return this._holdings.get(actorId) ?? 0
  }

  /** Per-holder PnL breakdown for all current shareholders, sorted by totalPnl desc. */
  getHolderStats(): HolderStat[] {
    const price = this._data.currentPrice
    const stats: HolderStat[] = []
    for (const [actorId, shares] of this._holdings) {
      if (shares <= 0) continue
      const pnl = this._holderPnl.get(actorId) ?? { costBasis: 0, realizedPnl: 0 }
      const unrealizedPnl = shares * price - pnl.costBasis
      stats.push({
        actorId,
        shares,
        costBasis: pnl.costBasis,
        realizedPnl: pnl.realizedPnl,
        unrealizedPnl,
        totalPnl: unrealizedPnl + pnl.realizedPnl,
      })
    }
    return stats.sort((a, b) => b.totalPnl - a.totalPnl)
  }

  /** Total locked share value. */
  get totalLockedValue(): number {
    let total = 0
    for (const entry of Object.values(this._data.lockRegistry)) {
      total += entry.shares * this._data.currentPrice
    }
    return total
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private _recordPrice(): void {
    this._data.priceHistory.push(this._data.currentPrice)
    if (this._data.priceHistory.length > 30) {
      this._data.priceHistory.shift()
    }
  }

  private _updateActiveUsers(): void {
    const allUsers = new Set<string>()
    for (const s of this._dailyUserSets) {
      for (const u of s) allUsers.add(u)
    }
    this._data.activeUsers30d = allUsers.size
  }

  private _distributeFeeToLocked(fee: number): void {
    const lockedWeight = this._computeLockedWeight()
    if (lockedWeight <= 0 || fee <= 0) return

    for (const [holderId, entry] of Object.entries(this._data.lockRegistry)) {
      const share = (entry.shares * entry.weight) / lockedWeight
      this._pendingPayouts.set(holderId, (this._pendingPayouts.get(holderId) ?? 0) + fee * share)
    }
  }

  private _computeTotalHolderWeight(): number {
    let total = 0
    for (const [holderId, heldShares] of this._holdings) {
      if (heldShares <= 0) continue
      const lock = this._data.lockRegistry[holderId]
      total += heldShares * (lock ? lock.weight : 1.0)
    }
    return total
  }

  private _computeLockedWeight(): number {
    let total = 0
    for (const entry of Object.values(this._data.lockRegistry)) {
      total += entry.shares * entry.weight
    }
    return total
  }
}
