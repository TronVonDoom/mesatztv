import { useEffect, useState } from 'react'

type Health = {
  status: string
  version: string
  uptimeSeconds: number
  node: string
  ffmpeg: boolean
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function StatusRow({
  label,
  value,
  ok,
}: {
  label: string
  value: string
  ok?: boolean
}) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-slate-800/70 last:border-0">
      <span className="text-slate-400 text-sm">{label}</span>
      <span
        className={
          'font-mono text-sm ' +
          (ok === undefined
            ? 'text-slate-200'
            : ok
              ? 'text-emerald-400'
              : 'text-rose-400')
        }
      >
        {value}
      </span>
    </div>
  )
}

export default function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [reachable, setReachable] = useState<boolean | null>(null)

  useEffect(() => {
    const load = () =>
      fetch('/api/health')
        .then((r) => r.json())
        .then((data: Health) => {
          setHealth(data)
          setReachable(true)
        })
        .catch(() => setReachable(false))
    load()
    const id = setInterval(load, 5000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6 bg-gradient-to-b from-slate-950 to-slate-900">
      <div className="w-full max-w-lg">
        <div className="flex items-center gap-4 mb-8">
          <div className="text-5xl leading-none">📺</div>
          <div>
            <h1 className="text-4xl font-bold tracking-tight">
              Me<span className="text-indigo-400">Satz</span>TV
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Your library. Your channels. Broadcasting live.
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-2xl backdrop-blur">
          <div className="flex items-center gap-3 mb-5">
            <span
              className={
                'inline-block w-2.5 h-2.5 rounded-full ' +
                (reachable
                  ? 'bg-emerald-400 shadow-[0_0_10px_2px_rgba(52,211,153,0.6)]'
                  : reachable === false
                    ? 'bg-rose-500'
                    : 'bg-amber-400')
              }
            />
            <span className="text-lg font-semibold">
              {reachable
                ? 'MeSatzTV is alive'
                : reachable === false
                  ? 'Backend unreachable'
                  : 'Connecting…'}
            </span>
          </div>

          {health && (
            <div>
              <StatusRow label="Status" value={health.status} ok={health.status === 'ok'} />
              <StatusRow label="Version" value={`v${health.version}`} />
              <StatusRow label="Uptime" value={formatUptime(health.uptimeSeconds)} />
              <StatusRow label="Node" value={health.node} />
              <StatusRow
                label="ffmpeg"
                value={health.ffmpeg ? 'available' : 'missing'}
                ok={health.ffmpeg}
              />
            </div>
          )}

          {reachable === false && (
            <p className="text-slate-400 text-sm">
              The web UI loaded, but the API isn't responding yet. If you just
              started the container, give it a moment and it'll reconnect.
            </p>
          )}
        </div>

        <p className="text-center text-slate-600 text-xs mt-6">
          Milestone 1 — deploy loop. Scheduler, streaming &amp; overlays are next.
        </p>
      </div>
    </div>
  )
}
