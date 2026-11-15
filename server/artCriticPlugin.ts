// Dev-server API: serves exports, config and game data from disk, copies exports chosen in the page into imports/,
// and persists UI state to state/user-state.json.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename, join } from 'node:path'
import type { Plugin } from 'vite'
import { refreshGameData } from './gameData.ts'

const CONFIG_FILE = 'genshin_artifact_config.json'
const DOMAINS_FILE = 'genshin_artifact_domains.json'
const GAME_DATA_FILE = join('data', 'game-data.json')
/** Far above any real export (a full account is about 1 MB). */
const MAX_BODY_BYTES = 64 * 1024 * 1024

/** An error whose message is meant for the page, answered with this status instead of 500. */
export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function send(res: ServerResponse, status: number, body: string, type = 'application/json') {
  res.statusCode = status
  res.setHeader('Content-Type', type)
  res.setHeader('Cache-Control', 'no-store')
  res.end(body)
}

/**
 * True when a request is addressed to this machine by name or IP address. Anything else is another site reaching
 * the API through DNS rebinding. Vite's own host check runs after this plugin's middleware, so it doesn't cover /api.
 */
export function isLocalHost(host: string | undefined): boolean {
  if (!host) return false
  const name = host.toLowerCase().replace(/:\d+$/, '')
  if (name === 'localhost' || name.endsWith('.localhost')) return true
  // An IP address can't be rebound, so it's as safe as a local name.
  return /^\[[0-9a-f:.]+\]$/.test(name) || /^\d{1,3}(\.\d{1,3}){3}$/.test(name)
}

/**
 * True unless a browser says the request comes from a page on another site. A website can POST to localhost without
 * a CORS preflight, so the Host check alone doesn't stop it writing to imports/. Requests without an Origin don't
 * come from a page on another site: browsers always send one cross-origin.
 */
export function isLocalOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return true
  try {
    const url = new URL(origin)
    return (url.protocol === 'http:' || url.protocol === 'https:') && isLocalHost(url.host)
  } catch {
    return false // includes "null", sent by sandboxed frames and file:// pages
  }
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Kept as bytes until the end: decoding chunk by chunk would split characters that straddle two chunks.
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size <= MAX_BODY_BYTES) chunks.push(chunk)
    })
    req.on('end', () =>
      size > MAX_BODY_BYTES ? reject(new HttpError(413, 'That file is too big to be an export.')) : resolve(Buffer.concat(chunks)),
    )
    req.on('error', reject)
  })
}

