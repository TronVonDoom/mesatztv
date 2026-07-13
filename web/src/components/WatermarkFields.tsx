import type { WatermarkConfig } from '../lib/api'

const inp = 'rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm focus:border-indigo-500 outline-none'

// Shared editor for a WatermarkConfig — used for the global default (Settings)
// and per-logo overrides (Logos).
export default function WatermarkFields({
  wm,
  onChange,
}: {
  wm: WatermarkConfig
  onChange: (wm: WatermarkConfig) => void
}) {
  const set = <K extends keyof WatermarkConfig>(k: K, v: WatermarkConfig[K]) => onChange({ ...wm, [k]: v })

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Mode</span>
          <select className={inp} value={wm.mode} onChange={(e) => set('mode', e.target.value as WatermarkConfig['mode'])}>
            <option value="permanent">Permanent</option>
            <option value="intermittent">Intermittent</option>
            <option value="none">None</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Position</span>
          <select className={inp} value={wm.position} onChange={(e) => set('position', e.target.value as WatermarkConfig['position'])}>
            <option value="bottom-right">Bottom Right</option>
            <option value="bottom-left">Bottom Left</option>
            <option value="top-right">Top Right</option>
            <option value="top-left">Top Left</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Width %</span>
          <input type="number" min={1} max={50} className={inp} value={wm.widthPercent} onChange={(e) => set('widthPercent', Number(e.target.value))} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Opacity %</span>
          <input type="number" min={0} max={100} className={inp} value={wm.opacityPercent} onChange={(e) => set('opacityPercent', Number(e.target.value))} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">H margin %</span>
          <input type="number" min={0} max={45} className={inp} value={wm.horizontalMarginPercent} onChange={(e) => set('horizontalMarginPercent', Number(e.target.value))} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">V margin %</span>
          <input type="number" min={0} max={45} className={inp} value={wm.verticalMarginPercent} onChange={(e) => set('verticalMarginPercent', Number(e.target.value))} />
        </label>
        {wm.mode === 'intermittent' && (
          <>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-400">Every (min)</span>
              <input type="number" min={1} className={inp} value={wm.frequencyMinutes} onChange={(e) => set('frequencyMinutes', Number(e.target.value))} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-400">Duration (sec)</span>
              <input type="number" min={1} className={inp} value={wm.durationSeconds} onChange={(e) => set('durationSeconds', Number(e.target.value))} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-400">Fade (sec)</span>
              <input type="number" min={0} className={inp} value={wm.fadeSeconds} onChange={(e) => set('fadeSeconds', Number(e.target.value))} />
            </label>
          </>
        )}
      </div>
      <label className="flex items-start gap-2 text-sm mt-3 select-none">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={wm.constrainToMedia}
          onChange={(e) => set('constrainToMedia', e.target.checked)}
        />
        <span className="text-slate-300">
          Constrain to picture
          <span className="block text-xs text-slate-500">
            Size &amp; place the logo relative to the actual image (e.g. 4:3 pillarboxed content) instead of the full
            16:9 frame, so it never lands on the black bars.
          </span>
        </span>
      </label>
    </div>
  )
}
