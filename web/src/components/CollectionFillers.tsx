import { useEffect, useState } from 'react'
import { api, type Asset, type Filler, type FillerInput } from '../lib/api'

const inp = 'rounded-lg bg-slate-950 border border-slate-700 px-2.5 py-1.5 text-sm focus:border-indigo-500 outline-none'
const emptyDraft: FillerInput = { name: '', style: 'frosted', assetId: null, audioAssetId: null, durationMode: 'fixed', durationSec: 30 }

// Manage a collection's branded filler pool (played during gaps in its blocks).
export default function CollectionFillers({
  collectionId,
  fillers,
  onChange,
}: {
  collectionId: number
  fillers: Filler[]
  onChange: () => void
}) {
  const [fillerAssets, setFillerAssets] = useState<Asset[]>([])
  const [audioAssets, setAudioAssets] = useState<Asset[]>([])
  const [draft, setDraft] = useState<FillerInput>(emptyDraft)
  const [editId, setEditId] = useState<number | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    api.assets('filler').then(setFillerAssets).catch(() => {})
    api.assets('audio').then(setAudioAssets).catch(() => {})
  }, [])

  function set<K extends keyof FillerInput>(k: K, v: FillerInput[K]) {
    setDraft((d) => ({ ...d, [k]: v }))
  }
  function startNew() {
    setEditId(null)
    setDraft(emptyDraft)
    setOpen(true)
  }
  function startEdit(f: Filler) {
    setEditId(f.id)
    setDraft({ name: f.name, style: f.style, assetId: f.assetId, audioAssetId: f.audioAssetId, durationMode: f.durationMode, durationSec: f.durationSec })
    setOpen(true)
  }
  async function save() {
    // Custom style needs a clip; if missing, fall back to frosted.
    const payload = { ...draft, assetId: draft.style === 'custom' ? draft.assetId : null }
    if (editId) await api.updateFiller(collectionId, editId, payload).catch(() => {})
    else await api.addFiller(collectionId, payload).catch(() => {})
    setOpen(false)
    setEditId(null)
    setDraft(emptyDraft)
    onChange()
  }
  async function del(id: number) {
    await api.deleteFiller(collectionId, id).catch(() => {})
    onChange()
  }

  const audioName = (id: number | null) => audioAssets.find((a) => a.id === id)?.name
  const clipName = (id: number | null) => fillerAssets.find((a) => a.id === id)?.name

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium">Fillers <span className="text-xs text-slate-500 font-normal">(gap interstitials, branded with this collection's logo)</span></span>
        {!open && <button onClick={startNew} className="text-xs rounded border border-slate-700 hover:border-indigo-500 hover:text-indigo-300 px-2 py-0.5">+ Add filler</button>}
      </div>

      {fillers.length > 0 && (
        <div className="space-y-1.5 mb-2">
          {fillers.map((f) => (
            <div key={f.id} className="flex items-center gap-2 text-sm rounded bg-slate-900/60 border border-slate-800 px-2.5 py-1.5">
              <span className="flex-1 min-w-0 truncate">
                {f.name || (f.style === 'custom' ? clipName(f.assetId) ?? 'Custom clip' : f.style === 'frosted' ? 'Frosted glass' : 'Animated')}
              </span>
              <span className="text-[11px] text-slate-500 shrink-0">
                {f.style} · {f.durationMode === 'audio' ? 'match audio' : `${f.durationSec}s`}
                {f.audioAssetId != null && ` · 🎵 ${audioName(f.audioAssetId) ?? 'audio'}`}
              </span>
              <button onClick={() => startEdit(f)} className="text-xs text-slate-400 hover:text-indigo-300">Edit</button>
              <button onClick={() => del(f.id)} className="text-slate-600 hover:text-rose-400" aria-label="Delete">×</button>
            </div>
          ))}
        </div>
      )}

      {open && (
        <div className="rounded border border-indigo-500/30 bg-indigo-500/5 p-3 space-y-2">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-slate-400">Name (optional)</span>
              <input className={inp} value={draft.name ?? ''} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Bumper" />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-slate-400">Visual</span>
              <select className={inp} value={draft.style} onChange={(e) => set('style', e.target.value as FillerInput['style'])}>
                <option value="frosted">Frosted glass</option>
                <option value="animated">Animated</option>
                <option value="custom">Custom clip</option>
              </select>
            </label>
            {draft.style === 'custom' && (
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-slate-400">Clip</span>
                <select className={inp} value={draft.assetId ?? ''} onChange={(e) => set('assetId', e.target.value ? Number(e.target.value) : null)}>
                  <option value="">Pick a filler clip…</option>
                  {fillerAssets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
            )}
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-slate-400">Music (optional)</span>
              <select className={inp} value={draft.audioAssetId ?? ''} onChange={(e) => set('audioAssetId', e.target.value ? Number(e.target.value) : null)}>
                <option value="">None</option>
                {audioAssets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-slate-400">Length</span>
              <select className={inp} value={draft.durationMode} onChange={(e) => set('durationMode', e.target.value as FillerInput['durationMode'])}>
                <option value="fixed">Fixed</option>
                <option value="audio" disabled={draft.audioAssetId == null}>Match audio</option>
              </select>
            </label>
            {draft.durationMode === 'fixed' && (
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-slate-400">Seconds</span>
                <input type="number" min={5} max={600} className={inp} value={draft.durationSec} onChange={(e) => set('durationSec', Number(e.target.value))} />
              </label>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => { setOpen(false); setEditId(null) }} className="rounded-lg border border-slate-700 hover:border-slate-500 px-3 py-1 text-sm">Cancel</button>
            <button onClick={save} className="rounded-lg bg-indigo-500 hover:bg-indigo-400 px-4 py-1 text-sm font-medium">{editId ? 'Save' : 'Add'}</button>
          </div>
          <p className="text-[11px] text-slate-500">Uploaded clips &amp; music live on the Media page. Fillers stretch to fill each gap; “Match audio” makes the loop length equal the music track.</p>
        </div>
      )}

      {fillers.length === 0 && !open && <p className="text-xs text-slate-600">No fillers — this collection uses the global default during gaps.</p>}
    </div>
  )
}
