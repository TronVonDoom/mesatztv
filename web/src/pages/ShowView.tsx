import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  api,
  formatDuration,
  formatSize,
  posterGradient,
  type SeasonGroup,
  type ShowDetail,
} from '../lib/api'
import MediaDetailModal from '../components/MediaDetailModal'

function seasonLabel(season: number | null): string {
  return season == null ? 'Unsorted' : `Season ${season}`
}

export default function ShowView() {
  const { libraryId, show } = useParams()
  const id = Number(libraryId)
  const showTitle = show ? decodeURIComponent(show) : ''

  const [detail, setDetail] = useState<ShowDetail | null>(null)
  const [openSeason, setOpenSeason] = useState<number | null | undefined>(undefined)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  useEffect(() => {
    if (!showTitle) return
    setOpenSeason(undefined)
    api.showDetail(id, showTitle).then(setDetail).catch(() => {})
  }, [id, showTitle])

  const current: SeasonGroup | undefined = useMemo(
    () => detail?.seasons.find((s) => s.season === openSeason),
    [detail, openSeason],
  )

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
        {current ? (
          <button onClick={() => setOpenSeason(undefined)} className="hover:text-indigo-300">
            {showTitle}
          </button>
        ) : (
          <span className="text-slate-300">{showTitle}</span>
        )}
        {current && (
          <>
            <span>/</span>
            <span className="text-slate-300">{seasonLabel(current.season)}</span>
          </>
        )}
      </div>

      <h1 className="text-2xl font-bold mb-6">
        {showTitle}
        {detail?.year && (
          <span className="text-slate-500 text-base font-normal ml-2">({detail.year})</span>
        )}
        {detail && (
          <span className="text-slate-500 text-base font-normal ml-2">
            · {detail.seasons.length} season{detail.seasons.length === 1 ? '' : 's'} ·{' '}
            {detail.episodeCount} episodes
          </span>
        )}
      </h1>

      {!detail ? (
        <div className="text-slate-500 text-sm">Loading…</div>
      ) : current ? (
        // --- Episodes within a chosen season ---
        <div>
          <button
            onClick={() => setOpenSeason(undefined)}
            className="text-sm text-indigo-300 hover:text-indigo-200 mb-4 inline-flex items-center gap-1"
          >
            ← All seasons
          </button>
          <div className="rounded-xl border border-slate-800 overflow-hidden divide-y divide-slate-800/60">
            {current.episodes.map((ep) => (
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
                    {ep.sizeBytes ? ` · ${formatSize(ep.sizeBytes)}` : ''}
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
      ) : (
        // --- Season tiles ---
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-x-4 gap-y-5">
          {detail.seasons.map((s) => {
            const totalDur = s.episodes.reduce((a, e) => a + (e.durationSec ?? 0), 0)
            return (
              <button
                key={s.season ?? 'none'}
                onClick={() => setOpenSeason(s.season)}
                className="group text-left w-full"
              >
                <div
                  className="aspect-[2/3] rounded-lg overflow-hidden relative shadow-lg flex flex-col items-center justify-center p-3"
                  style={{ background: posterGradient(`${showTitle} ${seasonLabel(s.season)}`) }}
                >
                  <span className="absolute top-2 left-2 text-xs bg-black/30 backdrop-blur rounded px-1.5 py-0.5 leading-none">
                    📺
                  </span>
                  <span className="text-4xl font-bold text-white/90 drop-shadow">
                    {s.season == null ? '—' : s.season}
                  </span>
                  <span className="mt-1 text-xs font-medium text-white/80">
                    {seasonLabel(s.season)}
                  </span>
                  <div className="absolute inset-0 rounded-lg ring-1 ring-white/10 group-hover:ring-2 group-hover:ring-indigo-400/70 transition-all" />
                </div>
                <div className="mt-1.5 text-xs text-slate-400 truncate group-hover:text-slate-200 transition-colors">
                  {s.episodes.length} ep · {formatDuration(totalDur)}
                </div>
              </button>
            )
          })}
        </div>
      )}

      {selectedId != null && (
        <MediaDetailModal id={selectedId} onClose={() => setSelectedId(null)} />
      )}
    </div>
  )
}
