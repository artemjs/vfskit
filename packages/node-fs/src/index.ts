import { promises as fs } from 'node:fs'
import { join as pjoin, dirname as pdirname } from 'node:path'
import {
  type VFS, type Entry, type Meta, type Capabilities,
  type ListOpts, type MkdirOpts, type RemoveOpts, type WriteOpts,
  type Unsubscribe,
  normalize, toBytes,
  notFound, alreadyExists, isADirectory, notADirectory, io, VfsError,
} from '@vfskit/core'

const caps: Capabilities = { streaming: false, watch: false, atomicMove: true, nativeMeta: false, randomAccess: false }
const META = '/.vfskit/meta.json'

export function nodeFs(root: string): VFS {
  const real = (p: string) => pjoin(root, normalize(p))
  const hidden = (p: string) => p === '/.vfskit' || p.startsWith('/.vfskit/')
  const loadMap = async (): Promise<Record<string, Meta>> => {
    try { return JSON.parse(new TextDecoder().decode(await fs.readFile(real(META)))) }
    catch { return {} }
  }
  const saveMap = async (m: Record<string, Meta>) => {
    await fs.mkdir(pdirname(real(META)), { recursive: true })
    await fs.writeFile(real(META), new TextEncoder().encode(JSON.stringify(m)))
  }
  const wrap = async <T>(p: string, fn: () => Promise<T>): Promise<T> => {
    try { return await fn() }
    catch (e) {
      if (e instanceof VfsError) throw e
      const c = (e as { code?: string }).code
      if (c === 'ENOENT') throw notFound(p)
      if (c === 'EEXIST') throw alreadyExists(p)
      if (c === 'ENOTDIR') throw notADirectory(p)
      if (c === 'EISDIR') throw isADirectory(p)
      throw io(String((e as Error).message ?? e), p)
    }
  }
  return {
    capabilities: () => caps,
    async read(path) {
      const p = normalize(path)
      return wrap(p, async () => {
        if ((await fs.stat(real(p))).isDirectory()) throw isADirectory(p)
        return new Uint8Array(await fs.readFile(real(p)))
      })
    },
    async write(path, data, opts?: WriteOpts) {
      const p = normalize(path)
      await wrap(p, async () => {
        await fs.access(pdirname(real(p)))
        await fs.writeFile(real(p), toBytes(data))
      })
      if (opts?.meta) { const m = await loadMap(); m[p] = opts.meta; await saveMap(m) }
    },
    async list(path, opts?: ListOpts) {
      const p = normalize(path)
      const out: Entry[] = []
      const walk = async (dir: string) => {
        for (const e of await fs.readdir(real(dir), { withFileTypes: true })) {
          const cp = normalize(dir + '/' + e.name)
          if (hidden(cp)) continue
          out.push({ name: e.name, path: cp, type: e.isDirectory() ? 'dir' : 'file' })
          if (opts?.recursive && e.isDirectory()) await walk(cp)
        }
      }
      await wrap(p, async () => {
        if (!(await fs.stat(real(p))).isDirectory()) throw notADirectory(p)
        await walk(p)
      })
      return out
    },
    async stat(path) {
      const p = normalize(path)
      return wrap(p, async () => {
        const st = await fs.stat(real(p))
        const dir = st.isDirectory()
        return { type: dir ? 'dir' : 'file', size: dir ? 0 : st.size, mtime: st.mtimeMs, ctime: st.ctimeMs, meta: (await loadMap())[p] ?? {} }
      })
    },
    async exists(path) {
      try { await fs.stat(real(normalize(path))); return true } catch { return false }
    },
    async mkdir(path, opts?: MkdirOpts) {
      const p = normalize(path)
      await wrap(p, () => fs.mkdir(real(p), { recursive: opts?.recursive }).then(() => {}))
    },
    async remove(path, opts?: RemoveOpts) {
      const p = normalize(path)
      await wrap(p, async () => {
        const st = await fs.stat(real(p))
        if (st.isDirectory()) {
          if ((await fs.readdir(real(p))).length && !opts?.recursive) throw io('directory not empty', p)
          await fs.rm(real(p), { recursive: true, force: true })
        } else await fs.rm(real(p))
      })
      const m = await loadMap()
      let changed = false
      for (const k of Object.keys(m)) if (k === p || k.startsWith(p + '/')) { delete m[k]; changed = true }
      if (changed) await saveMap(m)
    },
    async move(from, to) {
      const a = normalize(from), b = normalize(to)
      await wrap(a, async () => {
        await fs.access(pdirname(real(b)))
        await fs.rename(real(a), real(b))
      })
      const m = await loadMap()
      let changed = false
      for (const k of Object.keys(m)) if (k === a || k.startsWith(a + '/')) { m[b + k.slice(a.length)] = m[k]; delete m[k]; changed = true }
      if (changed) await saveMap(m)
    },
    async copy(from, to) {
      const a = normalize(from), b = normalize(to)
      await wrap(a, async () => {
        await fs.access(pdirname(real(b)))
        await fs.cp(real(a), real(b), { recursive: true })
      })
      const m = await loadMap()
      let changed = false
      for (const k of Object.keys(m)) if (k === a || k.startsWith(a + '/')) { m[b + k.slice(a.length)] = m[k]; changed = true }
      if (changed) await saveMap(m)
    },
    async getMeta(path) {
      const p = normalize(path)
      await wrap(p, () => fs.stat(real(p)).then(() => {}))
      return (await loadMap())[p] ?? {}
    },
    async setMeta(path, meta) {
      const p = normalize(path)
      await wrap(p, () => fs.stat(real(p)).then(() => {}))
      const m = await loadMap(); m[p] = meta; await saveMap(m)
    },
    watch(): Unsubscribe { return () => {} },
  }
}
