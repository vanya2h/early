import type { AppMarket } from './app-market.js'
import type { World } from './world.js'
import type { RNG } from './rng.js'

// ─── Public types ─────────────────────────────────────────────────────────────

/** Scripted abuse scenario categories. */
export enum ScenarioType {
  /** Single actor accumulates 30–40% of supply then dumps in one block. §7.1 */
  WhaleDump = 'WhaleDump',
  /** Multiple holders sell simultaneously; tests race-to-exit dynamics. §7.2 */
  CoordSell = 'CoordSell',
  /** All active locks expire immediately; tests lock-cliff structural risk. §7.3 */
  LockCliff = 'LockCliff',
  /** Creator bot injects $500/day fake revenue for 30 ticks. §7.4 */
  FakeRevenue = 'FakeRevenue',
  /** Adversarial requests drain the ops treasury for 14 ticks. §7.5 */
  TreasuryDrain = 'TreasuryDrain',
}

/** Snapshot of a running or completed scenario instance. */
export type ScenarioStatus = {
  id: string
  type: ScenarioType
  appId: string
  startTick: number
  endTick?: number
  phase: 'active' | 'done'
  /** Ticks elapsed / total for multi-tick scenarios. */
  progress?: { elapsed: number; total: number }
  /** Human-readable outcome, set on completion. */
  summary: string
}

// ─── Monthly hosting cost (duplicated from app-market to avoid a circular dep) ──

const HOSTING_COST: Record<string, number> = {
  Nano: 5.33, Small: 10.59, Medium: 21.17, Large: 42.34, Dedicated: 109.5,
}

// ─── ScenarioInstance ─────────────────────────────────────────────────────────

class ScenarioInstance {
  readonly id: string
  readonly type: ScenarioType
  readonly appId: string
  readonly startTick: number

  private _phase: 'active' | 'done' = 'active'
  private _summary = ''
  private _endTick = 0
  private _ticksElapsed = 0

  // Pre-scenario baseline captured on first tick
  private _prePrice = 0
  private _preReserve = 0

  constructor(id: string, type: ScenarioType, appId: string, startTick: number) {
    this.id = id
    this.type = type
    this.appId = appId
    this.startTick = startTick
  }

  get isDone(): boolean {
    return this._phase === 'done'
  }

  get status(): ScenarioStatus {
    const multi = this._durationTicks > 1
    const base: ScenarioStatus = {
      id: this.id,
      type: this.type,
      appId: this.appId,
      startTick: this.startTick,
      phase: this._phase,
      summary: this._summary,
    }
    if (this._phase === 'done') base.endTick = this._endTick
    if (multi) base.progress = { elapsed: this._ticksElapsed, total: this._durationTicks }
    return base
  }

  private get _durationTicks(): number {
    switch (this.type) {
      case ScenarioType.FakeRevenue: return 30
      case ScenarioType.TreasuryDrain: return 14
      default: return 1
    }
  }

  /** Execute one tick of this scenario. */
  step(market: AppMarket, world: World, rng: RNG): void {
    const tick = world.tick

    if (this._ticksElapsed === 0) {
      this._prePrice = market.data.currentPrice
      this._preReserve = market.data.reserveBalance
    }

    switch (this.type) {
      case ScenarioType.WhaleDump:
        this._execWhaleDump(market, world, rng, tick)
        break
      case ScenarioType.CoordSell:
        this._execCoordSell(market, world, rng, tick)
        break
      case ScenarioType.LockCliff:
        this._execLockCliff(market, tick)
        break
      case ScenarioType.FakeRevenue:
        this._execFakeRevenuePerTick(market, tick)
        break
      case ScenarioType.TreasuryDrain:
        this._execTreasuryDrainPerTick(market, tick)
        break
    }

    this._ticksElapsed++

    if (this._ticksElapsed >= this._durationTicks) {
      this._phase = 'done'
      this._endTick = tick
      this._buildSummary(market)
    }
  }

  // ── Scenario implementations ─────────────────────────────────────────────

