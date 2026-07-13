import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { Request, Response } from 'express'
import type { Channel, TimeBlock } from '@prisma/client'
import { prisma } from './db.js'
import { buildPlayout, prunePlayout } from './playout.js'
import { dataDir, logosDir } from './paths.js'
import { log } from './logs.js'

// Normalized output format — every item is transcoded to these exact params so
// the concatenated MPEG-TS is a single continuous, seamless stream.
const W = 1280
const H = 720
const FPS = 30

export type WatermarkConfig = {
  mode: 'permanent' | 'intermittent' | 'none'
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  widthPercent: number
  horizontalMarginPercent: number
  verticalMarginPercent: number
  opacityPercent: number
  frequencyMinutes: number
  durationSeconds: number
  fadeSeconds: number
  // When true, size/position the logo relative to the actual media rectangle
  // (respecting the source aspect, e.g. 4:3 pillarboxed content) instead of the
  // full 1280x720 output canvas — so the watermark stays over the picture.
  constrainToMedia: boolean
}

export const DEFAULT_WATERMARK: WatermarkConfig = {
  mode: 'permanent',
  position: 'bottom-right',
  widthPercent: 10,
  horizontalMarginPercent: 4,
  verticalMarginPercent: 4,
  opacityPercent: 85,
  frequencyMinutes: 5,
  durationSeconds: 30,
  fadeSeconds: 1,
  constrainToMedia: false,
}

/** Parse a stored WatermarkConfig JSON blob, filling gaps from `base`. */
export function parseWatermark(json: string | null | undefined, base: WatermarkConfig = DEFAULT_WATERMARK): WatermarkConfig {
  if (!json) return base
  try {
    return { ...base, ...(JSON.parse(json) as Partial<WatermarkConfig>) }
  } catch {
    return base
  }
}

/** Clamp an incoming (untrusted) watermark config to valid ranges/enums. */
export function sanitizeWatermark(input: unknown): WatermarkConfig {
  const wm = { ...DEFAULT_WATERMARK, ...((input as Partial<WatermarkConfig>) ?? {}) }
  const modes: WatermarkConfig['mode'][] = ['permanent', 'intermittent', 'none']
  const positions: WatermarkConfig['position'][] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
  return {
    mode: modes.includes(wm.mode) ? wm.mode : 'permanent',
    position: positions.includes(wm.position) ? wm.position : 'bottom-right',
    widthPercent: Math.max(1, Math.min(50, Number(wm.widthPercent) || 10)),
    horizontalMarginPercent: Math.max(0, Math.min(45, Number(wm.horizontalMarginPercent) || 0)),
    verticalMarginPercent: Math.max(0, Math.min(45, Number(wm.verticalMarginPercent) || 0)),
    opacityPercent: Math.max(0, Math.min(100, Number(wm.opacityPercent) || 85)),
    frequencyMinutes: Math.max(1, Number(wm.frequencyMinutes) || 5),
    durationSeconds: Math.max(1, Number(wm.durationSeconds) || 30),
    fadeSeconds: Math.max(0, Number(wm.fadeSeconds) || 0),
    constrainToMedia: !!wm.constrainToMedia,
  }
}

export async function loadWatermark(): Promise<WatermarkConfig> {
  const s = await prisma.setting.findUnique({ where: { key: 'watermark' } })
  return parseWatermark(s?.value)
}

let encoderCache: string | null = null

/** Detect once whether NVIDIA nvenc is available; fall back to libx264. */
function detectEncoder(): Promise<string> {
  if (encoderCache) return Promise.resolve(encoderCache)
  return new Promise((resolve) => {
    let out = ''
    const p = spawn('ffmpeg', ['-hide_banner', '-encoders'])
    p.stdout.on('data', (d) => (out += d))
    p.on('error', () => {
      log('warn', 'ffmpeg', 'Could not run ffmpeg to detect encoders; falling back to libx264')
      resolve((encoderCache = 'libx264'))
    })
    p.on('close', () => {
      const enc = out.includes('h264_nvenc') ? 'h264_nvenc' : 'libx264'
      log('info', 'ffmpeg', `Video encoder selected: ${enc}`)
      resolve((encoderCache = enc))
    })
  })
}

