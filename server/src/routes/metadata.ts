import { Router } from 'express'
import { prisma } from '../db.js'
import { enrichLibrary, getMetadataStatus, isEnriching } from '../metadata.js'

export const metadataRouter = Router()

metadataRouter.get('/status', (_req, res) => {
  res.json(getMetadataStatus())
})

metadataRouter.post('/:libraryId', async (req, res) => {
  if (isEnriching()) {
    return res.status(409).json({ error: 'A metadata fetch is already running.' })
  }
  const libraryId = Number(req.params.libraryId)
  const lib = await prisma.library.findUnique({ where: { id: libraryId } })
  if (!lib) return res.status(404).json({ error: 'Library not found.' })
  const force = req.query.force === '1' || req.query.force === 'true'

  // Fire-and-forget; client polls GET /api/metadata/status.
  enrichLibrary(libraryId, force).catch(() => {})
  res.status(202).json({ started: true, libraryId })
})
