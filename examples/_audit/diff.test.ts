import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, afterAll } from 'vitest'
import { type VFS, isVfsError } from '@vfskit/core'
import { memory } from '@vfskit/memory'
import { nodeFs } from '@vfskit/node-fs'
import { s3, memoryS3 } from '@vfskit/s3'
import { kv, memKv } from '@vfskit/kv'
import { sqlite } from '@vfskit/sqlite'
import { opfs } from '@vfskit/opfs'
import { MockDir } from '../../packages/opfs/src/mock'

const roots: string[] = []
afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }) })

const adapters: Record<string, () => VFS> = {
  memory: () => memory(),
  nodeFs: () => { const r = mkdtempSync(join(tmpdir(), 'vfskit-aud-')); roots.push(r); return nodeFs(r) },
  s3: () => s3({ client: memoryS3() }),
  kv: () => kv({ store: memKv() }),
  sqlite: () => sqlite(':memory:'),
  opfs: () => opfs(new MockDir() as unknown as FileSystemDirectoryHandle),
}

async function outcome(fn: () => Promise<unknown>): Promise<string> {
  try { const v = await fn(); return v === undefined ? 'ok' : 'ok:' + JSON.stringify(v) }
  catch (e) { return isVfsError(e) ? 'E:' + e.code : 'E:' + ((e as Error)?.name ?? 'unknown') }
}

type Scn = { name: string; run: (fs: VFS) => Promise<unknown>; cap?: 'conditionalWrite' }
const S: Scn[] = [
  { name: 'write into missing dir', run: (fs) => fs.write('/nope/a', 'x') },
  { name: 'write onto existing dir', run: async (fs) => { await fs.mkdir('/d'); return fs.write('/d', 'x') } },
  { name: 'write under a file parent', run: async (fs) => { await fs.write('/f', '1'); return fs.write('/f/a', 'x') } },
  { name: 'read a directory', run: async (fs) => { await fs.mkdir('/d'); return fs.read('/d') } },
  { name: 'mkdir over existing file', run: async (fs) => { await fs.write('/f', '1'); return fs.mkdir('/f') } },
  { name: 'mkdir missing parent', run: (fs) => fs.mkdir('/nope/d') },
  { name: 'mkdir recursive existing file as leaf', run: async (fs) => { await fs.write('/f', '1'); return fs.mkdir('/f', { recursive: true }) } },
  { name: 'remove root', run: (fs) => fs.remove('/') },
  { name: 'remove root recursive', run: (fs) => fs.remove('/', { recursive: true }) },
  { name: 'mkdir root', run: (fs) => fs.mkdir('/') },
  { name: 'write root', run: (fs) => fs.write('/', 'x') },
  { name: 'read root', run: (fs) => fs.read('/') },
  { name: 'stat root type', run: async (fs) => (await fs.stat('/')).type },
  { name: 'list root count', run: async (fs) => (await fs.list('/')).length },
  { name: 'exists missing', run: (fs) => fs.exists('/nope') },
  { name: 'move dest parent missing', run: async (fs) => { await fs.write('/a', '1'); return fs.move('/a', '/nope/b') } },
  { name: 'copy dest parent missing', run: async (fs) => { await fs.write('/a', '1'); return fs.copy('/a', '/nope/b') } },
  { name: 'move dest parent is file', run: async (fs) => { await fs.write('/a', '1'); await fs.write('/f', '2'); return fs.move('/a', '/f/b') } },
  { name: 'setMeta on missing', run: (fs) => fs.setMeta('/nope', { a: 1 }) },
  { name: 'getMeta on missing', run: (fs) => fs.getMeta('/nope') },
  { name: 'empty write then size', run: async (fs) => { await fs.write('/e', new Uint8Array(0)); return (await fs.stat('/e')).size } },
  { name: 'ifMatch on missing file', cap: 'conditionalWrite', run: (fs) => fs.write('/a', 'x', { ifMatch: '0' }) },
  { name: 'ifMatch empty-string on missing', cap: 'conditionalWrite', run: (fs) => fs.write('/a', 'x', { ifMatch: '' }) },
  { name: 'ifAbsent on missing', run: (fs) => fs.write('/a', 'x', { ifAbsent: true }) },
  { name: 'setMeta changes version?', cap: 'conditionalWrite', run: async (fs) => { await fs.write('/a', '1'); const v1 = (await fs.stat('/a')).version; await fs.setMeta('/a', { x: 1 }); const v2 = (await fs.stat('/a')).version; return v1 === v2 ? 'same' : 'changed' } },
  { name: 'copy bumps version?', cap: 'conditionalWrite', run: async (fs) => { await fs.write('/a', '1'); const v1 = (await fs.stat('/a')).version; await fs.copy('/a', '/b'); const v2 = (await fs.stat('/b')).version; return v1 === v2 ? 'same' : 'changed' } },
  { name: 'double-slash normalize', run: async (fs) => { await fs.write('//x//y', '1'); return (await fs.exists('/x/y')) } },
  { name: 'list does not leak hidden', run: async (fs) => { await fs.write('/a', '1', { meta: { m: 1 } }); return (await fs.list('/')).map((e) => e.name).sort().join(',') } },
  { name: 'remove then exists', run: async (fs) => { await fs.write('/a', '1'); await fs.remove('/a'); return fs.exists('/a') } },
  { name: 'stat missing', run: (fs) => fs.stat('/nope') },
]

describe('cross-adapter differential audit', () => {
  it('all adapters agree on every scenario', async () => {
    const names = Object.keys(adapters)
    const divergences: string[] = []
    for (const scn of S) {
      const results: Record<string, string> = {}
      for (const n of names) {
        const fs = adapters[n]()
        if (scn.cap && !fs.capabilities()[scn.cap]) continue
        results[n] = await outcome(() => scn.run(fs) as Promise<unknown>)
      }
      const vals = new Set(Object.values(results))
      if (vals.size > 1) divergences.push(`${scn.name}: ${names.map((n) => `${n}=${results[n]}`).join('  ')}`)
    }
    if (divergences.length) console.log('\nDIVERGENCES:\n' + divergences.join('\n') + '\n')
    expect(divergences).toEqual([])
  })
})