function encoderArgs(enc: string): string[] {
  if (enc === 'h264_nvenc') {
    return ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-b:v', '5M', '-maxrate', '8M', '-bufsize', '10M', '-g', String(FPS * 2), '-pix_fmt', 'yuv420p']
  }
  return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-maxrate', '8M', '-bufsize', '12M', '-g', String(FPS * 2), '-pix_fmt', 'yuv420p']
}

type Segment = {
  filePath: string
  offsetSec: number // seek into the file (first item only)
  durationSec?: number // cap output length (filler loop); undefined = play to EOF
  loop: boolean // loop the input (filler)
  hasAudio: boolean
  logo?: string // logo file path or http url
  wmEpochSec: number // segment's absolute start time (s) — aligns intermittent watermark to wall clock
  mediaWidth: number // source pixel dims (for constrain-to-media watermark)
  mediaHeight: number
  musicPath?: string // looped ambient audio (filler only) — overrides clip audio
  tsOffsetSec: number // cumulative output timestamp offset (keeps PTS monotonic across segments)
}

// The rectangle the picture occupies inside the WxH output canvas after
// aspect-preserving fit (pillar/letterbox). Used to constrain the watermark to
// the media. When not constraining, this is the whole canvas.
type Rect = { x0: number; y0: number; mw: number; mh: number }
function mediaRect(mediaW: number, mediaH: number, constrain: boolean): Rect {
  if (!constrain || !mediaW || !mediaH) return { x0: 0, y0: 0, mw: W, mh: H }
  const ar = mediaW / mediaH
  const canvasAR = W / H
  let mw: number
  let mh: number
  if (ar >= canvasAR) {
    mw = W
    mh = Math.round(W / ar)
  } else {
    mh = H
    mw = Math.round(H * ar)
  }
  return { x0: Math.round((W - mw) / 2), y0: Math.round((H - mh) / 2), mw, mh }
}

// Build the logo scale + opacity chain, overlay position, and (for intermittent
// mode) a timeline `enable` expression that shows the logo for `durationSeconds`
// every `frequencyMinutes`, aligned to wall-clock time so every viewer sees it
// at the same moment. `wmEpochSec` is the segment's absolute start time in
// seconds; `t` inside the expression is the segment-relative time.
function watermarkGraph(
  wm: WatermarkConfig,
  logoIdx: number,
  wmEpochSec: number,
  rect: Rect,
): { logoChain: string; overlayPos: string; overlayExtra: string } {
  const LW = Math.max(2, Math.round((rect.mw * wm.widthPercent) / 100))
  const MX = Math.round((rect.mw * wm.horizontalMarginPercent) / 100)
  const MY = Math.round((rect.mh * wm.verticalMarginPercent) / 100)
  const left = rect.x0 + MX
  const top = rect.y0 + MY
  const right = rect.x0 + rect.mw - MX // right edge of the logo box
  const bottom = rect.y0 + rect.mh - MY // bottom edge of the logo box
  const positions: Record<string, string> = {
    'top-left': `${left}:${top}`,
    'top-right': `${right}-w:${top}`,
    'bottom-left': `${left}:${bottom}-h`,
    'bottom-right': `${right}-w:${bottom}-h`,
  }
  const overlayPos = positions[wm.position] ?? positions['bottom-right']
  const BO = Math.max(0, Math.min(1, wm.opacityPercent / 100)).toFixed(3)

  // Static alpha via colorchannelmixer — reliable on all builds (unlike geq,
  // which needs planar RGBA and silently mangles packed formats).
  const logoChain = `[${logoIdx}:v]scale=${LW}:-2,format=rgba,colorchannelmixer=aa=${BO}[lg]`

  let overlayExtra = ''
  if (wm.mode === 'intermittent') {
    const P = Math.max(1, Math.round(wm.frequencyMinutes * 60)) // period, seconds
    const D = Math.max(1, Math.round(wm.durationSeconds)) // visible window, seconds
    // Single-quoted so the commas aren't parsed as filtergraph separators.
    overlayExtra = `:enable='lt(mod(t+${wmEpochSec.toFixed(1)},${P}),${D})'`
  }
  return { logoChain, overlayPos, overlayExtra }
}

