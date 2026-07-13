import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { prisma } from '../db.js'
import { logosDir } from '../paths.js'

export const logosRouter = Router()

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

logosRouter.get('/', async (_req, res) => {
  const logos = await prisma.logo.findMany({ orderBy: { createdAt: 'desc' } })
  res.json(logos.map((l) => ({ id: l.id, name: l.name, mime: l.mime })))
})

// Upload via a data URL (no multipart dependency needed).
logosRouter.post('/', async (req, res) => {
  const name = String(req.body?.name ?? '').trim()
  const dataUrl = String(req.body?.dataUrl ?? '')
  const m = dataUrl.match(/^data:(image\/[a-z+]+);base64,(.+)$/i)
  if (!name || !m) return res.status(400).json({ error: 'name and an image file are required' })
  const mime = m[1].toLowerCase()
  const ext = EXT[mime]
  if (!ext) return res.status(400).json({ error: 'Unsupported image type (use PNG, JPG, WEBP, or GIF).' })
  const buf = Buffer.from(m[2], 'base64')
  if (buf.length > 5 * 1024 * 1024) return res.status(400).json({ error: 'Image too large (max 5 MB).' })

  const logo = await prisma.logo.create({ data: { name, filename: 'pending', mime } })
  const filename = `logo-${logo.id}.${ext}`
  fs.writeFileSync(path.join(logosDir(), filename), buf)
  await prisma.logo.update({ where: { id: logo.id }, data: { filename } })
  res.status(201).json({ id: logo.id, name, mime })
})

logosRouter.get('/:id/image', async (req, res) => {
  const logo = await prisma.logo.findUnique({ where: { id: Number(req.params.id) } })
  if (!logo) return res.status(404).end()
  const file = path.join(logosDir(), logo.filename)
  if (!fs.existsSync(file)) return res.status(404).end()
  res.setHeader('Cache-Control', 'public, max-age=86400')
  res.type(logo.mime)
  res.sendFile(file)
})

logosRouter.delete('/:id', async (req, res) => {
  const id = Number(req.params.id)
  const logo = await prisma.logo.findUnique({ where: { id } })
  if (logo) {
    const file = path.join(logosDir(), logo.filename)
    fs.rm(file, () => {})
    await prisma.logo.delete({ where: { id } }).catch(() => {})
  }
  res.status(204).end()
})
