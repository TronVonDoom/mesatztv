import { PrismaClient } from '@prisma/client'

// Local-dev fallback. In Docker/production DATABASE_URL is always set (compose +
// Dockerfile ENV), so this only kicks in when running the app directly.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'file:./dev.db'
}

// Serialize on a single SQLite connection. Combined with WAL (below) this lets
// multiple concurrent viewers stream at once without hitting "database is
// locked" errors: readers never block the writer, and the two build/prune
// writes that fire when a new viewer connects can't collide with an in-flight
// query on another stream. Queries are short (the streaming loop only touches
// the DB between programs), so a single connection is plenty.
if (process.env.DATABASE_URL.startsWith('file:') && !/[?&]connection_limit=/.test(process.env.DATABASE_URL)) {
  process.env.DATABASE_URL += (process.env.DATABASE_URL.includes('?') ? '&' : '?') + 'connection_limit=1'
}

// Single shared Prisma client for the whole app.
export const prisma = new PrismaClient()

/**
 * Enable WAL journaling + a busy timeout so concurrent access doesn't error.
 * WAL is persisted in the DB file header (set once); busy_timeout is per
 * connection. Call once at boot, before serving requests.
 */
export async function initDb(): Promise<void> {
  try {
    await prisma.$executeRawUnsafe('PRAGMA journal_mode=WAL;')
    await prisma.$executeRawUnsafe('PRAGMA busy_timeout=8000;')
    await prisma.$executeRawUnsafe('PRAGMA synchronous=NORMAL;')
  } catch {
    /* non-SQLite or pragma unsupported — safe to ignore */
  }
}
