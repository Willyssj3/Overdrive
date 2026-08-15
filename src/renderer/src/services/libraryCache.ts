import type { SongMetadata } from '../types'

const DATABASE_NAME = 'octave-library-cache'
const DATABASE_VERSION = 1
const STORE_NAME = 'libraries'

export interface CachedLibrarySong {
  id: string
  path: string
  folderName: string
  metadata: SongMetadata
  addedAt?: number
}

interface CachedLibrary {
  folderPath: string
  songs: CachedLibrarySong[]
  updatedAt: number
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'folderPath' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Failed to open library cache'))
  })
}

// Cache entries written before the song.ini string-coercion fix may still have
// a number where a purely-numeric title/artist ("11", "80s") was misread as
// one -- sanitize on read so old IndexedDB entries can't reintroduce the
// "value.trim is not a function" crash after the source of truth was fixed.
function sanitizeCachedSong(song: CachedLibrarySong): CachedLibrarySong {
  const m = song.metadata as unknown as Record<string, unknown>
  return {
    ...song,
    metadata: {
      ...song.metadata,
      name: String(m.name ?? song.folderName ?? ''),
      artist: String(m.artist ?? 'Unknown Artist'),
      ...(m.album !== undefined ? { album: String(m.album) } : {}),
      ...(m.genre !== undefined ? { genre: String(m.genre) } : {}),
      ...(m.year !== undefined ? { year: String(m.year) } : {}),
      ...(m.charter !== undefined ? { charter: String(m.charter) } : {})
    }
  }
}

export async function readLibraryCache(folderPath: string): Promise<CachedLibrarySong[]> {
  const database = await openDatabase()
  try {
    const songs = await new Promise<CachedLibrarySong[]>((resolve, reject) => {
      const request = database.transaction(STORE_NAME).objectStore(STORE_NAME).get(folderPath)
      request.onsuccess = () => resolve((request.result as CachedLibrary | undefined)?.songs ?? [])
      request.onerror = () => reject(request.error ?? new Error('Failed to read library cache'))
    })
    return songs.map(sanitizeCachedSong)
  } finally {
    database.close()
  }
}

export async function writeLibraryCache(
  folderPath: string,
  songs: CachedLibrarySong[]
): Promise<void> {
  const database = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).put({ folderPath, songs, updatedAt: Date.now() })
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('Failed to write cache'))
      transaction.onabort = () => reject(transaction.error ?? new Error('Library cache write aborted'))
    })
  } finally {
    database.close()
  }
}
