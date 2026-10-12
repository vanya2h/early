import { useEffect, useRef, useMemo, useState } from 'react'
import { Vela } from '@luxalgo/vela'
import type { App } from '../models.js'
import type { TickPoint, ScenarioStatus } from '../sim/simulation.js'
import { ScenarioType } from '../sim/simulation.js'
import type { SimEvent, SimEventKind } from '../sim/sim-event.js'
import type { HolderStat } from '../sim/simulation.js'

// ── Constants ────────────────────────────────────────────────────────────────

const SIM_EPOCH = Date.UTC(2024, 0, 1)
const DAY_MS = 86_400_000
const BAR_UPDATE_STRIDE = 8

// ── Helpers ──────────────────────────────────────────────────────────────────

type VBar = { time: number; open: number; high: number; low: number; close: number }

function buildBars(appId: string, series: TickPoint[]): VBar[] {
  const bars: VBar[] = []
  let prevClose: number | null = null
  for (const pt of series) {
    const price = pt.appPrices[appId]
    if (!price) continue
    const open = prevClose ?? price
    bars.push({
      time: SIM_EPOCH + pt.tick * DAY_MS,
      open,
      high: Math.max(open, price),
      low:  Math.min(open, price),
      close: price,
    })
    prevClose = price
  }
  return bars
}

const KIND_META: Record<SimEventKind, { color: string; letter: string; dot: string }> = {
  DEPLOYED:                { color: '#60a5fa', letter: 'D', dot: 'bg-blue-400'    },
  AUCTION_CLEARED:         { color: '#fbbf24', letter: 'A', dot: 'bg-amber-400'   },
  OFFLINE:                 { color: '#f87171', letter: 'X', dot: 'bg-red-400'     },
  ONLINE:                  { color: '#34d399', letter: 'O', dot: 'bg-emerald-400' },
  LARGE_BUY:               { color: '#34d399', letter: 'B', dot: 'bg-emerald-500' },
  LARGE_SELL:              { color: '#f87171', letter: 'S', dot: 'bg-red-500'     },
  LOCK:                    { color: '#a78bfa', letter: 'L', dot: 'bg-violet-400'  },
  SCENARIO_WHALE_DUMP:     { color: '#ef4444', letter: 'W', dot: 'bg-red-500'     },
  SCENARIO_COORD_SELL:     { color: '#f97316', letter: 'C', dot: 'bg-orange-500'  },
  SCENARIO_LOCK_CLIFF:     { color: '#eab308', letter: 'K', dot: 'bg-yellow-500'  },
  SCENARIO_FAKE_REVENUE:   { color: '#a855f7', letter: 'F', dot: 'bg-purple-500'  },
  SCENARIO_TREASURY_DRAIN: { color: '#ec4899', letter: 'T', dot: 'bg-pink-500'    },
}

const TRADE_KINDS: SimEventKind[] = ['LARGE_BUY', 'LARGE_SELL', 'LOCK']

