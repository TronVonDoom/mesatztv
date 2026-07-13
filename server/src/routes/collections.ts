import { Router } from 'express'
import { prisma } from '../db.js'
import { collectionCount, collectionWhere } from '../collections.js'

export const collectionsRouter = Router()

collectionsRouter.get('/', async (_req, res) => {
  const cols = await prisma.collection.findMany({ orderBy: { createdAt: 'asc' } })
  const withCounts = await Promise.all(
    cols.map(async (c) => ({ ...c, itemCount: await collectionCount(c) })),
  )
  res.json(withCounts)
})

collectionsRouter.post('/', async (req, res) => {
  const { name, libraryId, filterType, filterShow, filterSearch, filterGenre } = req.body ?? {}
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' })
  const c = await prisma.collection.create({
    data: {
      name: String(name).trim(),
      libraryId: libraryId ? Number(libraryId) : null,
      filterType: filterType || null,
      filterShow: filterShow || null,
      filterSearch: filterSearch || null,
      filterGenre: filterGenre || null,
    },
  })
  res.status(201).json(c)
})

collectionsRouter.get('/:id/preview', async (req, res) => {
  const id = Number(req.params.id)
  const c = await prisma.collection.findUnique({ where: { id } })
  if (!c) return res.status(404).json({ error: 'Not found' })
  const [count, sample] = await Promise.all([
    collectionCount(c),
    prisma.mediaItem.findMany({
      where: collectionWhere(c),
      take: 12,
      orderBy: [{ showTitle: 'asc' }, { season: 'asc' }, { episode: 'asc' }, { title: 'asc' }],
      select: { id: true, title: true, showTitle: true, season: true, episode: true, type: true, durationSec: true },
    }),
  ])
  res.json({ count, sample })
})

collectionsRouter.delete('/:id', async (req, res) => {
  const id = Number(req.params.id)
  const [rotations, blocks] = await Promise.all([
    prisma.rotationItem.count({ where: { collectionId: id } }),
    prisma.timeBlock.count({ where: { collectionId: id } }),
  ])
  if (rotations + blocks > 0) {
    return res.status(409).json({ error: 'Collection is used by a channel. Remove it there first.' })
  }
  await prisma.collection.delete({ where: { id } }).catch(() => {})
  res.status(204).end()
})
