import {
  type VFS, type Entry, type Meta, type Capabilities,
  type ListOpts, type MkdirOpts, type RemoveOpts, type WriteOpts,
  type Unsubscribe,
  normalize, dirname, toBytes,
  notFound, alreadyExists, isADirectory, notADirectory, io, conflict,
} from '@vfskit/core'

export interface S3Object { body: Uint8Array; meta: Meta; size: number; mtime: number; version?: string }
export interface S3Like {
  get(key: string): Promise<S3Object | null>
  put(key: string, body: Uint8Array, meta: Meta): Promise<void>
  del(key: string): Promise<void>
  head(key: string): Promise<{ size: number; mtime: number; meta: Meta; version?: string } | null>
  list(prefix: string): Promise<{ key: string; size: number; mtime: number }[]>
}
export interface S3Opts { client: S3Like; prefix?: string; pollMs?: number }

const caps: Capabilities = { streaming: false, watch: true, atomicMove: false, nativeMeta: true, randomAccess: false, conditionalWrite: true }
const EMPTY = new Uint8Array(0)

export function memoryS3(): S3Like {
  const m = new Map<string, { body: Uint8Array; meta: Meta; mtime: number; version: string }>()
  let seq = 0
  return {
    async get(k) { const o = m.get(k); return o ? { body: o.body.slice(), meta: { ...o.meta }, size: o.body.length, mtime: o.mtime, version: o.version } : null },
    async put(k, body, meta) { m.set(k, { body: body.slice(), meta: { ...meta }, mtime: Date.now(), version: String(++seq) }) },
    async del(k) { m.delete(k) },
    async head(k) { const o = m.get(k); return o ? { size: o.body.length, mtime: o.mtime, meta: { ...o.meta }, version: o.version } : null },
    async list(prefix) {
      const out: { key: string; size: number; mtime: number }[] = []
      for (const [k, o] of m) if (k.startsWith(prefix)) out.push({ key: k, size: o.body.length, mtime: o.mtime })
      return out
    },
  }
}

