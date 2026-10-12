// ─── Enums ───────────────────────────────────────────────────────────────────

/** Hosting infrastructure tier. Cost increases with tier; see spec §2.2 for monthly prices. */
export enum HostingPlan {
  /** ~$5.33/mo */
  Nano = 'Nano',
  /** ~$10.59/mo */
  Small = 'Small',
  /** ~$21.17/mo */
  Medium = 'Medium',
  /** ~$42.34/mo */
  Large = 'Large',
  /** ~$109.50/mo */
  Dedicated = 'Dedicated',
}

/** Privacy capability tier of a deployed app. Users with stricter requirements churn if the tier drops below their threshold. */
export enum PrivacyLevel {
  /** Full TEE enclave; highest privacy guarantee */
  Sealed = 'Sealed',
  /** Encrypted storage with key management */
  Vault = 'Vault',
  /** Access control list enforced */
  Allowlisted = 'Allowlisted',
  /** No privacy guarantees */
  Open = 'Open',
}

/**
 * How a user discovered the app.
 * SEO users arrive from organic search for generic tasks and skew toward Trial/Casual cohorts.
 * Social users arrive from the creator's community (Twitter/X, Discord, Telegram) and skew toward Power/Privacy-Conscious cohorts.
 */
export enum AcquisitionChannel {
  SEO = 'SEO',
  Social = 'Social',
}

/**
 * User behaviour archetype.
 * Spawn weights: PowerUser 15%, Casual 55%, PrivacyConscious 20%, Trial 10%.
 */
export enum UserCohort {
  /** 20–50 daily requests; low price sensitivity (<$1/req); tolerates brief app outages */
  PowerUser = 'PowerUser',
  /** 1–5 daily requests; medium price sensitivity (<$0.20/req); skips apps priced above threshold */
  Casual = 'Casual',
  /** 5–15 daily requests; will pay for privacy; skips apps below Sealed/Vault tier */
  PrivacyConscious = 'PrivacyConscious',
  /** 1–3 daily requests; highly price-sensitive (<$0.05/req); skips any app above floor price */
  Trial = 'Trial',
}

/**
 * Creator behaviour archetype.
 * Spawn weights: SoloDev 50%, Startup 30%, Agency 15%, WhaleCreator 5%.
 */
export enum CreatorCohort {
  /** Niche tool; low volume, high margin; holds all auctioned shares */
  SoloDev = 'SoloDev',
  /** AI product; high volume, thin margin; sells some shares after vesting */
  Startup = 'Startup',
  /** Multiple apps; portfolio approach; diversifies across own apps */
  Agency = 'Agency',
  /** Flagship app; very high volume; stakes most shares, sells at premium */
  WhaleCreator = 'WhaleCreator',
}

/**
 * Investor behaviour archetype.
 * Spawn weights: Retail 50%, DeFiVeteran 20%, YieldHunter 15%, Speculator 10%, Whale 5%.
 */
export enum InvestorCohort {
  /** $500–$5k capital; medium risk; 3–6 month locks; follows momentum */
  Retail = 'Retail',
  /** $50k–$500k capital; low-medium risk; 6+ month auto-renew; patient, yield-focused */
  Whale = 'Whale',
  /** $5k–$50k capital; high risk; short 1–3 month locks; rotates aggressively */
  DeFiVeteran = 'DeFiVeteran',
  /** $2k–$20k capital; low risk; max 12-month locks; never rotates, yield only */
  YieldHunter = 'YieldHunter',
  /** $1k–$10k capital; very high risk; no locks; buys launch, dumps at target multiple */
  Speculator = 'Speculator',
}

/**
 * Trader behaviour archetype. Traders do not lock shares.
 * Spawn weights: RSITrader 30%, MACrossover 35%, BollingerBand 20%, Arbitrageur 10%, AuctionSniper 5%.
 */
export enum TraderCohort {
  /** Counter-cyclical; buys RSI oversold, sells RSI overbought */
  RSITrader = 'RSITrader',
  /** Trend-following; buys golden cross, exits death cross */
  MACrossover = 'MACrossover',
  /** Mean-reversion; buys lower Bollinger Band, sells upper band */
  BollingerBand = 'BollingerBand',
  /** Buys when reserve price is close to curve price; exits on curve recovery */
  Arbitrageur = 'Arbitrageur',
  /** Bids in CCA auctions; exits on post-auction price spike */
  AuctionSniper = 'AuctionSniper',
}

