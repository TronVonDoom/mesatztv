import { useEffect, useRef, useState } from 'react'
import { api, logoImageUrl, type Logo } from '../lib/api'

export default function Logos() {
  const [logos, setLogos] = useState<Logo[]>([])
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const refresh = () => api.logos().then(setLogos).catch(() => {})
  useEffect(() => {
    refresh()
  }, [])

  async function upload(e: React.FormEvent) {
    e.preventDefault()
    const f = fileRef.current?.files?.[0]
    if (!f || !name.trim()) {
      setError('A name and an image file are required.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const dataUrl = await new Promise<string>((res, rej) => {
        const r = new FileReader()
        r.onload = () => res(String(r.result))
        r.onerror = rej
        r.readAsDataURL(f)
      })
      await api.uploadLogo(name.trim(), dataUrl)
      setName('')
      if (fileRef.current) fileRef.current.value = ''
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  async function del(id: number) {
    await api.deleteLogo(id).catch(() => {})
    refresh()
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Logos</h1>
      <p className="text-slate-400 text-sm mb-6">
        Upload logos once, then pick them as channel or block watermarks (and guide images).
      </p>

      {error && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 text-sm p-3 mb-5">
          {error}
        </div>
      )}

      <form onSubmit={upload} className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 mb-6 flex flex-wrap gap-3 items-end">
        <label className="flex flex-col gap-1 text-sm flex-1 min-w-40">
          <span className="text-slate-400">Name</span>
          <input className="rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm focus:border-indigo-500 outline-none" placeholder="Nick @ Night" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Image (PNG/JPG/WEBP)</span>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="text-sm text-slate-400 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-800 file:px-3 file:py-2 file:text-slate-200 file:text-sm" />
        </label>
        <button type="submit" disabled={busy} className="rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 px-5 py-2 text-sm font-medium">
          {busy ? 'Uploading…' : 'Upload'}
        </button>
      </form>

      {logos.length === 0 ? (
        <div className="text-slate-500 text-sm">No logos yet.</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {logos.map((l) => (
            <div key={l.id} className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
              <div className="aspect-video flex items-center justify-center p-4 bg-[repeating-conic-gradient(#1e293b_0_25%,#0f172a_0_50%)] bg-[length:20px_20px]">
                <img src={logoImageUrl(l.id)} alt={l.name} className="max-h-full max-w-full object-contain" />
              </div>
              <div className="flex items-center gap-2 px-3 py-2">
                <span className="text-sm truncate flex-1">{l.name}</span>
                <button onClick={() => del(l.id)} className="text-slate-600 hover:text-rose-400 text-sm" aria-label="Delete">×</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
