export type SimEventKind =
  | 'DEPLOYED'
  | 'AUCTION_CLEARED'
  | 'OFFLINE'
  | 'ONLINE'
  | 'LARGE_BUY'
  | 'LARGE_SELL'
  | 'LOCK'
  | 'SCENARIO_WHALE_DUMP'
  | 'SCENARIO_COORD_SELL'
  | 'SCENARIO_LOCK_CLIFF'
  | 'SCENARIO_FAKE_REVENUE'
  | 'SCENARIO_TREASURY_DRAIN'

export type SimEvent = {
  tick: number
  kind: SimEventKind
  label: string
  /** USDC value associated with the event, if applicable. */
  value?: number
}
