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
        className="aspect-[2/3] rounded-lg overflow-hidden relative shadow-lg"
        style={{ background: posterGradient(title) }}
      >
        <div className="absolute inset-0 flex items-center justify-center text-5xl opacity-30 group-hover:opacity-50 transition-opacity">
          {icon}
        </div>
        {badge && (
          <div className="absolute top-2 right-2 text-[10px] font-medium bg-black/50 backdrop-blur px-1.5 py-0.5 rounded text-slate-200">
            {badge}
          </div>
        )}
        <div className="absolute inset-0 rounded-lg ring-1 ring-white/10 group-hover:ring-2 group-hover:ring-indigo-400/60 transition-all" />
      </div>
      <div className="mt-2">
        <div className="text-sm truncate text-slate-200 group-hover:text-indigo-300 transition-colors">
          {title}
        </div>
        {subtitle && <div className="text-xs text-slate-500 truncate">{subtitle}</div>}
      </div>
    </button>
  )
}
