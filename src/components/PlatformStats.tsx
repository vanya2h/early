import type { App } from '../models.js'
import type { TickPoint } from '../sim/simulation.js'

interface Props {
  point: TickPoint
  apps: App[]
}

function fmt(n: number, decimals = 0): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`
  return `$${n.toFixed(decimals)}`
}

function StatTile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col gap-1">
      <span className={`text-2xl font-bold tabular-nums ${accent ? 'text-emerald-400' : 'text-zinc-100'}`}>
        {value}
      </span>
      <span className="text-xs text-zinc-500 uppercase tracking-wider">{label}</span>
    </div>
  )
}

export function PlatformStats({ point, apps }: Props) {
  const activeApps = apps.filter(a => a.isOnline).length

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
      <StatTile label="Total Apps" value={`${point.totalApps} (${activeApps} live)`} />
      <StatTile label="Platform DAU" value={String(point.totalDau)} />
      <StatTile label="Market Cap" value={fmt(point.totalMarketCap)} accent />
      <StatTile label="Protocol Fees" value={fmt(point.platformFees)} />
      <StatTile label="Locked Value" value={fmt(point.totalLockedValue)} />
      <StatTile label="Unique Users" value={String(point.uniqueUsers)} />
      <StatTile label="Active Investors" value={String(point.activeInvestors)} />
      <StatTile label="Active Traders" value={String(point.activeTraders)} />
    </div>
  )
}
