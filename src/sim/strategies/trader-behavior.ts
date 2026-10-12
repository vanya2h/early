import type {
  RSIStrategy,
  MACrossoverStrategy,
  BollingerBandStrategy,
  ArbitrageurStrategy,
  AuctionSniperStrategy,
  TraderStrategy,
} from '../../models.js'

/** Trader signal strategy interface. */
export interface TraderBehavior {
  shouldEnter(priceHistory: number[], reserveRatio: number): boolean
  shouldExit(priceHistory: number[], entryPrice: number): boolean
}

// ─── RSI ─────────────────────────────────────────────────────────────────────

function computeRSI(prices: number[], period: number): number {
  if (prices.length < period + 1) return 50
  let gains = 0
  let losses = 0
  for (let i = prices.length - period; i < prices.length; i++) {
    const prev = prices[i - 1] ?? prices[i] ?? 0
    const curr = prices[i] ?? 0
    const change = curr - prev
    if (change > 0) gains += change
    else losses -= change
  }
  const avgGain = gains / period
  const avgLoss = losses / period
  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

/** RSI counter-cyclical trader behavior. */
export class RSIBehavior implements TraderBehavior {
  constructor(private readonly params: RSIStrategy) {}

  shouldEnter(priceHistory: number[], _reserveRatio: number): boolean {
    const rsi = computeRSI(priceHistory, this.params.rsiPeriod)
    return rsi < this.params.buyThreshold
  }

  shouldExit(priceHistory: number[], _entryPrice: number): boolean {
    const rsi = computeRSI(priceHistory, this.params.rsiPeriod)
    return rsi > this.params.sellThreshold
  }
}

// ─── MA Crossover ────────────────────────────────────────────────────────────

function sma(prices: number[], period: number): number | null {
  if (prices.length < period) return null
  const slice = prices.slice(prices.length - period)
  return slice.reduce((s, v) => s + v, 0) / period
}

/** Moving-average crossover trend-following behavior. */
export class MACrossoverBehavior implements TraderBehavior {
  constructor(private readonly params: MACrossoverStrategy) {}

  shouldEnter(priceHistory: number[], _reserveRatio: number): boolean {
    const fast = sma(priceHistory, this.params.maFast)
    const slow = sma(priceHistory, this.params.maSlow)
    if (fast === null || slow === null) return false
    return fast > slow * 1.001 // golden cross with small buffer
  }

  shouldExit(priceHistory: number[], _entryPrice: number): boolean {
    const fast = sma(priceHistory, this.params.maFast)
    const slow = sma(priceHistory, this.params.maSlow)
    if (fast === null || slow === null) return false
    return fast < slow * 0.999 // death cross
  }
}

// ─── Bollinger Band ───────────────────────────────────────────────────────────

function bollingerBands(prices: number[], period: number, width: number): { upper: number; lower: number; mid: number } | null {
  if (prices.length < period) return null
  const slice = prices.slice(prices.length - period)
  const mid = slice.reduce((s, v) => s + v, 0) / period
  const variance = slice.reduce((s, v) => s + (v - mid) ** 2, 0) / period
  const sigma = Math.sqrt(variance)
  return { upper: mid + width * sigma, lower: mid - width * sigma, mid }
}

/** Bollinger Band mean-reversion behavior. */
export class BollingerBandBehavior implements TraderBehavior {
  constructor(private readonly params: BollingerBandStrategy) {}

  shouldEnter(priceHistory: number[], _reserveRatio: number): boolean {
    const bands = bollingerBands(priceHistory, this.params.bbPeriod, this.params.bbWidth)
    if (!bands) return false
    const lastPrice = priceHistory[priceHistory.length - 1] ?? 0
    return lastPrice <= bands.lower
  }

  shouldExit(priceHistory: number[], _entryPrice: number): boolean {
    const bands = bollingerBands(priceHistory, this.params.bbPeriod, this.params.bbWidth)
    if (!bands) return false
    const lastPrice = priceHistory[priceHistory.length - 1] ?? 0
    return lastPrice >= bands.upper
  }
}

// ─── Arbitrageur ──────────────────────────────────────────────────────────────

/** Reserve undervaluation arbitrage behavior. */
export class ArbitrageurBehavior implements TraderBehavior {
  constructor(private readonly params: ArbitrageurStrategy) {}

  shouldEnter(_priceHistory: number[], reserveRatio: number): boolean {
    // reserveRatio is actually passed as reservePrice/curvePrice from TraderActor
    return reserveRatio < this.params.entryRatio
  }

  shouldExit(priceHistory: number[], entryPrice: number): boolean {
    const lastPrice = priceHistory[priceHistory.length - 1] ?? 0
    // Exit when price recovers above entry * 1.1
    return lastPrice > entryPrice * 1.1
  }
}

// ─── Auction Sniper ───────────────────────────────────────────────────────────

/** Auction sniping behavior — always enters new auctions. */
export class AuctionSniperBehavior implements TraderBehavior {
  constructor(private readonly params: AuctionSniperStrategy) {}

  shouldEnter(_priceHistory: number[], _reserveRatio: number): boolean {
    // Auction snipers enter via auction bids, not bonding curve
    // After auction clears, they may buy a small amount
    return _priceHistory.length <= 5
  }

  shouldExit(_priceHistory: number[], entryPrice: number): boolean {
    const lastPrice = _priceHistory[_priceHistory.length - 1] ?? 0
    return lastPrice >= entryPrice * this.params.targetMultiple
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/** Create a TraderBehavior from a TraderStrategy discriminated union. */
export function createBehavior(strategy: TraderStrategy): TraderBehavior {
  switch (strategy.type) {
    case 'RSI': return new RSIBehavior(strategy as RSIStrategy)
    case 'MACrossover': return new MACrossoverBehavior(strategy as MACrossoverStrategy)
    case 'BollingerBand': return new BollingerBandBehavior(strategy as BollingerBandStrategy)
    case 'Arbitrageur': return new ArbitrageurBehavior(strategy as ArbitrageurStrategy)
    case 'AuctionSniper': return new AuctionSniperBehavior(strategy as AuctionSniperStrategy)
  }
}
