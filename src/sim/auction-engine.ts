/** A single bid in the CCA auction. */
type Bid = {
  bidderId: string
  maxPrice: number
  amount: number
}

/** Result returned from a settled auction. */
export type AuctionResult = {
  winners: { actorId: string; shares: number; paid: number }[]
  totalProceeds: number
  reserveAmount: number
  creatorAmount: number
}

/**
 * Continuous Clearing Auction engine.
 * Holds bids from participants; settles at a uniform clearing price.
 */
export class AuctionEngine {
  private bids: Map<string, Bid> = new Map()

  /** Add or replace a bid for a given bidder. */
  submitBid(bidderId: string, maxPrice: number, amount: number): void {
    this.bids.set(bidderId, { bidderId, maxPrice, amount })
  }

  /**
   * Binary-search for the clearing price p* where
   * sum(amount_i for bids with maxPrice >= p*) >= availableShares.
   */
  clearingPrice(availableShares: number): number {
    const eligible = Array.from(this.bids.values())
    if (eligible.length === 0) return 0

    // Total demand at price 0 is sum of all amounts
    const totalDemand = eligible.reduce((s, b) => s + b.amount, 0)
    if (totalDemand <= 0) return 0

    // Find the range: lo = min maxPrice, hi = max maxPrice
    let lo = eligible.reduce((m, b) => Math.min(m, b.maxPrice), Infinity)
    let hi = eligible.reduce((m, b) => Math.max(m, b.maxPrice), 0)

    if (hi <= 0) return 0

    // Binary search: find largest p* where demand(p*) >= availableShares
    for (let iter = 0; iter < 64; iter++) {
      const mid = (lo + hi) / 2
      const demand = eligible.filter(b => b.maxPrice >= mid).reduce((s, b) => s + b.amount, 0)
      if (demand >= availableShares) {
        lo = mid
      } else {
        hi = mid
      }
      if (hi - lo < 0.0001) break
    }
    return lo
  }

  /**
   * Settle the auction: allocate shares pro-rata among winners at the clearing price.
   * Returns winners list plus fund split.
   */
  settle(auctionSize: number, reserveRatio: number): AuctionResult {
    const p = this.clearingPrice(auctionSize)
    const eligible = Array.from(this.bids.values()).filter(b => b.maxPrice >= p)
    const totalDemand = eligible.reduce((s, b) => s + b.amount, 0)

    const winners: AuctionResult['winners'] = []
    let totalProceeds = 0

    for (const bid of eligible) {
      // Pro-rata allocation: min(bid.amount, proportional share)
      const ratio = totalDemand > 0 ? bid.amount / totalDemand : 0
      const shares = Math.min(bid.amount, ratio * auctionSize)
      const paid = shares * p
      winners.push({ actorId: bid.bidderId, shares, paid })
      totalProceeds += paid
    }

    const reserveAmount = totalProceeds * reserveRatio
    const creatorAmount = totalProceeds - reserveAmount

    return { winners, totalProceeds, reserveAmount, creatorAmount }
  }
}
