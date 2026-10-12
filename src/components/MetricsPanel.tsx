import {
  AreaChart, Area, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts'
import type { TickPoint } from '../sim/simulation.js'

interface Props {
  series: TickPoint[]
}

const APP_COLORS = ['#34d399', '#a78bfa', '#60a5fa', '#fbbf24', '#f87171', '#fb923c']

function fmtUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`
  return `$${n.toFixed(0)}`
}

export function MetricsPanel({ series }: Props) {
  // Downsample to at most 120 points for performance
  const step = Math.max(1, Math.floor(series.length / 120))
  const sampled = series.filter((_, i) => i % step === 0)

  const last = series[series.length - 1]
  const appIds = last ? Object.keys(last.appPrices) : []

  const priceData = sampled.map(s => {
    const row: Record<string, number> = { tick: s.tick }
    for (const id of appIds) {
      row[id] = s.appPrices[id] ?? 0
    }
    return row
  })

  return (
    <div className="space-y-8">
      {/* DAU */}
      <div>
        <h3 className="text-sm font-semibold text-zinc-300 mb-3">Platform DAU</h3>
        <div className="h-48 bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={sampled}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="tick" tick={{ fill: '#71717a', fontSize: 11 }} />
              <YAxis tick={{ fill: '#71717a', fontSize: 11 }} />
              <Tooltip
                contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8 }}
                labelStyle={{ color: '#a1a1aa' }}
              />
              <Area type="monotone" dataKey="totalDau" stroke="#34d399" fill="#34d39920" strokeWidth={2} name="DAU" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Market Cap */}
      <div>
        <h3 className="text-sm font-semibold text-zinc-300 mb-3">Total Market Cap</h3>
        <div className="h-48 bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={sampled}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="tick" tick={{ fill: '#71717a', fontSize: 11 }} />
              <YAxis tickFormatter={fmtUsd} tick={{ fill: '#71717a', fontSize: 11 }} />
              <Tooltip
                formatter={(v: number) => fmtUsd(v)}
                contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8 }}
                labelStyle={{ color: '#a1a1aa' }}
              />
              <Line type="monotone" dataKey="totalMarketCap" stroke="#a78bfa" strokeWidth={2} dot={false} name="Market Cap" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Protocol Fees */}
      <div>
        <h3 className="text-sm font-semibold text-zinc-300 mb-3">Protocol Fees Accumulated</h3>
        <div className="h-48 bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={sampled}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="tick" tick={{ fill: '#71717a', fontSize: 11 }} />
              <YAxis tickFormatter={fmtUsd} tick={{ fill: '#71717a', fontSize: 11 }} />
              <Tooltip
                formatter={(v: number) => fmtUsd(v)}
                contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8 }}
                labelStyle={{ color: '#a1a1aa' }}
              />
              <Area type="monotone" dataKey="platformFees" stroke="#fbbf24" fill="#fbbf2420" strokeWidth={2} name="Protocol Fees" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Per-app price curves */}
      {appIds.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-zinc-300 mb-3">Per-App Price Curves</h3>
          <div className="h-64 bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={priceData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="tick" tick={{ fill: '#71717a', fontSize: 11 }} />
                <YAxis tickFormatter={fmtUsd} tick={{ fill: '#71717a', fontSize: 11 }} />
                <Tooltip
                  formatter={(v: number) => fmtUsd(v)}
                  contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8 }}
                  labelStyle={{ color: '#a1a1aa' }}
                />
                <Legend wrapperStyle={{ color: '#a1a1aa', fontSize: 11 }} />
                {appIds.map((id, i) => (
                  <Line
                    key={id}
                    type="monotone"
                    dataKey={id}
                    stroke={APP_COLORS[i % APP_COLORS.length] ?? '#34d399'}
                    strokeWidth={1.5}
                    dot={false}
                    name={`App ${i + 1}`}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}
