import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { prisma } from '../db.js'
import { assetsDir } from '../paths.js'
import { warmFiller, resolveFillerClipById } from '../stream.js'

export const fillersRouter = Router()

// Clamp an incoming Filler payload (owner is set separately on create).
function fillerData(body: Record<string, unknown>) {
  const style = ['animated', 'frosted', 'custom'].includes(String(body?.style)) ? String(body.style) : 'frosted'
  return {
    name: body?.name ? String(body.name).trim() : null,
    style,
    assetId: body?.assetId != null && body.assetId !== '' ? Number(body.assetId) : null,
    audioAssetId: body?.audioAssetId != null && body.audioAssetId !== '' ? Number(body.audioAssetId) : null,
    durationMode: body?.durationMode === 'audio' ? 'audio' : 'fixed',
    durationSec: Math.max(5, Math.min(600, Number(body?.durationSec) || 30)),
  }
}

// GET /api/fillers?channelId=  or  ?timeBlockId=
fillersRouter.get('/', async (req, res) => {
  const channelId = req.query.channelId != null ? Number(req.query.channelId) : undefined
  const timeBlockId = req.query.timeBlockId != null ? Number(req.query.timeBlockId) : undefined
  const where = channelId != null ? { channelId } : timeBlockId != null ? { timeBlockId } : { id: -1 }
  res.json(await prisma.filler.findMany({ where, orderBy: { order: 'asc' } }))
})

// POST /api/fillers  { channelId? | timeBlockId?, ...filler fields }
fillersRouter.post('/', async (req, res) => {
  const channelId = req.body?.channelId != null ? Number(req.body.channelId) : null
  const timeBlockId = req.body?.timeBlockId != null ? Number(req.body.timeBlockId) : null
  if (channelId == null && timeBlockId == null) {
    return res.status(400).json({ error: 'channelId or timeBlockId is required' })
  }
  const max = await prisma.filler.aggregate({
    where: channelId != null ? { channelId } : { timeBlockId },
    _max: { order: true },
  })
  const f = await prisma.filler.create({
    data: { channelId, timeBlockId, ...fillerData(req.body ?? {}), order: (max._max.order ?? -1) + 1 },
  })
  warmFiller().catch(() => {}) // pre-generate in the background
  res.status(201).json(f)
})

fillersRouter.patch('/:id', async (req, res) => {
  const f = await prisma.filler.update({ where: { id: Number(req.params.id) }, data: fillerData(req.body ?? {}) }).catch(() => null)
  if (!f) return res.status(404).json({ error: 'Filler not found' })
  warmFiller().catch(() => {})
  res.json(f)
})

fillersRouter.delete('/:id', async (req, res) => {
  await prisma.filler.delete({ where: { id: Number(req.params.id) } }).catch(() => {})
  res.status(204).end()
})

// POST /api/fillers/:id/generate — build the branded clip and save it as a Media
// asset (kind "filler") so it's previewable (static) and reusable. Reuses the
// filler's previous generated asset on regenerate. Returns the asset.
fillersRouter.post('/:id/generate', async (req, res) => {
  const id = Number(req.params.id)
  const filler = await prisma.filler.findUnique({ where: { id } })
  if (!filler) return res.status(404).json({ error: 'Filler not found' })

  const r = await resolveFillerClipById(id).catch(() => null)
  if (!r?.clip || !fs.existsSync(r.clip)) return res.status(500).json({ error: 'Generation failed — check the Logs.' })

  const name = filler.name?.trim() || `${filler.style} filler`
  const size = fs.statSync(r.clip).size

  // Reuse the existing generated asset if it still exists, else make a new one.
  let asset = filler.generatedAssetId != null ? await prisma.asset.findUnique({ where: { id: filler.generatedAssetId } }) : null
  if (asset) {
    fs.copyFileSync(r.clip, path.join(assetsDir(), asset.filename))
    asset = await prisma.asset.update({ where: { id: asset.id }, data: { name, sizeBytes: size } })
  } else {
    asset = await prisma.asset.create({ data: { name, kind: 'filler', filename: 'pending', mime: 'video/mp4', sizeBytes: size } })
    const filename = `asset-${asset.id}.mp4`
    fs.copyFileSync(r.clip, path.join(assetsDir(), filename))
    asset = await prisma.asset.update({ where: { id: asset.id }, data: { filename } })
    await prisma.filler.update({ where: { id }, data: { generatedAssetId: asset.id } })
  }
  res.json({ asset: { id: asset.id, name: asset.name, kind: asset.kind, mime: asset.mime, sizeBytes: asset.sizeBytes, createdAt: asset.createdAt } })
})
