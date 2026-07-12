import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, formatDuration, type ShowDetail } from '../lib/api'
import MediaDetailModal from '../components/MediaDetailModal'

export default function ShowView() {
  const { libraryId, show } = useParams()
  const id = Number(libraryId)
  const showTitle = show ? decodeURIComponent(show) : ''

  const [detail, setDetail] = useState<ShowDetail | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  useEffect(() => {
    if (!showTitle) return
    api.showDetail(id, showTitle).then(setDetail).catch(() => {})
  }, [id, showTitle])

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-slate-500 mb-1 flex-wrap">
        <Link to="/browse" className="hover:text-indigo-300">
          Browse
        </Link>
        <span>/</span>
        <Link to={`/browse/${id}`} className="hover:text-indigo-300">
          Library
        </Link>
        <span>/</span>
        <span className="text-slate-300">{showTitle}</span>
      </div>

      <h1 className="text-2xl font-bold mb-6">
        {showTitle}
        {detail?.year && (
          <span className="text-slate-500 text-base font-normal ml-2">({detail.year})</span>
        )}
        {detail && (
          <span className="text-slate-500 text-base font-normal ml-2">
            · {detail.episodeCount} episodes
          </span>
        )}
      </h1>

      {!detail ? (
        <div className="text-slate-500 text-sm">Loading…</div>
      ) : (
        <div className="space-y-8">
          {detail.seasons.map((season) => (
            <div key={season.season ?? 'none'}>
              <h2 className="text-lg font-semibold mb-3 text-slate-200">
                {season.season == null ? 'Unsorted' : `Season ${season.season}`}
                <span className="text-slate-500 text-sm font-normal ml-2">
                  {season.episodes.length} episodes
                </span>
              </h2>
              <div className="rounded-xl border border-slate-800 overflow-hidden divide-y divide-slate-800/60">
                {season.episodes.map((ep) => (
                  <button
                    key={ep.id}
                    onClick={() => setSelectedId(ep.id)}
                    className="w-full flex items-center gap-4 px-4 py-3 hover:bg-slate-900/60 text-left transition-colors"
                  >
                    <div className="w-10 text-center text-slate-500 font-mono text-sm shrink-0">
                      {ep.episode != null ? String(ep.episode).padStart(2, '0') : '—'}
                    </div>
                    <div className={'flex-1 min-w-0 ' + (ep.missing ? 'opacity-50' : '')}>
                      <div className="truncate text-slate-200">{ep.title}</div>
                      <div className="text-xs text-slate-500">
                        {ep.width && ep.height ? `${ep.width}×${ep.height}` : ''}
                        {ep.videoCodec ? ` · ${ep.videoCodec}` : ''}
                        {ep.missing ? ' · missing' : ''}
                      </div>
                    </div>
                    <div className="text-sm text-slate-400 shrink-0">
                      {formatDuration(ep.durationSec)}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedId != null && (
        <MediaDetailModal id={selectedId} onClose={() => setSelectedId(null)} />
      )}
    </div>
  )
}
