import type { Collection, MediaItem, TimeBlock } from '@prisma/client'
import { prisma } from './db.js'
import { resolveCollection, type PlaybackOrder } from './collections.js'

const MAX_ITERATIONS = 50000

type BlockWithCollection = TimeBlock & { collection: Collection }
type State = { rotationIndex: number; positions: Record<string, number> }

function truncateToMinute(d: Date): Date {
  return new Date(Math.floor(d.getTime() / 60000) * 60000)
}

/** The time block (if any) active at the given local date/time. First match wins. */
function activeBlock(blocks: BlockWithCollection[], date: Date): BlockWithCollection | null {
  const day = date.getDay()
  const prevDay = (day + 6) % 7
  const tod = date.getHours() * 60 + date.getMinutes()
  for (const b of blocks) {
    const days = b.days.split(',').map((s) => Number(s.trim()))
    if (b.endMinute > b.startMinute) {
      // Same-day block.
      if (days.includes(day) && tod >= b.startMinute && tod < b.endMinute) return b
    } else {
      // Wraps past midnight: evening part today, or the morning tail of a block
      // that started the previous day.
      if (days.includes(day) && tod >= b.startMinute) return b
      if (days.includes(prevDay) && tod < b.endMinute) return b
    }
  }
  return null
}

/** Jump the cursor to the end of the block window active at `cursor` (same day). */
function skipToBlockEnd(cursor: Date, block: TimeBlock): Date {
  const end = new Date(cursor)
  end.setHours(Math.floor(block.endMinute / 60), block.endMinute % 60, 0, 0)
  if (end <= cursor) end.setDate(end.getDate() + 1)
  return end
}

/** The soonest block start strictly after `cursor` and before `until` (and which block), or null. */
function nextBlockBoundary(
  blocks: BlockWithCollection[],
  cursor: Date,
  until: Date,
): { start: Date; block: BlockWithCollection } | null {
  let best: { start: Date; block: BlockWithCollection } | null = null
  for (let offset = 0; offset <= 7; offset++) {
    const day = new Date(cursor)
    day.setDate(day.getDate() + offset)
    const wd = day.getDay()
    for (const b of blocks) {
      if (!b.days.split(',').map((s) => Number(s.trim())).includes(wd)) continue
      const start = new Date(day)
      start.setHours(Math.floor(b.startMinute / 60), b.startMinute % 60, 0, 0)
      if (start > cursor && start < until && (best === null || start < best.start)) best = { start, block: b }
    }
  }
  return best
}

/**
 * Build (extend) a channel's playout timeline up to `until`. Rotation fills the
 * timeline 24/7; an active time block overrides it. Programs play fully, so
 * block boundaries are honored at program ends (soft dayparting). State persists
 * so shows continue in order across loops and days.
 */
