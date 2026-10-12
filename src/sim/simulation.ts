import type { SimConfig, App } from '../models.js'
import { World } from './world.js'
import { Spawner } from './spawner.js'
import { RNG } from './rng.js'
import { ScenarioEngine } from './scenarios.js'
import type { SimEvent } from './sim-event.js'
export type { SimEvent } from './sim-event.js'
export type { HolderStat } from './app-market.js'
export { ScenarioType } from './scenarios.js'
export type { ScenarioStatus } from './scenarios.js'

/** Lean per-tick platform metrics — no per-app state stored inline. */
export type TickPoint = {
  /** Simulation day index (0-based). */
  tick: number
  /** Current share price keyed by app ID. */
  appPrices: Record<string, number>
  /** Total number of deployed apps. */
  totalApps: number
  /** Apps with isOnline === true. */
  activeApps: number
  /** Cumulative protocol fees collected. */
  platformFees: number
  /** Sum of dailyRequests across all apps. */
  totalDau: number
  /** Sum of price × sharesSold across all apps. */
  totalMarketCap: number
  /** Sum of locked share value across all apps. */
  totalLockedValue: number
  /** Total user actors in world. */
  uniqueUsers: number
  /** Investors with any holdings or balance. */
  activeInvestors: number
  /** Traders with any holdings or balance. */
  activeTraders: number
}

/** Complete simulation output: time series + final app state for sparklines. */
export type SimResult = {
  series: TickPoint[]
  finalApps: App[]
}

/** Default simulation config — reference parameter values. */
export const defaultConfig: SimConfig = {
  paretoAlpha: 1.5,
  totalTicks: 365,
  monteCarloRuns: 1,
  randomSeed: 42,
  defaultAuctionDuration: 3,
  defaultAuctionFloor: 20,
  defaultAuctionSize: 200,
  defaultSellingFeeRate: 0.05,
  defaultLockMaxMonths: 12,
  defaultLockWeightMax: 3.0,
  defaultReserveRatio: 0.50,
}

export class Simulation {
  private readonly config: SimConfig
  private readonly world: World
  private readonly spawner: Spawner
  private readonly rng: RNG
  private readonly scenarioEngine: ScenarioEngine
  private cumulativeFees = 0
  private _currentTick = 0
  private _initialized = false

  constructor(config: SimConfig) {
    this.config = config
    this.world = new World()
    this.rng = new RNG(config.randomSeed ?? Math.floor(Math.random() * 0xffffffff))
    this.spawner = new Spawner(config, this.rng)
    this.scenarioEngine = new ScenarioEngine()
  }

  /** Set up initial world state. Must be called before step(). */
  initialize(): void {
    if (this._initialized) return
    this._initialize()
    this._initialized = true
  }

  /** Advance one tick and return its metrics snapshot. Runs indefinitely. */
  step(): TickPoint {
    if (!this._initialized) this.initialize()
    this.world.tick = this._currentTick
    this._tick()
    const point = this._tickPoint()
    this._currentTick++
    return point
  }

  /** Total ticks stepped so far. */
  get tickCount(): number {
    return this._currentTick
  }

  /** True only when totalTicks is set and reached (used by run()). */
  private get _isDone(): boolean {
    return this._currentTick >= this.config.totalTicks
  }

  /** Snapshot of current app states (grows with priceHistory as sim progresses). */
  getFinalApps(): App[] {
    return this.world.apps.map(a => a.data)
  }

  /** All logged events for one app, oldest first. */
  getAppEvents(appId: string): SimEvent[] {
    return this.world.apps.find(a => a.data.id === appId)?.events ?? []
  }

  /** Current holder PnL stats for one app, sorted by total PnL desc. */
  getHolderStats(appId: string) {
    return this.world.apps.find(a => a.data.id === appId)?.getHolderStats() ?? []
  }

  /**
   * Manually trigger a scripted abuse scenario on an app.
   * Safe to call while the simulation is running.
   * Returns false if the app doesn't exist or the scenario is already active.
   */
  triggerScenario(appId: string, type: import('./scenarios.js').ScenarioType): boolean {
    return this.scenarioEngine.trigger(appId, type, this.world)
  }

  /** Enable or disable random scenario injection each tick. */
  setRandomScenariosEnabled(enabled: boolean): void {
    this.scenarioEngine.setRandomEnabled(enabled)
  }

  get randomScenariosEnabled(): boolean {
    return this.scenarioEngine.randomEnabled
  }

  /** Scenario statuses for a specific app, newest first. */
  getScenarioStatuses(appId: string): import('./scenarios.js').ScenarioStatus[] {
    return this.scenarioEngine.statusesForApp(appId)
  }

  /** Synchronous convenience: run totalTicks ticks and return the complete result. */
  run(): SimResult {
    this.initialize()
    const series: TickPoint[] = []
    while (!this._isDone) {
      series.push(this.step())
    }
    return { series, finalApps: this.getFinalApps() }
  }