// ─── App ─────────────────────────────────────────────────────────────────────

/** A single shareholder lock position within an app's lock registry. */
export type LockEntry = {
  /** Number of shares locked. */
  shares: number
  /** Tick (day) when the lock expires and shares become sellable. */
  lockedUntil: number
  /**
   * Fee distribution weight multiplier.
   * Computed as `1.0 + (lockWeightMax − 1.0) × (lockMonths / lockMaxMonths)`.
   * Range: 1.0 – lockWeightMax.
   */
  weight: number
}

/**
 * Full state of a deployed app market.
 *
 * Each app has a fixed supply of 1,000 shares traded on a bonding curve where price doubles
 * every 20% of supply sold. The first `auctionSize` shares are sold via a Continuous Clearing
 * Auction (CCA); the remainder trade on the curve.
 *
 * Launch parameters (`auctionFloor` through `reserveRatio`) are the simulation's search space —
 * the sim sweeps their ranges to find the viable region where the market is attack-resistant,
 * investor-safe, and creator-viable simultaneously.
 */
export type App = {
  /** Unique app identifier. */
  id: string
  /** ID of the `CreatorActor` who deployed this app. */
  creatorId: string
  /** Tick (day) on which the app was deployed. */
  deployedAt: number

  // ── Supply & market ──────────────────────────────────────────────────────

  /** Always 1,000. Fixed supply; not configurable. */
  totalShares: number
  /** Shares sold so far (auction + bonding curve combined). */
  sharesSold: number
  /** Whether the opening CCA has completed. Bonding curve becomes active after this. */
  auctionCleared: boolean
  /** Uniform clearing price per share from the CCA. Set to 0 before auction clears. */
  auctionClearingPrice: number
  /** Current bonding curve price for the next share: `auctionClearingPrice × 2^(sharesSold / 200)`. */
  currentPrice: number

  // ── Launch parameters (simulation search space) ──────────────────────────

  /**
   * Number of ticks the CCA auction window stays open.
   *
   * Supply is released linearly each tick:
   * `Q(t) = floor(auctionSize × (t − openTick) / auctionDuration)`
   *
   * Only `Q(t)` shares can clear at any given tick; the full `auctionSize` becomes
   * available only at close. Bidders may submit and withdraw bids throughout the window.
   * Swept across [1, 14]; reference default 3.
   * @see https://docs.uniswap.org/contracts/liquidity-launchpad/Overview
   * @see spec §2.4
   */
  auctionDuration: number
  /**
   * Minimum `maxPrice` a bid must specify to be accepted into the CCA.
   * Swept across [5, 100]; reference default $20.
   * @see https://docs.uniswap.org/contracts/liquidity-launchpad/Overview
   * @see spec §2.4
   */
  auctionFloor: number
  /**
   * Number of shares sold in the CCA before the bonding curve activates.
   * Swept across [50, 400]; reference default 200 (20% of supply).
   * @see https://docs.uniswap.org/contracts/liquidity-launchpad/Overview
   * @see spec §2.4
   */
  auctionSize: number
  /**
   * Fixed selling fee rate applied on every share sale.
   * Collected from the seller and distributed to all locked shareholders weighted by lock weight.
   * Swept across [0.01, 0.20]; reference default 0.05 (5%).
   * @see spec §2.6
   */
  sellingFeeRate: number
  /**
   * Maximum lock duration in months. Shareholders may lock for 1–lockMaxMonths months.
   * Swept across [3, 24]; reference default 12.
   * @see spec §2.5
   */
  lockMaxMonths: number
  /**
   * Weight multiplier at the maximum lock duration.
   * Weight at any duration: `1.0 + (lockWeightMax − 1.0) × (months / lockMaxMonths)`.
   * Swept across [1.5, 6.0]; reference default 3.0.
   * @see spec §2.5
   */
  lockWeightMax: number
  /**
   * Fraction of each purchase price directed to the reserve pool.
   * The complement `(1 − reserveRatio)` goes to the creator.
   * Swept across [0.20, 0.80]; reference default 0.50.
   * @see spec §2.3
   */
  reserveRatio: number

  /** USDC charged to the user per API request. Drawn at deployment; drives all revenue. */
  pricingPerRequest: number

  // ── Reserve ──────────────────────────────────────────────────────────────

  /** USDC held in the reserve pool. Any shareholder can exit at `reserveBalance / sharesSold` per share. */
  reserveBalance: number

  // ── Lock registry ─────────────────────────────────────────────────────────

  /** All active lock positions keyed by holder actor ID. */
  lockRegistry: Record<string, LockEntry>

  // ── Financials ────────────────────────────────────────────────────────────

  /** USDC revenue from user request payments, rolling 30-day window. */
  monthlyRevenue: number
  /** AI inference + gas costs, rolling 30-day window. */
  variableCosts30d: number
  /** Pre-funded USDC reserve covering fixed costs (hosting, storage). */
  opsTreasury: number
  /** Target ops treasury size: N months × monthly fixed costs. */
  opsTreasuryTarget: number
  /** Protocol fee rate taken from net revenue each tick. Range: 0.0 – 0.02. */
  protocolFeeRate: number

  // ── Usage metrics ─────────────────────────────────────────────────────────

  /** Total user requests processed in the current tick. */
  dailyRequests: number
  /** Unique users who made at least one request in the last 30 ticks (MAU). */
  activeUsers30d: number
  /** All-time unique users who have ever sent at least one request to this app. */
  uniqueUsers: number
  /** Number of actors currently holding > 0 shares (investors + traders). */
  shareholderCount: number
  /** Bonding curve price per share sampled each tick, last 30 entries (index 0 = oldest). */
  priceHistory: number[]

  // ── Metadata ──────────────────────────────────────────────────────────────

  /** Hosting infrastructure tier; drives monthly fixed cost. */
  hostingPlan: HostingPlan
  /** Privacy capability tier; drives user churn if lowered. */
  privacyLevel: PrivacyLevel
  /** Whether the app is currently serving requests. Goes false if ops treasury is depleted. */
  isOnline: boolean
}

