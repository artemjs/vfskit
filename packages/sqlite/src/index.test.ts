import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, afterAll } from 'vitest'
import { toText } from '@vfskit/core'
import { runConformance } from '@vfskit/core/conformance'
import { sqlite } from './index'

runConformance(() => sqlite(':memory:'))

const dirs: string[] = []
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })

describe('sqlite', () => {
  it('persists to a real .db file across connections', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vfskit-sql-')); dirs.push(dir)
    const file = join(dir, 'store.db')
    await sqlite(file).write('/a', 'durable', { meta: { k: 'v' } })
    const fs2 = sqlite(file)
    expect(toText(await fs2.read('/a'))).toBe('durable')
    expect((await fs2.getMeta('/a')).k).toBe('v')
  })
  it('handles LIKE-special characters in paths without losing the subtree', async () => {
    const fs = sqlite(':memory:')
    for (const d of ['/a\\b', '/p%c', '/u_d']) {
      await fs.mkdir(d)
      await fs.write(d + '/x', '1')
      expect((await fs.list(d)).map((e) => e.name)).toEqual(['x'])
      let err: unknown
      try { await fs.remove(d) } catch (e) { err = e }
      expect(err).toBeTruthy()
      await fs.remove(d, { recursive: true })
      expect(await fs.exists(d)).toBe(false)
    }
  })
})