function ffmpegArgs(seg: Segment, enc: string, wm: WatermarkConfig): string[] {
  const useWatermark = wm.mode !== 'none' && !!seg.logo
  const a: string[] = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-fflags', '+genpts']
  if (seg.offsetSec > 0.1) a.push('-ss', seg.offsetSec.toFixed(3))
  if (seg.loop) a.push('-stream_loop', '-1')
  a.push('-re', '-i', seg.filePath) // input 0 = main video

  let idx = 1
  let logoIdx = -1
  if (useWatermark) {
    logoIdx = idx++
    a.push('-i', seg.logo as string)
  }
  // Audio source: ambient music (looped) overrides the clip's own audio; else
  // silence when the source has none.
  let audioIdx = -1 // -1 = use the main input's audio (0:a)
  if (seg.musicPath) {
    audioIdx = idx++
    a.push('-stream_loop', '-1', '-i', seg.musicPath)
  } else if (!seg.hasAudio) {
    audioIdx = idx++
    a.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo')
  }
  if (seg.durationSec) a.push('-t', seg.durationSec.toFixed(3))

  // De-anamorphize (scale=iw*sar:ih) so non-square-pixel sources (e.g. 720x480
  // DVD content) aren't horizontally stretched, then fit+letterbox to 1280x720.
  // Reset per-segment timestamps so concatenated segments stay in sync.
  const base = `[0:v]scale=iw*sar:ih,scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS},format=yuv420p,setpts=PTS-STARTPTS`
  let vf: string
  if (useWatermark) {
    const rect = mediaRect(seg.mediaWidth, seg.mediaHeight, wm.constrainToMedia)
    const wg = watermarkGraph(wm, logoIdx, seg.wmEpochSec, rect)
    vf = `${base}[bg];${wg.logoChain};[bg][lg]overlay=${wg.overlayPos}${wg.overlayExtra}[v]`
  } else {
    vf = `${base}[v]`
  }
  const aIn = audioIdx >= 0 ? `${audioIdx}:a:0` : '0:a:0'
  const af = `[${aIn}]asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo[a]`

  a.push('-filter_complex', `${vf};${af}`, '-map', '[v]', '-map', '[a]')
  a.push(...encoderArgs(enc))
  a.push('-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '192k')
  // Continuous timestamps: each segment's frames start at 0 (setpts above), and
  // -output_ts_offset shifts them to follow the previous segment so the muxed
  // MPEG-TS never jumps backwards. Backwards PTS at a boundary is what makes
  // players freeze/black-out until they reconnect.
  a.push('-output_ts_offset', seg.tsOffsetSec.toFixed(3))
  a.push('-mpegts_flags', '+resend_headers', '-f', 'mpegts', '-muxpreload', '0', '-muxdelay', '0', 'pipe:1')
  return a
}

// Which logo applies at a given time (block override, else channel default).
function activeBlockAt(blocks: TimeBlock[], date: Date): TimeBlock | null {
  const day = date.getDay()
  const prev = (day + 6) % 7
  const tod = date.getHours() * 60 + date.getMinutes()
  for (const b of blocks) {
    const days = b.days.split(',').map((s) => Number(s.trim()))
    if (b.endMinute > b.startMinute) {
      if (days.includes(day) && tod >= b.startMinute && tod < b.endMinute) return b
    } else {
      if (days.includes(day) && tod >= b.startMinute) return b
      if (days.includes(prev) && tod < b.endMinute) return b
    }
  }
  return null
}

// The logo active at a given time (block override, else channel default).
// Returns the Logo row id (so we can use its per-logo watermark settings) and
// the raw file path / URL to overlay.
function activeLogo(
  channel: Channel,
  blocks: TimeBlock[],
  logoPath: Map<number, string>,
  at: Date,
): { id: number | null; raw: string | null } {
  const block = activeBlockAt(blocks, at)
  const id = block?.logoId ?? channel.logoId
  if (id != null && logoPath.has(id)) return { id, raw: logoPath.get(id) as string }
  return { id: null, raw: block?.logoUrl || channel.logoUrl || null }
}

// Resolve a logo (local path or http url) to a usable local file, downloading
// and caching http logos. Falls back to the bundled icon so a bad URL never
// breaks the stream.
const logoCache = new Map<string, string | undefined>()
async function localLogo(raw: string | null): Promise<string | undefined> {
  const fallback = path.join(process.cwd(), 'public', 'mesatztv-icon.png')
  const fb = fs.existsSync(fallback) ? fallback : undefined
  if (!raw) return fb
  if (logoCache.has(raw)) return logoCache.get(raw)

  let result: string | undefined
  if (/^https?:\/\//i.test(raw)) {
    try {
      const r = await fetch(raw)
      if (r.ok) {
        const file = path.join(os.tmpdir(), 'mesatztv-logo-' + createHash('md5').update(raw).digest('hex') + '.png')
        fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()))
        result = file
      }
    } catch {
      /* ignore — fall back below */
    }
  } else if (fs.existsSync(raw)) {
    result = raw
  }
  result = result ?? fb
  logoCache.set(raw, result)
  return result
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args)
    let err = ''
    p.stderr?.on('data', (d) => (err += d))
    p.on('error', reject)
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error('ffmpeg exited ' + c + ': ' + err.slice(-500)))))
  })
}