/**
 * Parameters a `CreatorActor` supplies when deploying a new app.
 * The simulation instantiates an `App` from this spec at the deployment tick.
 */
export type AppSpec = {
  /** ID of the deploying creator. */
  creatorId: string
  /** Creator cohort; determines distribution draws for quality, pricing, and hosting. */
  cohort: CreatorCohort
  /** Chosen hosting tier. */
  hostingPlan: HostingPlan
  /** USDC price charged per user request. LogNormal draw per cohort at spawn. */
  pricingPerRequest: number
  /** Initial USDC seeded into the ops treasury at deployment. */
  opsTreasurySeed: number
  /**
   * App quality score sampled from a Beta distribution at deployment.
   * Drives the popularity score and long-run revenue potential.
   * Range: [0, 1].
   */
  appQuality: number
  /**
   * Fraction of incoming user traffic sourced from SEO (vs social).
   * Sampled once at deployment; correlates with creator cohort and app type.
   * Range: [0, 1].
   */
  seoFraction: number
  /** @see App.auctionDuration */
  auctionDuration: number
  /** @see App.auctionFloor */
  auctionFloor: number
  /** @see App.auctionSize */
  auctionSize: number
  /** @see App.sellingFeeRate */
  sellingFeeRate: number
  /** @see App.lockMaxMonths */
  lockMaxMonths: number
  /** @see App.lockWeightMax */
  lockWeightMax: number
  /** @see App.reserveRatio */
  reserveRatio: number
}

// ─── Actors ──────────────────────────────────────────────────────────────────

/** An investor's or trader's share position in a single app. */
export type HolderPosition = {
  /** Shares not subject to a lock; freely sellable. */
  sharesUnlocked: number
  /** Shares currently locked; not sellable until lock expires. */
  sharesLocked: number
  /** Average USDC cost per share across all purchases in this app. */
  avgCostBasis: number
}