export function s3(opts: S3Opts): VFS {
  const c = opts.client
  const base = opts.prefix ? normalize('/' + opts.prefix).slice(1) : ''
  const key = (p: string) => { const n = normalize(p).slice(1); return base ? (n ? base + '/' + n : base) : n }
  const marker = (p: string) => key(p) + '/'
  const prefixOf = (p: string) => { const k = key(p); return k ? k + '/' : '' }
  const within = (a: string, b: string) => b === a || b.startsWith(a === '/' ? '/' : a + '/')

  const kind = async (p: string): Promise<'file' | 'dir' | null> => {
    if (normalize(p) === '/') return 'dir'
    if (await c.head(key(p))) return 'file'
    if (await c.head(marker(p))) return 'dir'
    return (await c.list(prefixOf(p))).length ? 'dir' : null
  }
  const needDirParent = async (p: string) => {
    const d = dirname(p)
    const k = await kind(d)
    if (k === null) throw notFound(d)
    if (k !== 'dir') throw notADirectory(d)
  }

  return {
    capabilities: () => caps,
    async read(path) {
      const p = normalize(path)
      const o = await c.get(key(p))
      if (!o) throw (await kind(p)) === 'dir' ? isADirectory(p) : notFound(p)
      return o.body.slice()
    },
    async write(path, data, wopts?: WriteOpts) {
      const p = normalize(path)
      if ((await kind(p)) === 'dir') throw isADirectory(p)
      await needDirParent(p)
      const h = await c.head(key(p))
      if (wopts?.ifAbsent && h) throw alreadyExists(p)
      if (wopts?.ifMatch !== undefined && (h?.version ?? '') !== wopts.ifMatch) throw conflict(p)
      await c.put(key(p), toBytes(data), wopts?.meta ?? h?.meta ?? {})
    },
    async list(path, lopts?: ListOpts) {
      const p = normalize(path)
      const k = await kind(p)
      if (k === null) throw notFound(p)
      if (k !== 'dir') throw notADirectory(p)
      const pre = prefixOf(p)
      const seen = new Map<string, Entry>()
      for (const o of await c.list(pre)) {
        let rel = o.key.slice(pre.length)
        const isMarker = rel.endsWith('/')
        if (isMarker) rel = rel.slice(0, -1)
        if (rel === '') continue
        if (lopts?.recursive) {
          const cp = normalize(p + '/' + rel)
          const type = isMarker ? 'dir' : 'file'
          if (!seen.has(cp) || type === 'dir') seen.set(cp, { name: rel.split('/').pop() as string, path: cp, type })
        } else {
          const seg = rel.split('/')[0]
          const cp = normalize(p + '/' + seg)
          const type = isMarker || rel.includes('/') ? 'dir' : 'file'
          if (!seen.has(cp) || type === 'dir') seen.set(cp, { name: seg, path: cp, type })
        }
      }
      return [...seen.values()]
    },
    async stat(path) {
      const p = normalize(path)
      const k = await kind(p)
      if (k === null) throw notFound(p)
      if (k === 'file') {
        const h = await c.head(key(p))
        return { type: 'file', size: h?.size ?? 0, mtime: h?.mtime ?? 0, ctime: h?.mtime ?? 0, meta: h?.meta ?? {}, version: h?.version }
      }
      const h = await c.head(marker(p))
      return { type: 'dir', size: 0, mtime: h?.mtime ?? 0, ctime: h?.mtime ?? 0, meta: h?.meta ?? {} }
    },
    async exists(path) {
      return (await kind(path)) !== null
    },
    async mkdir(path, mopts?: MkdirOpts) {
      const p = normalize(path)
      if ((await kind(p)) !== null) {
        if (mopts?.recursive) return
        throw alreadyExists(p)
      }
      if (mopts?.recursive) {
        const segs = p.split('/').filter(Boolean)
        let cur = ''
        for (const s of segs) {
          cur += '/' + s
          const k = await kind(cur)
          if (k === 'file') throw notADirectory(cur)
          if (k === null) await c.put(marker(cur), EMPTY, {})
        }
        return
      }
      await needDirParent(p)
      await c.put(marker(p), EMPTY, {})
    },
    async remove(path, ropts?: RemoveOpts) {
      const p = normalize(path)
      const k = await kind(p)
      if (k === null) throw notFound(p)
      if (k === 'file') { await c.del(key(p)); return }
      const objs = await c.list(prefixOf(p))
      const children = objs.filter((o) => o.key !== marker(p))
      if (children.length && !ropts?.recursive) throw io('directory not empty', p)
      for (const o of objs) await c.del(o.key)
      await c.del(marker(p))
    },
    async copy(from, to) {
      const a = normalize(from), b = normalize(to)
      if (within(a, b)) throw io('cannot copy into itself', b)
      const k = await kind(a)
      if (k === null) throw notFound(a)
      if ((await kind(b)) !== null) throw alreadyExists(b)
      await needDirParent(b)
      if (k === 'file') { const o = await c.get(key(a)); if (o) await c.put(key(b), o.body, o.meta); return }
      await c.put(marker(b), EMPTY, {})
      const pre = prefixOf(a)
      for (const o of await c.list(pre)) {
        const rel = o.key.slice(pre.length)
        if (rel === '') continue
        const dst = prefixOf(b) + rel
        if (rel.endsWith('/')) await c.put(dst, EMPTY, {})
        else { const obj = await c.get(o.key); if (obj) await c.put(dst, obj.body, obj.meta) }
      }
    },
    async move(from, to) {
      await this.copy(from, to)
      await this.remove(from, { recursive: true })
    },
    async getMeta(path) {
      const p = normalize(path)
      const k = await kind(p)
      if (k === null) throw notFound(p)
      const h = await c.head(k === 'file' ? key(p) : marker(p))
      return h?.meta ?? {}
    },
    async setMeta(path, meta) {
      const p = normalize(path)
      const k = await kind(p)
      if (k === null) throw notFound(p)
      if (k === 'file') { const o = await c.get(key(p)); await c.put(key(p), o?.body ?? EMPTY, meta) }
      else await c.put(marker(p), EMPTY, meta)
    },
    watch(path, cb): Unsubscribe {
      const p = normalize(path)
      const pre = prefixOf(p)
      const self = key(p) ? key(p) + '/' : ''
      const unkey = (k: string) => normalize('/' + (base ? k.slice(base.length + 1) : k))
      let prev = new Map<string, number>()
      let primed = false
      const snap = async () => {
        const m = new Map<string, number>()
        for (const o of await c.list(pre)) if (o.key !== self) m.set(o.key, o.mtime)
        return m
      }
      snap().then((m) => { prev = m; primed = true })
      let busy = false
      const tick = async () => {
        if (!primed || busy) return
        busy = true
        try {
          const cur = await snap()
          for (const [k, mt] of cur) {
            if (!prev.has(k)) cb({ type: 'create', path: unkey(k) })
            else if (prev.get(k) !== mt) cb({ type: 'update', path: unkey(k) })
          }
          for (const k of prev.keys()) if (!cur.has(k)) cb({ type: 'remove', path: unkey(k) })
          prev = cur
        } finally { busy = false }
      }
      const timer = setInterval(() => void tick(), opts.pollMs ?? 200)
      ;(timer as { unref?: () => void }).unref?.()
      return () => clearInterval(timer)
    },
  }
}