  private _initialize(): void {
    // Seed marketplace with one creator and one app
    const c0 = this.spawner.spawnCreator(this.world)
    this.spawner.deployApp(c0, this.world, 0)

    // Initial investor / trader pool
    for (let i = 0; i < 3; i++) this.world.investors.push(this.spawner.spawnInvestor())
    for (let i = 0; i < 2; i++) this.world.traders.push(this.spawner.spawnTrader())
  }

  private _tick(): number {
    const tick = this.world.tick

    // Step 0: prime each app with the current tick + reset per-tick request counter
    for (const app of this.world.apps) {
      app.setTick(tick)
      app.resetDailyRequests()
    }

    // Step 1: new user arrivals (scales with app count — network effect)
    this.spawner.arriveUsers(this.world, tick)

    // Step 2: shuffle users, each steps (makes requests, spends USDC)
    const shuffledUsers = this.rng.shuffle(this.world.users)
    for (const user of shuffledUsers) {
      user.step(this.world, this.rng)
    }

    // Step 3: distribute profit from each app; collect protocol fees
    let tickFees = 0
    for (const app of this.world.apps) {
      const fee = app.distributeProfit(tick)
      tickFees += fee
    }
    this.world.protocolTreasury += tickFees
    this.cumulativeFees += tickFees

    // Step 4: shuffle investors + traders, each step
    const investorsAndTraders = this.rng.shuffle([...this.world.investors, ...this.world.traders])
    for (const actor of investorsAndTraders) {
      actor.step(this.world, this.rng)
    }

    // Step 5: creators step
    for (const creator of this.world.creators) {
      creator.step(this.world, this.rng)
    }

    // Step 6: settle auctions
    for (const app of this.world.apps) {
      app.settleAuction(tick, this.rng)
    }

    // Step 7: expire locks
    for (const app of this.world.apps) {
      app.expireLocks(tick)
    }

    // Step 7.5: advance / randomly trigger abuse scenarios
    this.scenarioEngine.step(this.world, this.rng)

    // Step 8: demand-driven app deployment
    //
    // Two forces drive new apps:
    //   Vacuum  — when users-per-app is high there is unmet demand (sustained signal)
    //   Early   — first-mover incentive in the first ~60 ticks (decays exponentially)
    //
    // A saturation dampener ensures the rate falls off as the market fills.
    {
      const onlineApps = Math.max(this.world.apps.filter(a => a.data.isOnline).length, 1)
      const usersPerApp = this.world.users.length / onlineApps

      // Vacuum pressure: kicks in meaningfully above 2 users/app, peaks around 10+
      const vacuumPressure = Math.max(0, (usersPerApp / 5 - 0.4) * 0.20)

      // Early-market burst: strong in first 60 ticks, negligible after ~150
      const earlyBonus = Math.exp(-tick / 45) * 0.15

      // Saturation: each additional app exponentially dampens deployment probability
      const saturation = Math.exp(-this.world.apps.length / 20)

      const pDeploy = Math.min(0.50, (vacuumPressure + earlyBonus) * saturation)

      if (this.rng.next() < pDeploy) {
        const creator = this.spawner.spawnCreator(this.world)
        this.spawner.deployApp(creator, this.world, tick)
      }
    }

    // Step 9: scale investor / trader pool with marketplace size
    {
      const targetInvestors = Math.min(60, 5 + this.world.apps.length * 3)
      const targetTraders   = Math.min(35, 3 + this.world.apps.length)
      if (tick % 15 === 0 && this.world.investors.length < targetInvestors) {
        this.world.investors.push(this.spawner.spawnInvestor())
      }
      if (tick % 20 === 0 && this.world.traders.length < targetTraders) {
        this.world.traders.push(this.spawner.spawnTrader())
      }
    }

    return tickFees
  }

  private _tickPoint(): TickPoint {
    const appPrices: Record<string, number> = {}
    let totalMarketCap = 0
    let totalLockedValue = 0
    let totalDau = 0
    let activeApps = 0

    for (const app of this.world.apps) {
      const d = app.data
      appPrices[d.id] = d.currentPrice
      totalMarketCap += d.currentPrice * d.sharesSold
      totalLockedValue += app.totalLockedValue
      totalDau += d.dailyRequests
      if (d.isOnline) activeApps++
    }

    const activeInvestors = this.world.investors.filter(
      i => i.holdingsMap.size > 0 || i.usdcBalance > 0
    ).length

    const activeTraders = this.world.traders.filter(
      t => t.holdingsMap.size > 0 || t.usdcBalance > 0
    ).length

    return {
      tick: this.world.tick,
      appPrices,
      totalApps: this.world.apps.length,
      activeApps,
      platformFees: this.cumulativeFees,
      totalDau,
      totalMarketCap,
      totalLockedValue,
      uniqueUsers: this.world.users.length,
      activeInvestors,
      activeTraders,
    }
  }
}
