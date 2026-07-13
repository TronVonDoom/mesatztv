import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type Channel } from '../lib/api'

export default function Channels() {
  const [channels, setChannels] = useState<Channel[]>([])
  const [form, setForm] = useState({ number: '', name: '', group: '' })
  const [error, setError] = useState<string | null>(null)

  const refresh = () => api.channels().then(setChannels).catch(() => {})
  useEffect(() => {
    refresh()
  }, [])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await api.addChannel({
        number: Number(form.number),
        name: form.name,
        group: form.group || null,
      })
      setForm({ number: '', name: '', group: '' })
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create channel')
    }
  }

  async function del(id: number) {
    setError(null)
    try {
      await api.deleteChannel(id)
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete channel')
    }
  }

  const input = 'rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm focus:border-indigo-500 outline-none'

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Channels</h1>
      <p className="text-slate-400 text-sm mb-6">
        Each channel plays a 24/7 rotation with optional day/time blocks.
      </p>

      {error && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 text-sm p-3 mb-5">
          {error}
        </div>
      )}

      <form onSubmit={add} className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 mb-6 grid grid-cols-1 md:grid-cols-[100px_1fr_1fr_auto] gap-3 items-end">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Number</span>
          <input className={input} type="number" placeholder="1" value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} required />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Name</span>
          <input className={input} placeholder="Cartoon Channel" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Group (optional)</span>
          <input className={input} placeholder="Kids" value={form.group} onChange={(e) => setForm({ ...form, group: e.target.value })} />
        </label>
        <button type="submit" className="rounded-lg bg-indigo-500 hover:bg-indigo-400 px-4 py-2 font-medium text-sm">
          Add
        </button>
      </form>

      {channels.length === 0 ? (
        <div className="text-slate-500 text-sm">No channels yet.</div>
      ) : (
        <div className="space-y-2">
          {channels.map((c) => (
            <div key={c.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 flex items-center gap-4">
              <div className="text-lg font-mono text-indigo-300 w-12 text-center shrink-0">{c.number}</div>
              <Link to={`/channels/${c.id}`} className="flex-1 min-w-0 group">
                <div className="font-medium group-hover:text-indigo-300 transition-colors">
                  {c.name}
                  {c.group && <span className="text-xs text-slate-500 ml-2">{c.group}</span>}
                </div>
                <div className="text-xs text-slate-500">
                  {c.rotationCount} rotation · {c.blockCount} blocks ·{' '}
                  {c.playoutCount > 0 ? `${c.playoutCount} programs scheduled` : 'not built yet'}
                </div>
              </Link>
              <Link to={`/channels/${c.id}`} className="rounded-lg border border-slate-700 hover:border-indigo-500 hover:text-indigo-300 px-3 py-1.5 text-sm">
                Edit
              </Link>
              <button onClick={() => del(c.id)} className="rounded-lg border border-slate-800 text-slate-500 hover:border-rose-500/50 hover:text-rose-400 px-3 py-1.5 text-sm">
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
