import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { Request, Response } from 'express'
import type { Channel, TimeBlock } from '@prisma/client'
import { prisma } from './db.js'
import { buildPlayout, prunePlayout } from './playout.js'
import { logosDir } from './paths.js'
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
}

export async function loadWatermark(): Promise<WatermarkConfig> {
  const s = await prisma.setting.findUnique({ where: { key: 'watermark' } })
  if (!s?.value) return DEFAULT_WATERMARK
  try {
    return { ...DEFAULT_WATERMARK, ...(JSON.parse(s.value) as Partial<WatermarkConfig>) }
  } catch {
    return DEFAULT_WATERMARK
  }
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
  phaseFrames: number // intermittent watermark phase (for cross-segment continuity)
}

// Build the logo scale + opacity chain and overlay position for a watermark.
function watermarkGraph(wm: WatermarkConfig, logoIdx: number, phaseFrames: number): { logoChain: string; overlayPos: string } {
  const LW = Math.max(2, Math.round((W * wm.widthPercent) / 100))
  const MX = Math.round((W * wm.horizontalMarginPercent) / 100)
  const MY = Math.round((H * wm.verticalMarginPercent) / 100)
  const positions: Record<string, string> = {
    'top-left': `${MX}:${MY}`,
    'top-right': `W-w-${MX}:${MY}`,
    'bottom-left': `${MX}:H-h-${MY}`,
    'bottom-right': `W-w-${MX}:H-h-${MY}`,
  }
  const overlayPos = positions[wm.position] ?? positions['bottom-right']
  const BO = Math.max(0, Math.min(1, wm.opacityPercent / 100)).toFixed(3)

  let logoChain: string
  if (wm.mode === 'intermittent') {
    // geq's frame-number N is periodic; T is unreliable in some builds.
    const Pf = Math.max(1, Math.round(wm.frequencyMinutes * 60 * FPS))
    const Df = Math.max(1, Math.round(wm.durationSeconds * FPS))
    const Ff = Math.max(1, Math.round(wm.fadeSeconds * FPS))
    const c = `mod(N+${phaseFrames},${Pf})`
    const vis = `clip(min(min(${c}/${Ff},(${Df}-${c})/${Ff}),1),0,1)`
    logoChain = `[${logoIdx}:v]scale=${LW}:-2,fps=${FPS},format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*${BO}*${vis}'[lg]`
  } else {
    logoChain = `[${logoIdx}:v]scale=${LW}:-2,format=rgba,colorchannelmixer=aa=${BO}[lg]`
  }
  return { logoChain, overlayPos }
}

function ffmpegArgs(seg: Segment, enc: string, wm: WatermarkConfig): string[] {
  const useWatermark = wm.mode !== 'none' && !!seg.logo
  const a: string[] = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-fflags', '+genpts']
  if (seg.offsetSec > 0.1) a.push('-ss', seg.offsetSec.toFixed(3))
  if (seg.loop) a.push('-stream_loop', '-1')
  a.push('-re', '-i', seg.filePath)

  let logoIdx = -1
  if (useWatermark) {
    a.push('-i', seg.logo as string)
    logoIdx = 1
  }
  let silentIdx = -1
  if (!seg.hasAudio) {
    a.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo')
    silentIdx = useWatermark ? 2 : 1
  }
  if (seg.durationSec) a.push('-t', seg.durationSec.toFixed(3))

  // De-anamorphize (scale=iw*sar:ih) so non-square-pixel sources (e.g. 720x480
  // DVD content) aren't horizontally stretched, then fit+letterbox to 1280x720.
  // Reset per-segment timestamps so concatenated segments stay in sync.
  const base = `[0:v]scale=iw*sar:ih,scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS},format=yuv420p,setpts=PTS-STARTPTS`
  let vf: string
  if (useWatermark) {
    const wg = watermarkGraph(wm, logoIdx, seg.phaseFrames)
    vf = `${base}[bg];${wg.logoChain};[bg][lg]overlay=${wg.overlayPos}[v]`
  } else {
    vf = `${base}[v]`
  }
  const aIn = seg.hasAudio ? '0:a:0' : `${silentIdx}:a:0`
  const af = `[${aIn}]asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo[a]`

  a.push('-filter_complex', `${vf};${af}`, '-map', '[v]', '-map', '[a]')
  a.push(...encoderArgs(enc))
  a.push('-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '192k')
  a.push('-avoid_negative_ts', 'make_zero', '-f', 'mpegts', '-muxpreload', '0', '-muxdelay', '0', 'pipe:1')
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

function rawLogoFor(
  channel: Channel,
  blocks: TimeBlock[],
  logoPath: Map<number, string>,
  at: Date,
): string | null {
  const block = activeBlockAt(blocks, at)
  const id = block?.logoId ?? channel.logoId
  if (id != null && logoPath.has(id)) return logoPath.get(id) as string
  return block?.logoUrl || channel.logoUrl || null
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

/** Generate a loopable ambient station-ID clip (gradient background + soft tone). */
export function generateFiller(out: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      '-y',
      '-f', 'lavfi', '-i', 'gradients=s=1280x720:d=20:speed=0.015:c0=0x111827:c1=0x4c1d95:c2=0x1e3a8a:c3=0x0e7490:nb_colors=4',
      '-f', 'lavfi', '-i', 'sine=f=98:d=20,volume=0.06',
      '-c:v', 'libx264', '-preset', 'medium', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-ac', '2', '-ar', '48000', '-shortest', out,
    ]
    const p = spawn('ffmpeg', args)
    p.stderr?.on('data', () => {})
    p.on('error', reject)
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error('filler generation failed'))))
  })
}

