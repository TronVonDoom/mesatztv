import { Router } from 'express'
import fs from 'node:fs/promises'
import path from 'node:path'

export const fsRouter = Router()

// GET /api/fs?path=/media  -> list subdirectories for the directory picker.
// Read-only, directories only. Defaults to /media (the mounted library root).
fsRouter.get('/', async (req, res) => {
  const requested =
    typeof req.query.path === 'string' && req.query.path.trim()
      ? req.query.path
      : '/media'
  const target = path.resolve(requested)

  try {
    const entries = await fs.readdir(target, { withFileTypes: true })
    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => ({ name: e.name, path: path.join(target, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name))
    const parent = path.dirname(target)
    res.json({
      path: target,
      parent: parent === target ? null : parent,
      dirs,
    })
  } catch {
    res.status(400).json({ error: `Cannot open folder: ${target}` })
  }
})
