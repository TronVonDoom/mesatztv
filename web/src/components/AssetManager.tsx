import { useEffect, useRef, useState } from 'react'
import { api, assetFileUrl, type Asset, type AssetKind } from '../lib/api'

function fmtSize(bytes: number | null): string {
  if (!bytes) return ''
  const u = ['B', 'KB', 'MB', 'GB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`
}

export default function AssetManager({
  kind,
  accept,
  useAs,
  useLabel,
  emptyText,
}: {
  kind: AssetKind
  accept: string
  useAs: 'music' | 'filler'
  useLabel: string
  emptyText: string
}) {
  const [assets, setAssets] = useState<Asset[]>([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const refresh = () => api.assets(kind).then(setAssets).catch(() => {})
  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind])

  async function upload(e: React.FormEvent) {
    e.preventDefault()
    const f = fileRef.current?.files?.[0]
    const nm = name.trim() || f?.name.replace(/\.[^.]+$/, '') || ''
    if (!f || !nm) {
      setMsg({ type: 'err', text: 'Pick a file (a name is optional).' })
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      await api.uploadAsset(kind, nm, f)
      setName('')
      if (fileRef.current) fileRef.current.value = ''
      refresh()
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Upload failed' })
    } finally {
      setBusy(false)
    }
  }

  async function use(a: Asset) {
    try {
      await api.useAsset(a.id, useAs)
      setMsg({ type: 'ok', text: `"${a.name}" ${useLabel.toLowerCase()}. ✅` })
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Failed' })
    }
  }

  async function del(id: number) {
    await api.deleteAsset(id).catch(() => {})
    refresh()
  }

  return (
    <div>
      {msg && (
        <div
          className={
            'rounded-lg text-sm p-3 mb-4 border ' +
            (msg.type === 'ok'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
              : 'border-rose-500/40 bg-rose-500/10 text-rose-300')
          }
        >
          {msg.text}
        </div>
      )}

      <form onSubmit={upload} className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 mb-6 flex flex-wrap gap-3 items-end">
        <label className="flex flex-col gap-1 text-sm flex-1 min-w-40">
          <span className="text-slate-400">Name (optional)</span>
          <input
            className="rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm focus:border-indigo-500 outline-none"
            placeholder="defaults to the file name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">File</span>
          <input
            ref={fileRef}
            type="file"
            accept={accept}
            className="text-sm text-slate-400 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-800 file:px-3 file:py-2 file:text-slate-200 file:text-sm"
          />
        </label>
        <button type="submit" disabled={busy} className="rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 px-5 py-2 text-sm font-medium">
          {busy ? 'Uploading…' : 'Upload'}
        </button>
      </form>

      {assets.length === 0 ? (
        <div className="text-slate-500 text-sm">{emptyText}</div>
      ) : (
        <div className="space-y-2">
          {assets.map((a) => (
            <div key={a.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate" title={a.name}>{a.name}</div>
                <div className="text-xs text-slate-500">{a.mime}{a.sizeBytes ? ` · ${fmtSize(a.sizeBytes)}` : ''}</div>
              </div>
              {kind === 'audio' ? (
                <audio controls preload="none" src={assetFileUrl(a.id)} className="h-8 max-w-[240px]" />
              ) : (
                <video controls preload="none" src={assetFileUrl(a.id)} className="h-16 rounded bg-black" />
              )}
              <button
                onClick={() => use(a)}
                className="rounded-lg border border-slate-700 hover:border-indigo-500 hover:text-indigo-300 px-3 py-1.5 text-sm"
              >
                {useLabel}
              </button>
              <button onClick={() => del(a.id)} className="text-slate-600 hover:text-rose-400 text-lg px-1" aria-label="Delete">
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
