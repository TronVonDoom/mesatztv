import { Router } from 'express'
import { prisma } from '../db.js'
import { getScanStatus, isScanning, scanLibrary } from '../scanner/scanner.js'

export const scanRouter = Router()

scanRouter.get('/status', (_req, res) => {
  res.json(getScanStatus())
})

scanRouter.post('/:libraryId', async (req, res) => {
  if (isScanning()) {
    return res.status(409).json({ error: 'A scan is already running.' })
  }
  const libraryId = Number(req.params.libraryId)
  const lib = await prisma.library.findUnique({ where: { id: libraryId } })
  if (!lib) return res.status(404).json({ error: 'Library not found.' })

  const force = req.query.force === '1' || req.query.force === 'true'
  // Fire-and-forget; the client polls GET /api/scan/status for progress.
  scanLibrary(libraryId, force).catch(() => {})
  res.status(202).json({ started: true, libraryId })
})
