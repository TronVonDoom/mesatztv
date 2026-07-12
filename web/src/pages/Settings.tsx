import { useEffect, useState } from 'react'
import { api } from '../lib/api'

export default function Settings() {
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [key, setKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    api.settings().then((s) => setConfigured(s.tmdbConfigured)).catch(() => {})
  }, [])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    setSaving(true)
    try {
      await api.saveTmdbKey(key.trim())
      setConfigured(true)
      setKey('')
      setMsg({ type: 'ok', text: 'TMDB key saved and verified. ✅' })
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Failed to save key' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-bold mb-1">Settings</h1>
      <p className="text-slate-400 text-sm mb-6">Configure external services.</p>

      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="flex items-center gap-3 mb-2">
          <h2 className="font-semibold">TMDB (The Movie Database)</h2>
          {configured != null && (
            <span
              className={
                'text-xs rounded-full px-2 py-0.5 ' +
                (configured
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : 'bg-slate-700/50 text-slate-400')
              }
            >
              {configured ? 'configured' : 'not set'}
            </span>
          )}
        </div>
        <p className="text-slate-400 text-sm mb-4">
          Provides posters, overviews, genres and ratings. Get a free API key from your{' '}
          <a
            href="https://www.themoviedb.org/settings/api"
            target="_blank"
            rel="noreferrer"
            className="text-indigo-300 hover:text-indigo-200"
          >
            TMDB account → API
          </a>{' '}
          (use the <span className="text-slate-300">API Key (v3 auth)</span>).
        </p>

        {msg && (
          <div
            className={
              'rounded-lg text-sm p-3 mb-4 ' +
              (msg.type === 'ok'
                ? 'border border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                : 'border border-rose-500/40 bg-rose-500/10 text-rose-300')
            }
          >
            {msg.text}
          </div>
        )}

        <form onSubmit={save} className="flex gap-2">
          <input
            type="password"
            className="flex-1 min-w-0 rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 font-mono text-sm focus:border-indigo-500 outline-none"
            placeholder={configured ? '•••••••• (enter a new key to replace)' : 'Paste your TMDB API key'}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            required
          />
          <button
            type="submit"
            disabled={saving || !key.trim()}
            className="rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 px-4 py-2 text-sm font-medium shrink-0"
          >
            {saving ? 'Verifying…' : 'Save & verify'}
          </button>
        </form>
      </div>
    </div>
  )
}
