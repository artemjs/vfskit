import { describe, it, expect } from 'vitest'
import { runConformance } from '@vfskit/core/conformance'
import { toText, type VFS } from '@vfskit/core'
import { memory } from '@vfskit/memory'
import { cache } from './index'

runConformance(() => cache(memory()))

describe('cache', () => {
  it('serves reads from cache without hitting inner again', async () => {
    const inner = memory()
    let reads = 0
    const counting: VFS = { ...inner, read: (p, o) => { reads++; return inner.read(p, o) } }
    const fs = cache(counting)
    await fs.write('/a', 'hi')
    await fs.read('/a'); await fs.read('/a')
    expect(reads).toBe(0)
  })
  it('invalidates on remove so stale data is not served', async () => {
    const fs = cache(memory())
    await fs.write('/a', 'hi')
    await fs.read('/a')
    await fs.remove('/a')
    let err: unknown
    try { await fs.read('/a') } catch (e) { err = e }
    expect(err).toBeTruthy()
  })
  it('reflects a fresh write through the cache', async () => {
    const fs = cache(memory())
    await fs.write('/a', '1')
    expect(toText(await fs.read('/a'))).toBe('1')
    await fs.write('/a', '2')
    expect(toText(await fs.read('/a'))).toBe('2')
  })
})