  private _execWhaleDump(market: AppMarket, _world: World, rng: RNG, tick: number): void {
    if (!market.data.auctionCleared || market.data.sharesSold < 20) {
      this._summary = 'Skipped — auction not cleared or insufficient supply'
      return
    }

    const frac = 0.30 + rng.next() * 0.10 // 30–40%
    const whaleShares = Math.floor(market.data.sharesSold * frac)
    const whaleId = `scenario-whale-${this.id}`

    const priceBeforeInject = market.data.currentPrice
    market.injectHolding(whaleId, whaleShares)
    const priceAfterInject = market.data.currentPrice

    const proceeds = market.sell(whaleId, whaleShares)
    const priceAfterDump = market.data.currentPrice
    const priceDrop = priceAfterInject > 0
      ? ((priceAfterDump - priceAfterInject) / priceAfterInject * 100)
      : 0

    market.logEvent({
      tick,
      kind: 'SCENARIO_WHALE_DUMP',
      label: `Whale dump: ${whaleShares} shares (${(frac * 100).toFixed(0)}% of supply) — price ${priceDrop.toFixed(1)}%`,
      value: proceeds,
    })

    this._summary =
      `${whaleShares} shares dumped. Price: $${priceBeforeInject.toFixed(2)} → $${priceAfterDump.toFixed(2)} (${priceDrop.toFixed(1)}%)`
  }

  private _execCoordSell(market: AppMarket, world: World, rng: RNG, tick: number): void {
    if (!market.data.auctionCleared) {
      this._summary = 'Skipped — auction not cleared'
      return
    }

    const stats = market.getHolderStats()
    if (stats.length < 2) {
      this._summary = 'Skipped — fewer than 2 holders'
      return
    }

    const count = Math.min(stats.length, 3 + Math.floor(rng.next() * 6))
    const targets = stats.slice(0, count)
    let totalProceeds = 0
    let totalShares = 0

    for (const stat of targets) {
      market.forceUnlock(stat.actorId)
      const proceeds = market.sell(stat.actorId, stat.shares)
      totalProceeds += proceeds
      totalShares += stat.shares
      // Keep actor holdingsMap in sync so they don't re-enter a stale position
      this._evictActorPosition(stat.actorId, market.data.id, world)
    }

    market.logEvent({
      tick,
      kind: 'SCENARIO_COORD_SELL',
      label: `Coordinated sell: ${count} holders dumped ${totalShares.toFixed(0)} shares`,
      value: totalProceeds,
    })

    const priceDrop = this._prePrice > 0
      ? ((market.data.currentPrice - this._prePrice) / this._prePrice * 100)
      : 0
    this._summary =
      `${count} holders sold ${totalShares.toFixed(0)} sh for $${totalProceeds.toFixed(0)}. Price ${priceDrop.toFixed(1)}%`
  }

  private _execLockCliff(market: AppMarket, tick: number): void {
    const lockCount = Object.keys(market.data.lockRegistry).length
    market.expireAllLocks()

    market.logEvent({
      tick,
      kind: 'SCENARIO_LOCK_CLIFF',
      label: `Lock cliff: ${lockCount} lock${lockCount !== 1 ? 's' : ''} force-expired`,
    })

    this._summary = `${lockCount} lock${lockCount !== 1 ? 's' : ''} force-expired`
  }

  private _execFakeRevenuePerTick(market: AppMarket, tick: number): void {
    const dailyFake = 500
    market.injectRevenue(dailyFake)

    if (this._ticksElapsed === 0) {
      market.logEvent({
        tick,
        kind: 'SCENARIO_FAKE_REVENUE',
        label: `Fake revenue bot started — injecting $${dailyFake}/day for ${this._durationTicks} ticks`,
      })
    }
  }