const FILLER_D = 30
// Preferred look: a drifting color gradient with a slow hue sway, animated
// grain and a vignette (visible motion to keep viewers hanging tight). Loops
// smoothly (hue uses a sine that returns to 0 at the end).
function fillerArgsAnimated(out: string): string[] {
  return [
    '-y',
    '-f', 'lavfi', '-i', `gradients=s=${W}x${H}:d=${FILLER_D}:speed=0.05:c0=0x0b1020:c1=0x3b1d60:c2=0x1e3a8a:c3=0x0e7490:nb_colors=4`,
    '-f', 'lavfi', '-i', `sine=f=110:d=${FILLER_D},volume=0.05`,
    '-filter_complex',
    `[0:v]hue=H='0.5*sin(2*PI*t/${FILLER_D})':s='1.05+0.05*sin(2*PI*t/${FILLER_D})',noise=alls=6:allf=t,vignette=PI/4.5,fps=${FPS},format=yuv420p[v]`,
    '-map', '[v]', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'medium', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ac', '2', '-ar', '48000', '-shortest', out,
  ]
}
// Proven fallback (the original) in case a filter isn't available on this build.
function fillerArgsBasic(out: string): string[] {
  return [
    '-y',
    '-f', 'lavfi', '-i', `gradients=s=${W}x${H}:d=20:speed=0.02:c0=0x111827:c1=0x4c1d95:c2=0x1e3a8a:c3=0x0e7490:nb_colors=4`,
    '-f', 'lavfi', '-i', 'sine=f=98:d=20,volume=0.06',
    '-c:v', 'libx264', '-preset', 'medium', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ac', '2', '-ar', '48000', '-shortest', out,
  ]
}

