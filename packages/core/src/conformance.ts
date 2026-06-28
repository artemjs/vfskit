import type { VFS } from './types'
import { toText, toBytes } from './bytes'
import { isVfsError } from './errors'
import { readStream, writeStream, collect } from './stream'

function fail(m: string): never { throw new Error('conformance: ' + m) }
function ok(v: unknown, m = 'expected truthy') { if (!v) fail(m) }
function eq(a: unknown, b: unknown, m?: string) { if (a !== b) fail(m ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`) }
async function code(fn: () => Promise<unknown>, c: string) {
  let e: unknown
  try { await fn() } catch (x) { e = x }
  ok(isVfsError(e) && e.code === c, `expected error ${c}, got ${isVfsError(e) ? e.code : e}`)
}
async function throws(fn: () => Promise<unknown>) {
  let e: unknown
  try { await fn() } catch (x) { e = x }
  ok(e, 'expected throw')
}
async function waitFor(cond: () => boolean, ms = 2000) {
  const step = 10
  for (let t = 0; t < ms; t += step) { if (cond()) return; await new Promise((r) => setTimeout(r, step)) }
}

export interface ConformanceCase { name: string; run(make: () => VFS): Promise<void> }

export const conformanceCases: ConformanceCase[] = [
  { name: 'writes and reads a file', async run(make) {
    const fs = make(); await fs.write('/a.txt', 'hello'); eq(toText(await fs.read('/a.txt')), 'hello') } },
  { name: 'reports existence', async run(make) {
    const fs = make(); eq(await fs.exists('/a.txt'), false); await fs.write('/a.txt', 'x'); eq(await fs.exists('/a.txt'), true) } },
  { name: 'stats a file', async run(make) {
    const fs = make(); await fs.write('/a.txt', 'hello'); const s = await fs.stat('/a.txt'); eq(s.type, 'file'); ok(s.size > 0) } },
  { name: 'throws NOT_FOUND for missing read', async run(make) {
    const fs = make(); await code(() => fs.read('/nope'), 'NOT_FOUND') } },
  { name: 'lists directory children', async run(make) {
    const fs = make(); await fs.mkdir('/d'); await fs.write('/d/a', '1'); await fs.write('/d/b', '2')
    eq((await fs.list('/d')).map((e) => e.name).sort().join(','), 'a,b') } },
  { name: 'lists recursively', async run(make) {
    const fs = make(); await fs.mkdir('/d'); await fs.mkdir('/d/sub'); await fs.write('/d/sub/a', '1')
    ok((await fs.list('/d', { recursive: true })).some((e) => e.path === '/d/sub/a')) } },
  { name: 'removes a file', async run(make) {
    const fs = make(); await fs.write('/a', '1'); await fs.remove('/a'); eq(await fs.exists('/a'), false) } },
  { name: 'requires recursive to remove a non-empty dir', async run(make) {
    const fs = make(); await fs.mkdir('/d'); await fs.write('/d/a', '1')
    await throws(() => fs.remove('/d')); await fs.remove('/d', { recursive: true }); eq(await fs.exists('/d'), false) } },
  { name: 'moves a file', async run(make) {
    const fs = make(); await fs.write('/a', '1'); await fs.move('/a', '/b')
    eq(await fs.exists('/a'), false); eq(toText(await fs.read('/b')), '1') } },
  { name: 'copies a file', async run(make) {
    const fs = make(); await fs.write('/a', '1'); await fs.copy('/a', '/b')
    eq(toText(await fs.read('/a')), '1'); eq(toText(await fs.read('/b')), '1') } },
  { name: 'stores and reads metadata', async run(make) {
    const fs = make(); await fs.write('/a', '1', { meta: { tag: 'x' } }); eq((await fs.getMeta('/a')).tag, 'x')
    await fs.setMeta('/a', { tag: 'y' }); eq((await fs.getMeta('/a')).tag, 'y') } },
  { name: 'emits watch events when supported', async run(make) {
    const fs = make(); if (!fs.capabilities().watch) return
    const events: string[] = []; const off = fs.watch('/', (e) => events.push(e.type + ':' + e.path))
    await new Promise((r) => setTimeout(r, 60))
    await fs.write('/a', '1'); await waitFor(() => events.includes('create:/a')); off(); ok(events.includes('create:/a')) } },
  { name: 'moves a directory subtree', async run(make) {
    const fs = make(); await fs.mkdir('/d'); await fs.mkdir('/d/sub'); await fs.write('/d/sub/a', '1')
    await fs.move('/d', '/e'); eq(await fs.exists('/d'), false); eq(toText(await fs.read('/e/sub/a')), '1') } },
  { name: 'copies a directory subtree deeply', async run(make) {
    const fs = make(); await fs.mkdir('/d'); await fs.write('/d/a', '1'); await fs.copy('/d', '/e')
    await fs.write('/e/a', '2'); eq(toText(await fs.read('/d/a')), '1'); eq(toText(await fs.read('/e/a')), '2') } },
  { name: 'isolates returned read buffers from the store', async run(make) {
    const fs = make(); await fs.write('/a', 'abc'); const buf = await fs.read('/a'); buf[0] = 0
    eq(toText(await fs.read('/a')), 'abc') } },
  { name: 'does not confuse sibling prefixes', async run(make) {
    const fs = make(); await fs.mkdir('/d'); await fs.mkdir('/dx'); await fs.write('/dx/a', '1')
    ok(!(await fs.list('/d')).some((e) => e.name === 'a')) } },
  { name: 'reports byte size matching written content', async run(make) {
    const fs = make(); await fs.write('/a', 'hello'); eq((await fs.stat('/a')).size, 5) } },
  { name: 'throws ALREADY_EXISTS creating an existing dir without recursive', async run(make) {
    const fs = make(); await fs.mkdir('/d'); await code(() => fs.mkdir('/d'), 'ALREADY_EXISTS') } },
  { name: 'preserves metadata when overwriting content without new meta', async run(make) {
    const fs = make(); await fs.write('/a', '1', { meta: { tag: 'x' } }); await fs.write('/a', '2')
    eq((await fs.getMeta('/a')).tag, 'x') } },
  { name: 'throws NOT_A_DIRECTORY creating a directory under a file', async run(make) {
    const fs = make(); await fs.write('/f', '1'); await code(() => fs.mkdir('/f/sub', { recursive: true }), 'NOT_A_DIRECTORY') } },
  { name: 'throws ALREADY_EXISTS moving or copying onto an existing path', async run(make) {
    const fs = make(); await fs.write('/a', '1'); await fs.write('/b', '2')
    await code(() => fs.move('/a', '/b'), 'ALREADY_EXISTS'); await code(() => fs.copy('/a', '/b'), 'ALREADY_EXISTS') } },
  { name: 'conditional write succeeds on matching version and CONFLICTs on stale (when capable)', async run(make) {
    const fs = make(); if (!fs.capabilities().conditionalWrite) return
    await fs.write('/a', '1'); const v = (await fs.stat('/a')).version
    ok(typeof v === 'string' && v.length > 0, 'expected a version token')
    await fs.write('/a', '2', { ifMatch: v }); eq(toText(await fs.read('/a')), '2')
    await code(() => fs.write('/a', '3', { ifMatch: v }), 'CONFLICT'); eq(toText(await fs.read('/a')), '2') } },
  { name: 'ifAbsent rejects overwriting an existing file (when capable)', async run(make) {
    const fs = make(); if (!fs.capabilities().conditionalWrite) return
    await fs.write('/a', '1'); await code(() => fs.write('/a', '2', { ifAbsent: true }), 'ALREADY_EXISTS')
    eq(toText(await fs.read('/a')), '1') } },
  { name: 'rejects copy or move into its own subtree', async run(make) {
    const fs = make(); await fs.mkdir('/d'); await fs.write('/d/a', '1')
    await code(() => fs.copy('/d', '/d/x'), 'IO')
    await code(() => fs.move('/d', '/d/x'), 'IO') } },
  { name: 'throws NOT_A_DIRECTORY copying under a file', async run(make) {
    const fs = make(); await fs.write('/f', '1'); await fs.write('/src', '2')
    await code(() => fs.copy('/src', '/f/x'), 'NOT_A_DIRECTORY') } },
  { name: 'changes the version token on move (when capable)', async run(make) {
    const fs = make(); if (!fs.capabilities().conditionalWrite) return
    await fs.write('/a', '1'); const v = (await fs.stat('/a')).version
    await fs.move('/a', '/b'); const v2 = (await fs.stat('/b')).version
    ok(typeof v2 === 'string' && v2.length > 0 && v2 !== v, 'expected a new version after move') } },
  { name: 'streams content in and back out (helper, native or buffered)', async run(make) {
    const fs = make()
    const ws = await writeStream(fs, '/s.bin'); const w = ws.getWriter()
    await w.write(toBytes('chunk-one;')); await w.write(toBytes('chunk-two')); await w.close()
    eq(toText(await collect(await readStream(fs, '/s.bin'))), 'chunk-one;chunk-two')
    eq(toText(await fs.read('/s.bin')), 'chunk-one;chunk-two') } },
]

export function runConformance(make: () => VFS): void {
  const g = globalThis as unknown as {
    describe: (n: string, f: () => void) => void
    it: (n: string, f: () => Promise<void>) => void
  }
  g.describe('vfs conformance', () => {
    for (const c of conformanceCases) g.it(c.name, () => c.run(make))
  })
}
