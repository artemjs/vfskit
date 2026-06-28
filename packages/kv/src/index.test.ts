import { describe, it, expect } from 'vitest'
import { runConformance } from '@vfskit/core/conformance'
import { toText } from '@vfskit/core'
import { kv, memKv, localStorageKv } from './index'

runConformance(() => kv({ store: memKv() }))

describe('kv', () => {
  it('persists across adapter instances over the same store', async () => {
    const store = memKv()
    await kv({ store }).write('/a', 'persisted')
    expect(toText(await kv({ store }).read('/a'))).toBe('persisted')
  })
  it('isolates by prefix', async () => {
    const store = memKv()
    await kv({ store, prefix: 'u1' }).write('/a', 'one')
    expect(await kv({ store, prefix: 'u2' }).exists('/a')).toBe(false)
  })
})

class MemStorage {
  m = new Map<string, string>()
  get length() { return this.m.size }
  key(i: number) { return [...this.m.keys()][i] ?? null }
  getItem(k: string) { return this.m.get(k) ?? null }
  setItem(k: string, v: string) { this.m.set(k, v) }
  removeItem(k: string) { this.m.delete(k) }
  clear() { this.m.clear() }
}

runConformance(() => kv({ store: localStorageKv(new MemStorage() as unknown as Storage) }))