/** Generate a loopable ambient "please stand by" clip (animated, with a fallback). */
export async function generateFiller(out: string): Promise<void> {
  try {
    await runFfmpeg(fillerArgsAnimated(out))
  } catch (e) {
    log('warn', 'system', 'Animated filler failed, using basic gradient fallback', String(e))
    await runFfmpeg(fillerArgsBasic(out))
  }
}

// Bump when generateFiller changes so the persisted default regenerates.
const FILLER_VERSION = 2
function autoFillerPath(): string {
  return path.join(dataDir(), `filler-auto-v${FILLER_VERSION}.mp4`)
}

// Resolve the filler clip: user-provided (setting) else the auto-generated
// default (persisted under the data dir so it survives restarts).
async function getFillerClip(): Promise<string | undefined> {
  const s = await prisma.setting.findUnique({ where: { key: 'filler_path' } })
  if (s?.value && fs.existsSync(s.value)) return s.value
  const out = autoFillerPath()
  if (fs.existsSync(out)) return out
  log('info', 'system', 'Generating default animated filler clip (one-time)…')
  const ok = await generateFiller(out)
    .then(() => true)
    .catch((e) => {
      log('error', 'system', 'Filler generation failed', String(e))
      return false
    })
  return ok && fs.existsSync(out) ? out : undefined
}

// Optional ambient music played during intermissions (loops under the filler).
async function getFillerMusic(): Promise<string | undefined> {
  const s = await prisma.setting.findUnique({ where: { key: 'filler_music' } })
  return s?.value && fs.existsSync(s.value) ? s.value : undefined
}

/** Pre-build the default filler at boot so it never blocks a live stream. */
export async function warmFiller(): Promise<void> {
  const fp = await getFillerClip().catch(() => undefined)
  if (fp) log('info', 'system', `Filler clip ready: ${fp}`)
  else log('warn', 'system', 'No filler clip available — gaps will play black')
}

type SegmentResult = { code: number | null; stderr: string; spawnError?: Error; bytes: number; firstByteMs: number }

/**
 * Pipe a child's stdout to the response with backpressure; resolve on exit.
 * Captures a tail of stderr, the exit code, bytes written, and how long until
 * the first byte arrived (a big first-byte delay is a stall the viewer sees).
 */
function pipeSegment(proc: ChildProcess, res: Response): Promise<SegmentResult> {
  return new Promise((resolve) => {
    let stderr = ''
    let spawnError: Error | undefined
    let bytes = 0
    let firstByteMs = -1
    const t0 = Date.now()
    proc.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString()
      if (stderr.length > 6000) stderr = stderr.slice(-6000) // keep the tail
    })
    const onData = (chunk: Buffer) => {
      if (firstByteMs < 0) firstByteMs = Date.now() - t0
      bytes += chunk.length
      if (!res.write(chunk)) proc.stdout?.pause()
    }
    const onDrain = () => proc.stdout?.resume()
    proc.stdout?.on('data', onData)
    res.on('drain', onDrain)
    let settled = false
    const done = (code: number | null) => {
      if (settled) return
      settled = true
      res.off('drain', onDrain)
      resolve({ code, stderr: stderr.trim(), spawnError, bytes, firstByteMs })
    }
    proc.on('close', (code) => done(code))
    proc.on('error', (err) => {
      spawnError = err
      done(null)
    })
  })
}

function clientInfo(req?: Request): string {
  if (!req) return 'unknown client'
  const ip =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  const ua = (req.headers['user-agent'] as string) || 'unknown'
  return `${ip} — ${ua}`
}

// Count of live viewers per channel number, for logging concurrency.
const viewers = new Map<number, number>()