type BaseActor = {
  /** Unique actor identifier. */
  id: string
  /**
   * Current USDC balance.
   *
   * Initialised at spawn from `Pareto(x_min, α)` where `x_min` is cohort-specific
   * and `α = SimConfig.paretoAlpha` is shared across all cohorts.
   * For users this represents their **lifetime platform budget** (total they will
   * ever spend on requests); for investors and traders it is their available
   * investment capital. Neither figure represents the actor's real-world total wealth.
   */
  usdcBalance: number
  /** Cumulative USDC received (payouts + share sales). */
  totalUsdcEarned: number
  /** Cumulative USDC spent (share purchases + request payments). */
  totalUsdcSpent: number
  /** USDC profit on closed positions. */
  realizedPnl: number
  /** Mark-to-market USDC profit on open positions. */
  unrealizedPnl: number
}

/** A platform user who pays per request but never holds shares. */
export type UserActor = BaseActor & {
  type: 'User'
  /** Behaviour archetype; determines request rate, price sensitivity, and churn. */
  cohort: UserCohort
  /**
   * Maximum acceptable price per request in USDC.
   * Sampled from a LogNormal distribution at spawn; varies by cohort.
   * The user skips any app whose price exceeds this threshold; their USDC balance is
   * the only lifetime limit — they become inactive once it is exhausted.
   */
  priceThreshold: number
  /** Whether this user arrived via SEO or via the creator's social community. */
  acquisitionChannel: AcquisitionChannel
  /**
   * Poisson rate parameter for daily request count.
   * Sampled from a Uniform distribution per cohort at spawn.
   */
  dailyRequestLambda: number
}

/** An app creator who deploys apps, sets pricing, and receives the auction vesting allocation. */
export type CreatorActor = BaseActor & {
  type: 'Creator'
  /** Behaviour archetype; determines hosting preferences, pricing, and share retention. */
  cohort: CreatorCohort
  /** IDs of all apps this creator has deployed. */
  ownedAppIds: string[]
  /** Fraction of claimed payout reinvested by buying more shares in own apps. */
  reinvestmentRate: number
  /** Multiplier on user discovery probability. Models marketing spend effect on inflow. */
  marketingSpendMultiplier: number
  /**
   * Fraction of the CCA vesting allocation the creator sells immediately after the 6-month cliff.
   * Sampled from a Uniform distribution per cohort at spawn.
   */
  vestingSellFraction: number
}

/**
 * Exit strategy parameters for an investor actor.
 * All fields are sampled from per-cohort distributions at spawn.
 * @see spec §3.3
 */
export type InvestorStrategy = {
  /**
   * Price multiple at which the investor exits via momentum sell.
   * Sampled from Uniform[lo, hi] per cohort (e.g. Speculator [1.5, 2.0], Whale [8.0, 15.0]).
   */
  momentumTarget: number
  /**
   * Minimum acceptable annualised yield (%).
   * If `currentYieldApy < riskFloorYield` persists for `yieldPatience` ticks, the investor exits.
   * Adjusted upward for volatile apps: `effectiveFloor = riskFloorYield + riskPremium × priceVolatility30d`.
   */
  riskFloorYield: number
  /** Consecutive ticks the yield must stay below `riskFloorYield` before triggering an exit. */
  yieldPatience: number
  /**
   * Minimum APY advantage a new launch must offer over the current position to trigger rotation.
   * 0 means the investor never rotates.
   */
  rotationPremium: number
  /** Preferred lock duration in months. Used as input to lock weight calculation. */
  lockPreferenceMonths: number
  /** Maximum fraction of portfolio value that can be held in a single app. */
  maxSingleAppPct: number
  /**
   * Beta distribution α parameter for per-investment position sizing.
   *
   * Each time the investor enters a position, the fraction of available `usdcBalance`
   * to commit is sampled from `Beta(positionSizingAlpha, positionSizingBeta)`.
   * The draw is then capped at `maxSingleAppPct × totalPortfolioValue`.
   * Conservative cohorts have small α relative to β (right-skewed → small typical position);
   * aggressive cohorts have α > β (left-skewed → large typical position).
   * Per-cohort reference values: Retail (2,8) ~20%; Whale (2,10) ~17%;
   * DeFi Veteran (4,6) ~40%; Yield Hunter (3,5) ~38%; Speculator (6,4) ~60%.
   */
  positionSizingAlpha: number
  /**
   * Beta distribution β parameter for per-investment position sizing.
   * @see positionSizingAlpha
   */
  positionSizingBeta: number
}

