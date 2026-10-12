import { useState, useMemo } from 'react'
import type { App } from '../models.js'

const APP_NAMES = [
  'PDF Converter', 'Image Resizer', 'Audio Transcoder', 'File Compressor',
  'Text Summariser', 'DeFi Bridge', 'DEX Aggregator', 'Yield Optimizer',
  'LP Manager', 'Token Swapper',
]

type SortKey =
  | 'name' | 'status' | 'price' | 'priceDelta' | 'marketCap'
  | 'sharesPct' | 'revenue' | 'mau' | 'uniqueUsers' | 'investors'
  | 'reserve' | 'lockedValue' | 'lockedPct' | 'fee'

type SortDir = 'asc' | 'desc'

interface Row {
  app: App
  name: string
  originalIndex: number
  statusLabel: 'Active' | 'Auction' | 'Offline'
  price: number
  priceDelta: number
  marketCap: number
  sharesPct: number
  revenue: number
  mau: number
  uniqueUsers: number
  investors: number
  reserve: number
  lockedValue: number
  lockedPct: number
  fee: number
}

function buildRow(app: App, index: number): Row {
  const totalLocked = Object.values(app.lockRegistry).reduce((s, e) => s + e.shares, 0)
  const histLen = app.priceHistory.length
  const openPrice = histLen > 0 ? (app.priceHistory[0] ?? app.currentPrice) : app.currentPrice
  const priceDelta = openPrice > 0 ? (app.currentPrice / openPrice - 1) * 100 : 0
  const statusLabel: Row['statusLabel'] = !app.isOnline ? 'Offline' : !app.auctionCleared ? 'Auction' : 'Active'

  return {
    app,
    name: APP_NAMES[index % APP_NAMES.length] ?? `App #${index + 1}`,
    originalIndex: index,
    statusLabel,
    price: app.currentPrice,
    priceDelta,
    marketCap: app.currentPrice * app.sharesSold,
    sharesPct: app.totalShares > 0 ? (app.sharesSold / app.totalShares) * 100 : 0,
    revenue: app.monthlyRevenue,
    mau: app.activeUsers30d,
    uniqueUsers: app.uniqueUsers,
    investors: app.shareholderCount,
    reserve: app.reserveBalance,
    lockedValue: totalLocked * app.currentPrice,
    lockedPct: app.sharesSold > 0 ? (totalLocked / app.sharesSold) * 100 : 0,
    fee: app.sellingFeeRate * 100,
  }
}

function sortRows(rows: Row[], key: SortKey, dir: SortDir): Row[] {
  const sorted = [...rows].sort((a, b) => {
    let va: string | number
    let vb: string | number
    if (key === 'name') {
      va = a.name
      vb = b.name
    } else if (key === 'status') {
      const rank = { Active: 0, Auction: 1, Offline: 2 }
      va = rank[a.statusLabel]
      vb = rank[b.statusLabel]
    } else {
      va = a[key]
      vb = b[key]
    }
    if (va < vb) return dir === 'asc' ? -1 : 1
    if (va > vb) return dir === 'asc' ? 1 : -1
    return 0
  })
  return sorted
}

function fmtUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`
  return `$${n.toFixed(2)}`
}

function fmtPct(n: number, signed = false): string {
  const s = n.toFixed(1) + '%'
  return signed ? (n >= 0 ? '+' + s : s) : s
}

function SortIcon({ dir }: { dir: SortDir | null }) {
  if (!dir) return <span className="ml-1 text-zinc-700">⇅</span>
  return <span className="ml-1 text-emerald-400">{dir === 'asc' ? '↑' : '↓'}</span>
}

interface ColDef {
  key: SortKey
  label: string
  title?: string
  align: 'left' | 'right'
}

const COLUMNS: ColDef[] = [
  { key: 'name',        label: 'App',        align: 'left'  },
  { key: 'status',      label: 'Status',     align: 'left'  },
  { key: 'price',       label: 'Price',      align: 'right' },
  { key: 'priceDelta',  label: 'Δ (hist)',   title: 'Price change over available history', align: 'right' },
  { key: 'marketCap',   label: 'Mkt Cap',    align: 'right' },
  { key: 'sharesPct',   label: 'Shares %',   title: 'Shares sold as % of total supply', align: 'right' },
  { key: 'revenue',     label: 'Rev 30d',    title: 'Rolling 30-day revenue', align: 'right' },
  { key: 'mau',         label: 'MAU',        title: 'Monthly active users (last 30 ticks)', align: 'right' },
  { key: 'uniqueUsers', label: 'Users',      title: 'All-time unique users', align: 'right' },
  { key: 'investors',   label: 'Investors',  title: 'Unique shareholders currently holding > 0 shares', align: 'right' },
  { key: 'reserve',     label: 'Reserve',    title: 'Reserve pool balance', align: 'right' },
  { key: 'lockedValue', label: 'Locked $',   title: 'Value of locked shares at current price', align: 'right' },
  { key: 'lockedPct',   label: 'Locked %',   title: 'Locked shares as % of sold shares', align: 'right' },
  { key: 'fee',         label: 'Fee %',      title: 'Selling fee rate', align: 'right' },
]

interface Props {
  apps: App[]
  onSelect: (app: App, name: string) => void
}

export function AppGrid({ apps, onSelect }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('marketCap')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const rows = useMemo(() => {
    const built = apps.map((app, i) => buildRow(app, i))
    return sortRows(built, sortKey, sortDir)
  }, [apps, sortKey, sortDir])

  if (apps.length === 0) {
    return <div className="text-zinc-500 text-sm py-8 text-center">No apps deployed yet.</div>
  }

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      // Numeric columns default to descending (highest first); text columns ascending
      setSortDir(key === 'name' || key === 'status' ? 'asc' : 'desc')
    }
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-800">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-zinc-900 border-b border-zinc-800">
            {COLUMNS.map(col => (
              <th
                key={col.key}
                title={col.title}
                onClick={() => handleSort(col.key)}
                className={`
                  px-4 py-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider
                  cursor-pointer select-none whitespace-nowrap
                  hover:text-zinc-200 transition-colors
                  ${col.align === 'right' ? 'text-right' : 'text-left'}
                `}
              >
                {col.label}
                <SortIcon dir={sortKey === col.key ? sortDir : null} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIdx) => {
            const { app } = row
            const statusColor = row.statusLabel === 'Active'
              ? 'bg-emerald-900/60 text-emerald-400'
              : row.statusLabel === 'Auction'
                ? 'bg-amber-900/60 text-amber-400'
                : 'bg-zinc-800 text-zinc-500'
            const deltaColor = row.priceDelta >= 0 ? 'text-emerald-400' : 'text-red-400'

            return (
              <tr
                key={app.id}
                onClick={() => onSelect(row.app, row.name)}
                className={`
                  border-b border-zinc-800/60 transition-colors cursor-pointer
                  ${rowIdx % 2 === 0 ? 'bg-zinc-950' : 'bg-zinc-900/40'}
                  hover:bg-zinc-800/50
                `}
              >
                {/* App name */}
                <td className="px-4 py-3 whitespace-nowrap">
                  <div className="font-medium text-zinc-100">{row.name}</div>
                  <div className="text-xs text-zinc-600">#{row.originalIndex + 1} · day {app.deployedAt}</div>
                </td>

                {/* Status */}
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor}`}>
                    {row.statusLabel}
                  </span>
                </td>

                {/* Price */}
                <td className="px-4 py-3 text-right tabular-nums text-zinc-100 font-medium">
                  {fmtUsd(row.price)}
                </td>

                {/* Price Δ */}
                <td className={`px-4 py-3 text-right tabular-nums font-medium ${deltaColor}`}>
                  {fmtPct(row.priceDelta, true)}
                </td>

                {/* Market Cap */}
                <td className="px-4 py-3 text-right tabular-nums text-zinc-200">
                  {fmtUsd(row.marketCap)}
                </td>

                {/* Shares % */}
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-16 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-600 rounded-full"
                        style={{ width: `${Math.min(row.sharesPct, 100)}%` }}
                      />
                    </div>
                    <span className="tabular-nums text-zinc-300 text-xs w-10 text-right">
                      {row.sharesPct.toFixed(0)}%
                    </span>
                  </div>
                </td>

                {/* Revenue 30d */}
                <td className="px-4 py-3 text-right tabular-nums text-zinc-200">
                  {fmtUsd(row.revenue)}
                </td>

                {/* MAU */}
                <td className="px-4 py-3 text-right tabular-nums text-zinc-300">
                  {row.mau.toLocaleString()}
                </td>

                {/* Unique Users */}
                <td className="px-4 py-3 text-right tabular-nums text-zinc-300">
                  {row.uniqueUsers.toLocaleString()}
                </td>

                {/* Investors */}
                <td className="px-4 py-3 text-right tabular-nums text-zinc-300">
                  {row.investors.toLocaleString()}
                </td>

                {/* Reserve */}
                <td className="px-4 py-3 text-right tabular-nums text-zinc-300">
                  {fmtUsd(row.reserve)}
                </td>

                {/* Locked $ */}
                <td className="px-4 py-3 text-right tabular-nums text-zinc-300">
                  {fmtUsd(row.lockedValue)}
                </td>

                {/* Locked % */}
                <td className="px-4 py-3 text-right tabular-nums text-zinc-300">
                  {fmtPct(row.lockedPct)}
                </td>

                {/* Fee % */}
                <td className="px-4 py-3 text-right tabular-nums text-zinc-400">
                  {fmtPct(row.fee)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
