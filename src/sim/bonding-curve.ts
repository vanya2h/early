/** Pure-math bonding curve. No mutable state. */
export class BondingCurve {
  /**
   * Instantaneous price at `sharesSold` shares already sold.
   * p(s) = floor * 2^(sharesSold / 200)
   */
  static price(sharesSold: number, floor: number): number {
    return floor * Math.pow(2, sharesSold / 200)
  }

  /**
   * Total cost to acquire `amount` shares starting from `from` shares already sold.
   * Integral of p(s) ds from `from` to `from + amount`:
   *   floor * (200 / ln2) * (2^((from+amount)/200) - 2^(from/200))
   */
  static costToAcquire(from: number, amount: number, floor: number): number {
    if (amount <= 0) return 0
    const factor = floor * (200 / Math.LN2)
    return factor * (Math.pow(2, (from + amount) / 200) - Math.pow(2, from / 200))
  }
}
