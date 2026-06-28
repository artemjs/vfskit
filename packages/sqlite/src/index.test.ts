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
})
