import { useState, useEffect, useRef, useCallback } from 'react'
import { Simulation, defaultConfig, ScenarioType } from './sim/simulation.js'
import type { TickPoint, ScenarioStatus } from './sim/simulation.js'
import type { App } from './models.js'
import { Dashboard } from './components/Dashboard.js'

/** Max TickPoints kept in series (rolling window). */
const SERIES_MAX = 1_000
/** Ticks batched per requestAnimationFrame frame when intervalMs === 0. */
const RAF_BATCH = 10
/** Default ms between ticks. */
const DEFAULT_INTERVAL_MS = 100

export default function AppRoot() {
  const [series, setSeries] = useState<TickPoint[]>([])
  const [currentApps, setCurrentApps] = useState<App[] | null>(null)
  const [tickCount, setTickCount] = useState(0)
  const [running, setRunning] = useState(false)
  const [intervalMs, setIntervalMs] = useState(DEFAULT_INTERVAL_MS)
  const [randomScenarios, setRandomScenarios] = useState(false)

  const simRef = useRef<Simulation | null>(null)
  const timerRef = useRef<number | null>(null)
  const timerTypeRef = useRef<'raf' | 'timeout'>('timeout')
  const intervalMsRef = useRef(DEFAULT_INTERVAL_MS)
  const runningRef = useRef(false)
  const tickFnRef = useRef<(() => void) | null>(null)

  // ── Timer helpers ─────────────────────────────────────────────────────────

  function cancelTimer() {
    if (timerRef.current === null) return
    if (timerTypeRef.current === 'raf') {
      cancelAnimationFrame(timerRef.current)
    } else {
      clearTimeout(timerRef.current)
    }
    timerRef.current = null
  }

  function scheduleNext() {
    const fn = tickFnRef.current
    if (!fn || !runningRef.current) return
    const delay = intervalMsRef.current
    if (delay <= 0) {
      timerTypeRef.current = 'raf'
      timerRef.current = requestAnimationFrame(fn)
    } else {
      timerTypeRef.current = 'timeout'
      timerRef.current = window.setTimeout(fn, delay)
    }
  }

  // ── Controls ──────────────────────────────────────────────────────────────

  const handleRun = useCallback(() => {
    if (!simRef.current) {
      const sim = new Simulation(defaultConfig)
      sim.initialize()
      simRef.current = sim
      setSeries([])
      setCurrentApps(null)
      setTickCount(0)
    }
    setRunning(true)
  }, [])

  const handleStop = useCallback(() => {
    setRunning(false)
  }, [])

  const handleReset = useCallback(() => {
    setRunning(false)
    simRef.current = null
    setSeries([])
    setCurrentApps(null)
    setTickCount(0)
  }, [])

  const handleSpeedChange = useCallback((ms: number) => {
    setIntervalMs(ms)
    intervalMsRef.current = ms
    if (runningRef.current) {
      cancelTimer()
      scheduleNext()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleToggleRandomScenarios = useCallback(() => {
    setRandomScenarios(prev => {
      const next = !prev
      simRef.current?.setRandomScenariosEnabled(next)
      return next
    })
  }, [])

  const handleTriggerScenario = useCallback((appId: string, type: ScenarioType) => {
    simRef.current?.triggerScenario(appId, type)
  }, [])

  const getScenarioStatuses = useCallback(
    (appId: string): ScenarioStatus[] => simRef.current?.getScenarioStatuses(appId) ?? [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  // ── Simulation loop ───────────────────────────────────────────────────────

  useEffect(() => {
    if (!running) return
    const sim = simRef.current
    if (!sim) return
    const s = sim
    runningRef.current = true

    function tick() {
      if (!runningRef.current) return

      const delay = intervalMsRef.current

      if (delay <= 0) {
        // Max speed — batch RAF_BATCH ticks per animation frame
        const batch: TickPoint[] = []
        for (let i = 0; i < RAF_BATCH; i++) {
          batch.push(s.step())
        }
        setSeries(prev => {
          const next = [...prev, ...batch]
          return next.length > SERIES_MAX ? next.slice(next.length - SERIES_MAX) : next
        })
        setCurrentApps(s.getFinalApps())
        setTickCount(s.tickCount)
        timerTypeRef.current = 'raf'
        timerRef.current = requestAnimationFrame(tick)
      } else {
        // Precise speed — one tick per setTimeout
        const point = s.step()
        setSeries(prev => {
          const next = [...prev, point]
          return next.length > SERIES_MAX ? next.slice(1) : next
        })
        setCurrentApps(s.getFinalApps())
        setTickCount(s.tickCount)
        timerTypeRef.current = 'timeout'
        timerRef.current = window.setTimeout(tick, delay)
      }
    }

    tickFnRef.current = tick
    scheduleNext()

    return () => {
      runningRef.current = false
      cancelTimer()
      tickFnRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running])

  // ── App event accessor ────────────────────────────────────────────────────

  const getAppEvents = useCallback(
    (appId: string) => simRef.current?.getAppEvents(appId) ?? [],
    // simRef is stable; intentionally omitted from deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const getHolderStats = useCallback(
    (appId: string) => simRef.current?.getHolderStats(appId) ?? [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  // ── Render ────────────────────────────────────────────────────────────────

  const hasSeries = series.length > 0

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="flex items-center justify-between gap-6 flex-wrap">
          {/* Brand */}
          <div className="shrink-0">
            <h1 className="text-xl font-bold tracking-tight text-zinc-100">
              Early<span className="text-emerald-400">.cool</span>
            </h1>
            <p className="text-xs text-zinc-500 mt-0.5">Decentralised App Marketplace Simulator</p>
          </div>

          <div className="flex items-center gap-6 flex-wrap">
            {/* Tick counter */}
            {hasSeries && (
              <div className="flex items-center gap-2">
                {running && (
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                )}
                <div>
                  <span className="text-lg font-bold tabular-nums text-zinc-100">
                    Day {tickCount.toLocaleString()}
                  </span>
                  <span className="text-xs text-zinc-500 ml-2">tick</span>
                </div>
              </div>
            )}

            {/* Speed control */}
            <div className="flex items-center gap-3">
              <span className="text-xs text-zinc-500 whitespace-nowrap">Tick speed</span>
              <input
                type="range"
                min={0}
                max={2000}
                step={10}
                value={intervalMs}
                onChange={e => handleSpeedChange(Number(e.target.value))}
                className="w-28 accent-emerald-500 cursor-pointer"
              />
              <span className="text-xs text-zinc-300 tabular-nums w-24 text-left">
                {intervalMs === 0 ? 'max speed' : `${intervalMs} ms / tick`}
              </span>
            </div>

            {/* Preset speed buttons */}
            <div className="flex gap-1">
              {[0, 50, 200, 500, 1000].map(ms => (
                <button
                  key={ms}
                  onClick={() => handleSpeedChange(ms)}
                  className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                    intervalMs === ms
                      ? 'bg-emerald-700 text-emerald-200'
                      : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
                  }`}
                >
                  {ms === 0 ? 'MAX' : `${ms}ms`}
                </button>
              ))}
            </div>

            {/* Random scenarios toggle */}
            {hasSeries && (
              <button
                onClick={handleToggleRandomScenarios}
                title="When enabled, abuse scenarios (whale dumps, fake revenue, etc.) fire randomly during the simulation"
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  randomScenarios
                    ? 'bg-red-900/40 border-red-700 text-red-300 hover:bg-red-900/60'
                    : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${randomScenarios ? 'bg-red-400 animate-pulse' : 'bg-zinc-600'}`} />
                Abuse scenarios
              </button>
            )}

            {/* Run / Stop / Reset */}
            <div className="flex items-center gap-2">
              {!running ? (
                <button
                  onClick={handleRun}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium transition-colors"
                >
                  {hasSeries ? '▶ Resume' : '▶ Run'}
                </button>
              ) : (
                <button
                  onClick={handleStop}
                  className="px-4 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-sm font-medium transition-colors"
                >
                  ■ Stop
                </button>
              )}
              {hasSeries && (
                <button
                  onClick={handleReset}
                  className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-sm font-medium transition-colors"
                >
                  ↺ Reset
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="px-6 py-6">
        {hasSeries && currentApps !== null && (
          <Dashboard
            series={series}
            apps={currentApps}
            getAppEvents={getAppEvents}
            getHolderStats={getHolderStats}
            onTriggerScenario={handleTriggerScenario}
            getScenarioStatuses={getScenarioStatuses}
          />
        )}

        {!hasSeries && (
          <div className="flex flex-col items-center justify-center py-32 gap-3 text-center">
            <div className="text-5xl">📊</div>
            <h2 className="text-lg font-semibold text-zinc-300">Ready to simulate</h2>
            <p className="text-zinc-500 text-sm max-w-sm">
              Set your preferred tick speed and click Run to start the
              continuous Early.cool marketplace simulation.
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
