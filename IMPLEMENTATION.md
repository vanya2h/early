# Implementation Plan

## Class Hierarchy

```
Simulation
├── World                    (GlobalState wrapper — single source of truth)
│   ├── AppMarket[]          (per-app market logic)
│   │   ├── BondingCurve     (pure math, no state)
│   │   └── AuctionEngine    (CCA bid queue + clearing)
│   └── Actor[]
│       ├── UserActor
│       ├── CreatorActor
│       ├── InvestorActor
│       └── TraderActor
├── MetricsCollector
├── Spawner                  (actor factory — draws from distributions)
└── RNG                      (seeded PRNG, injected everywhere)
```

## Tick Engine

`Simulation` drives everything. Actors do not call each other — the engine phases them:

```typescript
class Simulation {
  private tick(): void {
    this.spawner.arriveUsers(this.world)       // 1. new user arrivals
    this.processRequests()                     // 2. user requests (RNG-shuffled)
    this.world.apps.forEach(a =>
      a.distributeProfit())                    // 3. PROFIT_DISTRIBUTION
    this.world.investors.forEach(i =>
      i.step(this.world))                      // 4. investor decisions
    this.world.traders.forEach(t =>
      t.step(this.world))                      //    (traders same phase)
    this.world.creators.forEach(c =>
      c.step(this.world))                      // 5. creator deployments
    this.world.apps.forEach(a =>
      a.settleAuction(this.world.tick))        // 6. auction settlements
    this.world.apps.forEach(a =>
      a.expireLocks(this.world))               // 7. lock expirations
    this.metrics.snapshot(this.world)          // 8. metrics
    this.world.tick++
  }

  run(): SimMetrics {
    this.initialize()
    for (let t = 0; t < this.config.totalTicks; t++) this.tick()
    return this.metrics.aggregate()
  }
}
```

## Key Classes

**`Actor` (abstract)** — base for all actor types; holds `usdcBalance`, bookkeeping fields from `BaseActor`; subclasses implement `step(world: World): void`

**`AppMarket`** — wraps `App` data type; exposes `buy()`, `sell()`, `lock()`, `unlock()`, `distributeProfit()`, `settleAuction()`; owns a `BondingCurve` and nullable `AuctionEngine`

**`BondingCurve`** — pure static methods; `price(sharesSold, floor)` and `costToAcquire(from, amount, floor)`

**`AuctionEngine`** — holds the live bid list; `submitBid()`, `clearingPrice(tick)`, `settle()` → returns `AuctionResult` with winner allocations and refunds

**`Spawner`** — actor factory; reads `SimConfig` + `Distributions` to draw initial USDC balances and per-cohort parameters; called each tick for new arrivals

**`Distributions`** — static sampling utilities: `pareto()`, `beta()`, `logNormal()`, `poisson()`, `uniform()` — all take an `RNG` instance for reproducibility

**`RNG`** — thin wrapper around a seeded PRNG (xoshiro128); passed by injection into every class that needs randomness; `next(): number`, `shuffle<T>()`

**`MetricsCollector`** — observes `World` each tick; accumulates `SimMetrics` time series; `aggregate()` returns the final struct

## Strategy Pattern for Traders

Trader signal logic is extracted into behavior objects so `TraderActor` stays generic:

```typescript
interface TraderBehavior {
  shouldEnter(app: AppMarket, world: World, rng: RNG): boolean
  shouldExit(position: HolderPosition, app: AppMarket): boolean
}

class RSIBehavior implements TraderBehavior { ... }
class MACrossoverBehavior implements TraderBehavior { ... }
class BollingerBandBehavior implements TraderBehavior { ... }
class ArbitrageurBehavior implements TraderBehavior { ... }
class AuctionSniperBehavior implements TraderBehavior { ... }
```

`TraderActor` holds one `TraderBehavior` instance assigned at spawn based on cohort. Investor exit logic stays on `InvestorActor` directly — all cohorts share the same three-trigger pattern; only the parameters differ.

## Distribution System

### Core Interface

Every distribution implements a single interface. The `DistParam<T>` alias allows any parameter slot to accept either a fixed value or another distribution, enabling composition without special combinators.

```typescript
interface Distribution<T = number> {
  sample(rng: RNG): T
}

// Any parameter can be a fixed value or a sampled distribution
type DistParam<T> = T | Distribution<T>

// Internal helper — resolves a DistParam at sample time
function resolve<T>(param: DistParam<T>, rng: RNG): T {
  return isDistribution(param) ? param.sample(rng) : param
}
```

### Concrete Distributions

| Class | Parameters | Output |
|---|---|---|
| `Uniform` | `lo, hi: DistParam<number>` | `[lo, hi)` |
| `Pareto` | `xMin, alpha: DistParam<number>` | `≥ xMin` |
| `Beta` | `alpha, beta: DistParam<number>` | `[0, 1]` |
| `LogNormal` | `mu, sigma: DistParam<number>` | `> 0` |
| `Normal` | `mu, sigma: DistParam<number>` | `ℝ` |
| `Exponential` | `mean: DistParam<number>` | `> 0` |
| `Poisson` | `lambda: DistParam<number>` | integer `≥ 0` |
| `Categorical<T>` | `items: T[], weights: DistParam<number>[]` | `T` |
| `Constant<T>` | `value: T` | `T` (no randomness) |
| `Derived<T>` | `fn: (rng: RNG) => T` | `T` (arbitrary logic) |

`Derived<T>` is the escape hatch for sampling composite objects (e.g. a fully-sampled `TraderStrategy` record) without creating a bespoke class:

