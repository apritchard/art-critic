import { describe, expect, it } from 'vitest'
import { isLocalHost } from './artCriticPlugin.ts'

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