  private _execTreasuryDrainPerTick(market: AppMarket, tick: number): void {
    const monthlyCost = HOSTING_COST[market.data.hostingPlan] ?? 10.59
    // Attack simulates 3× normal variable cost burn
    const drainPerDay = (monthlyCost / 30) * 3
    market.drainTreasury(drainPerDay)

    if (this._ticksElapsed === 0) {
      market.logEvent({
        tick,
        kind: 'SCENARIO_TREASURY_DRAIN',
        label: `Treasury drain attack started — $${drainPerDay.toFixed(2)}/day for ${this._durationTicks} ticks`,
      })
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Remove a force-sold position from the actor's own holdings map. */
  private _evictActorPosition(actorId: string, appId: string, world: World): void {
    for (const inv of world.investors) {
      if (inv.id === actorId) {
        inv.holdingsMap.delete(appId)
        inv.ticksBelowFloor.delete(appId)
        return
      }
    }
    for (const tr of world.traders) {
      if (tr.id === actorId) {
        tr.holdingsMap.delete(appId)
        return
      }
    }
  }

  private _buildSummary(market: AppMarket): void {
    if (this._summary) return

    const pricePct = this._prePrice > 0
      ? ((market.data.currentPrice - this._prePrice) / this._prePrice * 100)
      : 0

    switch (this.type) {
      case ScenarioType.FakeRevenue:
        this._summary = `Injected $${500 * this._ticksElapsed} over ${this._ticksElapsed} ticks. Price ${pricePct > 0 ? '+' : ''}${pricePct.toFixed(1)}%`
        break
      case ScenarioType.TreasuryDrain:
        this._summary = market.data.isOnline
          ? `App survived ${this._ticksElapsed} ticks of drain`
          : `App went offline after ${this._ticksElapsed} ticks`
        market.logEvent({
          tick: this._endTick,
          kind: 'SCENARIO_TREASURY_DRAIN',
          label: this._summary,
        })
        break
      default:
        this._summary = `Completed tick ${this._endTick}`
    }
  }
}

// ─── ScenarioEngine ───────────────────────────────────────────────────────────

/** Manages scripted abuse scenarios for a running simulation. */
export class ScenarioEngine {
  private _active = new Map<string, ScenarioInstance>()
  private _history: ScenarioStatus[] = []
  private _randomEnabled = false
  private _idCounter = 0

  setRandomEnabled(enabled: boolean): void {
    this._randomEnabled = enabled
  }

  get randomEnabled(): boolean {
    return this._randomEnabled
  }

  /** All statuses sorted by startTick descending (newest first). */
  allStatuses(): ScenarioStatus[] {
    const active = Array.from(this._active.values()).map(s => s.status)
    return [...active, ...this._history].sort((a, b) => b.startTick - a.startTick)
  }

  /** Statuses for a specific app (active + historical). */
  statusesForApp(appId: string): ScenarioStatus[] {
    return this.allStatuses().filter(s => s.appId === appId)
  }

  /**
   * Manually trigger a scenario.
   * Returns false if the app doesn't exist or an identical active scenario is already running.
   */
  trigger(appId: string, type: ScenarioType, world: World): boolean {
    if (!world.getApp(appId)) return false
    for (const s of this._active.values()) {
      if (s.appId === appId && s.type === type) return false
    }
    const id = `scenario-${++this._idCounter}`
    this._active.set(id, new ScenarioInstance(id, type, appId, world.tick))
    return true
  }

  /** Advance all active scenarios one tick. Call once per simulation tick after lock expirations. */
  step(world: World, rng: RNG): void {
    if (this._randomEnabled) {
      this._maybeRandomTrigger(world, rng)
    }

    for (const [id, instance] of this._active) {
      const market = world.getApp(instance.appId)
      if (!market) {
        this._history.push(instance.status)
        this._active.delete(id)
        continue
      }
      instance.step(market, world, rng)
      if (instance.isDone) {
        this._history.push(instance.status)
        this._active.delete(id)
      }
    }
  }

  // ─── Random trigger ───────────────────────────────────────────────────────

  private _maybeRandomTrigger(world: World, rng: RNG): void {
    for (const market of world.apps) {
      if (!market.data.auctionCleared || !market.data.isOnline) continue

      const appId = market.data.id
      const activeCount = Array.from(this._active.values()).filter(s => s.appId === appId).length
      if (activeCount >= 2) continue

      const r = rng.next()

      // Cumulative thresholds — one event max per app per tick
      if (r < 0.002 && market.data.sharesSold > 50) {
        this._tryRandom(appId, ScenarioType.WhaleDump, world)
      } else if (r < 0.003 && market.getHolderStats().length >= 3) {
        this._tryRandom(appId, ScenarioType.CoordSell, world)
      } else if (r < 0.006) {
        this._tryRandom(appId, ScenarioType.FakeRevenue, world)
      } else if (r < 0.008) {
        this._tryRandom(appId, ScenarioType.TreasuryDrain, world)
      }
    }
  }

  private _tryRandom(appId: string, type: ScenarioType, world: World): void {
    for (const s of this._active.values()) {
      if (s.appId === appId && s.type === type) return
    }
    const id = `scenario-${++this._idCounter}`
    this._active.set(id, new ScenarioInstance(id, type, appId, world.tick))
  }
}
