import { posterGradient } from '../lib/api'

export default function PosterCard({
  title,
  subtitle,
  badge,
  icon,
  onClick,
}: {
  title: string
  subtitle?: string
  badge?: string
  icon: string
  onClick: () => void
}) {
  return (
    <button onClick={onClick} className="group text-left w-full">
      <div
        className="aspect-[2/3] rounded-lg overflow-hidden relative shadow-lg flex items-center justify-center p-3"
        style={{ background: posterGradient(title) }}
      >
        {/* type icon chip */}
        <span className="absolute top-2 left-2 text-xs bg-black/30 backdrop-blur rounded px-1.5 py-0.5 leading-none">
          {icon}
        </span>
        {badge && (
          <span className="absolute top-2 right-2 text-[10px] font-medium bg-black/40 backdrop-blur px-1.5 py-0.5 rounded text-slate-200">
            {badge}
          </span>
        )}
        {/* title acts as the "artwork" until real posters land */}
        <span className="text-center text-sm font-semibold text-white/95 leading-snug line-clamp-4 drop-shadow">
          {title}
        </span>
        <div className="absolute inset-0 rounded-lg ring-1 ring-white/10 group-hover:ring-2 group-hover:ring-indigo-400/70 transition-all" />
      </div>
      {subtitle && (
        <div className="mt-1.5 text-xs text-slate-400 truncate group-hover:text-slate-200 transition-colors">
          {subtitle}
        </div>
      )}
    </button>
  )
}
