// Dev-server API: serves exports, config and game data from disk and persists UI state to state/user-state.json.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename, join } from 'node:path'
import type { Plugin } from 'vite'
import { refreshGameData } from './gameData.ts'

const CONFIG_FILE = 'genshin_artifact_config.json'
const DOMAINS_FILE = 'genshin_artifact_domains.json'
const GAME_DATA_FILE = join('data', 'game-data.json')

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

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => (data += chunk))
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
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
          server.ws.send({ type: 'custom', event: 'art-critic:exports-changed', data: { name: basename(file) } })
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
              const body = await readBody(req)
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
          send(res, 500, JSON.stringify({ error: String(err) }))
        }
      })
    },
  }
}
