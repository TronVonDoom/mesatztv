import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { prisma } from '../db.js'
import { assetsDir } from '../paths.js'
import { warmFiller, resolveFillerClipById } from '../stream.js'

export const fillersRouter = Router()

// Clamp an incoming Filler payload (owner is set separately on create).
function fillerData(body: Record<string, unknown>) {
  const style = ['animated', 'frosted', 'custom', 'logowall', 'pulse', 'retro', 'vintage'].includes(String(body?.style)) ? String(body.style) : 'frosted'
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

// In-memory generation progress, keyed by filler id (polled by the UI).
type GenState = { percent: number; done: boolean; error?: string; assetId?: number }
const genJobs = new Map<number, GenState>()

// Save a freshly-built clip as a Media asset (kind "filler"), reusing the
// filler's previous generated asset on regenerate.
async function registerGeneratedAsset(fillerId: number, name: string, clip: string, prevAssetId: number | null): Promise<number> {
  const size = fs.statSync(clip).size
  let asset = prevAssetId != null ? await prisma.asset.findUnique({ where: { id: prevAssetId } }) : null
  if (asset) {
    fs.copyFileSync(clip, path.join(assetsDir(), asset.filename))
    await prisma.asset.update({ where: { id: asset.id }, data: { name, sizeBytes: size } })
    return asset.id
  }
  asset = await prisma.asset.create({ data: { name, kind: 'filler', filename: 'pending', mime: 'video/mp4', sizeBytes: size } })
  const filename = `asset-${asset.id}.mp4`
  fs.copyFileSync(clip, path.join(assetsDir(), filename))
  await prisma.asset.update({ where: { id: asset.id }, data: { filename } })
  await prisma.filler.update({ where: { id: fillerId }, data: { generatedAssetId: asset.id } })
  return asset.id
}

// POST /api/fillers/:id/generate — kick off generation in the background (so the
// request returns immediately) and track progress. Poll the status endpoint.
fillersRouter.post('/:id/generate', async (req, res) => {
  const id = Number(req.params.id)
  const filler = await prisma.filler.findUnique({ where: { id } })
  if (!filler) return res.status(404).json({ error: 'Filler not found' })
  if (genJobs.get(id)?.done === false) return res.json({ started: true }) // already running

  genJobs.set(id, { percent: 0, done: false })
  const name = filler.name?.trim() || `${filler.style} filler`
  ;(async () => {
    try {
      const r = await resolveFillerClipById(id, (pct) => {
        const s = genJobs.get(id)
        if (s) s.percent = pct
      })
      if (!r?.clip || !fs.existsSync(r.clip)) throw new Error('Generation produced no clip — check the Logs.')
      const assetId = await registerGeneratedAsset(id, name, r.clip, filler.generatedAssetId)
      genJobs.set(id, { percent: 100, done: true, assetId })
    } catch (e) {
      genJobs.set(id, { percent: 100, done: true, error: e instanceof Error ? e.message : 'Generation failed' })
    }
  })()
  res.status(202).json({ started: true })
})

// GET /api/fillers/:id/generate/status — poll generation progress.
fillersRouter.get('/:id/generate/status', (req, res) => {
  const s = genJobs.get(Number(req.params.id))
  res.json(s ?? { idle: true })
})
