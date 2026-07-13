import { useEffect, useState } from 'react'
import { api, type EncodingProfile, type ProfileFields, type ProfileInput } from '../lib/api'

const RES = [
  { label: '480p', width: 854, height: 480 },
  { label: '720p', width: 1280, height: 720 },
  { label: '1080p', width: 1920, height: 1080 },
]
const resLabel = (w: number, h: number) => RES.find((r) => r.width === w && r.height === h)?.label ?? `${w}×${h}`
const HW = { auto: 'Auto', nvidia: 'NVIDIA', cpu: 'CPU' } as const
const inp = 'rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm focus:border-indigo-500 outline-none'

const blank = (d: ProfileFields): ProfileInput => ({ name: '', ...d })

export default function EncodingProfilesCard() {
  const [profiles, setProfiles] = useState<EncodingProfile[]>([])
  const [defaults, setDefaults] = useState<ProfileFields | null>(null)
  const [form, setForm] = useState<ProfileInput | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = () =>
    api.profiles().then((r) => {
      setProfiles(r.profiles)
      setDefaults(r.default)
      setForm((f) => f ?? blank(r.default))
    }).catch(() => {})
  useEffect(() => {
    refresh()
  }, [])

  function set<K extends keyof ProfileInput>(k: K, v: ProfileInput[K]) {
    setForm((f) => (f ? { ...f, [k]: v } : f))
  }

  function startNew() {
    setEditingId(null)
    if (defaults) setForm(blank(defaults))
  }
  function startEdit(p: EncodingProfile) {
    setEditingId(p.id)
    setForm({ name: p.name, width: p.width, height: p.height, fps: p.fps, quality: p.quality, hwaccel: p.hwaccel, audioBitrate: p.audioBitrate })
  }
  async function save() {
    if (!form || !form.name.trim()) {
      setError('A profile name is required.')
      return
    }
    setError(null)
    try {
      if (editingId) await api.updateProfile(editingId, form)
      else await api.addProfile(form)
      setEditingId(null)
      if (defaults) setForm(blank(defaults))
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    }
  }
  async function del(id: number) {
    if (!confirm('Delete this profile? Channels using it fall back to the built-in default.')) return
    await api.deleteProfile(id).catch(() => {})
    if (editingId === id) startNew()
    refresh()
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 mt-6">
      <h2 className="font-semibold mb-1">Encoding profiles</h2>
      <p className="text-slate-400 text-sm mb-4">
        Reusable output settings you can assign per channel. Channels with no profile use the built-in
        default{defaults ? ` (${resLabel(defaults.width, defaults.height)}, ${defaults.fps}fps, ${defaults.quality}, ${HW[defaults.hwaccel]})` : ''}.
      </p>

      {error && <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 text-sm p-3 mb-4">{error}</div>}

      {profiles.length > 0 && (
        <div className="space-y-2 mb-4">
          {profiles.map((p) => (
            <div key={p.id} className="flex items-center gap-3 text-sm rounded-lg bg-slate-950/50 border border-slate-800 px-3 py-2">
              <span className="font-medium flex-1 min-w-0 truncate">{p.name}</span>
              <span className="text-xs text-slate-500 shrink-0">
                {resLabel(p.width, p.height)} · {p.fps}fps · {p.quality} · {HW[p.hwaccel]} · {p.audioBitrate}k
              </span>
              <button onClick={() => startEdit(p)} className="text-xs text-slate-400 hover:text-indigo-300">Edit</button>
              <button onClick={() => del(p.id)} className="text-slate-600 hover:text-rose-400" aria-label="Delete">×</button>
            </div>
          ))}
        </div>
      )}

      {form && (
        <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
          <div className="text-sm font-medium mb-3">{editingId ? 'Edit profile' : 'New profile'}</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <label className="flex flex-col gap-1 text-sm col-span-2 md:col-span-1">
              <span className="text-slate-400">Name</span>
              <input className={inp} placeholder="1080p HD" value={form.name} onChange={(e) => set('name', e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-400">Resolution</span>
              <select
                className={inp}
                value={resLabel(form.width, form.height)}
                onChange={(e) => {
                  const r = RES.find((x) => x.label === e.target.value)
                  if (r) setForm((f) => (f ? { ...f, width: r.width, height: r.height } : f))
                }}
              >
                {RES.map((r) => <option key={r.label} value={r.label}>{r.label}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-400">Frame rate</span>
              <select className={inp} value={form.fps} onChange={(e) => set('fps', Number(e.target.value))}>
                {[24, 30, 60].map((f) => <option key={f} value={f}>{f} fps</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-400">Video quality</span>
              <select className={inp} value={form.quality} onChange={(e) => set('quality', e.target.value as ProfileFields['quality'])}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-400">Hardware acceleration</span>
              <select className={inp} value={form.hwaccel} onChange={(e) => set('hwaccel', e.target.value as ProfileFields['hwaccel'])}>
                <option value="auto">Auto</option>
                <option value="nvidia">NVIDIA (nvenc)</option>
                <option value="cpu">CPU (libx264)</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-400">Audio quality</span>
              <select className={inp} value={form.audioBitrate} onChange={(e) => set('audioBitrate', Number(e.target.value))}>
                {[128, 192, 256].map((b) => <option key={b} value={b}>{b} kbps</option>)}
              </select>
            </label>
          </div>
          <div className="flex justify-end gap-2 mt-3">
            {editingId && <button onClick={startNew} className="rounded-lg border border-slate-700 hover:border-slate-500 px-3 py-1.5 text-sm">New instead</button>}
            <button onClick={save} className="rounded-lg bg-indigo-500 hover:bg-indigo-400 px-5 py-1.5 text-sm font-medium">{editingId ? 'Save' : 'Create profile'}</button>
          </div>
        </div>
      )}
    </div>
  )
}