```typescript
const rsiStrategyDist = new Derived<RSIStrategy>(rng => ({
  type: 'RSI',
  rsiPeriod:      new Uniform(10, 20).sample(rng),
  buyThreshold:   new Uniform(25, 40).sample(rng),
  sellThreshold:  new Uniform(60, 75).sample(rng),
}))
```

### Composition

`DistParam<T>` makes distributions composable — pass a child distribution anywhere a scalar is expected:

```typescript
// λ is resampled from Uniform on every call — useful for per-tick draws
const requestsPerTick = new Poisson(new Uniform(1, 5))

// vs. λ fixed at spawn — the more common pattern for actor parameters
const lambda = new Uniform(1, 5).sample(rng)          // sampled once
const requestsPerTick = new Poisson(lambda)             // reused every tick
```

The same `Poisson` class handles both cases because `lambda: DistParam<number>` accepts either.

### Cohort Distribution Maps

`Spawner` builds one distribution map per actor type at construction time from `SimConfig`. All spawn-time draws read from these maps; tick-time draws (e.g. daily requests) create lightweight one-off distributions inline.

```typescript
type UserCohortDists = {
  lifetimeBudget:      Distribution<number>   // Pareto  — drawn once at spawn
  priceThreshold:      Distribution<number>   // LogNormal — drawn once at spawn
  dailyRequestLambda:  Distribution<number>   // Uniform — drawn once at spawn; stored on actor
}

type InvestorCohortDists = {
  capital:             Distribution<number>   // Pareto — drawn once at spawn
  momentumTarget:      Distribution<number>   // Uniform — drawn at each new position entry
  riskFloorYield:      number                 // fixed per cohort
  yieldPatience:       number                 // fixed per cohort
  rotationPremium:     number                 // fixed per cohort
  positionSizingAlpha: number                 // fixed per cohort
  positionSizingBeta:  number                 // fixed per cohort
}

type TraderCohortDists = {
  capital:     Distribution<number>           // Pareto — drawn once at spawn
  strategy:    Distribution<TraderStrategy>   // Derived — draws all signal params at spawn
}

type CreatorCohortDists = {
  pricing:           Distribution<number>     // LogNormal — drawn at app deployment
  appQuality:        Distribution<number>     // Beta — drawn at app deployment
  opsTreasurySeed:   Distribution<number>     // Uniform × monthly_fixed
  vestingSellFrac:   Distribution<number>     // Uniform — drawn at auction close
  hostingPlan:       Distribution<HostingPlan> // Categorical — drawn at app deployment
}
```

Maps are keyed by cohort enum:

```typescript
class Spawner {
  private readonly userDists: Record<UserCohort, UserCohortDists>
  private readonly investorDists: Record<InvestorCohort, InvestorCohortDists>
  private readonly traderDists: Record<TraderCohort, TraderCohortDists>
  private readonly creatorDists: Record<CreatorCohort, CreatorCohortDists>

  constructor(config: SimConfig, rng: RNG) {
    const α = config.paretoAlpha
    this.userDists = {
      [UserCohort.PowerUser]: {
        lifetimeBudget:     new Pareto(50, α),
        priceThreshold:     new LogNormal(-0.69, 0.7),
        dailyRequestLambda: new Uniform(20, 50),
      },
      [UserCohort.Casual]: {
        lifetimeBudget:     new Pareto(10, α),
        priceThreshold:     new LogNormal(-1.90, 0.5),
        dailyRequestLambda: new Uniform(1, 5),
      },
      // ... PrivacyConscious, Trial
    }
    // ... investorDists, traderDists, creatorDists
  }
}
```

### Sampling Convention

| When | Pattern |
|---|---|
| Actor spawn — fixed for actor's lifetime | `dist.sample(rng)` → store on actor field |
| Per-tick draw using actor's stored param | `new Poisson(actor.dailyRequestLambda).sample(rng)` |
| Per-decision draw (e.g. position sizing) | `new Beta(α, β).sample(rng)` inline in `step()` |
| Composite object (strategy, hosting plan) | `new Derived(fn).sample(rng)` → store on actor |

## Design Decisions

- **Direct mutation** — actors mutate `World` state directly; no event queue, no return values. The simulation is single-threaded and deterministic; event sourcing adds complexity with no benefit here.
- **Injected RNG** — `RNG` is passed by injection (not a global singleton) so Monte Carlo runs can be seeded independently with no shared state.
- **Data/behaviour split** — `AppMarket` wraps the `App` data type from `models.ts` rather than being the data type itself; pure data stays serializable and storable.
- **Uniform trader class** — trader cohort spawn weight determines which `TraderBehavior` is created; `TraderActor` itself is always the same class.

## File Structure

```
src/
  models.ts                 — data types (done)
  simulation.ts             — Simulation, main loop, Monte Carlo
  world.ts                  — World class
  rng.ts                    — seeded RNG
  distributions/
    distribution.ts         — Distribution<T> interface, DistParam<T>, resolve()
    uniform.ts              — Uniform
    pareto.ts               — Pareto
    beta.ts                 — Beta
    log-normal.ts           — LogNormal
    normal.ts               — Normal
    exponential.ts          — Exponential
    poisson.ts              — Poisson
    categorical.ts          — Categorical<T>
    constant.ts             — Constant<T>
    derived.ts              — Derived<T>
    index.ts                — re-exports all
  metrics.ts                — MetricsCollector
  spawn/
    spawner.ts              — actor factory + all cohort distribution maps
  actors/
    actor.ts                — abstract Actor
    user-actor.ts
    creator-actor.ts
    investor-actor.ts
    trader-actor.ts
  markets/
    app-market.ts           — AppMarket
    bonding-curve.ts        — BondingCurve
    auction-engine.ts       — AuctionEngine
  strategies/
    trader-behavior.ts      — TraderBehavior interface + all five implementations
```
