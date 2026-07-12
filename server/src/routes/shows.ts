import { Router } from 'express'
import type { Prisma } from '@prisma/client'
import { prisma } from '../db.js'

export const showsRouter = Router()

// GET /api/shows?libraryId=  -> one card per show in a TV library
showsRouter.get('/', async (req, res) => {
  const libraryId = req.query.libraryId ? Number(req.query.libraryId) : undefined
  const where: Prisma.MediaItemWhereInput = {
    type: 'episode',
    missing: false,
    showTitle: { not: null },
  }
  if (libraryId && !Number.isNaN(libraryId)) where.libraryId = libraryId

  const episodes = await prisma.mediaItem.findMany({
    where,
    select: { showTitle: true, season: true, year: true, durationSec: true, libraryId: true },
  })

  type Agg = {
    showTitle: string
    year: number | null
    seasons: Set<number>
    episodeCount: number
    totalDurationSec: number
    libraryId: number
  }
  const map = new Map<string, Agg>()
  for (const e of episodes) {
    const key = e.showTitle as string
    let agg = map.get(key)
    if (!agg) {
      agg = {
        showTitle: key,
        year: e.year,
        seasons: new Set(),
        episodeCount: 0,
        totalDurationSec: 0,
        libraryId: e.libraryId,
      }
      map.set(key, agg)
    }
    if (e.season != null) agg.seasons.add(e.season)
    agg.episodeCount++
    agg.totalDurationSec += e.durationSec ?? 0
    if (agg.year == null && e.year != null) agg.year = e.year
  }

  const shows = [...map.values()]
    .map((s) => ({
      showTitle: s.showTitle,
      year: s.year,
      seasonCount: s.seasons.size,
      episodeCount: s.episodeCount,
      totalDurationSec: s.totalDurationSec,
      libraryId: s.libraryId,
    }))
    .sort((a, b) => a.showTitle.localeCompare(b.showTitle))

  res.json({ shows })
})

// GET /api/shows/detail?show=NAME&libraryId=  -> seasons, each with its episodes
showsRouter.get('/detail', async (req, res) => {
  const show = typeof req.query.show === 'string' ? req.query.show : ''
  if (!show) return res.status(400).json({ error: 'show query param is required' })
  const libraryId = req.query.libraryId ? Number(req.query.libraryId) : undefined

  const where: Prisma.MediaItemWhereInput = { type: 'episode', showTitle: show }
  if (libraryId && !Number.isNaN(libraryId)) where.libraryId = libraryId

  const episodes = await prisma.mediaItem.findMany({
    where,
    orderBy: [{ season: 'asc' }, { episode: 'asc' }],
  })

  const seasonMap = new Map<number, typeof episodes>()
  for (const ep of episodes) {
    const key = ep.season ?? -1
    if (!seasonMap.has(key)) seasonMap.set(key, [])
    seasonMap.get(key)!.push(ep)
  }
  const seasons = [...seasonMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([season, eps]) => ({ season: season === -1 ? null : season, episodes: eps }))

  const year = episodes.find((e) => e.year != null)?.year ?? null
  res.json({ showTitle: show, year, episodeCount: episodes.length, seasons })
})
