import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, afterAll } from 'vitest'
import { nodeFs, encrypt, readStream, writeStream, collect, toBytes, toText } from './index'

const roots: string[] = []
const mk = () => { const r = mkdtempSync(join(tmpdir(), 'vfskit-es-')); roots.push(r); return r }
afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }) })

describe('streaming through encrypt over a streaming adapter', () => {
  it('stays correct: stored bytes are ciphertext, stream yields plaintext', async () => {
    const disk = nodeFs(mk())
    const fs = encrypt(disk, { key: new Uint8Array(32).fill(9) })
    const ws = await writeStream(fs, '/secret.txt'); const w = ws.getWriter()
    await w.write(toBytes('top ')); await w.write(toBytes('secret')); await w.close()
    expect(toText(await collect(await readStream(fs, '/secret.txt')))).toBe('top secret')
    expect(toText(await disk.read('/secret.txt')).includes('secret')).toBe(false)
  })
})