// Resolve the filler clip: user-provided (setting) else an auto-generated default.
let fillerClipCache: string | undefined
async function getFillerClip(): Promise<string | undefined> {
  const s = await prisma.setting.findUnique({ where: { key: 'filler_path' } })
  if (s?.value && fs.existsSync(s.value)) return s.value
  const out = path.join(os.tmpdir(), 'mesatztv-filler.mp4')
  if (fs.existsSync(out)) return (fillerClipCache = out)
  await generateFiller(out).catch(() => {})
  return fs.existsSync(out) ? (fillerClipCache = out) : undefined
}

type SegmentResult = { code: number | null; stderr: string; spawnError?: Error }

/**
 * Pipe a child's stdout to the response with backpressure; resolve on exit.
 * Captures a tail of stderr and the exit code so the caller can log failures.
 */
function pipeSegment(proc: ChildProcess, res: Response): Promise<SegmentResult> {
  return new Promise((resolve) => {
    let stderr = ''
    let spawnError: Error | undefined
    proc.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString()
      if (stderr.length > 6000) stderr = stderr.slice(-6000) // keep the tail
    })
    const onData = (chunk: Buffer) => {
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
      resolve({ code, stderr: stderr.trim(), spawnError })
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
    await buildPlayout(channel.id, new Date(now + 4 * 3600 * 1000)).catch((e) =>
      log('error', 'playout', `Playout build failed for channel ${channelNumber}`, String(e?.stack || e)),
    )
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
  const wm = await loadWatermark()
  const periodFrames = Math.max(1, Math.round(wm.frequencyMinutes * 60 * FPS))
  const logos = await prisma.logo.findMany()
  const logoPath = new Map<number, string>(logos.map((l) => [l.id, path.join(logosDir(), l.filename)]))

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
        await buildPlayout(channel.id, new Date(Date.now() + 4 * 3600 * 1000)).catch((e) =>
          log('error', 'playout', `Playout refill failed for channel ${channelNumber}`, String(e?.stack || e)),
        )
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
        const logo = await localLogo(rawLogoFor(channel, channel.timeBlocks, logoPath, item.startTime))
        const offset = first ? Math.max(0, (Date.now() - item.startTime.getTime()) / 1000) : 0
        first = false
        const mi = item.mediaItem
        const phaseFrames = Math.round((item.startTime.getTime() / 1000) * FPS) % periodFrames
        let seg: Segment | null = null

        if (item.kind === 'filler' || !mi) {
          const fp = await getFillerClip()
          const dur = (item.stopTime.getTime() - item.startTime.getTime()) / 1000 - offset
          if (fp && dur > 0.3) seg = { filePath: fp, offsetSec: 0, loop: true, durationSec: dur, hasAudio: true, logo, phaseFrames }
        } else if (fs.existsSync(mi.path)) {
          seg = { filePath: mi.path, offsetSec: offset, loop: false, hasAudio: !!mi.audioCodec, logo, phaseFrames }
        } else {
          log('warn', 'stream', `Channel ${channelNumber}: media file missing, skipping`, mi.path)
        }

        if (!seg) {
          cursor = item.stopTime
          continue
        }
        current = spawn('ffmpeg', ffmpegArgs(seg, enc, wm))
        const result = await pipeSegment(current, res)
        current = null
        cursor = item.stopTime
        // Log ffmpeg trouble (but not the SIGKILL we send on disconnect).
        if (!aborted) {
          if (result.spawnError) {
            log('error', 'ffmpeg', `Channel ${channelNumber}: failed to launch ffmpeg for ${path.basename(seg.filePath)}`, String(result.spawnError))
          } else if (result.code && result.code !== 0) {
            log('error', 'ffmpeg', `Channel ${channelNumber}: ffmpeg exited ${result.code} on ${path.basename(seg.filePath)}`, result.stderr || '(no stderr)')
          } else if (result.stderr) {
            log('warn', 'ffmpeg', `Channel ${channelNumber}: ffmpeg warnings on ${path.basename(seg.filePath)}`, result.stderr)
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