function fmtUsd(n: number, signed = false): string {
  const abs = Math.abs(n)
  const prefix = signed ? (n >= 0 ? '+' : '−') : n < 0 ? '−' : ''
  if (abs >= 1_000_000) return `${prefix}$${(abs / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000)     return `${prefix}$${(abs / 1_000).toFixed(1)}k`
  return `${prefix}$${abs.toFixed(2)}`
}

function pnlColor(n: number): string {
  if (n > 0) return 'text-emerald-400'
  if (n < 0) return 'text-red-400'
  return 'text-zinc-500'
}

function shortId(id: string): string {
  // "investor-12" → "inv·12", "trader-7" → "trd·7", "creator-3" → "ctr·3"
  const m = /^(\w+)-(\d+)$/.exec(id)
  if (!m) return id
  const prefix = m[1]?.slice(0, 3) ?? m[1] ?? '?'
  return `${prefix}·${m[2]}`
}

// ── Event row ─────────────────────────────────────────────────────────────────

function EventRow({ ev }: { ev: SimEvent }) {
  const meta = KIND_META[ev.kind]
  return (
    <div className="flex items-start gap-3 px-4 py-2.5 border-b border-zinc-800/60 hover:bg-zinc-800/40 transition-colors">
      <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${meta.dot}`} />
      <div className="min-w-0">
        <div className="text-xs text-zinc-300 leading-snug">{ev.label}</div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-zinc-600">Day {ev.tick}</span>
          {ev.value !== undefined && (
            <span className="text-xs text-zinc-500">{fmtUsd(ev.value)}</span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Investor row ──────────────────────────────────────────────────────────────

function InvestorRow({ stat, rank }: { stat: HolderStat; rank: number }) {
  return (
    <div className="px-4 py-2.5 border-b border-zinc-800/60 hover:bg-zinc-800/40 transition-colors">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs text-zinc-600 tabular-nums w-4 shrink-0">#{rank}</span>
          <span className="text-xs font-mono text-zinc-300 truncate">{shortId(stat.actorId)}</span>
        </div>
        <span className={`text-xs tabular-nums font-semibold ${pnlColor(stat.totalPnl)}`}>
          {fmtUsd(stat.totalPnl, true)}
        </span>
      </div>
      <div className="flex items-center justify-between mt-1 pl-6">
        <div className="flex gap-3 text-xs text-zinc-600">
          <span>{stat.shares.toFixed(1)} sh</span>
          <span title="Cost basis">cb {fmtUsd(stat.costBasis)}</span>
        </div>
        <div className="flex gap-2 text-xs tabular-nums">
          <span className={pnlColor(stat.unrealizedPnl)} title="Unrealized PnL">
            U {fmtUsd(stat.unrealizedPnl, true)}
          </span>
          <span className={pnlColor(stat.realizedPnl)} title="Realized PnL">
            R {fmtUsd(stat.realizedPnl, true)}
          </span>
        </div>
      </div>
    </div>
  )
}

// ── Scenarios panel ───────────────────────────────────────────────────────────

const SCENARIO_DEFS: {
  type: ScenarioType
  label: string
  description: string
  color: 'red' | 'orange' | 'yellow' | 'purple' | 'pink'
  requiresAuction: boolean
}[] = [
  {
    type: ScenarioType.WhaleDump,
    label: 'Whale Dump',
    description: 'Inject a whale holding 30–40% of supply who dumps everything in one block',
    color: 'red',
    requiresAuction: true,
  },
  {
    type: ScenarioType.CoordSell,
    label: 'Coord Sell',
    description: 'Force 3–8 of the largest holders to sell simultaneously',
    color: 'orange',
    requiresAuction: true,
  },
  {
    type: ScenarioType.LockCliff,
    label: 'Lock Cliff',
    description: 'Force-expire all active locks instantly (structural cliff risk)',
    color: 'yellow',
    requiresAuction: false,
  },
  {
    type: ScenarioType.FakeRevenue,
    label: 'Fake Revenue',
    description: 'Creator bot injects $500/day fake revenue for 30 ticks',
    color: 'purple',
    requiresAuction: false,
  },
  {
    type: ScenarioType.TreasuryDrain,
    label: 'Treasury Drain',
    description: 'Adversarial requests drain the ops treasury over 14 ticks',
    color: 'pink',
    requiresAuction: false,
  },
]

const BUTTON_COLOR: Record<string, string> = {
  red:    'bg-red-900/40 border-red-700 text-red-300 hover:bg-red-900/70 disabled:opacity-40 disabled:cursor-not-allowed',
  orange: 'bg-orange-900/40 border-orange-700 text-orange-300 hover:bg-orange-900/70 disabled:opacity-40 disabled:cursor-not-allowed',
  yellow: 'bg-yellow-900/40 border-yellow-700 text-yellow-300 hover:bg-yellow-900/70 disabled:opacity-40 disabled:cursor-not-allowed',
  purple: 'bg-purple-900/40 border-purple-700 text-purple-300 hover:bg-purple-900/70 disabled:opacity-40 disabled:cursor-not-allowed',
  pink:   'bg-pink-900/40 border-pink-700 text-pink-300 hover:bg-pink-900/70 disabled:opacity-40 disabled:cursor-not-allowed',
}

const DOT_COLOR: Record<string, string> = {
  red: 'bg-red-400', orange: 'bg-orange-400', yellow: 'bg-yellow-400',
  purple: 'bg-purple-400', pink: 'bg-pink-400',
}

function ScenariosPanel({
  app,
  statuses,
  onTrigger,
}: {
  app: App
  statuses: ScenarioStatus[]
  onTrigger: (type: ScenarioType) => void
}) {
  const activeTypes = new Set(statuses.filter(s => s.phase === 'active').map(s => s.type))
  const active = statuses.filter(s => s.phase === 'active')
  const history = statuses.filter(s => s.phase === 'done')

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Trigger buttons */}
      <div className="px-4 py-3 border-b border-zinc-800/60 shrink-0">
        <p className="text-xs text-zinc-500 mb-2.5 uppercase tracking-wider">Inject scenario</p>
        <div className="flex flex-col gap-1.5">
          {SCENARIO_DEFS.map(def => {
            const blocked = activeTypes.has(def.type) ||
              (def.requiresAuction && !app.auctionCleared)
            return (
              <button
                key={def.type}
                disabled={blocked}
                onClick={() => onTrigger(def.type)}
                title={def.description}
                className={`flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs font-medium border text-left transition-colors ${BUTTON_COLOR[def.color]}`}
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${
                  activeTypes.has(def.type)
                    ? `${DOT_COLOR[def.color]} animate-pulse`
                    : `${DOT_COLOR[def.color]} opacity-60`
                }`} />
                <span className="flex-1">{def.label}</span>
                {activeTypes.has(def.type) && (
                  <span className="text-zinc-400 text-xs">running</span>
                )}
                {def.requiresAuction && !app.auctionCleared && (
                  <span className="text-zinc-600 text-xs">needs auction</span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Active */}
      {active.length > 0 && (
        <div className="px-4 py-2 border-b border-zinc-800/60 shrink-0">
          <p className="text-xs text-zinc-500 mb-1.5 uppercase tracking-wider">Active</p>
          {active.map(s => (
            <div key={s.id} className="mb-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-zinc-200">{s.type.replace(/([A-Z])/g, ' $1').trim()}</span>
                {s.progress && (
                  <span className="text-xs tabular-nums text-zinc-500">
                    {s.progress.elapsed}/{s.progress.total}
                  </span>
                )}
              </div>
              {s.progress && (
                <div className="mt-1 h-1 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-zinc-400 rounded-full transition-all"
                    style={{ width: `${(s.progress.elapsed / s.progress.total) * 100}%` }}
                  />
                </div>
              )}
              <div className="text-xs text-zinc-600 mt-0.5">Day {s.startTick}</div>
            </div>
          ))}
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="px-4 py-2">
          <p className="text-xs text-zinc-500 mb-1.5 uppercase tracking-wider">History</p>
          {history.map(s => (
            <div key={s.id} className="mb-2.5 border-b border-zinc-800/40 pb-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-zinc-300">{s.type.replace(/([A-Z])/g, ' $1').trim()}</span>
                <span className="text-xs text-zinc-600">Day {s.startTick}–{s.endTick ?? '?'}</span>
              </div>
              {s.summary && (
                <p className="text-xs text-zinc-500 mt-0.5 leading-snug">{s.summary}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {active.length === 0 && history.length === 0 && (
        <p className="text-xs text-zinc-600 px-4 py-6 text-center">No scenarios triggered yet.</p>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

type SideTab = 'investors' | 'events' | 'scenarios'

interface Props {
  app: App
  appName: string
  series: TickPoint[]
  events: SimEvent[]
  holderStats: HolderStat[]
  scenarioStatuses: ScenarioStatus[]
  onTriggerScenario: (type: ScenarioType) => void
  onClose: () => void
}

export function AppDetail({ app, appName, series, events, holderStats, scenarioStatuses, onTriggerScenario, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const velaRef      = useRef<InstanceType<typeof Vela> | null>(null)
  const lastLenRef   = useRef(0)
  const [sideTab, setSideTab] = useState<SideTab>('investors')

  const bars = useMemo(() => buildBars(app.id, series), [app.id, series])

  // ── Init chart once per app ───────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current
    if (!el || bars.length === 0) return

    const chart = new Vela(el, { data: bars, timeframe: '1D', theme: 'dark' })
    chart.marks
      .defineGroup({ id: 'lifecycle', label: 'Lifecycle' })
      .defineGroup({ id: 'trades',    label: 'Trades'    })

    velaRef.current    = chart
    lastLenRef.current = bars.length
    void chart.ready().then(() => chart.setVisibleRangePreset('ALL'))

    return () => {
      chart.destroy()
      velaRef.current    = null
      lastLenRef.current = 0
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.id])

  // ── Live bar updates (throttled) ─────────────────────────────────────────
  useEffect(() => {
    const chart = velaRef.current
    if (!chart || bars.length === 0) return
    if (bars.length - lastLenRef.current < BAR_UPDATE_STRIDE) return
    lastLenRef.current = bars.length
    void chart.setMarket({ data: bars })
  }, [bars])

  // ── Sync timeline marks ───────────────────────────────────────────────────
  useEffect(() => {
    const chart = velaRef.current
    if (!chart) return
    const marks = events.map(ev => {
      const meta = KIND_META[ev.kind]
      return {
        id:      `${ev.tick}-${ev.kind}`,
        time:    SIM_EPOCH + ev.tick * DAY_MS,
        group:   TRADE_KINDS.includes(ev.kind) ? 'trades' : 'lifecycle',
        title:   ev.label,
        tooltip: `Day ${ev.tick} · ${ev.label}`,
        glyph:   { color: meta.color, letter: meta.letter },
        content: {
          panel: {
            items: [
              { type: 'field' as const, label: 'Day',   value: String(ev.tick) },
              { type: 'field' as const, label: 'Event', value: ev.label        },
              ...(ev.value !== undefined
                ? [{ type: 'field' as const, label: 'Amount', value: fmtUsd(ev.value) }]
                : []),
            ],
          },
        },
      }
    })
    chart.marks.set(marks)
  }, [events])

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-7xl bg-zinc-900 border border-zinc-700 rounded-2xl flex flex-col overflow-hidden"
        style={{ height: '88vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-zinc-100">{appName}</span>
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                !app.isOnline         ? 'bg-zinc-800 text-zinc-500'       :
                !app.auctionCleared   ? 'bg-amber-900/60 text-amber-400'  :
                                        'bg-emerald-900/60 text-emerald-400'
              }`}
            >
              {!app.isOnline ? 'Offline' : !app.auctionCleared ? 'Auction' : 'Active'}
            </span>
            <span className="text-xs text-zinc-500">
              #{app.id} · deployed day {app.deployedAt} · {fmtUsd(app.currentPrice)} / share
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200 text-lg leading-none transition-colors px-1"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0">
          {/* Vela chart */}
          <div ref={containerRef} className="flex-1 min-w-0" />

          {/* Right sidebar */}
          <div className="w-80 shrink-0 border-l border-zinc-800 flex flex-col">
            {/* Tab bar */}
            <div className="flex border-b border-zinc-800 shrink-0">
              {(['investors', 'events', 'scenarios'] as SideTab[]).map(t => {
                const activeScenarios = scenarioStatuses.filter(s => s.phase === 'active').length
                const label =
                  t === 'investors' ? `Investors (${holderStats.length})`
                  : t === 'events'  ? `Events (${events.length})`
                  : activeScenarios > 0 ? `Scenarios (${activeScenarios})` : 'Scenarios'
                return (
                  <button
                    key={t}
                    onClick={() => setSideTab(t)}
                    className={`flex-1 px-2 py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
                      sideTab === t
                        ? 'text-emerald-400 border-b-2 border-emerald-400'
                        : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>

            {/* Investors panel */}
            {sideTab === 'investors' && (
              <div className="flex-1 overflow-y-auto">
                {holderStats.length === 0 ? (
                  <p className="text-xs text-zinc-600 px-4 py-6 text-center">
                    No shareholders yet.
                  </p>
                ) : (
                  <>
                    {/* Column header */}
                    <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800/60 shrink-0">
                      <span className="text-xs text-zinc-600">Actor</span>
                      <div className="flex gap-4 text-xs text-zinc-600">
                        <span title="Unrealized PnL">U PnL</span>
                        <span title="Realized PnL">R PnL</span>
                        <span>Total</span>
                      </div>
                    </div>
                    {holderStats.map((stat, i) => (
                      <InvestorRow key={stat.actorId} stat={stat} rank={i + 1} />
                    ))}
                  </>
                )}
              </div>
            )}

            {/* Events panel */}
            {sideTab === 'events' && (
              <div className="flex-1 overflow-y-auto">
                {events.length === 0 ? (
                  <p className="text-xs text-zinc-600 px-4 py-6 text-center">No events yet.</p>
                ) : (
                  events.slice().reverse().map((ev, i) => (
                    <EventRow key={i} ev={ev} />
                  ))
                )}
              </div>
            )}

            {/* Scenarios panel */}
            {sideTab === 'scenarios' && (
              <div className="flex-1 min-h-0">
                <ScenariosPanel
                  app={app}
                  statuses={scenarioStatuses}
                  onTrigger={onTriggerScenario}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
