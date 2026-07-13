import type { Prisma, MediaItem } from '@prisma/client'
import { prisma } from './db.js'

export type CollectionFilter = {
  libraryId?: number | null
  filterType?: string | null
  filterShow?: string | null
  filterSearch?: string | null
  filterGenre?: string | null
}

export type PlaybackOrder = 'chronological' | 'shuffle'

// Only playable items: present on disk and with a known duration.
export function collectionWhere(c: CollectionFilter): Prisma.MediaItemWhereInput {
  const where: Prisma.MediaItemWhereInput = { missing: false, durationSec: { gt: 0 } }
  if (c.libraryId) where.libraryId = c.libraryId
  if (c.filterType) where.type = c.filterType
  if (c.filterShow) where.showTitle = c.filterShow
  if (c.filterGenre) where.genres = { contains: c.filterGenre }
  if (c.filterSearch) {
    where.OR = [
      { title: { contains: c.filterSearch } },
      { showTitle: { contains: c.filterSearch } },
    ]
  }
  return where
}

export function collectionCount(c: CollectionFilter): Promise<number> {
  return prisma.mediaItem.count({ where: collectionWhere(c) })
}

// Stable integer hash for deterministic shuffles.
function hash(n: number): number {
  let x = (n ^ 0x9e3779b9) >>> 0
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b)
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b)
  return (x ^ (x >>> 16)) >>> 0
}

function seededShuffle<T extends { id: number }>(arr: T[], seed: number): T[] {
  return [...arr]
    .map((x) => ({ x, k: hash(x.id ^ seed) }))
    .sort((a, b) => a.k - b.k)
    .map((o) => o.x)
}

/** Resolve a collection to an ordered, playable list of media items. */
export async function resolveCollection(
  c: CollectionFilter,
  order: PlaybackOrder,
  seed = 0,
): Promise<MediaItem[]> {
  const items = await prisma.mediaItem.findMany({
    where: collectionWhere(c),
    orderBy: [
      { showTitle: 'asc' },
      { season: 'asc' },
      { episode: 'asc' },
      { year: 'asc' },
      { title: 'asc' },
    ],
  })
  return order === 'shuffle' ? seededShuffle(items, seed) : items
}
