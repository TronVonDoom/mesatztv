import fs from 'node:fs/promises'
import path from 'node:path'
import type { LibraryKind } from './parse.js'

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'tbn']

export type Artwork = {
  posterPath: string | null
  showPosterPath: string | null
  seasonPosterPath: string | null
}

// Cache directory listings for the duration of a scan so show/season folders
// aren't re-read once per episode.
type DirCache = Map<string, string[] | null>

async function listFiles(dir: string, cache: DirCache): Promise<string[] | null> {
  if (cache.has(dir)) return cache.get(dir)!
  let files: string[] | null
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    files = entries.filter((e) => e.isFile()).map((e) => e.name)
  } catch {
    files = null
  }
  cache.set(dir, files)
  return files
}

/** Return the actual filename in `files` matching any base name + image ext (case-insensitive). */
function matchImage(files: string[] | null, baseNames: string[]): string | null {
  if (!files) return null
  const lower = files.map((f) => [f.toLowerCase(), f] as const)
  for (const base of baseNames) {
    for (const ext of IMAGE_EXTS) {
      const target = `${base}.${ext}`.toLowerCase()
      const hit = lower.find(([l]) => l === target)
      if (hit) return hit[1]
    }
  }
  return null
}

const FOLDER_POSTER_NAMES = ['poster', 'folder', 'cover', 'default']

/**
 * Detect local artwork next to a media file using Plex/Kodi/Jellyfin naming:
 *   Movie:   <movie folder>/poster.jpg | folder.jpg | <MovieName>.jpg
 *   Show:    <show folder>/poster.jpg | folder.jpg | show.jpg | banner.jpg
 *   Season:  <season folder>/poster.jpg  OR  <show folder>/Season01.jpg
 *   Episode: <season folder>/<EpisodeFile>.jpg | <EpisodeFile>-thumb.jpg
 */
export async function detectArtwork(
  filePath: string,
  libraryPath: string,
  kind: LibraryKind,
  season: number | null,
  cache: DirCache,
): Promise<Artwork> {
  const folder = path.dirname(filePath)
  const baseName = path.basename(filePath, path.extname(filePath))
  const rel = path.relative(libraryPath, filePath)
  const segments = rel.split(/[\\/]/).filter(Boolean)
  const showFolder = segments.length > 1 ? path.join(libraryPath, segments[0]) : null

  const art: Artwork = { posterPath: null, showPosterPath: null, seasonPosterPath: null }
  const join = (dir: string, name: string | null) => (name ? path.join(dir, name) : null)

  if (kind === 'movie') {
    const files = await listFiles(folder, cache)
    art.posterPath = join(folder, matchImage(files, [...FOLDER_POSTER_NAMES, 'movie', baseName]))
    return art
  }

  if (kind === 'tv') {
    // Episode thumbnail: same basename as the video, or "<base>-thumb".
    const seasonFiles = await listFiles(folder, cache)
    art.posterPath = join(folder, matchImage(seasonFiles, [baseName, `${baseName}-thumb`]))

    // Show poster from the top-level show folder.
    if (showFolder) {
      const showFiles = await listFiles(showFolder, cache)
      art.showPosterPath = join(
        showFolder,
        matchImage(showFiles, [...FOLDER_POSTER_NAMES, 'show', 'banner']),
      )
    }

    // Season poster: prefer the season folder, else "SeasonNN" in the show folder.
    let seasonPoster = join(folder, matchImage(seasonFiles, FOLDER_POSTER_NAMES))
    if (!seasonPoster && showFolder && season != null) {
      const showFiles = await listFiles(showFolder, cache)
      const nn = String(season).padStart(2, '0')
      seasonPoster = join(
        showFolder,
        matchImage(showFiles, [`Season${nn}`, `Season ${nn}`, `season${season}`, `Season${season}`]),
      )
    }
    art.seasonPosterPath = seasonPoster
    return art
  }

  // "other" — look for a sidecar image next to the clip.
  const files = await listFiles(folder, cache)
  art.posterPath = join(folder, matchImage(files, [...FOLDER_POSTER_NAMES, baseName]))
  return art
}