export async function buildPlayout(channelId: number, until: Date): Promise<number> {
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    include: {
      rotationItems: {
        orderBy: { order: 'asc' },
        include: { collection: { include: { items: true } } },
      },
      timeBlocks: { include: { collection: { include: { items: true } } } },
    },
  })
  if (!channel) throw new Error(`Channel ${channelId} not found`)

  const anchor = channel.playoutAnchor ?? truncateToMinute(new Date())
  let cursor = channel.playoutCursor ?? anchor
  if (cursor >= until) return 0

  const state: State = channel.playoutState
    ? (JSON.parse(channel.playoutState) as State)
    : { rotationIndex: 0, positions: {} }

  // Cache resolved collection lists for this build pass.
  const cache = new Map<string, MediaItem[]>()
  const listFor = async (key: string, filter: unknown, order: string): Promise<MediaItem[]> => {
    if (!cache.has(key)) {
      const seed = channelId * 100000 + (Number(key.slice(1)) || 0)
      cache.set(key, await resolveCollection(filter as never, order as PlaybackOrder, seed))
    }
    return cache.get(key)!
  }

  const created: {
    mediaItemId: number | null
    kind: string
    title: string | null
    startTime: Date
    stopTime: Date
  }[] = []
  const pushProgram = (id: number, start: Date, stop: Date) =>
    created.push({ mediaItemId: id, kind: 'program', title: null, startTime: start, stopTime: stop })
  const pushFiller = (start: Date, stop: Date) =>
    created.push({ mediaItemId: null, kind: 'filler', title: 'Filler', startTime: start, stopTime: stop })
  let iterations = 0
  let stall = 0
  const stallLimit = channel.rotationItems.length + channel.timeBlocks.length + 3

  while (cursor < until && iterations < MAX_ITERATIONS) {
    iterations++
    const before = cursor.getTime()
    const block = activeBlock(channel.timeBlocks, cursor)

    if (block) {
      const key = 'b' + block.id
      const items = await listFor(key, block.collection, block.playbackOrder)
      const blockEnd = skipToBlockEnd(cursor, block)
      const fillerMode = block.fillerMode || 'none'

      if (items.length === 0) {
        // No programs: fill the whole window with filler (if enabled), else skip.
        if (fillerMode !== 'none' && blockEnd > cursor) pushFiller(new Date(cursor), new Date(blockEnd))
        cursor = blockEnd
      } else if (fillerMode === 'none') {
        // Soft boundary: one program per iteration; may overrun the block end.
        const pos = state.positions[key] ?? 0
        const mi = items[pos % items.length]
        state.positions[key] = pos + 1
        const dur = mi.durationSec ?? 0
        if (dur > 0) {
          const stop = new Date(cursor.getTime() + dur * 1000)
          pushProgram(mi.id, new Date(cursor), stop)
          cursor = stop
        }
      } else {
        // Pack as many programs as fit, then filler to land exactly on blockEnd.
        const availSec = (blockEnd.getTime() - cursor.getTime()) / 1000
        let pos = state.positions[key] ?? 0
        const fit: { id: number; dur: number }[] = []
        let used = 0
        for (let g = 0; g < 20000; g++) {
          const mi = items[pos % items.length]
          const dur = mi.durationSec ?? 0
          if (dur <= 0) {
            pos++
            continue
          }
          if (used + dur > availSec) break
          fit.push({ id: mi.id, dur })
          used += dur
          pos++
        }
        state.positions[key] = pos

        if (fit.length === 0) {
          // A single program is longer than the whole block — play it (overruns).
          const mi = items[pos % items.length]
          state.positions[key] = pos + 1
          const stop = new Date(cursor.getTime() + Math.max(mi.durationSec ?? 0, 1) * 1000)
          pushProgram(mi.id, new Date(cursor), stop)
          cursor = stop
        } else {
          const gapSec = Math.max(0, availSec - used)
          let c = cursor.getTime()
          const perGap = fillerMode === 'between' ? gapSec / fit.length : 0
          for (const p of fit) {
            const stop = c + p.dur * 1000
            pushProgram(p.id, new Date(c), new Date(stop))
            c = stop
            if (perGap > 0.5) {
              const fEnd = c + perGap * 1000
              pushFiller(new Date(c), new Date(fEnd))
              c = fEnd
            }
          }
          if (fillerMode === 'end' && gapSec > 0.5) pushFiller(new Date(c), new Date(blockEnd))
          cursor = blockEnd
        }
      }
    } else if (channel.rotationItems.length > 0) {
      const ri = channel.rotationItems[state.rotationIndex % channel.rotationItems.length]
      state.rotationIndex = state.rotationIndex + 1
      const key = 'r' + ri.id
      const items = await listFor(key, ri.collection, ri.playbackOrder)
      if (items.length > 0) {
        const take = ri.mode === 'multiple' ? Math.max(1, ri.count) : 1
        let pos = state.positions[key] ?? 0
        for (let k = 0; k < take; k++) {
          const mi = items[pos % items.length]
          const dur = mi.durationSec ?? 0
          if (dur <= 0) {
            pos++
            continue
          }
          // Hard block ahead? If this program would overrun a "hard" block's
          // start, fill the gap so the block begins exactly on time and defer
          // this program (don't advance pos) rather than cutting it short.
          const boundary = nextBlockBoundary(channel.timeBlocks, cursor, until)
          if (boundary && boundary.block.startMode === 'hard') {
            const gapMs = boundary.start.getTime() - cursor.getTime()
            if (dur * 1000 > gapMs) {
              if (gapMs > 500) pushFiller(new Date(cursor), new Date(boundary.start))
              cursor = boundary.start
              break
            }
          }
          pos++
          const stop = new Date(cursor.getTime() + dur * 1000)
          pushProgram(mi.id, new Date(cursor), stop)
          cursor = stop
          if (cursor >= until) break
          if (activeBlock(channel.timeBlocks, cursor)) break // enter the block promptly
        }
        state.positions[key] = pos
      }
    } else {
      // No rotation: this is a blocks-only channel. Jump to the next block
      // start (dead air in between), or stop if none is coming up.
      const next = channel.timeBlocks.length ? nextBlockBoundary(channel.timeBlocks, cursor, until)?.start ?? null : null
      if (next) cursor = next
      else break
    }

    // Break if we're not making progress (all sources empty / zero-duration).
    stall = cursor.getTime() === before ? stall + 1 : 0
    if (stall > stallLimit) break
  }

  await prisma.$transaction([
    prisma.playoutItem.createMany({
      data: created.map((c) => ({ channelId, ...c })),
    }),
    prisma.channel.update({
      where: { id: channelId },
      data: { playoutAnchor: anchor, playoutCursor: cursor, playoutState: JSON.stringify(state) },
    }),
  ])
  return created.length
}

/**
 * Clear a channel's future timeline and re-anchor it to now. By default this
 * KEEPS each rotation/block's saved position, so shows continue where they
 * left off instead of restarting at episode 1 — pass hard=true to also wipe
 * positions and start every item over from the beginning.
 */
export async function resetPlayout(channelId: number, hard = false): Promise<void> {
  const anchor = truncateToMinute(new Date())
  await prisma.$transaction([
    prisma.playoutItem.deleteMany({ where: { channelId } }),
    prisma.channel.update({
      where: { id: channelId },
      data: { playoutAnchor: anchor, playoutCursor: anchor, ...(hard ? { playoutState: null } : {}) },
    }),
  ])
}

/** Drop already-finished programs to keep the table small. */
export async function prunePlayout(channelId: number): Promise<void> {
  const cutoff = new Date(Date.now() - 3600 * 1000)
  await prisma.playoutItem.deleteMany({ where: { channelId, stopTime: { lt: cutoff } } })
}