/** Stream a channel's playout as a continuous MPEG-TS to `res`. */
export async function streamChannel(channelNumber: number, res: Response, req?: Request): Promise<void> {
  const channel = await prisma.channel.findFirst({
    where: { number: channelNumber },
    include: { timeBlocks: true, rotationItems: true },
  })
  if (!channel) {
    log('warn', 'stream', `Rejected stream: channel ${channelNumber} not found (${clientInfo(req)})`)
    res.status(404).end()
    return
  }

  // Auto-build the playout if it's empty or nearly exhausted.
  const now = Date.now()
  if (!channel.playoutCursor || channel.playoutCursor.getTime() < now + 30 * 60 * 1000) {
    if (channel.rotationItems.length === 0 && channel.timeBlocks.length === 0) {
      log('warn', 'stream', `Channel ${channelNumber} (${channel.name}) has nothing scheduled — no rotation or time blocks`)
      res.status(409).end() // nothing scheduled
      return
    }
    await prunePlayout(channel.id).catch((e) =>
      log('warn', 'playout', `Prune failed for channel ${channelNumber}`, String(e)),
    )
    const built = await buildPlayout(channel.id, new Date(now + 4 * 3600 * 1000)).catch((e) => {
      log('error', 'playout', `Playout build failed for channel ${channelNumber}`, String(e?.stack || e))
      return -1
    })
    if (built >= 0) log('debug', 'playout', `Channel ${channelNumber}: built ${built} playout item(s) on connect`)
  }

  const nViewers = (viewers.get(channelNumber) ?? 0) + 1
  viewers.set(channelNumber, nViewers)
  log(
    'info',
    'stream',
    `▶ Channel ${channelNumber} (${channel.name}) connected — ${nViewers} viewer(s) now watching this channel`,
    clientInfo(req),
  )

  const enc = await detectEncoder()
  const defaultWm = await loadWatermark()
  const fillerMusic = await getFillerMusic()
  const logos = await prisma.logo.findMany()
  const logoPath = new Map<number, string>(logos.map((l) => [l.id, path.join(logosDir(), l.filename)]))
  // Each logo can carry its own watermark settings; legacy URL logos and the
  // bundled fallback icon use the global default.
  const logoWm = new Map<number, WatermarkConfig>(logos.map((l) => [l.id, parseWatermark(l.watermark, defaultWm)]))
  if (fillerMusic) log('debug', 'stream', `Channel ${channelNumber}: intermission music ${path.basename(fillerMusic)}`)

  res.writeHead(200, {
    'Content-Type': 'video/mp2t',
    'Cache-Control': 'no-cache, no-store',
    Connection: 'close',
  })

  let aborted = false
  let reason = 'client disconnected'
  let current: ChildProcess | null = null
  res.on('close', () => {
    aborted = true
    current?.kill('SIGKILL')
  })

  // Walk playout items from now forward, refilling as we go.
  let cursor = new Date()
  let first = true
  // Cumulative output-timestamp offset so PTS climbs monotonically across every
  // segment (no backwards jump at boundaries). A tiny epsilon per boundary biases
  // slightly forward so frame-rounding never overlaps into the previous segment.
  let tsOffset = 0
  try {
    while (!aborted) {
      // A transient DB error must not kill an in-flight stream — retry briefly
      // (WAL + busy_timeout make this rare, but a lock during another viewer's
      // build could still surface here).
      const items = await prisma.playoutItem
        .findMany({
          where: { channelId: channel.id, stopTime: { gt: cursor } },
          orderBy: { startTime: 'asc' },
          take: 100,
          include: { mediaItem: true },
        })
        .catch((e) => {
          log('warn', 'stream', `Channel ${channelNumber}: DB read failed, retrying`, String(e))
          return null
        })
      if (items === null) {
        await new Promise((r) => setTimeout(r, 500))
        continue
      }
      if (items.length === 0) {
        const built = await buildPlayout(channel.id, new Date(Date.now() + 4 * 3600 * 1000)).catch((e) => {
          log('error', 'playout', `Playout refill failed for channel ${channelNumber}`, String(e?.stack || e))
          return -1
        })
        if (built > 0) log('debug', 'playout', `Channel ${channelNumber}: refilled ${built} playout item(s) mid-stream`)
        const more = await prisma.playoutItem
          .count({ where: { channelId: channel.id, stopTime: { gt: cursor } } })
          .catch(() => 0)
        if (more === 0) {
          reason = 'playout exhausted (nothing left to play)'
          break
        }
        continue
      }
      for (const item of items) {
        if (aborted) break
        const active = activeLogo(channel, channel.timeBlocks, logoPath, item.startTime)
        const logo = await localLogo(active.raw)
        // Per-logo watermark settings, else the global default.
        const wm = active.id != null ? logoWm.get(active.id) ?? defaultWm : defaultWm
        const offset = first ? Math.max(0, (Date.now() - item.startTime.getTime()) / 1000) : 0
        first = false
        const mi = item.mediaItem
        // Absolute wall-clock start of the frames we're about to emit — anchors
        // the intermittent watermark so it fires on schedule for every viewer.
        const wmEpochSec = item.startTime.getTime() / 1000 + offset
        // Cap every segment to its scheduled slot so output timestamps stay
        // exactly continuous (a program overrunning its probed duration is what
        // could otherwise push the next segment's PTS backwards → a freeze).
        const segDur = (item.stopTime.getTime() - item.startTime.getTime()) / 1000 - offset
        let seg: Segment | null = null
        let label: string

        if (item.kind === 'filler' || !mi) {
          const genStart = Date.now()
          const fp = await getFillerClip()
          const genMs = Date.now() - genStart
          if (genMs > 500) log('warn', 'system', `Channel ${channelNumber}: filler clip resolve blocked ${genMs}ms (should be pre-warmed)`)
          if (fp && segDur > 0.3) seg = { filePath: fp, offsetSec: 0, loop: true, durationSec: segDur, hasAudio: true, logo, wmEpochSec, mediaWidth: W, mediaHeight: H, musicPath: fillerMusic, tsOffsetSec: tsOffset }
          label = `filler (${Math.round(segDur)}s)${fillerMusic ? ' +music' : ''}`
          if (!fp) log('error', 'stream', `Channel ${channelNumber}: no filler clip — a ${Math.round(segDur)}s gap will play black`)
        } else if (fs.existsSync(mi.path)) {
          seg = { filePath: mi.path, offsetSec: offset, loop: false, durationSec: segDur, hasAudio: !!mi.audioCodec, logo, wmEpochSec, mediaWidth: mi.width ?? W, mediaHeight: mi.height ?? H, tsOffsetSec: tsOffset }
          label = mi.showTitle
            ? `${mi.showTitle}${mi.season != null && mi.episode != null ? ` S${String(mi.season).padStart(2, '0')}E${String(mi.episode).padStart(2, '0')}` : ''}${mi.title ? ` — ${mi.title}` : ''}`
            : mi.title
        } else {
          log('warn', 'stream', `Channel ${channelNumber}: media file missing, skipping`, mi.path)
          label = mi.title
        }

        if (!seg) {
          cursor = item.stopTime
          continue
        }
        const args = ffmpegArgs(seg, enc, wm)
        let wmDesc: string
        if (wm.mode === 'none' || !logo) {
          wmDesc = 'no watermark'
        } else if (wm.mode === 'intermittent') {
          // Where we are in the show/hide cycle right now, so the log makes it
          // obvious when to expect the logo (and confirms it's scheduled).
          const P = Math.max(1, Math.round(wm.frequencyMinutes * 60))
          const phase = Math.round(wmEpochSec) % P
          const untilOn = phase < wm.durationSeconds ? 0 : P - phase
          wmDesc = `watermark intermittent/${wm.position}${wm.constrainToMedia ? '/media-fit' : ''} — ${wm.durationSeconds}s every ${wm.frequencyMinutes}min, ${untilOn === 0 ? 'visible now' : 'next in ' + untilOn + 's'}`
        } else {
          wmDesc = `watermark ${wm.mode}/${wm.position}${wm.constrainToMedia ? '/media-fit' : ''}`
        }
        log(
          'info',
          'stream',
          `Ch ${channelNumber} ▶ ${label}${offset > 1 ? ` (resuming at ${Math.round(offset)}s)` : ''}`,
          `source ${seg.mediaWidth}x${seg.mediaHeight}, logo ${active.id != null ? '#' + active.id : active.raw ? 'url' : 'none'}, ${wmDesc}, ts+${tsOffset.toFixed(1)}s`,
        )
        log('debug', 'ffmpeg', `Ch ${channelNumber} ffmpeg command`, 'ffmpeg ' + args.join(' '))
        const segStart = Date.now()
        current = spawn('ffmpeg', args)
        const result = await pipeSegment(current, res)
        current = null
        cursor = item.stopTime
        // Advance the timestamp clock by the segment's intended output length
        // (+40ms so rounding never overlaps backwards into the previous one).
        tsOffset += Math.max(0, segDur) + 0.04
        // Log the outcome of every segment (bytes, wall time, first-byte delay)
        // — a slow first byte or zero bytes is the stall a viewer sees as a
        // freeze/black screen. Skip the SIGKILL we send on disconnect.
        if (!aborted) {
          const wallMs = Date.now() - segStart
          const wallS = (wallMs / 1000).toFixed(1)
          const mb = (result.bytes / 1e6).toFixed(1)
          const detail = `${mb} MB in ${wallS}s (expected ~${Math.round(segDur)}s), first byte ${result.firstByteMs < 0 ? 'never' : result.firstByteMs + 'ms'}, exit ${result.code ?? 'n/a'}`
          if (result.spawnError) {
            log('error', 'ffmpeg', `Channel ${channelNumber}: failed to launch ffmpeg for ${path.basename(seg.filePath)}`, String(result.spawnError))
          } else if (result.code && result.code !== 0) {
            log('error', 'ffmpeg', `Channel ${channelNumber}: ffmpeg exited ${result.code} on ${path.basename(seg.filePath)}`, `${detail}\n${result.stderr || '(no stderr)'}`)
          } else if (result.bytes === 0) {
            log('error', 'ffmpeg', `Channel ${channelNumber}: ffmpeg produced NO output for ${path.basename(seg.filePath)} — viewers see a freeze/black`, `${detail}\n${result.stderr || '(no stderr)'}`)
          } else if (result.firstByteMs > 2500) {
            log('warn', 'ffmpeg', `Channel ${channelNumber}: slow start (${result.firstByteMs}ms to first byte) on ${path.basename(seg.filePath)} — possible stall`, detail)
          } else if (segDur > 5 && wallMs > (segDur + 3) * 1000 * 1.15) {
            // Took much longer than real time → the encoder can't sustain the
            // stream, so viewers' buffers underrun and it freezes/stutters.
            log('warn', 'ffmpeg', `Channel ${channelNumber}: encoder slower than real-time (${wallS}s for a ${Math.round(segDur)}s segment, ${enc}) — likely cause of freezing`, detail)
          } else {
            log('debug', 'ffmpeg', `Channel ${channelNumber}: segment done — ${label}`, `${detail}${result.stderr ? '\n' + result.stderr : ''}`)
          }
        }
      }
    }
  } catch (e) {
    reason = 'internal error'
    log('error', 'stream', `Channel ${channelNumber}: stream loop crashed`, String((e as Error)?.stack || e))
  }

  const left = (viewers.get(channelNumber) ?? 1) - 1
  viewers.set(channelNumber, Math.max(0, left))
  log('info', 'stream', `⏹ Channel ${channelNumber} (${channel.name}) stream ended — ${reason}; ${Math.max(0, left)} viewer(s) still watching`)
  if (!res.writableEnded) res.end()
}
