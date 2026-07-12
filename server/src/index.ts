import express from 'express'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

const app = express()
const PORT = Number(process.env.PORT ?? 8688)
const VERSION = process.env.APP_VERSION ?? '0.1.0'
const startedAt = Date.now()

// --- ffmpeg detection -------------------------------------------------------
// The streaming pipeline (later milestones) depends on ffmpeg being present in
// the container. Probe it once at startup and expose the result via /api/health
// so you can confirm the image is built correctly from the landing page.
let ffmpegAvailable = false

function checkFfmpeg(): Promise<void> {
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', ['-version'])
    proc.on('error', () => {
      ffmpegAvailable = false
      resolve()
    })
    proc.on('close', (code) => {
      ffmpegAvailable = code === 0
      resolve()
    })
  })
}

// --- API --------------------------------------------------------------------
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: VERSION,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    node: process.version,
    ffmpeg: ffmpegAvailable,
  })
})

// --- Static frontend (production only) --------------------------------------
// In production the compiled backend lives at /app/dist and the built React app
// is copied to /app/public. In dev, Vite serves the frontend on :5173 instead.
const publicDir = path.join(process.cwd(), 'public')
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir))
  // SPA fallback: send index.html for any non-API route.
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next()
    res.sendFile(path.join(publicDir, 'index.html'))
  })
}

// --- Boot -------------------------------------------------------------------
checkFfmpeg().then(() => {
  app.listen(PORT, () => {
    console.log(`MeSatzTV v${VERSION} listening on http://0.0.0.0:${PORT}`)
    console.log(`ffmpeg available: ${ffmpegAvailable}`)
  })
})
