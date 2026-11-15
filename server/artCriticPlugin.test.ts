import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { exportFileName, HttpError, isLocalHost, isLocalOrigin, saveExport } from './artCriticPlugin.ts'

describe('isLocalHost', () => {
  it('answers this machine by name or IP address, and nothing else', () => {
    for (const host of ['localhost:5317', 'LOCALHOST', 'app.localhost:5317', '127.0.0.1:5317', '[::1]:5317', '192.168.1.20:5317']) {
      expect(isLocalHost(host), host).toBe(true)
    }
    for (const host of [undefined, '', 'evil.example:5317', 'localhost.evil.example', '127.0.0.1.nip.io']) {
      expect(isLocalHost(host), String(host)).toBe(false)
    }
  })
})

describe('isLocalOrigin', () => {
  it('lets this page and non-browser clients change files, but not other sites', () => {
    for (const origin of [undefined, 'http://localhost:5317', 'http://127.0.0.1:5317', 'http://[::1]:5317']) {
      expect(isLocalOrigin(origin), String(origin)).toBe(true)
    }
    for (const origin of ['https://evil.example', 'http://localhost.evil.example', 'null', '', 'file:///C:/x.html']) {
      expect(isLocalOrigin(origin), origin).toBe(false)
    }
  })
})

describe('exportFileName', () => {
  it('keeps only a safe file name inside imports/', () => {
    expect(exportFileName('genshin_export_2026-11-13_15-34.json')).toBe('genshin_export_2026-11-13_15-34.json')
    expect(exportFileName('C:\\Users\\me\\Downloads\\export.json')).toBe('export.json')
    expect(exportFileName('../../state/user-state.json')).toBe('user-state.json')
    expect(exportFileName('..')).toBe('export.json')
    expect(exportFileName('')).toBe('export.json')
    expect(exportFileName('export')).toBe('export.json')
    expect(exportFileName('Export.JSON')).toBe('Export.JSON')
    expect(exportFileName('a:b?.json. ')).toBe('a_b_.json')
  })
})

describe('saveExport', () => {
  const good = (n: number) => Buffer.from(JSON.stringify({ format: 'GOOD', version: 2, artifacts: [], n }))
  let dir: string
  beforeEach(() => {
    dir = join(mkdtempSync(join(tmpdir(), 'art-critic-')), 'imports')
  })
  afterEach(() => rmSync(join(dir, '..'), { recursive: true, force: true }))

  it('copies the file byte for byte, creating imports/ if needed', () => {
    const body = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), good(1)]) // with a byte-order mark, as Notepad saves
    expect(saveExport(dir, 'export.json', body)).toBe('export.json')
    expect(readFileSync(join(dir, 'export.json')).equals(body)).toBe(true)
    expect(readdirSync(dir)).toEqual(['export.json']) // no .tmp left behind
  })

  it('reuses the same file loaded again, and never overwrites a different one', () => {
    expect(saveExport(dir, 'export.json', good(1))).toBe('export.json')
    expect(saveExport(dir, 'export.json', good(1))).toBe('export.json')
    expect(saveExport(dir, 'export.json', good(2))).toBe('export (2).json')
    expect(saveExport(dir, 'export.json', good(3))).toBe('export (3).json')
    expect(saveExport(dir, 'export.json', good(2))).toBe('export (2).json')
    expect(JSON.parse(readFileSync(join(dir, 'export.json'), 'utf8')).n).toBe(1)
    expect(readdirSync(dir).sort()).toEqual(['export (2).json', 'export (3).json', 'export.json'])
  })

  it('matches names the way Windows does, ignoring case, and answers with the name on disk', () => {
    saveExport(dir, 'export.json', good(1))
    expect(saveExport(dir, 'EXPORT.json', good(1))).toBe('export.json')
    expect(saveExport(dir, 'EXPORT.json', good(2))).toBe('EXPORT (2).json')
  })

  it("keeps the original's modified time, so exports still sort by when they were made", () => {
    const made = Date.UTC(2026, 0, 2, 3, 4, 5)
    saveExport(dir, 'old.json', good(1), made)
    expect(Math.round(statSync(join(dir, 'old.json')).mtimeMs)).toBe(made)
    saveExport(dir, 'now.json', good(2), 0)
    expect(statSync(join(dir, 'now.json')).mtimeMs).toBeGreaterThan(made)
  })

  it('refuses anything that is not a GOOD export, without writing it', () => {
    const refused = (body: string) => {
      try {
        saveExport(dir, 'notes.json', Buffer.from(body))
      } catch (e) {
        return e instanceof HttpError ? e.status : e
      }
      return 'saved'
    }
    expect(refused('not json')).toBe(400)
    expect(refused('{"format":"GOOD"')).toBe(400)
    expect(refused('null')).toBe(400)
    expect(refused('[]')).toBe(400)
    expect(refused('{"format":"other"}')).toBe(400)
    expect(readdirSync(join(dir, '..'))).toEqual([])
  })
})
