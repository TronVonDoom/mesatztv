import { useEffect, useState } from 'react'
import { api, type Collection, type Library } from '../lib/api'

const emptyForm = {
  name: '',
  libraryId: '',
  filterType: '',
  filterShow: '',
  filterSearch: '',
  filterGenre: '',
}

export default function Collections() {
  const [cols, setCols] = useState<Collection[]>([])
  const [libs, setLibs] = useState<Library[]>([])
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState<string | null>(null)

  const refresh = () => api.collections().then(setCols).catch(() => {})
  useEffect(() => {
    refresh()
    api.libraries().then(setLibs).catch(() => {})
  }, [])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await api.addCollection({
        name: form.name,
        libraryId: form.libraryId ? Number(form.libraryId) : null,
        filterType: form.filterType || null,
        filterShow: form.filterShow || null,
        filterSearch: form.filterSearch || null,
        filterGenre: form.filterGenre || null,
      })
      setForm(emptyForm)
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create collection')
    }
  }

  async function del(id: number) {
    setError(null)
    try {
      await api.deleteCollection(id)
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete collection')
    }
  }

  const input = 'rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm focus:border-indigo-500 outline-none'

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Collections</h1>
      <p className="text-slate-400 text-sm mb-6">
        Named, filtered sets of media. Build channels from these.
      </p>

      {error && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 text-sm p-3 mb-5">
          {error}
        </div>
      )}

      <form onSubmit={add} className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 mb-6 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-400">Name</span>
            <input className={input} placeholder="Simpsons" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-400">Library</span>
            <select className={input} value={form.libraryId} onChange={(e) => setForm({ ...form, libraryId: e.target.value })}>
              <option value="">Any library</option>
              {libs.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-400">Type</span>
            <select className={input} value={form.filterType} onChange={(e) => setForm({ ...form, filterType: e.target.value })}>
              <option value="">Any type</option>
              <option value="episode">Episodes</option>
              <option value="movie">Movies</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-400">Show title (exact)</span>
            <input className={input} placeholder="e.g. Futurama" value={form.filterShow} onChange={(e) => setForm({ ...form, filterShow: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-400">Title contains</span>
            <input className={input} placeholder="search" value={form.filterSearch} onChange={(e) => setForm({ ...form, filterSearch: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-400">Genre contains</span>
            <input className={input} placeholder="e.g. Comedy" value={form.filterGenre} onChange={(e) => setForm({ ...form, filterGenre: e.target.value })} />
          </label>
        </div>
        <div className="flex justify-end">
          <button type="submit" className="rounded-lg bg-indigo-500 hover:bg-indigo-400 px-5 py-2 font-medium text-sm">
            Create collection
          </button>
        </div>
      </form>

      {cols.length === 0 ? (
        <div className="text-slate-500 text-sm">No collections yet.</div>
      ) : (
        <div className="space-y-2">
          {cols.map((c) => (
            <div key={c.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="font-medium">{c.name}</div>
                <div className="text-xs text-slate-500">
                  {[
                    c.libraryId ? libs.find((l) => l.id === c.libraryId)?.name : null,
                    c.filterType,
                    c.filterShow && `show: ${c.filterShow}`,
                    c.filterSearch && `"${c.filterSearch}"`,
                    c.filterGenre && `genre: ${c.filterGenre}`,
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'all media'}
                </div>
              </div>
              <span className="text-sm text-slate-400">{c.itemCount} items</span>
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
