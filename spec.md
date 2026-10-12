# Early.cool Economic Simulation Specification

Oct 5, 2026 · @Ivan Koriakovtcev

## Table of Contents

- [Overview & Objectives](#overview--objectives)
  - [Scope](#scope)
- [Platform Mechanics](#platform-mechanics)
  - [2.1 Running Cost Priority Order](#21-running-cost-priority-order)
  - [2.2 Hosting Cost Reference](#22-hosting-cost-reference)
  - [2.3 Bonding Curve](#23-bonding-curve)
  - [2.4 Opening Auction (Uniswap CCA)](#24-opening-auction-uniswap-cca)
  - [2.5 Locking Mechanics](#25-locking-mechanics)
  - [2.6 Selling Fee](#26-selling-fee)
  - [2.7 Profit Payout Distribution](#27-profit-payout-distribution)
- [Actors & Cohorts](#actors--cohorts)
  - [3.1 Users](#31-users)
  - [3.2 App Creators](#32-app-creators)
  - [3.3 Investors](#33-investors)
  - [3.4 Traders](#34-traders)
  - [3.5 Platform](#35-platform)
- [State Variables](#state-variables)
- [Events & Transitions](#events--transitions)
  - [5.1 User Events](#51-user-events)
  - [5.2 Creator Events](#52-creator-events)
  - [5.3 Auction Events](#53-auction-events)
  - [5.4 Market Events](#54-market-events)
  - [5.5 Financial Events](#55-financial-events)
- [Multi-Market Dynamics](#multi-market-dynamics)
  - [6.1 Traffic Distribution](#61-traffic-distribution)
  - [6.2 New App Deployment Rate](#62-new-app-deployment-rate)
  - [6.3 Investor Rotation](#63-investor-rotation)
  - [6.4 App Lifecycle Model](#64-app-lifecycle-model)
  - [6.5 Reserve Price Floor & Cross-App Contagion](#65-reserve-price-floor--cross-app-contagion)
  - [6.6 Liquidity Spreading Metric](#66-liquidity-spreading-metric)
- [Abuse Scenarios](#abuse-scenarios)
  - [7.1 Whale Dump](#71-whale-dump)
  - [7.2 Coordinated Sell-Off](#72-coordinated-sell-off)
  - [7.3 Lock-Expiry Cliff](#73-lock-expiry-cliff)
  - [7.4 Fake Revenue Inflation](#74-fake-revenue-inflation)
  - [7.5 Ops Treasury Drain Attack](#75-ops-treasury-drain-attack)
  - [7.6 Market Recovery Benchmark](#76-market-recovery-benchmark)
- [Simulation Parameters](#simulation-parameters)
  - [8.1 Time Model](#81-time-model)
  - [8.2 Initialization](#82-initialization)
  - [8.3 Stochastic Distributions](#83-stochastic-distributions)
    - [8.3.1 Actor Cohort Mix](#831-actor-cohort-mix)
    - [8.3.2 App Configuration Distributions](#832-app-configuration-distributions)
    - [8.3.3 User Behavior Distributions](#833-user-behavior-distributions)
    - [8.3.4 Investor and Trader Capital Distributions](#834-investor-and-trader-capital-distributions)
    - [8.3.5 Trader Signal Parameters](#835-trader-signal-parameters)
  - [8.4 Monte Carlo Configuration](#84-monte-carlo-configuration)
  - [8.5 Scenario Variants](#85-scenario-variants)
  - [8.6 Reference App Economics](#86-reference-app-economics)
- [KPIs & Success Metrics](#kpis--success-metrics)
  - [9.1 Creator Metrics](#91-creator-metrics)
  - [9.2 Investor Metrics](#92-investor-metrics)
  - [9.3 User Metrics](#93-user-metrics)
  - [9.4 Platform Metrics](#94-platform-metrics)
  - [9.5 Abuse Scenario Outcomes](#95-abuse-scenario-outcomes)
  - [9.6 Simulation Report Structure](#96-simulation-report-structure)

## Overview & Objectives

The Early.cool economic simulation models the full lifecycle of a decentralized app marketplace where each deployed application has its own revenue-share market. Several questions are framed as parameter-search problems: the simulation sweeps the relevant launch parameters and returns the viable range — the region where the market is attack-resistant, investor-safe, and creator-viable simultaneously.

- **Reserve ratio** (currently fixed at 50%): what range keeps the per-share exit price above a minimum floor under any dump up to 40% of supply, preserves enough reserve for market recovery after the event, and does not over-capitalise at the creator's expense?
- **Bonding curve steepness** (currently: price doubles every 20% of supply): what doubling interval balances early-investor upside against late-buyer price risk?
- **Auction parameters** (`auction_floor` swept across `[$5, $100]`; `auction_size` swept across `[50, 400]` shares; `auction_duration` swept across `[1, 14]` days): what floor price attracts enough genuine bidders to set a fair clearing price, and how does the floor interact with reserve depth to bound the maximum loss for a first-buyer who exits immediately post-auction? What CCA share allocation (as a fraction of total supply) best balances price discovery depth against early concentration risk? Does a longer auction window improve price discovery or mainly increase the opportunity for bid sniping at the close?
- **Selling fee and locking incentives** (`selling_fee_rate` swept across `[0.01, 0.20]`; `lock_max_months` swept across `[3, 24]`; `lock_weight_max` swept across `[1.5, 6.0]`): what fee rate minimises benign-seller friction while still generating meaningful income for locked holders? Does a higher weight ceiling draw enough capital into long locks to meaningfully resist a coordinated dump, or does it merely reward already-committed holders?
- **Is a pool dump ever the economically dominant strategy?** For each point in the launch-parameter space, compute EV(dump) = reserve exit price minus surge fee minus opportunity cost of foregone yield, and map the region where EV(dump) < EV(hold) for both single-actor and coordinated attacks. The boundary is the viability frontier — parameters inside it make dumping strictly irrational.
- Do investors prefer new-launch speculation or mature-app yield, and how does that rotation behaviour affect liquidity depth on older markets?
- Can fake revenue inflation distort share prices before on-chain detection signals fire?

### Scope

The simulation covers **multiple simultaneous app markets** running in parallel with shared user and investor populations. Time advances in discrete daily steps over a 24-month horizon. Monte Carlo runs (100–1,000 scenarios) sample stochastic distributions for user demand, creator quality, and investor behavior to produce confidence intervals.

**In scope:** bonding curve markets, CCA auctions, locking and unlocking mechanics, x402 payment flows, profit distribution, protocol fees, multi-market rotation, abuse scenarios.

**Out of scope:** on-chain gas costs beyond fixed estimates, governance voting, cross-chain bridge flows, off-platform secondary trading.

## Platform Mechanics

### 2.1 Running Cost Priority Order

Before any profit is computed, revenue is applied in strict order:

1. **Variable costs** — AI inference, RPC calls, settlement gas (deducted first, proportional to usage)
2. **Ops treasury top-up** — fixed costs (hosting, storage) are pre-funded to cover N months of runway; contributions stop once the cap is reached
3. **Protocol fee** — 0–2% of remaining profit, taken on-chain
4. **Profit distribution** — remainder sent to shareholders via the payout accumulator

### 2.2 Hosting Cost Reference

| Plan          | Cost/hour | Monthly (\~730 h) |
| ------------- | --------- | ----------------- |
| Shared Nano   | $0.0073   | \~$5.33           |
| Shared Small  | $0.0145   | \~$10.59          |
| Shared Medium | $0.029    | \~$21.17          |
| Shared Large  | $0.058    | \~$42.34          |
| Dedicated     | flat      | $40.00            |

### 2.3 Bonding Curve

Each app has a fixed supply of **1,000 shares**. Price is determined by a bonding curve where **price doubles every 20% of supply sold** (200 shares).

```
Price formula (continuous approximation):
  p(s) = p_floor * 2^(s / 200)

Where:
  s = shares sold so far (0 to 1,000)
  p_floor = floor price from the opening auction
  p(0) = auction clearing price
  p(200) = 2x clearing price
  p(400) = 4x clearing price
  p(800) = 16x clearing price
  p(1000) = 32x clearing price
```

**Reserve mechanics:** A configurable fraction `r` (the **reserve ratio**, swept across `[0.20, 0.80]` in the simulation; reference default `r = 0.50`) of each purchase price goes into the app's reserve pool. The complement `(1 − r)` goes to the creator. This reserve underwrites the buyback guarantee — any seller can exit at reserve price, which is always lower than the current curve price. Higher `r` deepens the floor but reduces creator proceeds; lower `r` improves creator economics but weakens attack resistance.

### 2.4 Opening Auction (Uniswap CCA)

The first `auction_size` shares (configurable fraction of supply; swept across `[50, 400]`; reference default `200` = 20% of supply) are sold through a **Continuous Clearing Auction (CCA)** rather than the bonding curve. The mechanism follows the Uniswap Liquidity Launchpad CCA — see [Uniswap Liquidity Launchpad Overview](https://docs.uniswap.org/contracts/liquidity-launchpad/Overview).

- **Auction window:** runs for `auction_duration` ticks (swept across `[1, 14]`; reference default `3`); bidders may submit and withdraw bids throughout the window
- **Floor price:** `auction_floor` per share (swept across `[$5, $100]`; reference default `$20`); bids with `maxPrice < auction_floor` are rejected
- **Bid structure:** each bid specifies a `maxPrice` (highest $/share the bidder will pay) and a USDC `amount` to spend
- **Supply schedule:** `Q(t) = floor(auction_size × t / auction_duration)` — shares are released linearly, one tick at a time; `Q(auction_duration) = auction_size` (full supply available only at close)
- **Dynamic clearing price:** after each bid submission the clearing price `p*` is recomputed as the highest price at which `Σ(amount_i / p*) ≥ Q(t)` for all bids with `maxPrice ≥ p*`; any bid whose `maxPrice < p*` is automatically dropped
- **Uniform price:** all winning bidders pay the same final `p*`; shares allocated pro-rata if demand exceeds supply
- **Auction proceeds:** fraction `r` to reserve, `(1 − r)` to creator (vested linearly over 6 months)
- **Post-auction:** shares `(auction_size + 1)`–1,000 trade on the bonding curve; `p*` becomes `p_floor` in the curve formula

### 2.5 Locking Mechanics

Shareholders can lock shares for 1–`lock_max_months` months (swept across `[3, 24]`; reference default `12`) to earn a weight multiplier on selling fee income.

**Weight function** (linear; `lock_weight_max` swept across `[1.5, 6.0]`; reference default `3.0`):

```
lock_weight(months) = 1.0 + (lock_weight_max − 1.0) × (months / lock_max_months)
```

At reference defaults this evaluates to:

| Lock duration | Weight multiplier |
| ------------- | ----------------- |
| Unlocked      | 1.0x              |
| 3 months      | 1.5x              |
| 6 months      | 2.0x              |
| 12 months     | 3.0x              |

Auto-renew at `lock_max_months` keeps the maximum weight active indefinitely. Locked shares cannot be sold; upon unlock, the selling fee weight drops to 1.0x.

### 2.6 Selling Fee

Every share sale incurs a fixed selling fee set at deployment and distributed to all locked shareholders.

```
fee = selling_fee_rate × exit_price
```

`selling_fee_rate` is swept across `[0.01, 0.20]`; reference default `0.05` (5%). The fee is deducted from the seller's proceeds and redistributed to locked holders weighted by their lock weight.

**Fee distribution per locked holder:**

```
fee_share = (holder_locked_shares × holder_weight) / total_weighted_locked_shares
```

### 2.7 Profit Payout Distribution

Payouts are distributed automatically to all holders at the end of every tick as part of `PROFIT_DISTRIBUTION`. Each holder receives a share proportional to their unlocked and locked shares; the simulation iterates all holders directly — no pull-based claim step is required.

```
payout_per_share = net_profit / total_shares
for each holder of app:
  holder.usdc_balance += holder.total_shares * payout_per_share
```

## Actors & Cohorts

All actors share a common USDC wallet balance and can hold positions in multiple app markets simultaneously. Each actor type is parameterized by its cohort and will execute its strategy every simulation tick (daily).

### 3.1 Users

Users interact with apps via x402 payments. They do not hold shares.

| Cohort            | Daily requests | Price sensitivity   | Skips app when            |
| ----------------- | -------------- | ------------------- | ------------------------- |
| Power User        | 20–50          | Low (<$1/req)       | App offline >3 days       |
| Casual User       | 1–5            | Medium (<$0.20/req) | Price > 2× threshold      |
| Privacy-Conscious | 5–15           | Medium              | Privacy tier below Sealed |
| Trial User        | 1–3            | High (<$0.05/req)   | Any price above floor     |

Full distribution parameters → §8.3.1 (spawn weights), §8.3.3 (price threshold, daily requests, lifetime budget).

**Behavior:** Users discover apps through a platform-wide traffic pool. Each tick, each user selects an app to use (weighted by app popularity score), skipping any app whose price exceeds their threshold, any app offline for 3+ days, and any app whose privacy tier is below their requirement. A user becomes inactive when their Pareto-distributed USDC balance is exhausted — there are no separate churn events.

**Onboarding:** New users arrive daily following a logistic growth curve: slow start, rapid growth, saturation. Each simulation run samples a peak daily-user arrival rate from a distribution (mean 50, std 30 for a mid-tier launch).

**Acquisition channels:**

The majority of platform traffic arrives through two structurally distinct channels that map onto different user cohorts and produce different retention profiles.

| Channel | Share of arrivals | Source                                                                          | Typical app type                                     |
| ------- | ----------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------- |
| SEO     | ~70–80%           | Organic search for generic tasks ("pdf to image", "mp3 to wav", "resize image") | Generic utility tools                                |
| Social  | ~20–30%           | Creator's own social network (Twitter/X, Discord, Telegram)                     | Niche community apps (DeFi, bridges, DEX, fan tools) |

**SEO channel:** Users arrive with no platform awareness — they searched for a specific task and landed on the app. There is no project loyalty, conversion rate is low, and most churn after one session unless the task recurs regularly. Arrival rate is relatively steady, following a logistic growth curve tied to the app's search rank.

**Social channel:** Users are pre-qualified by the creator's community and arrive already aware of the project. They show higher retention and are more likely to become repeat Power Users or Privacy-Conscious users. Arrival is bursty — a spike on launch announcements, product updates, or influencer mentions, then exponential decay to a lower steady baseline.

**Cohort mix by acquisition channel:**

| Cohort            | SEO | Social |
| ----------------- | --- | ------ |
| Trial             | 40% | 15%    |
| Casual            | 45% | 30%    |
| Power User        | 10% | 30%    |
| Privacy-Conscious | 5%  | 25%    |

**SEO fraction per app** — sampled once at deployment; loosely correlated with creator cohort (Solo Devs tend to build generic utility apps; Startups and Whale Creators tend to build niche community products):

| App type                                           | SEO fraction distribution |
| -------------------------------------------------- | ------------------------- |
| Generic utility (converter, formatter, transcoder) | Beta(8, 2) mean ~0.80     |
| Productivity / niche tool                          | Beta(5, 5) mean ~0.50     |
| Community / DeFi / bridge / DEX                    | Beta(2, 8) mean ~0.20     |

### 3.2 App Creators

Creators deploy apps, set pricing, choose hosting plans, and receive the creator vesting allocation from the auction.

| Cohort        | App type      | Revenue model            | Share retention           |
| ------------- | ------------- | ------------------------ | ------------------------- |
| Solo Dev      | Niche tool    | Low volume, high margin  | Hold all auctioned shares |
| Startup       | AI product    | High volume, thin margin | Sell some after vesting   |
| Agency        | Multiple apps | Portfolio approach       | Diversify across own apps |
| Whale Creator | Flagship app  | Very high volume         | Stake most, sell premium  |

Full distribution parameters → §8.3.1 (spawn weights), §8.3.2 (pricing, quality, ops runway, vesting sell fraction, hosting plan).

Hosting plan selection is Categorical per cohort (solo devs skew Nano/Small, whale creators skew Large/Dedicated) — full probability table in §8.3.2.

**Strategy parameters:**

- `pricing_per_request`: fixed initially; creator may raise/lower based on demand elasticity
- `hosting_plan`: upgrades when monthly active users cross threshold; downgrades during low-traffic months
- `reinvestment_rate`: fraction of profit claimed that the creator reinvests into buying more shares
- `marketing_spend`: multiplier on user discovery probability (not modeled financially, only as inflow boost)

### 3.3 Investors

Investors hold shares across multiple apps, lock for multipliers, claim payouts, and trade.

| Cohort          | Risk profile | Lock preference      | Rotation behavior         |
| --------------- | ------------ | -------------------- | ------------------------- |
| Retail Investor | Medium       | 3–6 months           | Follows momentum          |
| Whale Investor  | Low–medium   | 6+ months auto-renew | Patient, yield-focused    |
| DeFi Veteran    | High         | Short (1–3 months)   | Rotates aggressively      |
| Yield Hunter    | Low          | Max (12 months)      | Never rotates; yield only |
| Speculator      | Very high    | None                 | Buys launch, dumps at 3x  |

**Exit strategies:**

All investor cohorts evaluate four exit triggers each tick, applied in order:

**1. Momentum exit** — sell when `current_price / entry_price >= momentum_target`. Target is sampled once at entry; speculators exit at modest multiples, long-term investors hold out for large ones. All cohorts have this trigger — the difference is only the target distribution.

**2. Yield-floor exit** — sell when `current_yield_apy < effective_floor_yield` for `yield_patience` consecutive ticks, where:

```
effective_floor_yield = risk_floor_yield + risk_premium × app_price_volatility_30d
```

`risk_floor_yield` is the baseline minimum APY the cohort will accept. `risk_premium` scales the floor upward when the app is volatile — a Speculator tolerates a position only if it yields well above the platform average; a Yield Hunter stays in as long as any positive yield remains. `yield_patience` prevents jittery exits on a single bad tick.

**3. Rotation exit** — sell a held position to fund entry into a new launch when `projected_yield_new > current_yield_apy + rotation_premium`. Only applies to cohorts with non-zero rotation behaviour.

**Exit strategy parameters:**

| Cohort       | Momentum target (× entry) | Risk floor yield (APY) | Yield patience (ticks) | Rotation premium |
| ------------ | ------------------------- | ---------------------- | ---------------------- | ---------------- |
| Retail       | Uniform[3.0, 5.0]         | 12%                    | 14                     | 8%               |
| Whale        | Uniform[8.0, 15.0]        | 6%                     | 30                     | 15%              |
| DeFi Veteran | Uniform[2.0, 3.0]         | 18%                    | 7                      | 5%               |
| Yield Hunter | Uniform[15.0, 30.0]       | 5%                     | 60                     | —                |
| Speculator   | Uniform[1.5, 2.0]         | 30%                    | 3                      | —                |

Yield Hunter and Speculator have no rotation premium (—): the Yield Hunter never exits for a new launch; the Speculator holds no locks and exits on price target alone.

Capital and position sizing parameters → §8.3.4.

**Other per-tick logic:**

- **Re-lock:** if a position is approaching lock expiry AND `current_yield_apy >= risk_floor_yield` → auto-renew

### 3.4 Traders

Traders focus on price speculation rather than yield. They do not lock shares. Each cohort uses a distinct technical signal; signal parameters are sampled at spawn from per-cohort distributions.

| Cohort                | Strategy                                              | Entry trigger                               | Exit trigger                              |
| --------------------- | ----------------------------------------------------- | ------------------------------------------- | ----------------------------------------- |
| RSI Trader            | Counter-cyclical; buys oversold, sells overbought     | RSI(N) < `buy_threshold`                    | RSI(N) > `sell_threshold`                 |
| MA Crossover Trader   | Trend-following; buys golden cross, exits death cross | MA(`ma_fast`) crosses above MA(`ma_slow`)   | MA(`ma_fast`) crosses below MA(`ma_slow`) |
| Bollinger Band Trader | Mean-reversion; fades extremes                        | Price touches lower band                    | Price touches upper band                  |
| Arbitrageur           | Buys reserve undervaluation                           | `reserve_price > curve_price × entry_ratio` | Curve price recovery                      |
| Auction Sniper        | Bids in CCA, exits on post-auction spike              | Any new auction opens                       | Post-auction price × `target_multiple`    |

Spawn weights, capital, signal parameters, and position sizing → §8.3.1, §8.3.4, §8.3.5.

**Market asymmetry note:** In a bonding curve, price only falls when holders actively sell against a surge fee, so oversold conditions persist longer than in traditional markets. RSI and Bollinger Band traders see extended buy windows during sell-offs, providing a counter-cyclical liquidity buffer. MA Crossover traders amplify the initial move in both directions.

**Dump-and-Exit actor** is an adversarial scenario, not a regular trading strategy — modeled in §6 (Abuse Scenarios).

### 3.5 Platform

The platform is not an active trading actor but collects protocol fees and can adjust fee rates (0–2% range). In the simulation, the platform is a passive accumulator used to measure ecosystem-level sustainability.

## State Variables

All types are defined in [`src/models.ts`](src/models.ts). The spec references them by name; the file is the single source of truth.

| Type               | Description                                                                                                             |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `GlobalState`      | Top-level simulation state: tick, apps, actors, platform aggregates                                                     |
| `App`              | Per-app market state including launch parameters (`sellingFeeRate`, `lockMaxMonths`, etc.), reserve, payout accumulator, lock registry, financials, usage metrics |
| `LockEntry`        | Per-holder lock record within an app's `lockRegistry`: shares, expiry tick, weight multiplier                           |
| `AppSpec`          | Parameters a `CreatorActor` supplies when deploying a new app                                                           |
| `HolderPosition`   | Per-app share position within an actor's `holdings`                                                                     |
| `UserActor`        | User actor state: cohort, price threshold, daily request rate, acquisition channel                                      |
| `CreatorActor`     | Creator actor state: owned apps, reinvestment rate, vesting sell fraction                                               |
| `InvestorActor`    | Investor actor state: holdings, `InvestorStrategy`, per-app yield patience counters                                     |
| `InvestorStrategy` | Exit strategy parameters: momentum target, risk floor yield, patience, rotation premium, position sizing                |
| `TraderActor`      | Trader actor state: holdings, `TraderStrategy` discriminated union                                                      |
| `TraderStrategy`   | Union of `RSIStrategy \| MACrossoverStrategy \| BollingerBandStrategy \| ArbitrageurStrategy \| AuctionSniperStrategy`  |
| `Actor`            | Discriminated union: `UserActor \| CreatorActor \| InvestorActor \| TraderActor`                                        |
| `SimMetrics`       | Time-series accumulators: per-tick platform snapshots, per-app series, per-cohort series                                |
| `SimConfig`        | Simulation parameters: tick count, Monte Carlo runs, reference-default launch parameters                                |

## Events & Transitions

Events are the atomic state changes that drive the simulation. Each event specifies preconditions, the state delta, and any triggered downstream events.

### 5.1 User Events

**USER\_ONBOARDED**

- Preconditions: tick is within the growth phase; platform DAU < saturation cap
- State delta: `actors.append(new User(cohort=sample_cohort()))`, `global.total_dau += 1`

**USER\_REQUEST**

- Preconditions: user is active, target app is online, user balance ≥ request price
- State delta:
  - `user.usdc_balance -= price`
  - `app.monthly_revenue += price`
  - `app.daily_requests += 1`
  - Variable costs are atomically deducted (AI inference estimate)

### 5.2 Creator Events

**APP\_DEPLOYED**

- Preconditions: creator has enough USDC for ops treasury seed; platform not congested
- State delta:
  - New `App` entry initialized with `shares_sold=0`, `reserve_balance=0`
  - Ops treasury seeded with creator's initial deposit
  - Auction window opened immediately: `auction_bids = []`; `auction_close_tick = tick + app.auction_duration`
- Parameters: hosting plan, privacy level, pricing, ops\_treasury\_target

### 5.3 Auction Events

**AUCTION\_BID**

- Preconditions: auction is open (`tick < auction_close_tick`), bidder has USDC ≥ `bid.amount`, `bid.maxPrice ≥ app.auction_floor`
- State delta:
  - `auction_bids.append({bidder_id, maxPrice, amount})` — `maxPrice` = highest $/share bidder will pay; `amount` = USDC to spend
  - Compute `Q(t) = floor(app.auction_size × (tick − auction_open_tick) / app.auction_duration)`
  - Recompute clearing price `p*`: highest price where `Σ(amount_i / p*) for bids with maxPrice ≥ p*` ≥ `Q(t)`
  - Drop any bids whose `maxPrice < p*`
- Note: timing of submission does not affect final allocation; early bids only clear against the smaller `Q(t)` available at that tick

**AUCTION\_CLEARED**

- Preconditions: `tick = auction_close_tick`
- Clearing algorithm:
  1. At close `Q(auction_duration) = app.auction_size` (full supply now available)
  2. Compute final `p*`: highest price where `Σ(amount_i / p*)` ≥ `app.auction_size` for all bids with `maxPrice ≥ p*`
  3. All winning bids pay `p*`; each winner receives `floor(amount_i / p*)` shares; pro-rata reduction if oversubscribed
  4. USDC in excess of `shares_received × p*` is refunded to each bidder
- State delta:
  - `app.shares_sold = app.auction_size`
  - `app.auction_clearing_price = p*`
  - `app.auction_cleared = true`
  - For each winner: deduct `shares_received * p*` from USDC; credit shares; refund excess
  - `r * total_proceeds` → `app.reserve_balance`; `(1 − r) * total_proceeds` → creator vesting schedule
  - Bonding curve becomes active for shares `(auction_size + 1)`–1,000

### 5.4 Market Events

**SHARE\_PURCHASED** (bonding curve)

- Preconditions: `app.auction_cleared = true`, `app.shares_sold < 1000`, buyer USDC ≥ cost
- Cost calculation:

  ```
  cost = integral of p(s) ds from shares_sold to shares_sold + amount
       ≈ amount * p_avg (midpoint approximation for small amounts)
  ```

- State delta:
  - `buyer.usdc_balance -= cost`
  - `buyer.holdings[app_id].shares_unlocked += amount`
  - `app.shares_sold += amount`
  - `app.reserve_balance += r * cost`
  - `app.current_price = p(app.shares_sold)`

**SHARE\_SOLD** (reserve exit)

- Preconditions: seller holds shares, shares not locked
- State delta:
  - `exit_price = app.reserve_balance / app.shares_sold` (pro-rata reserve)
  - `fee = exit_price × app.selling_fee_rate`
  - `seller.usdc_balance += exit_price - fee`
  - `app.reserve_balance -= exit_price`
  - `app.shares_sold -= amount`
  - For each locked holder: `holder.usdc_balance += fee × (holder_locked_shares × holder_weight) / total_weighted_locked`

**SHARES\_LOCKED**

- Preconditions: holder has unlocked shares, `lock_months` in `1–app.lock_max_months`
- State delta:
  - `holder.holdings[app].shares_unlocked -= amount`
  - `holder.holdings[app].shares_locked += amount`
  - `lock_registry[holder] = {until: tick + lock_months*30, weight: 1.0 + (app.lock_weight_max − 1.0) × (lock_months / app.lock_max_months)}`
  - `global.total_locked_value += amount * current_price`

**SHARES\_UNLOCKED**

- Preconditions: `tick >= lock_registry[holder].locked_until`
- State delta:
  - `holder.holdings[app].shares_locked -= amount`
  - `holder.holdings[app].shares_unlocked += amount`
  - `lock_registry[holder].weight = 1.0` (if not auto-renewed)
  - `global.total_locked_value -= amount * current_price`

### 5.5 Financial Events

**PROFIT\_DISTRIBUTION** (end of each day)

- Preconditions: `app.is_online = true`
- Computation sequence:
  1. `gross_revenue = app.daily_revenue`
  2. `variable_costs = estimated_inference_cost + gas`
  3. `net_revenue = gross_revenue - variable_costs`
  4. If `app.ops_treasury < app.ops_treasury_target`: `topup = min(net_revenue, ops_treasury_target - ops_treasury)`; `app.ops_treasury += topup`; `net_revenue -= topup`
  5. `protocol_fee = net_revenue * app.protocol_fee_rate`; `global.protocol_treasury += protocol_fee`; `net_revenue -= protocol_fee`
  6. For each holder of this app: `holder.usdc_balance += holder.total_shares * (net_revenue / app.total_shares)`
  7. If `app.ops_treasury ≤ 0`: `app.is_online = false`; creator may inject funds to bring back online

## Multi-Market Dynamics

### 6.1 Traffic Distribution

Users do not commit to a single app. Each day, each active user samples from the platform's app catalog according to a **weighted popularity score**.

```
Popularity score for app i:
  score_i = log(1 + active_users_30d_i) * quality_i * recency_boost_i

  quality_i: sampled at deployment from Beta(alpha, beta) per cohort
  recency_boost_i: exp(-days_since_launch / 30) — new apps get discovery lift

User selects app with probability proportional to score_i / sum(scores)
```

This produces a **power-law traffic distribution**: top apps get most traffic, with a long tail. New deployments temporarily distort the distribution via the recency boost.

### 6.2 New App Deployment Rate

New apps enter the platform following a Poisson process. The arrival rate grows with overall platform DAU.

```
new_apps_per_month = poisson(lambda = base_rate * (1 + dau / dau_scale))

Default parameters:
  base_rate: 2  (2 new apps/month at platform launch)
  dau_scale: 1,000  (each 1,000 DAU adds ~1 app/month to rate)
```

Each new app draws from the creator cohort distribution. Creator cohort determines: initial ops treasury seed, hosting plan, pricing strategy, and starting `quality_i`.

### 6.3 Investor Rotation

Investors scan all active markets each tick and may rotate capital from low-yield positions into higher-opportunity ones. Rotation logic:

1. **Trigger condition:** position yield < `rotation_threshold` AND a new app has launched within the last 14 days
2. **Exit:** sell unlocked shares in the old position (incurring selling fee)
3. **Entry:** participate in the new app's auction or buy from the curve
4. **Cooldown:** investor cannot rotate the same capital again for 30 days

Rotation creates a natural **liquidity flow from mature apps to new launches**, which is the intended ecosystem behavior. The simulation measures whether this depletes mature app liquidity unfairly.

### 6.4 App Lifecycle Model

Each app progresses through lifecycle phases that affect user inflow and quality:

| Phase    | Duration         | User growth             | Investor behavior                  |
| -------- | ---------------- | ----------------------- | ---------------------------------- |
| Launch   | 0–30 days        | +20%/wk (recency boost) | Speculation; auction + early curve |
| Growth   | 30–120 days      | +5–10%/wk               | Locking for yield                  |
| Maturity | 120–365 days     | Stable ±1%/wk           | Yield claiming; some rotation out  |
| Decline  | 365+ days        | −5%/wk                  | Gradual exit; lock expirations     |
| Dead     | ops treasury = 0 | 0                       | Emergency exits; reserve triggered |

Apps can stay in Maturity indefinitely if quality is high. The lifecycle is stochastic: a low-quality app may skip Growth entirely and enter Decline by day 45.

### 6.5 Reserve Price Floor & Cross-App Contagion

Because each app has an independent reserve, a crash in one app does not directly drain another's reserve. However, **contagion can occur** through shared investor capital:

- A large loss in App A forces an investor to sell App B shares to cover losses
- Simultaneous multi-app sell pressure reduces platform-wide locked value
- This reduces platform-wide selling fee income, weakening the incentive to lock

The simulation models this by tracking investor USDC balance across all holdings. When an investor suffers a large realized loss, their probability of selling other positions increases proportionally to the loss fraction.

### 6.6 Liquidity Spreading Metric

A key simulation output is the **Gini coefficient of app-level locked value** over time:

- Gini near 0: locked value evenly distributed across all apps (healthy)
- Gini near 1: locked value concentrated in one or two dominant apps (fragile)

The simulation should demonstrate Gini stays below 0.6 for healthy platform scenarios and exceeds 0.8 in abuse scenarios.

## Abuse Scenarios

Each scenario is a scripted injection that overrides normal actor strategy for a subset of actors during a defined tick window. The simulation runs the scenario alongside a baseline run and computes the difference in platform health metrics.

### 7.1 Whale Dump

**Setup:** A single Dump-and-Exit trader accumulates 30–40% of an app's supply over ticks 30–60 (buying slowly via bonding curve to avoid price impact). At tick 61, sells the entire position in one block.

**Expected mechanisms to activate:**

- Selling fee surges toward `fee_max` (because `fee_lookback_days`-day price drop is severe)
- Reserve depletes proportionally to sold shares
- Remaining shareholders receive large selling fee windfall via the accumulator
- Price crashes to new bonding curve floor (remaining shares\_sold lower → lower price)

**Metrics to track:**

- Price before / immediately after / 30 days after dump
- Reserve balance before / after (should be partially depleted, not zero)
- Locked holder payout spike (selling fee income)
- Time to price recovery (new buyers enter at lower curve price)
- DAU change (do users leave due to market instability signal?)

**Recovery conditions:** Price recovers when new buyers accumulate shares at the post-crash lower price. The reserve floor guarantees sellers always get at least reserve-price / share, preventing a zero-exit scenario. Simulation should show recovery within 60–120 days for a well-funded reserve.

**Abuse viability assessment:** Whale dump is partially self-defeating. The whale incurs up to `fee_max` on a large position, and the resulting windfall rewards locked holders who stayed — which is by design. The simulation quantifies whether the whale actually profits net of fees.

### 7.2 Coordinated Sell-Off

**Setup:** 5–10 investors each holding 8–12% of supply agree to sell simultaneously at tick 90. Combined, they unload 50–65% of supply in one tick.

**Key difference from whale dump:** Coordinated sell means multiple reserve withdrawals in the same block. Reserve may deplete enough that late sellers get significantly less than early sellers — this creates a race-to-exit dynamic.

**Metrics to track:**

- Reserve depletion rate per seller in sequence
- First-mover vs last-mover exit price differential
- Surge fee total (distributed to any remaining locked holders)
- App online status after event (ops treasury unaffected — only reserve affected)
- Long-term user retention (app may keep running; market recovers if users stay)

**Defense mechanisms tested:**

- The selling fee makes early coordinated selling expensive
- The reserve is partially protected because each sale reduces shares\_sold, and later sellers face lower reserve per share
- Locked holders are immune to the price crash and collect fees

### 7.3 Lock-Expiry Cliff

**Setup:** A cohort of investors all locked for 6 months at launch. At tick 180±5, all locks expire simultaneously. Each investor re-evaluates: auto-renew if yield is satisfactory, exit otherwise.

**This is not a malicious scenario but a structural risk.** If launch-era investors are disappointed by yield, a cliff of simultaneous unlocks can trigger a price cascade.

**Metrics to track:**

- Fraction of expiring locks that auto-renew vs exit
- Price impact of cliff exits
- Selling fee income for the few remaining locked holders (may be very high per-holder)
- New investor inflow attracted by post-cliff lower price

**Mitigation modeled:** Staggered lock expirations (investors chose different lock lengths) dampen the cliff. The simulation should test whether encouraging diverse lock lengths at launch reduces the cliff amplitude.

### 7.4 Fake Revenue Inflation

**Setup:** A creator operates a bot that calls the app's own x402 endpoint, paying for requests from a wallet the creator controls. This inflates `app.monthly_revenue` and therefore `earned_per_share_acc`, attracting investors at false yield signals.

**Mechanism:** Bot pays $X/day in fake revenue. App earns this revenue, distributes it as profit. Investors see high yield, buy shares (driving up price), creator then sells into the elevated price.

**Detection signals (not enforced in simulation — logged as flags):**

- Revenue-to-user ratio anomaly: revenue per DAU > 5x platform median
- Single-wallet request concentration: >30% of revenue from one address
- Request timing regularity: coefficient of variation of inter-request intervals < 0.05 (too uniform)

**Simulation outcome:** The scheme is profitable until detection. Simulation quantifies the breakeven point: how much fake revenue must be injected before share price appreciation exceeds the injection cost. This informs what detection thresholds should be set.

### 7.5 Ops Treasury Drain Attack

**Setup:** An adversary makes very high-frequency requests that maximize variable costs (expensive AI calls) but pays only the minimum x402 price, attempting to drain the app's profit margin and eventually the ops treasury.

**Expected behavior:**

- If variable cost > price per request: each request is net-negative for the app
- Ops treasury tops up fixed costs first; if variable costs > revenue, even the variable cost budget is exceeded
- Eventually `app.ops_treasury` reaches 0 and `APP_PAUSED` triggers

**Defense:** Creators can raise pricing or add rate-limiting. Simulation tests how quickly a well-funded treasury withstands this attack and what pricing floor is needed to be immune.

### 7.6 Market Recovery Benchmark

For scenarios 7.1 and 7.2, the simulation must demonstrate recovery capability. A market is considered **recovered** when all of the following hold for 14 consecutive days:

- Price ≥ 50% of pre-crash level
- DAU ≥ 80% of pre-crash level
- At least 30% of shares locked
- Reserve balance ≥ 40% of pre-crash level

Recovery is driven by: new bargain buyers entering at lower curve price, surge selling fee income attracting new lockers, creator marketing spend boosting user inflow.

## Simulation Parameters

### 8.1 Time Model

```
Timestep:          1 day
Horizon:           730 days (24 months)
Market open hours: 24/7 (no market closure)
Block granularity: Each day = 1 block for auction/trade settlement
```

Intra-day ordering within a tick:

1. New user arrivals
2. User requests (random ordering among users)
3. End-of-day profit distribution
4. Investor decisions (buy / sell / lock / claim)
5. Creator deployment decisions (any creator actor may deploy a new app this tick)
6. Auction settlements (if any auction is active)
7. Lock expirations check
8. Metrics snapshot

### 8.2 Initialization

```
Day 0 state:
  active_apps: 0 (first app deployed on tick 1)
  active_users: 0
  protocol_treasury: 0

First app (reference app for baseline):
  hosting_plan: Shared Large ($42/mo)
  pricing_per_request: $0.05
  ops_treasury_target: 3 months * $42 = $126
  protocol_fee_rate: 0.01 (1%)
  auction_duration: 3
  auction_floor: $20
  auction_size: 200
  selling_fee_rate: 0.05
  lock_max_months: 12
  lock_weight_max: 3.0
  reserve_ratio: 0.50
  creator_cohort: Startup
```

### 8.3 Stochastic Distributions

#### 8.3.1 Actor Cohort Mix

Proportions control how many actors of each type are spawned per simulation run. These reflect a realistic early-stage marketplace where indie creators dominate and retail investors outnumber whales.

| Actor type | Cohort            | Spawn weight |
| ---------- | ----------------- | ------------ |
| Creator    | Solo Dev          | 50%          |
| Creator    | Startup           | 30%          |
| Creator    | Agency            | 15%          |
| Creator    | Whale Creator     | 5%           |
| User       | Casual            | 55%          |
| User       | Privacy-Conscious | 20%          |
| User       | Power User        | 15%          |
| User       | Trial             | 10%          |
| Investor   | Retail            | 50%          |
| Investor   | DeFi Veteran      | 20%          |
| Investor   | Yield Hunter      | 15%          |
| Investor   | Speculator        | 10%          |
| Investor   | Whale             | 5%           |
| Trader     | MA Crossover      | 35%          |
| Trader     | RSI Trader        | 30%          |
| Trader     | Bollinger Band    | 20%          |
| Trader     | Arbitrageur       | 10%          |
| Trader     | Auction Sniper    | 5%           |

#### 8.3.2 App Configuration Distributions

**Hosting plan** — Categorical per creator cohort. Solo devs skew toward cheap shared plans; whale creators default to dedicated infrastructure. Probabilities reflect observed patterns in small SaaS and AI-API products.

| Cohort        | Nano | Small | Medium | Large | Dedicated |
| ------------- | ---- | ----- | ------ | ----- | --------- |
| Solo Dev      | 45%  | 35%   | 15%    | 4%    | 1%        |
| Startup       | 5%   | 20%   | 35%    | 30%   | 10%       |
| Agency        | 10%  | 25%   | 35%    | 25%   | 5%        |
| Whale Creator | 0%   | 5%    | 10%    | 40%   | 45%       |

**Pricing per request** — LogNormal. Prices span two orders of magnitude across app types; the log-normal reflects that most apps cluster around a typical price with a long tail of premium tools.

| Cohort        | Distribution             | Median price | Approx range |
| ------------- | ------------------------ | ------------ | ------------ |
| Solo Dev      | LogNormal(μ=−4.2, σ=0.7) | ~$0.015      | $0.005–$0.10 |
| Startup       | LogNormal(μ=−3.0, σ=0.8) | ~$0.050      | $0.010–$0.50 |
| Agency        | LogNormal(μ=−3.5, σ=0.7) | ~$0.030      | $0.008–$0.20 |
| Whale Creator | LogNormal(μ=−1.6, σ=0.6) | ~$0.200      | $0.050–$1.00 |

**Ops treasury seed** — number of months of fixed costs pre-funded at launch. Uniform per cohort.

| Cohort        | Distribution                    | Meaning            |
| ------------- | ------------------------------- | ------------------ |
| Solo Dev      | Uniform[1, 3] × monthly\_fixed  | 1–3 months runway  |
| Startup       | Uniform[2, 6] × monthly\_fixed  | 2–6 months runway  |
| Agency        | Uniform[3, 12] × monthly\_fixed | 3–12 months runway |
| Whale Creator | Uniform[6, 24] × monthly\_fixed | 6–24 months runway |

**App quality score** — Beta(α, β), sampled once at deployment. Drives the popularity score and long-run revenue potential.

| Cohort        | Distribution | Mean quality |
| ------------- | ------------ | ------------ |
| Solo Dev      | Beta(1, 2)   | 0.33         |
| Startup       | Beta(2, 1.5) | 0.57         |
| Agency        | Beta(2, 1)   | 0.67         |
| Whale Creator | Beta(4, 1)   | 0.80         |

**Creator vesting sell fraction** — fraction of the auction allocation the creator sells immediately after the 6-month vesting cliff. Uniform per cohort.

| Cohort        | Distribution       |
| ------------- | ------------------ |
| Solo Dev      | Uniform[0.0, 0.1]  |
| Startup       | Uniform[0.1, 0.4]  |
| Agency        | Uniform[0.0, 0.3]  |
| Whale Creator | Uniform[0.0, 0.15] |

#### 8.3.3 User Behavior Distributions

All actor USDC balances at spawn follow a **Pareto distribution**: `f(x) = α × x_min^α / x^(α+1)` for `x ≥ x_min`. The shape parameter `α` is shared across all cohorts (same wealth inequality structure); `x_min` differs per cohort (sets the floor for that cohort's spending power). For users, this balance is their **lifetime platform budget** — the total USDC they may spend on requests across the full simulation, not their real-world wealth. Reference default `α = 1.5` (mean = 3 × x\_min).

| Parameter                              | Distribution | Params               |
| -------------------------------------- | ------------ | -------------------- |
| Lifetime budget — Power User           | Pareto       | x\_min = $50                           |
| Lifetime budget — Casual User          | Pareto       | x\_min = $10                           |
| Lifetime budget — Privacy-Conscious    | Pareto       | x\_min = $15                           |
| Lifetime budget — Trial User           | Pareto       | x\_min = $2                            |
| Price threshold — Power User           | LogNormal    | μ=−0.69, σ=0.7 (median ~$0.50/req)     |
| Price threshold — Casual User          | LogNormal    | μ=−1.90, σ=0.5 (median ~$0.15/req)     |
| Price threshold — Privacy-Conscious    | LogNormal    | μ=−1.61, σ=0.6 (median ~$0.20/req)     |
| Price threshold — Trial User           | LogNormal    | μ=−3.51, σ=0.4 (median ~$0.03/req)     |
| Daily requests — Power User            | Poisson(λ)   | λ ~ Uniform[20, 50]                    |
| Daily requests — Casual User           | Poisson(λ)   | λ ~ Uniform[1, 5]                      |
| Daily requests — Privacy-Conscious     | Poisson(λ)   | λ ~ Uniform[5, 15]                     |
| Daily requests — Trial User            | Poisson(λ)   | λ ~ Uniform[1, 3]                      |
| Peak daily user arrival rate           | LogNormal    | μ=ln(50), σ=0.6                        |

#### 8.3.4 Investor and Trader Capital Distributions

Starting capital follows `Pareto(x_min, α)` with shared `α` (see §8.3.3). For investors and traders this is their available investment capital on the platform. `x_min` values below are back-derived from previous median estimates to preserve distribution centres.

| Cohort         | x\_min   | Mean at α=1.5 |
| -------------- | -------- | ------------- |
| Retail         | $500     | ~$1,500       |
| DeFi Veteran   | $4,000   | ~$12,000      |
| Yield Hunter   | $2,000   | ~$6,000       |
| Speculator     | $1,000   | ~$3,000       |
| Whale          | $40,000  | ~$120,000     |
| RSI Trader     | $1,000   | ~$3,000       |
| MA Crossover   | $2,000   | ~$6,000       |
| Bollinger Band | $600     | ~$1,800       |
| Arbitrageur    | $3,000   | ~$9,000       |
| Auction Sniper | $1,000   | ~$3,000       |

| Parameter                  | Distribution | Params                                           |
| -------------------------- | ------------ | ------------------------------------------------ |
| Entry timing post-launch   | Exponential  | mean=14 days                                     |
| Auction participation rate | Beta         | α=2, β=8 (mean ~20% of investors bid per launch) |
| Variable cost per request  | Normal       | μ=cohort\_estimate, σ=0.15×μ                     |

**Position sizing** — fraction of available balance committed per investment or trade, sampled from `Beta(α, β)`. Draw is capped by `max_single_app_pct` before execution.

| Cohort         | α | β  | Mean fraction |
| -------------- | - | -- | ------------- |
| Retail         | 2 | 8  | ~20%          |
| Whale          | 2 | 10 | ~17%          |
| DeFi Veteran   | 4 | 6  | ~40%          |
| Yield Hunter   | 3 | 5  | ~38%          |
| Speculator     | 6 | 4  | ~60%          |
| RSI Trader     | 3 | 7  | ~30%          |
| MA Crossover   | 4 | 6  | ~40%          |
| Bollinger Band | 3 | 7  | ~30%          |
| Arbitrageur    | 5 | 5  | ~50%          |
| Auction Sniper | 4 | 6  | ~40%          |

#### 8.3.5 Trader Signal Parameters

Signal parameters are sampled once at spawn from per-cohort Uniform distributions.

| Cohort         | Parameter          | Distribution        |
| -------------- | ------------------ | ------------------- |
| RSI Trader     | `rsi_period`       | Uniform[10, 20]     |
| RSI Trader     | `buy_threshold`    | Uniform[25, 40]     |
| RSI Trader     | `sell_threshold`   | Uniform[60, 75]     |
| MA Crossover   | `ma_fast`          | Uniform[5, 10]      |
| MA Crossover   | `ma_slow`          | Uniform[20, 40]     |
| Bollinger Band | `bb_period`        | Uniform[15, 25]     |
| Bollinger Band | `bb_width`         | Uniform[1.5, 2.5]   |
| Arbitrageur    | `entry_ratio`      | Uniform[0.55, 0.70] |
| Auction Sniper | `target_multiple`  | Uniform[1.3, 2.0]   |

### 8.4 Monte Carlo Configuration

```
Runs per scenario:  100 (quick scan) or 1,000 (publication-quality)
Seed strategy:      fixed base seed + run index (reproducible)
Parallelization:    runs are independent; embarrassingly parallel

Output aggregation:
  For each metric, report:
    - Median
    - 10th percentile (pessimistic)
    - 90th percentile (optimistic)
    - Fraction of runs that meet the success condition
```

### 8.5 Scenario Variants

| Scenario ID    | Description                   | Key override                                |
| -------------- | ----------------------------- | ------------------------------------------- |
| BASELINE       | Single app, healthy growth    | None                                        |
| MULTI\_APP\_5  | 5 apps launch over 6 months   | App arrival rate: 1/month                   |
| MULTI\_APP\_20 | 20 apps, competitive market   | App arrival rate: 3–4/month                 |
| WHALE\_DUMP    | Scenario 7.1                  | Dump-and-Exit actor injected at tick 30     |
| COORD\_SELL    | Scenario 7.2                  | 8 coordinated sellers at tick 90            |
| LOCK\_CLIFF    | Scenario 7.3                  | All launch investors chose 6-month lock     |
| FAKE\_REVENUE  | Scenario 7.4                  | Creator bot injecting $500/day fake revenue |
| LOW\_QUALITY   | Solo Dev cohort, thin revenue | quality\_i \~ Beta(1,3)                     |
| HIGH\_GROWTH   | Viral app, 10x expected DAU   | peak\_dau \* 10                             |

### 8.6 Reference App Economics

Based on the pitch deck's illustrative example:

```
AI document tool (reference app):
  Monthly requests:    200,000
  Price per request:   $0.05
  Gross revenue:       $10,000 / month

  Variable costs:
    AI inference:      $1,600
    Settlement + gas:  $300
  Fixed costs:
    Hosting (Shared L):$42
    Storage, RPC, misc:$58
  Total costs:         $2,000

  Profit:              $8,000 / month
  Per share (1,000):   $8.00 / share / month = $96 / share / year

  At auction clearing of $40/share:
    Dividend yield:    240% APY (early investors)
  At curve price of $160/share (after 40% supply sold):
    Dividend yield:    60% APY
  At curve price of $640/share (after 80% supply sold):
    Dividend yield:    15% APY
```

This reference example grounds the stochastic distributions — quality apps should produce outcomes near these numbers; low-quality apps fall 5–10x below.

## KPIs & Success Metrics

### 9.1 Creator Metrics

| Metric                   | Definition                                            | Success threshold                |
| ------------------------ | ----------------------------------------------------- | -------------------------------- |
| Break-even day           | First day `cumulative_revenue > cumulative_costs`     | < 90 days                        |
| Monthly profit stability | StdDev(monthly\_profit) / Mean(monthly\_profit)       | < 0.5 (coefficient of variation) |
| Ops treasury months      | `ops_treasury / monthly_fixed_costs`                  | > 2 months at all times          |
| Creator vesting yield    | Total USDC from auction allocation after 6-month vest | > $5,000 for mid-tier app        |
| Uptime                   | Fraction of days `app.is_online = true`               | > 99% for healthy apps           |

### 9.2 Investor Metrics

| Metric                  | Definition                                                | Success threshold                         |
| ----------------------- | --------------------------------------------------------- | ----------------------------------------- |
| Total ROI               | `(exit_value + total_payouts - cost_basis) / cost_basis`  | > 50% over 12 months                      |
| Dividend yield APY      | `annualized(monthly_payout / current_position_value)`     | > 20% for mature apps                     |
| Sharpe ratio            | `mean(monthly_returns) / std(monthly_returns) * sqrt(12)` | > 1.5 for yield-focused cohorts           |
| Lock utilization        | Fraction of held shares that are locked                   | > 60% platform-wide                       |
| Exit liquidity          | P(exit at ≥ 50% of cost basis)                            | > 90% for non-crash scenarios             |
| Whale dump recovery ROI | ROI for locked holders through a 7.1 event                | > 0% (locked holders should net positive) |

### 9.3 User Metrics

| Metric                   | Definition                                           | Success threshold           |
| ------------------------ | ---------------------------------------------------- | --------------------------- |
| Cost per request         | Average USDC spent per request                       | < $0.10 for mainstream apps |
| 30-day retention         | Fraction of users still active after 30 days         | > 50% for high-quality apps |
| Privacy guarantee uptime | Fraction of days sealed/vault apps maintain enclave  | > 99.9%                     |
| Access denied rate       | Fraction of requests rejected (insufficient balance) | < 5%                        |

### 9.4 Platform Metrics

| Metric                | Definition                                              | Success threshold                           |
| --------------------- | ------------------------------------------------------- | ------------------------------------------- |
| Protocol fee revenue  | Cumulative USDC collected at protocol level             | Covers $50k/year operational costs          |
| Active app count      | Apps with DAU > 0                                       | > 10 after 12 months (MULTI\_APP scenarios) |
| Market cap total      | Sum of (shares\_sold \* current\_price) across all apps | Growing monotonically in BASELINE           |
| Locked value ratio    | `total_locked_value / total_market_cap`                 | > 40% platform-wide                         |
| Gini of locked value  | Concentration of locked value across apps               | < 0.6 for healthy ecosystem                 |
| New app survival rate | Fraction of deployed apps still online at 90 days       | > 70%                                       |

### 9.5 Abuse Scenario Outcomes

| Scenario             | Pass condition                                                           | Fail condition                             |
| -------------------- | ------------------------------------------------------------------------ | ------------------------------------------ |
| 7.1 Whale Dump       | Whale net profit < 0 after selling fees; market recovers within 120 days | Whale profits > 30%; no recovery           |
| 7.2 Coordinated Sell | Last seller gets ≥ 40% of first seller's price; app survives             | Reserve fully drained; app dies            |
| 7.3 Lock Cliff       | < 20% price drop at cliff; > 60% of expiring locks auto-renew            | > 50% price drop; mass exit                |
| 7.4 Fake Revenue     | Detection flag raised within 30 days of bot start                        | Scheme profitable for > 60 days undetected |
| 7.5 Treasury Drain   | App survives 14 days of attack with creator injecting funds              | App paused within 7 days of attack         |

### 9.6 Simulation Report Structure

Each scenario produces a report containing:

1. **Time-series charts:** price, DAU, payout yield, reserve balance, locked value (all per-app + platform-wide)
2. **Cohort comparison table:** median ROI, median yield, exit rate by actor cohort
3. **Percentile bands:** 10th/50th/90th percentile over Monte Carlo runs for each KPI
4. **Event log sample:** one representative run narrated as a sequence of key events
5. **Pass/fail matrix:** all pass conditions from Section 9.5 evaluated per run, with fraction passing
6. **Sensitivity analysis:** which input parameter has the largest effect on each KPI (via partial correlation coefficient)