/** The last segment of `requested`, made safe as a file name in imports/ and ending in .json. */
export function exportFileName(requested: string): string {
  const name = (requested.split(/[\\/]/).pop() ?? '')
    .replace(/[<>:"|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/, '') // Windows drops trailing dots and spaces, which would make ".." the parent folder
    .trim()
  if (!name) return 'export.json'
  return /\.json$/i.test(name) ? name : `${name}.json`
}

/**
 * Copies an export into imports/ and returns the name it has there. The same file loaded again is found rather than
 * copied twice. A different file whose name is taken gets " (2)", " (3)", … instead, so nothing in imports/ is ever
 * overwritten. `modified` (ms) is the original file's modified time, kept on the copy as Explorer does, because exports
 * are listed and picked newest first by it.
 */
export function saveExport(importsDir: string, requested: string, body: Buffer, modified?: number): string {
  const name = exportFileName(requested)
  let data: unknown
  try {
    data = JSON.parse(body.toString('utf8').replace(/^﻿/, ''))
  } catch {
    throw new HttpError(400, `${name} isn't a JSON file. Choose the .json that Irminsul writes.`)
  }
  if (typeof data !== 'object' || data === null || (data as { format?: unknown }).format !== 'GOOD') {
    throw new HttpError(400, `${name} isn't a GOOD export. Choose the .json that Irminsul writes.`)
  }

  mkdirSync(importsDir, { recursive: true })
  // By lower case, because Windows file names are: Export.json is the same file as export.json.
  const taken = new Map(readdirSync(importsDir).map((f) => [f.toLowerCase(), f]))
  const stem = name.slice(0, -'.json'.length)
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? name : `${stem} (${n}).json`
    const existing = taken.get(candidate.toLowerCase())
    if (existing === undefined) {
      const file = join(importsDir, candidate)
      // Written beside it and renamed, so the watcher never sees half a file (it ignores .tmp).
      const tmp = `${file}.tmp`
      writeFileSync(tmp, body)
      if (modified !== undefined && Number.isFinite(modified) && modified > 0) utimesSync(tmp, new Date(), new Date(modified))
      renameSync(tmp, file)
      return candidate
    }
    if (readFileSync(join(importsDir, existing)).equals(body)) return existing
  }
}

export function artCriticPlugin(root: string): Plugin {
  const importsDir = join(root, 'imports')
  const stateDir = join(root, 'state')
  const stateFile = join(stateDir, 'user-state.json')

  const listExports = () =>
    existsSync(importsDir)
      ? readdirSync(importsDir)
          .filter((f) => f.toLowerCase().endsWith('.json'))
          .map((name) => ({ name, mtime: statSync(join(importsDir, name)).mtimeMs }))
          .sort((a, b) => b.mtime - a.mtime)
      : []

  return {
    name: 'art-critic-api',
    configureServer(server) {
      server.watcher.add(importsDir)
      const notify = (file: string) => {
        if (file.startsWith(importsDir) && file.toLowerCase().endsWith('.json')) {
          // The modified time lets the page tell this file from the copy of it that it has already loaded.
          let mtime: number | undefined
          try {
            mtime = statSync(file).mtimeMs
          } catch {
            // gone again already; the page still hears about it
          }
          server.ws.send({ type: 'custom', event: 'art-critic:exports-changed', data: { name: basename(file), mtime } })
        }
      }
      server.watcher.on('add', notify)
      server.watcher.on('change', notify)

      // Weapon and ascension stats for ER totals; a failed refresh just keeps the file that's there.
      const gameDataFile = join(root, GAME_DATA_FILE)
      refreshGameData(gameDataFile)
        .then((updated) => updated && server.ws.send({ type: 'custom', event: 'art-critic:game-data-changed', data: {} }))
        .catch((err) => server.config.logger.warn(`art-critic: couldn't refresh game data (${err.message ?? err})`))

      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        if (!url.pathname.startsWith('/api/')) return next()
        if (!isLocalHost(req.headers.host)) return send(res, 403, JSON.stringify({ error: 'only local requests are served' }))
        if (req.method !== 'GET' && !isLocalOrigin(req.headers.origin)) {
          return send(res, 403, JSON.stringify({ error: 'only this page can change files' }))
        }
        try {
          if (url.pathname === '/api/exports' && req.method === 'GET') {
            return send(res, 200, JSON.stringify(listExports()))
          }
          const exportMatch = /^\/api\/exports\/(.+)$/.exec(url.pathname)
          if (exportMatch && req.method === 'GET') {
            // basename() keeps requests inside imports/.
            const file = join(importsDir, basename(decodeURIComponent(exportMatch[1])))
            if (!existsSync(file)) return send(res, 404, JSON.stringify({ error: 'not found' }))
            return send(res, 200, readFileSync(file, 'utf8'))
          }
          if (exportMatch && req.method === 'POST') {
            // The Load export button: the file's name in the path, its bytes as the body.
            const modified = Number(url.searchParams.get('modified')) // 0 when missing, which keeps today's time
            const name = saveExport(importsDir, decodeURIComponent(exportMatch[1]), await readBody(req), modified)
            return send(res, 200, JSON.stringify({ name }))
          }
          if (url.pathname === '/api/config' && req.method === 'GET') {
            return send(res, 200, readFileSync(join(root, CONFIG_FILE), 'utf8'))
          }
          if (url.pathname === '/api/domains' && req.method === 'GET') {
            const file = join(root, DOMAINS_FILE)
            if (!existsSync(file)) return send(res, 404, JSON.stringify({ error: 'not found' }))
            return send(res, 200, readFileSync(file, 'utf8'))
          }
          if (url.pathname === '/api/game-data' && req.method === 'GET') {
            if (!existsSync(gameDataFile)) return send(res, 404, JSON.stringify({ error: 'not found' }))
            return send(res, 200, readFileSync(gameDataFile, 'utf8'))
          }
          if (url.pathname === '/api/state') {
            if (req.method === 'GET') {
              return send(res, 200, existsSync(stateFile) ? readFileSync(stateFile, 'utf8') : '{}')
            }
            if (req.method === 'PUT') {
              const body = (await readBody(req)).toString('utf8')
              JSON.parse(body) // reject anything that isn't JSON before touching the file
              mkdirSync(stateDir, { recursive: true })
              const tmp = `${stateFile}.tmp`
              writeFileSync(tmp, body)
              renameSync(tmp, stateFile)
              return send(res, 204, '')
            }
          }
          send(res, 404, JSON.stringify({ error: 'unknown endpoint' }))
        } catch (err) {
          if (err instanceof HttpError) return send(res, err.status, JSON.stringify({ error: err.message }))
          send(res, 500, JSON.stringify({ error: String(err) }))
        }
      })
    },
  }
}
