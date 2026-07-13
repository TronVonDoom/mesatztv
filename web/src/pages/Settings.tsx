import { useEffect, useState } from 'react'
import { api, type WatermarkConfig } from '../lib/api'
import WatermarkFields from '../components/WatermarkFields'

export default function Settings() {
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [key, setKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [fillerPath, setFillerPath] = useState<string | null>(null)
  const [fillerMusicPath, setFillerMusicPath] = useState<string | null>(null)
  const [provide, setProvide] = useState('')
  const [music, setMusic] = useState('')
  const [fillerBusy, setFillerBusy] = useState(false)
  const [fillerMsg, setFillerMsg] = useState<string | null>(null)
  const [wm, setWm] = useState<WatermarkConfig | null>(null)
  const [wmMsg, setWmMsg] = useState<string | null>(null)

  useEffect(() => {
    api
      .settings()
      .then((s) => {
        setConfigured(s.tmdbConfigured)
        setFillerPath(s.fillerPath)
        setFillerMusicPath(s.fillerMusicPath)
        setWm(s.watermark)
      })
      .catch(() => {})
  }, [])

  async function saveWm(e: React.FormEvent) {
    e.preventDefault()
    if (!wm) return
    setWmMsg(null)
    try {
      const r = await api.saveWatermark(wm)
      setWm(r.watermark)
      setWmMsg('Watermark saved. ✅')
    } catch (err) {
      setWmMsg(err instanceof Error ? err.message : 'Failed to save watermark')
    }
  }

  async function genFiller() {
    setFillerBusy(true)
    setFillerMsg(null)
    try {
      const r = await api.generateFiller()
      setFillerPath(r.path)
      setFillerMsg('Ambient filler generated. ✅')
    } catch (e) {
      setFillerMsg(e instanceof Error ? e.message : 'Failed to generate filler')
    } finally {
      setFillerBusy(false)
    }
  }
  async function saveProvide(e: React.FormEvent) {
    e.preventDefault()
    setFillerBusy(true)
    setFillerMsg(null)
    try {
      const r = await api.setFillerPath(provide.trim())
      setFillerPath(r.path)
      setProvide('')
      setFillerMsg('Filler updated. ✅')
    } catch (e) {
      setFillerMsg(e instanceof Error ? e.message : 'Failed to set filler')
    } finally {
      setFillerBusy(false)
    }
  }
  async function saveMusic(e: React.FormEvent) {
    e.preventDefault()
    setFillerBusy(true)
    setFillerMsg(null)
    try {
      const r = await api.setFillerMusic(music.trim())
      setFillerMusicPath(r.path)
      setMusic('')
      setFillerMsg('Intermission music updated. ✅')
    } catch (e) {
      setFillerMsg(e instanceof Error ? e.message : 'Failed to set music')
    } finally {
      setFillerBusy(false)
    }
  }

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

      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 mt-6">
        <h2 className="font-semibold mb-1">Filler (station ID)</h2>
        <p className="text-slate-400 text-sm mb-3">
          Fills gaps in time blocks. The channel/block logo is overlaid live, so a plain ambient
          clip works for every channel.
        </p>
        <div className="text-xs mb-3">
          Current:{' '}
          {fillerPath ? (
            <code className="text-emerald-300 break-all">{fillerPath}</code>
          ) : (
            <span className="text-slate-500">auto-generated default</span>
          )}
        </div>
        {fillerMsg && <div className="text-sm text-emerald-300 mb-3">{fillerMsg}</div>}
        <div className="flex flex-wrap gap-2 items-center mb-3">
          <button onClick={genFiller} disabled={fillerBusy} className="rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 px-4 py-2 text-sm font-medium">
            {fillerBusy ? 'Working…' : 'Generate ambient filler'}
          </button>
          <span className="text-xs text-slate-500">or point at your own clip:</span>
        </div>
        <form onSubmit={saveProvide} className="flex gap-2">
          <input
            className="flex-1 min-w-0 rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm font-mono focus:border-indigo-500 outline-none"
            placeholder="/media/bumpers/station-id.mp4 (blank = default)"
            value={provide}
            onChange={(e) => setProvide(e.target.value)}
          />
          <button type="submit" disabled={fillerBusy} className="rounded-lg border border-slate-700 hover:border-indigo-500 hover:text-indigo-300 px-4 py-2 text-sm shrink-0">
            Use file
          </button>
        </form>

        <div className="border-t border-slate-800 mt-4 pt-4">
          <h3 className="text-sm font-medium mb-1">Intermission music</h3>
          <p className="text-slate-400 text-xs mb-2">
            Optional ambient track looped under the filler during gaps (overrides the filler clip's own
            audio). Point at an audio or video file inside your mounted media.
          </p>
          <div className="text-xs mb-2">
            Current:{' '}
            {fillerMusicPath ? (
              <code className="text-emerald-300 break-all">{fillerMusicPath}</code>
            ) : (
              <span className="text-slate-500">none (filler's own audio)</span>
            )}
          </div>
          <form onSubmit={saveMusic} className="flex gap-2">
            <input
              className="flex-1 min-w-0 rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm font-mono focus:border-indigo-500 outline-none"
              placeholder="/media/music/ambient.mp3 (blank = clear)"
              value={music}
              onChange={(e) => setMusic(e.target.value)}
            />
            <button type="submit" disabled={fillerBusy} className="rounded-lg border border-slate-700 hover:border-indigo-500 hover:text-indigo-300 px-4 py-2 text-sm shrink-0">
              {fillerMusicPath ? 'Update' : 'Use file'}
            </button>
          </form>
        </div>
      </div>

      {wm && (
        <form onSubmit={saveWm} className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 mt-6">
          <h2 className="font-semibold mb-1">Default watermark (on-screen logo)</h2>
          <p className="text-slate-400 text-sm mb-4">
            The fallback watermark for logos without their own settings (and legacy URL logos). Set
            per-logo overrides on the <span className="text-slate-300">Logos</span> page. Intermittent
            mode fades the logo in when it appears and out when its time is up.
          </p>
          {wmMsg && <div className="text-sm text-emerald-300 mb-3">{wmMsg}</div>}
          <WatermarkFields wm={wm} onChange={setWm} />
          <div className="flex justify-end mt-3">
            <button type="submit" className="rounded-lg bg-indigo-500 hover:bg-indigo-400 px-5 py-2 text-sm font-medium">Save default</button>
          </div>
        </form>
      )}
    </div>
  )
}
