import {
  type VFS, type Entry, type Meta, type Capabilities,
  type ListOpts, type MkdirOpts, type RemoveOpts, type WriteOpts, type Unsubscribe,
  normalize, dirname, basename, segments, toBytes, concat,
  notFound, alreadyExists, isADirectory, notADirectory, io,
} from '@vfskit/core'

type DirH = FileSystemDirectoryHandle
const entriesOf = (dir: DirH) => (dir as unknown as { values(): AsyncIterableIterator<{ kind: 'file' | 'directory'; name: string }> }).values()
const caps: Capabilities = { streaming: true, watch: false, atomicMove: false, nativeMeta: false, randomAccess: false, conditionalWrite: false }
const META = '/.vfskit/meta.json'

function mapErr(p: string, e: unknown): never {
  const n = (e as { name?: string }).name
  if (n === 'NotFoundError') throw notFound(p)
  if (n === 'TypeMismatchError') throw notADirectory(p)
  if (n === 'InvalidModificationError') throw io('not empty', p)
  throw io(String((e as Error)?.message ?? e), p)
}

export function opfs(root?: DirH): VFS {
  const rootP: Promise<DirH> = root ? Promise.resolve(root) : navigator.storage.getDirectory()
  const hidden = (p: string) => p === '/.vfskit' || p.startsWith('/.vfskit/')

  const dirOf = async (parts: string[], create: boolean): Promise<DirH> => {
    let d = await rootP
    for (const name of parts) d = await d.getDirectoryHandle(name, { create })
    return d
  }
  const parent = (p: string) => dirOf(segments(dirname(p)), false)
  const kind = async (p: string): Promise<'file' | 'dir' | null> => {
    if (normalize(p) === '/') return 'dir'
    const par = await parent(p).catch(() => null)
    if (!par) return null
    const name = basename(p)
    try { await par.getFileHandle(name); return 'file' } catch { /* not a file */ }
    try { await par.getDirectoryHandle(name); return 'dir' } catch { return null }
  }

  const loadMap = async (): Promise<Record<string, Meta>> => {
    try {
      const dir = await dirOf(['.vfskit'], false)
      const f = await (await dir.getFileHandle('meta.json')).getFile()
      return JSON.parse(await f.text())
    } catch { return {} }
  }
  const saveMap = async (m: Record<string, Meta>) => {
    const dir = await dirOf(['.vfskit'], true)
    const w = await (await dir.getFileHandle('meta.json', { create: true })).createWritable()
    const wr = w.getWriter(); await wr.write(toBytes(JSON.stringify(m))); await wr.close()
  }
  const reMeta = async (mut: (m: Record<string, Meta>) => boolean) => { const m = await loadMap(); if (mut(m)) await saveMap(m) }

  const fileHandle = async (p: string, create: boolean) => (await parent(p)).getFileHandle(basename(p), { create })

  return {
    capabilities: () => caps,
    async read(path) {
      const p = normalize(path)
      if (p === '/') throw isADirectory(p)
      try { return new Uint8Array(await (await (await fileHandle(p, false)).getFile()).arrayBuffer()) }
      catch (e) { if ((await kind(p)) === 'dir') throw isADirectory(p); mapErr(p, e) }
    },
    async write(path, data, o?: WriteOpts) {
      const p = normalize(path)
      if ((await kind(p)) === 'dir') throw isADirectory(p)
      try {
        const w = await (await fileHandle(p, true)).createWritable()
        const wr = w.getWriter(); await wr.write(toBytes(data)); await wr.close()
      } catch (e) { mapErr(dirname(p), e) }
      if (o?.meta) await reMeta((m) => { m[p] = o.meta!; return true })
    },
    async list(path, o?: ListOpts) {
      const p = normalize(path)
      const out: Entry[] = []
      const walk = async (dp: string) => {
        const dir = await dirOf(segments(dp), false)
        for await (const h of entriesOf(dir)) {
          const cp = normalize(dp + '/' + h.name)
          if (hidden(cp)) continue
          const type = h.kind === 'directory' ? 'dir' : 'file'
          out.push({ name: h.name, path: cp, type })
          if (o?.recursive && type === 'dir') await walk(cp)
        }
      }
      try { await walk(p) } catch (e) { if ((await kind(p)) === 'file') throw notADirectory(p); mapErr(p, e) }
      return out
    },
    async stat(path) {
      const p = normalize(path); const k = await kind(p)
      if (k === null) throw notFound(p)
      let size = 0
      if (k === 'file') size = (await (await fileHandle(p, false)).getFile()).size
      return { type: k, size, mtime: 0, ctime: 0, meta: (await loadMap())[p] ?? {} }
    },
    async exists(path) { return (await kind(path)) !== null },
    async mkdir(path, o?: MkdirOpts) {
      const p = normalize(path); const k = await kind(p)
      if (k !== null) { if (o?.recursive) return; throw alreadyExists(p) }
      if (o?.recursive) {
        let cur = ''
        for (const s of segments(p)) { cur += '/' + s; const ck = await kind(cur); if (ck === 'file') throw notADirectory(cur); if (ck === null) await dirOf(segments(cur), true) }
        return
      }
      try { await (await parent(p)).getDirectoryHandle(basename(p), { create: true }) } catch (e) { mapErr(dirname(p), e) }
    },
    async remove(path, o?: RemoveOpts) {
      const p = normalize(path); const k = await kind(p)
      if (k === null) throw notFound(p)
      const par = await parent(p)
      try { await par.removeEntry(basename(p), { recursive: !!o?.recursive }) } catch (e) { mapErr(p, e) }
      await reMeta((m) => { let c = false; for (const key of Object.keys(m)) if (key === p || key.startsWith(p + '/')) { delete m[key]; c = true } return c })
    },
    async move(from, to) { await this.copy(from, to); await this.remove(from, { recursive: true }) },
    async copy(from, to) {
      const a = normalize(from), b = normalize(to); const k = await kind(a)
      if (k === null) throw notFound(a)
      if ((await kind(b)) !== null) throw alreadyExists(b)
      if (b === a || b.startsWith(a + '/')) throw io('cannot copy into itself', b)
      if (await parent(b).catch(() => null) === null) throw notFound(dirname(b))
      const m = await loadMap(); let changed = false
      const rec = async (src: string, dst: string) => {
        if ((await kind(src)) === 'file') {
          await this.write(dst, await this.read(src))
          if (m[src]) { m[dst] = m[src]; changed = true }
        } else {
          await this.mkdir(dst)
          if (m[src]) { m[dst] = m[src]; changed = true }
          for (const e of await this.list(src)) await rec(e.path, dst + '/' + e.name)
        }
      }
      await rec(a, b)
      if (changed) await saveMap(m)
    },
    async getMeta(path) { const p = normalize(path); if ((await kind(p)) === null) throw notFound(p); return (await loadMap())[p] ?? {} },
    async setMeta(path, meta) { const p = normalize(path); if ((await kind(p)) === null) throw notFound(p); await reMeta((m) => { m[p] = meta; return true }) },
    async readStream(path) {
      const p = normalize(path)
      try { return (await (await fileHandle(p, false)).getFile()).stream() as ReadableStream<Uint8Array> }
      catch (e) { if ((await kind(p)) === 'dir') throw isADirectory(p); mapErr(p, e) }
    },
    async writeStream(path) {
      const p = normalize(path)
      if ((await kind(p)) === 'dir') throw isADirectory(p)
      try { return (await (await fileHandle(p, true)).createWritable()) as unknown as WritableStream<Uint8Array> }
      catch (e) { mapErr(dirname(p), e) }
    },
    watch(): Unsubscribe { return () => {} },
  }
}
