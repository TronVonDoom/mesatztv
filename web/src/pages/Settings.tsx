import { useEffect, useState } from 'react'
import { api, type WatermarkConfig } from '../lib/api'

const wmInp = 'rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm focus:border-indigo-500 outline-none'

export default function Settings() {
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [key, setKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [fillerPath, setFillerPath] = useState<string | null>(null)
  const [provide, setProvide] = useState('')
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
        setWm(s.watermark)
      })
      .catch(() => {})
  }, [])

  function setWmField<K extends keyof WatermarkConfig>(k: K, v: WatermarkConfig[K]) {
    setWm((w) => (w ? { ...w, [k]: v } : w))
  }
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
      </div>

      {wm && (
        <form onSubmit={saveWm} className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 mt-6">
          <h2 className="font-semibold mb-1">Watermark (on-screen logo)</h2>
          <p className="text-slate-400 text-sm mb-4">
            Overlays the channel/block logo on the live stream. Intermittent mode fades it in when
            it appears and out when its time is up.
          </p>
          {wmMsg && <div className="text-sm text-emerald-300 mb-3">{wmMsg}</div>}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-400">Mode</span>
              <select className={wmInp} value={wm.mode} onChange={(e) => setWmField('mode', e.target.value as WatermarkConfig['mode'])}>
                <option value="permanent">Permanent</option>
                <option value="intermittent">Intermittent</option>
                <option value="none">None</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-400">Position</span>
              <select className={wmInp} value={wm.position} onChange={(e) => setWmField('position', e.target.value as WatermarkConfig['position'])}>
                <option value="bottom-right">Bottom Right</option>
                <option value="bottom-left">Bottom Left</option>
                <option value="top-right">Top Right</option>
                <option value="top-left">Top Left</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-400">Width %</span>
              <input type="number" min={1} max={50} className={wmInp} value={wm.widthPercent} onChange={(e) => setWmField('widthPercent', Number(e.target.value))} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-400">Opacity %</span>
              <input type="number" min={0} max={100} className={wmInp} value={wm.opacityPercent} onChange={(e) => setWmField('opacityPercent', Number(e.target.value))} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-400">H margin %</span>
              <input type="number" min={0} max={45} className={wmInp} value={wm.horizontalMarginPercent} onChange={(e) => setWmField('horizontalMarginPercent', Number(e.target.value))} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-400">V margin %</span>
              <input type="number" min={0} max={45} className={wmInp} value={wm.verticalMarginPercent} onChange={(e) => setWmField('verticalMarginPercent', Number(e.target.value))} />
            </label>
            {wm.mode === 'intermittent' && (
              <>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-slate-400">Every (min)</span>
                  <input type="number" min={1} className={wmInp} value={wm.frequencyMinutes} onChange={(e) => setWmField('frequencyMinutes', Number(e.target.value))} />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-slate-400">Duration (sec)</span>
                  <input type="number" min={1} className={wmInp} value={wm.durationSeconds} onChange={(e) => setWmField('durationSeconds', Number(e.target.value))} />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-slate-400">Fade (sec)</span>
                  <input type="number" min={0} className={wmInp} value={wm.fadeSeconds} onChange={(e) => setWmField('fadeSeconds', Number(e.target.value))} />
                </label>
              </>
            )}
          </div>
          <div className="flex justify-end mt-3">
            <button type="submit" className="rounded-lg bg-indigo-500 hover:bg-indigo-400 px-5 py-2 text-sm font-medium">Save watermark</button>
          </div>
        </form>
      )}
    </div>
  )
}
