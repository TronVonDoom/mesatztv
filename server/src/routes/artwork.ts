import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { prisma } from '../db.js'

export const artworkRouter = Router()

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.tbn': 'image/jpeg',
}

// GET /api/artwork/:id?type=poster|show|season
// Streams a local artwork file — but only paths recorded on the item, so this
// can't be used to read arbitrary files.
artworkRouter.get('/:id', async (req, res) => {
  const id = Number(req.params.id)
  if (Number.isNaN(id)) return res.status(400).end()

  const item = await prisma.mediaItem.findUnique({
    where: { id },
    select: { posterPath: true, showPosterPath: true, seasonPosterPath: true },
  })
  if (!item) return res.status(404).end()

  const type = req.query.type
  const filePath =
    type === 'show'
      ? item.showPosterPath
      : type === 'season'
        ? item.seasonPosterPath
        : item.posterPath

  if (!filePath || !fs.existsSync(filePath)) return res.status(404).end()

  res.setHeader('Cache-Control', 'public, max-age=86400')
  res.type(MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream')
  res.sendFile(filePath, (err) => {
    if (err && !res.headersSent) res.status(404).end()
  })
})
