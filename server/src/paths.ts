import fs from 'node:fs'
import path from 'node:path'

export function dataDir(): string {
  const url = process.env.DATABASE_URL || ''
  const dir = url.startsWith('file:/') ? path.dirname(url.slice(5)) : path.join(process.cwd(), 'data')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function logosDir(): string {
  const d = path.join(dataDir(), 'logos')
  fs.mkdirSync(d, { recursive: true })
  return d
}

export function assetsDir(): string {
  const d = path.join(dataDir(), 'assets')
  fs.mkdirSync(d, { recursive: true })
  return d
}

// Downloaded TMDB artwork, so guide clients fetch posters from us on the LAN
// rather than needing their own route to the internet.
export function tmdbCacheDir(): string {
  const d = path.join(dataDir(), 'tmdb-cache')
  fs.mkdirSync(d, { recursive: true })
  return d
}
