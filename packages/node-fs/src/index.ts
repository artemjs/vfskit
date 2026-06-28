import { promises as fs, watch as fsWatch, createReadStream, type FSWatcher } from 'node:fs'
import { Readable } from 'node:stream'
import { join as pjoin, dirname as pdirname } from 'node:path'
import {
  type VFS, type Entry, type Meta, type Capabilities,
  type ListOpts, type MkdirOpts, type RemoveOpts, type WriteOpts,
  type Unsubscribe,
  normalize, toBytes,
  notFound, alreadyExists, isADirectory, notADirectory, io, conflict, VfsError,
} from '@vfskit/core'

const caps: Capabilities = { streaming: true, watch: true, atomicMove: true, nativeMeta: false, randomAccess: false, conditionalWrite: true }
const META = '/.vfskit/meta.json'
const VER = '/.vfskit/ver.json'

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
  const loadVer = async (): Promise<Record<string, number>> => {
    try { return JSON.parse(new TextDecoder().decode(await fs.readFile(real(VER)))) }
    catch { return {} }
  }
  const saveVer = async (m: Record<string, number>) => {
    await fs.mkdir(pdirname(real(VER)), { recursive: true })
    await fs.writeFile(real(VER), new TextEncoder().encode(JSON.stringify(m)))
  }
  const rekey = (m: Record<string, unknown>, a: string, b: string, keep: boolean) => {
    let changed = false
    for (const k of Object.keys(m)) if (k === a || k.startsWith(a + '/')) { m[b + k.slice(a.length)] = m[k]; if (!keep) delete m[k]; changed = true }
    return changed
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
      await wrap(p, () => fs.access(pdirname(real(p))).then(() => {}))
      const vmap = await loadVer()
      if (opts?.ifAbsent || opts?.ifMatch !== undefined) {
        const existed = await fs.stat(real(p)).then(() => true, () => false)
        if (opts.ifAbsent && existed) throw alreadyExists(p)
        if (opts.ifMatch !== undefined && String(vmap[p] ?? '') !== opts.ifMatch) throw conflict(p)
      }
      await wrap(p, () => fs.writeFile(real(p), toBytes(data)).then(() => {}))
      vmap[p] = (vmap[p] ?? 0) + 1
      await saveVer(vmap)
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
        const v = dir ? undefined : (await loadVer())[p]
        return { type: dir ? 'dir' : 'file', size: dir ? 0 : st.size, mtime: st.mtimeMs, ctime: st.ctimeMs, meta: (await loadMap())[p] ?? {}, version: v != null ? String(v) : undefined }
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
      const vm = await loadVer()
      let vch = false
      for (const k of Object.keys(vm)) if (k === p || k.startsWith(p + '/')) { delete vm[k]; vch = true }
      if (vch) await saveVer(vm)
    },
    async move(from, to) {
      const a = normalize(from), b = normalize(to)
      await wrap(a, async () => {
        await fs.access(pdirname(real(b)))
        if (await fs.stat(real(b)).then(() => true, () => false)) throw alreadyExists(b)
        await fs.rename(real(a), real(b))
      })
      const m = await loadMap(); if (rekey(m, a, b, false)) await saveMap(m)
      const vm = await loadVer(); if (rekey(vm, a, b, false)) await saveVer(vm)
    },
    async copy(from, to) {
      const a = normalize(from), b = normalize(to)
      await wrap(a, async () => {
        await fs.access(pdirname(real(b)))
        if (await fs.stat(real(b)).then(() => true, () => false)) throw alreadyExists(b)
        await fs.cp(real(a), real(b), { recursive: true })
      })
      const m = await loadMap(); if (rekey(m, a, b, true)) await saveMap(m)
      const vm = await loadVer(); if (rekey(vm, a, b, true)) await saveVer(vm)
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
    watch(path, cb): Unsubscribe {
      const p = normalize(path)
      const on = (event: string, filename: string | Buffer | null) => {
        if (!filename) return
        const cp = normalize(p + '/' + filename.toString())
        if (hidden(cp)) return
        fs.stat(real(cp)).then(
          () => cb({ type: event === 'change' ? 'update' : 'create', path: cp }),
          () => cb({ type: 'remove', path: cp }),
        )
      }
      let w: FSWatcher
      try { w = fsWatch(real(p), { recursive: true }, on) }
      catch { try { w = fsWatch(real(p), on) } catch { return () => {} } }
      return () => w.close()
    },
    async readStream(path, ropts) {
      const p = normalize(path)
      await wrap(p, async () => { if ((await fs.stat(real(p))).isDirectory()) throw isADirectory(p) })
      const rs = createReadStream(real(p), ropts?.signal ? { signal: ropts.signal } : {})
      return Readable.toWeb(rs) as unknown as ReadableStream<Uint8Array>
    },
    async writeStream(path, wopts) {
      const p = normalize(path)
      const fh = await wrap(p, async () => { await fs.access(pdirname(real(p))); return fs.open(real(p), 'w') })
      return new WritableStream<Uint8Array>({
        async write(chunk) { try { await fh.write(chunk) } catch (e) { await fh.close().catch(() => {}); throw e } },
        close: async () => {
          await fh.close()
          const vmap = await loadVer(); vmap[p] = (vmap[p] ?? 0) + 1; await saveVer(vmap)
          if (wopts?.meta) { const m = await loadMap(); m[p] = wopts.meta; await saveMap(m) }
        },
        abort: async () => { await fh.close() },
      })
    },
  }
}