/** An investor who holds shares, locks for yield, claims payouts, and applies four exit strategies. */
export type InvestorActor = BaseActor & {
  type: 'Investor'
  /** Behaviour archetype; determines capital, risk tolerance, lock preference, and exit parameters. */
  cohort: InvestorCohort
  /** Share positions keyed by app ID. */
  holdings: Record<string, HolderPosition>
  /** Sampled exit strategy parameters. */
  strategy: InvestorStrategy
  /** Per-app count of consecutive ticks where yield has been below `strategy.riskFloorYield`. */
  ticksBelowFloor: Record<string, number>
}

/**
 * RSI-based trading strategy.
 * Counter-cyclical: buys into oversold conditions, sells into overbought conditions.
 * In a bonding curve market, oversold conditions persist longer because the surge selling fee
 * discourages exits, giving RSI traders extended buy windows during sell-offs.
 */
export type RSIStrategy = {
  type: 'RSI'
  /** RSI lookback period in ticks. Sampled from Uniform[10, 20]. */
  rsiPeriod: number
  /** RSI level below which the trader enters a position. Sampled from Uniform[25, 40]. */
  buyThreshold: number
  /** RSI level above which the trader exits a position. Sampled from Uniform[60, 75]. */
  sellThreshold: number
}

/**
 * Moving-average crossover strategy.
 * Trend-following: buys on golden cross (fast > slow), sells on death cross (fast < slow).
 * Amplifies trends in both directions.
 */
export type MACrossoverStrategy = {
  type: 'MACrossover'
  /** Fast MA period in ticks. Sampled from Uniform[5, 10]. */
  maFast: number
  /** Slow MA period in ticks. Sampled from Uniform[20, 40]. */
  maSlow: number
}

/**
 * Bollinger Band mean-reversion strategy.
 * Buys when price touches the lower band, sells when price touches the upper band.
 */
export type BollingerBandStrategy = {
  type: 'BollingerBand'
  /** Lookback period for mean and standard deviation. Sampled from Uniform[15, 25]. */
  bbPeriod: number
  /** Band width as a σ multiplier. Sampled from Uniform[1.5, 2.5]. */
  bbWidth: number
}

/**
 * Reserve undervaluation arbitrage strategy.
 * Enters when the reserve exit price is close to the curve price (limited downside),
 * exits when the curve price recovers.
 */
export type ArbitrageurStrategy = {
  type: 'Arbitrageur'
  /** `reservePrice / curvePrice` ratio threshold to enter. Sampled from Uniform[0.55, 0.70]. */
  entryRatio: number
}

/**
 * Auction sniping strategy.
 * Bids in CCA auctions and exits on the post-auction price spike.
 */
export type AuctionSniperStrategy = {
  type: 'AuctionSniper'
  /** Post-auction price multiple at which to exit. Sampled from Uniform[1.3, 2.0]. */
  targetMultiple: number
}

/** Discriminated union of all trader signal strategies. Keyed by the `type` field. */
export type TraderStrategy =
  | RSIStrategy
  | MACrossoverStrategy
  | BollingerBandStrategy
  | ArbitrageurStrategy
  | AuctionSniperStrategy

/** A price-speculation actor who does not lock shares and trades using a technical signal strategy. */
export type TraderActor = BaseActor & {
  type: 'Trader'
  /** Behaviour archetype; determines capital and the sampled signal strategy. */
  cohort: TraderCohort
  /** Share positions keyed by app ID. */
  holdings: Record<string, HolderPosition>
  /** Technical signal strategy with parameters sampled at spawn. */
  strategy: TraderStrategy
  /**
   * Beta distribution α parameter for per-trade position sizing.
   *
   * Each time a signal fires and the trader enters a position, the fraction of available
   * `usdcBalance` to commit is sampled from `Beta(positionSizingAlpha, positionSizingBeta)`.
   * Per-cohort reference values: RSI (3,7) ~30%; MA Crossover (4,6) ~40%;
   * Bollinger Band (3,7) ~30%; Arbitrageur (5,5) ~50%; Auction Sniper (4,6) ~40%.
   * @see InvestorStrategy.positionSizingAlpha
   */
  positionSizingAlpha: number
  /**
   * Beta distribution β parameter for per-trade position sizing.
   * @see InvestorStrategy.positionSizingAlpha
   */
  positionSizingBeta: number
}

