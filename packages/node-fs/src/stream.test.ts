import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, afterAll } from 'vitest'
import { collect, readStream } from '@vfskit/core'
import { nodeFs } from './index'

const roots: string[] = []
const mk = () => { const r = mkdtempSync(join(tmpdir(), 'vfskit-s-')); roots.push(r); return r }
afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }) })

describe('node-fs native streaming', () => {
  it('reads a large file back in multiple chunks', async () => {
    const fs = nodeFs(mk())
    const big = new Uint8Array(256 * 1024).fill(65)
    await fs.write('/big', big)
    let chunks = 0
    const r = (await readStream(fs, '/big')).getReader()
    let total = 0
    for (;;) { const { done, value } = await r.read(); if (done) break; chunks++; total += value!.length }
    expect(total).toBe(big.length)
    expect(chunks).toBeGreaterThan(1)
  })
  it('round-trips via collect helper', async () => {
    const fs = nodeFs(mk())
    await fs.write('/a', 'hello stream')
    expect(new TextDecoder().decode(await collect(await readStream(fs, '/a')))).toBe('hello stream')
  })
})
