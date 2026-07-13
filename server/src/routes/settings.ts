import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { getTmdbKey, setTmdbKey, validateKey } from '../tmdb.js'
import { generateFiller } from '../stream.js'
import { prisma } from '../db.js'

export const settingsRouter = Router()

function dataDir(): string {
  const url = process.env.DATABASE_URL || ''
  const dir = url.startsWith('file:/') ? path.dirname(url.slice(5)) : path.join(process.cwd(), 'data')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}
const getSetting = async (k: string) => (await prisma.setting.findUnique({ where: { key: k } }))?.value ?? null
async function setSetting(k: string, v: string | null) {
  if (v == null) await prisma.setting.deleteMany({ where: { key: k } })
  else await prisma.setting.upsert({ where: { key: k }, create: { key: k, value: v }, update: { value: v } })
}

settingsRouter.get('/', async (_req, res) => {
  const key = await getTmdbKey()
  res.json({ tmdbConfigured: !!key, fillerPath: await getSetting('filler_path') })
})

// Generate an ambient station-ID filler clip and use it.
settingsRouter.post('/filler/generate', async (_req, res) => {
  const out = path.join(dataDir(), 'filler.mp4')
  try {
    await generateFiller(out)
    await setSetting('filler_path', out)
    res.json({ ok: true, path: out })
  } catch {
    res.status(500).json({ error: 'Could not generate filler (ffmpeg failed).' })
  }
})

// Point filler at a user-provided clip (empty clears it -> uses auto default).
settingsRouter.post('/filler', async (req, res) => {
  const p = String(req.body?.path ?? '').trim()
  if (!p) {
    await setSetting('filler_path', null)
    return res.json({ ok: true, path: null })
  }
  if (!fs.existsSync(p)) return res.status(400).json({ error: `File not found: ${p}` })
  await setSetting('filler_path', p)
  res.json({ ok: true, path: p })
})

// Validate and save the TMDB API key in one step.
settingsRouter.post('/tmdb', async (req, res) => {
  const apiKey = String(req.body?.apiKey ?? '').trim()
  if (!apiKey) return res.status(400).json({ error: 'apiKey is required' })
  const valid = await validateKey(apiKey)
  if (!valid) {
    return res.status(400).json({ error: 'TMDB rejected that key. Double-check it and try again.' })
  }
  await setTmdbKey(apiKey)
  res.json({ ok: true, tmdbConfigured: true })
})
