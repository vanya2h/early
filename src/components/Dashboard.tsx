import { useState } from 'react'
import type { App } from '../models.js'
import type { TickPoint, ScenarioStatus } from '../sim/simulation.js'
import { ScenarioType } from '../sim/simulation.js'
import type { SimEvent } from '../sim/sim-event.js'
import type { HolderStat } from '../sim/simulation.js'
import { PlatformStats } from './PlatformStats.js'
import { AppGrid } from './AppGrid.js'
import { MetricsPanel } from './MetricsPanel.js'
import { AppDetail } from './AppDetail.js'

type Tab = 'apps' | 'platform'

interface Props {
  series: TickPoint[]
  apps: App[]
  getAppEvents: (appId: string) => SimEvent[]
  getHolderStats: (appId: string) => HolderStat[]
  onTriggerScenario: (appId: string, type: ScenarioType) => void
  getScenarioStatuses: (appId: string) => ScenarioStatus[]
}

export function Dashboard({ series, apps, getAppEvents, getHolderStats, onTriggerScenario, getScenarioStatuses }: Props) {
  const [tab, setTab] = useState<Tab>('apps')
  const [selectedApp, setSelectedApp] = useState<{ app: App; name: string } | null>(null)

  const last = series[series.length - 1]
  if (!last) return null

  return (
    <div className="space-y-6">
      <PlatformStats point={last} apps={apps} />

      <div className="flex gap-1 border-b border-zinc-800">
        {(['apps', 'platform'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t
                ? 'border-emerald-400 text-emerald-400'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {t === 'apps' ? 'App Markets' : 'Platform Over Time'}
          </button>
        ))}
      </div>

      {tab === 'apps' && (
        <AppGrid
          apps={apps}
          onSelect={(app, name) => setSelectedApp({ app, name })}
        />
      )}
      {tab === 'platform' && <MetricsPanel series={series} />}

      {selectedApp !== null && (
        <AppDetail
          app={selectedApp.app}
          appName={selectedApp.name}
          series={series}
          events={getAppEvents(selectedApp.app.id)}
          holderStats={getHolderStats(selectedApp.app.id)}
          scenarioStatuses={getScenarioStatuses(selectedApp.app.id)}
          onTriggerScenario={(type) => onTriggerScenario(selectedApp.app.id, type)}
          onClose={() => setSelectedApp(null)}
        />
      )}
    </div>
  )
}