/** Discriminated union of all actor types. Narrow by the `type` field. */
export type Actor = UserActor | CreatorActor | InvestorActor | TraderActor

// ─── Global State ─────────────────────────────────────────────────────────────

/**
 * Top-level simulation state. Mutated by events each tick.
 * One tick represents one day; the simulation runs for `SimConfig.totalTicks` days (default 730).
 */
export type GlobalState = {
  /** Current day. Range: 0 – totalTicks. */
  tick: number
  /** All deployed app markets. */
  apps: App[]
  /** All active actors: users, creators, investors, traders. */
  actors: Actor[]
  /** Accumulated protocol fee revenue in USDC. */
  protocolTreasury: number
  /** Sum of all locked share values across all app markets in USDC. */
  totalLockedValue: number
  /** Daily active users across the platform this tick. */
  totalDau: number
}

// ─── Simulation Metrics ───────────────────────────────────────────────────────

/**
 * Time-series accumulators written each tick. Used for post-run analysis and
 * confidence interval computation across Monte Carlo runs.
 */
export type SimMetrics = {
  /** Total protocol fees collected per tick (index = tick). */
  totalProtocolFeesByTick: number[]
  /** Total market capitalisation (sum of all `currentPrice × sharesSold`) per tick. */
  totalMarketCapByTick: number[]
  /** Platform-wide DAU per tick. */
  totalDauByTick: number[]
  /** Total locked share value across all markets per tick. */
  totalLockedValueByTick: number[]

  /** Per-app bonding curve price history. Key = app ID, inner index = tick. */
  appPriceSeries: Record<string, number[]>
  /** Per-app revenue (USDC from user requests) per tick. */
  appRevenueSeries: Record<string, number[]>
  /** Per-app payout distributed to shareholders per tick. */
  appPayoutSeries: Record<string, number[]>
  /** Per-app shares sold (cumulative) per tick. */
  appSharesSoldSeries: Record<string, number[]>

  /** Annualised ROI aggregated by cohort per tick. Key = cohort string. */
  cohortRoiSeries: Record<string, number[]>
  /** Realised + unrealised PnL aggregated by cohort per tick. */
  cohortPnlSeries: Record<string, number[]>
}

// ─── Simulation Config ────────────────────────────────────────────────────────

/**
 * Top-level simulation configuration.
 * `default*` fields seed each `AppSpec` unless the creator overrides them;
 * they also define the centre point of the parameter search sweep.
 */
export type SimConfig = {
  /**
   * Pareto shape parameter α shared across all actor cohorts.
   * Controls wealth inequality: lower α = heavier tail = more whales.
   * Reference default 1.5 (mean = 3 × x_min per cohort; roughly matches 80/20 wealth distribution).
   * Only x_min differs per cohort; α is global.
   */
  paretoAlpha: number
  /** Number of daily ticks to simulate. Default: 730 (24 months). */
  totalTicks: number
  /** Number of independent Monte Carlo runs. Default: 100–1000. */
  monteCarloRuns: number
  /** Optional fixed seed for reproducible runs. Omit for random seeding. */
  randomSeed?: number

  /** @see App.auctionDuration — reference default 3 */
  defaultAuctionDuration: number
  /** @see App.auctionFloor — reference default $20 */
  defaultAuctionFloor: number
  /** @see App.auctionSize — reference default 200 */
  defaultAuctionSize: number
  /** @see App.sellingFeeRate — reference default 0.05 */
  defaultSellingFeeRate: number
  /** @see App.lockMaxMonths — reference default 12 */
  defaultLockMaxMonths: number
  /** @see App.lockWeightMax — reference default 3.0 */
  defaultLockWeightMax: number
  /** @see App.reserveRatio — reference default 0.50 */
  defaultReserveRatio: number
}
