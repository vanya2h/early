import { LineChart, Line, ResponsiveContainer, Tooltip } from 'recharts'
import type { App } from '../models.js'

const APP_NAMES = [
  'PDF Converter', 'Image Resizer', 'Audio Transcoder', 'File Compressor',
  'Text Summariser', 'DeFi Bridge', 'DEX Aggregator', 'Yield Optimizer',
  'LP Manager', 'Token Swapper',
]

interface Props {
  app: App
  index: number
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`
  return `$${n.toFixed(2)}`
}

function pct(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`
}

export function AppCard({ app, index }: Props) {
  const name = APP_NAMES[index % APP_NAMES.length] ?? `App #${index + 1}`
  const isAuction = !app.auctionCleared
  const status = !app.isOnline ? 'Offline' : isAuction ? 'Auction' : 'Active'
  const statusColor = status === 'Active'
    ? 'bg-emerald-900 text-emerald-400'
    : status === 'Auction'
      ? 'bg-amber-900 text-amber-400'
      : 'bg-zinc-800 text-zinc-500'

  // Sparkline from priceHistory (last 30 ticks)
  const sparkData = app.priceHistory.slice(-30).map((p, i) => ({ t: i, p }))
  const openPrice = sparkData[0]?.p ?? app.currentPrice
  const changePct = openPrice > 0 ? (app.currentPrice / openPrice - 1) * 100 : 0
  const priceUp = changePct >= 0

  // Shares sold progress
  const sharesPct = app.totalShares > 0 ? (app.sharesSold / app.totalShares) * 100 : 0

  // Locked value
  const totalLocked = Object.values(app.lockRegistry).reduce((s, e) => s + e.shares, 0)
  const lockedPct = app.sharesSold > 0 ? (totalLocked / app.sharesSold) * 100 : 0

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="font-semibold text-zinc-100 text-sm">{name}</div>
          <div className="text-xs text-zinc-500 mt-0.5">App #{index + 1}</div>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor}`}>
          {status}
        </span>
      </div>

      {/* Price */}
      <div className="flex items-end justify-between">
        <div>
          <div className="text-xl font-bold tabular-nums text-zinc-100">
            {fmt(app.currentPrice)}
          </div>
          <div className={`text-xs font-medium ${priceUp ? 'text-emerald-400' : 'text-red-400'}`}>
            {pct(changePct)} from open
          </div>
        </div>

        {/* Sparkline */}
        <div className="w-24 h-10">
          {sparkData.length >= 2 && (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparkData}>
                <Line
                  type="monotone"
                  dataKey="p"
                  stroke={priceUp ? '#34d399' : '#f87171'}
                  strokeWidth={1.5}
                  dot={false}
                />
                <Tooltip content={() => null} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Shares progress */}
      <div>
        <div className="flex justify-between text-xs text-zinc-500 mb-1">
          <span>Shares sold</span>
          <span>{Math.round(app.sharesSold)} / {app.totalShares}</span>
        </div>
        <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-500 rounded-full transition-all"
            style={{ width: `${Math.min(sharesPct, 100)}%` }}
          />
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <div>
          <div className="text-zinc-500">Reserve</div>
          <div className="text-zinc-200 font-medium">{fmt(app.reserveBalance)}</div>
        </div>
        <div>
          <div className="text-zinc-500">Monthly Rev</div>
          <div className="text-zinc-200 font-medium">{fmt(app.monthlyRevenue)}</div>
        </div>
        <div>
          <div className="text-zinc-500">Active Users</div>
          <div className="text-zinc-200 font-medium">{app.activeUsers30d}</div>
        </div>
        <div>
          <div className="text-zinc-500">Sell Fee</div>
          <div className="text-zinc-200 font-medium">{(app.sellingFeeRate * 100).toFixed(0)}%</div>
        </div>
        <div>
          <div className="text-zinc-500">Locked Value</div>
          <div className="text-zinc-200 font-medium">{fmt(totalLocked * app.currentPrice)}</div>
        </div>
        <div>
          <div className="text-zinc-500">Locked %</div>
          <div className="text-zinc-200 font-medium">{lockedPct.toFixed(1)}%</div>
        </div>
      </div>
    </div>
  )
}
