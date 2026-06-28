import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, afterAll } from 'vitest'
import { nodeFs } from './index'

const roots: string[] = []
const mk = () => { const r = mkdtempSync(join(tmpdir(), 'vfskit-w-')); roots.push(r); return r }
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const until = async (cond: () => boolean, ms = 2000) => { for (let t = 0; t < ms; t += 10) { if (cond()) return; await wait(10) } }
afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }) })

describe('node-fs watch', () => {
  it('emits remove when a file is deleted', async () => {
    const fs = nodeFs(mk())
    await fs.write('/a', '1')
    const ev: string[] = []
    const off = fs.watch('/', (e) => ev.push(e.type + ':' + e.path))
    await wait(30)
    await fs.remove('/a')
    await until(() => ev.includes('remove:/a'))
    off()
    expect(ev).toContain('remove:/a')
  })
})
