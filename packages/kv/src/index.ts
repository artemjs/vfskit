import {
  type VFS, type Entry, type Meta, type Capabilities,
  type ListOpts, type MkdirOpts, type RemoveOpts, type WriteOpts, type Unsubscribe,
  normalize, dirname, toBytes,
  notFound, alreadyExists, isADirectory, notADirectory, io, conflict,
} from '@vfskit/core'

export interface KvStore {
  get(key: string): Promise<string | null | undefined>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
  list(prefix: string): Promise<string[]>
}
export interface KvOpts { store: KvStore; prefix?: string }

interface Rec { t: 'file' | 'dir'; d?: string; m: Meta; v: number }

const caps: Capabilities = { streaming: false, watch: false, atomicMove: false, nativeMeta: true, randomAccess: false, conditionalWrite: true }

function b64encode(u: Uint8Array): string {
  let s = ''
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000))
  return btoa(s)
}
function b64decode(s: string): Uint8Array {
  const bin = atob(s); const u = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
  return u
}

export function memKv(): KvStore {
  const m = new Map<string, string>()
  return {
    async get(k) { return m.get(k) },
    async set(k, v) { m.set(k, v) },
    async delete(k) { m.delete(k) },
    async list(prefix) { return [...m.keys()].filter((k) => k.startsWith(prefix)) },
  }
}

export function localStorageKv(ls: Storage = globalThis.localStorage): KvStore {
  return {
    async get(k) { return ls.getItem(k) },
    async set(k, v) { ls.setItem(k, v) },
    async delete(k) { ls.removeItem(k) },
    async list(prefix) {
      const out: string[] = []
      for (let i = 0; i < ls.length; i++) { const k = ls.key(i); if (k && k.startsWith(prefix)) out.push(k) }
      return out
    },
  }
}

export function kv(opts: KvOpts): VFS {
  const s = opts.store
  const NS = (opts.prefix ? opts.prefix + ':' : '') + 'vfs:'
  const K = (p: string) => NS + normalize(p)
  const unkey = (k: string) => k.slice(NS.length)
  const within = (a: string, b: string) => b === a || b.startsWith(a === '/' ? '/' : a + '/')
  const get = async (p: string): Promise<Rec | undefined> => { const r = await s.get(K(p)); return r ? JSON.parse(r) : undefined }
  const put = (p: string, r: Rec) => s.set(K(p), JSON.stringify(r))
  const need = async (p: string): Promise<Rec> => { const r = await get(p); if (!r) throw notFound(p); return r }
  const children = async (p: string) => (await s.list(K(p) === NS + '/' ? NS + '/' : K(p) + '/')).map(unkey).filter((c) => c !== p && within(p, c))
  const parentDir = async (p: string) => { const d = dirname(p); const r = await get(d); if (!r) throw notFound(d); if (r.t !== 'dir') throw notADirectory(d) }

  const init = put('/', { t: 'dir', m: {}, v: 0 }).catch(() => {})

  return {
    capabilities: () => caps,
    async read(path) { await init; const p = normalize(path); const r = await need(p); if (r.t === 'dir') throw isADirectory(p); return b64decode(r.d ?? '') },
    async write(path, data, o?: WriteOpts) {
      await init; const p = normalize(path); await parentDir(p)
      const prev = await get(p)
      if (prev?.t === 'dir') throw isADirectory(p)
      if (o?.ifAbsent && prev) throw alreadyExists(p)
      if (o?.ifMatch !== undefined && String(prev?.v ?? '') !== o.ifMatch) throw conflict(p)
      await put(p, { t: 'file', d: b64encode(toBytes(data)), m: o?.meta ?? prev?.m ?? {}, v: (prev?.v ?? 0) + 1 })
    },
    async list(path, o?: ListOpts) {
      await init; const p = normalize(path); const r = await need(p); if (r.t !== 'dir') throw notADirectory(p)
      const out: Entry[] = []
      for (const c of await children(p)) {
        if (!o?.recursive && dirname(c) !== p) continue
        const cr = await get(c); if (!cr) continue
        out.push({ name: c.slice(c.lastIndexOf('/') + 1), path: c, type: cr.t })
      }
      return out
    },
    async stat(path) {
      await init; const p = normalize(path); const r = await need(p)
      return { type: r.t, size: r.t === 'file' ? b64decode(r.d ?? '').length : 0, mtime: 0, ctime: 0, meta: { ...r.m }, version: r.t === 'file' ? String(r.v) : undefined }
    },
    async exists(path) { await init; return !!(await get(normalize(path))) },
    async mkdir(path, o?: MkdirOpts) {
      await init; const p = normalize(path); const ex = await get(p)
      if (ex) { if (o?.recursive) return; throw alreadyExists(p) }
      if (o?.recursive) {
        let cur = ''
        for (const seg of p.split('/').filter(Boolean)) { cur += '/' + seg; const e = await get(cur); if (e?.t === 'file') throw notADirectory(cur); if (!e) await put(cur, { t: 'dir', m: {}, v: 0 }) }
        return
      }
      await parentDir(p); await put(p, { t: 'dir', m: {}, v: 0 })
    },
    async remove(path, o?: RemoveOpts) {
      await init; const p = normalize(path); await need(p)
      const ch = await children(p)
      if (ch.length && !o?.recursive) throw io('directory not empty', p)
      for (const c of [...ch, p]) await s.delete(K(c))
    },
    async move(from, to) { await this.copy(from, to); await this.remove(from, { recursive: true }) },
    async copy(from, to) {
      await init; const a = normalize(from), b = normalize(to); await need(a); await parentDir(b)
      if (await get(b)) throw alreadyExists(b)
      if (within(a, b)) throw io('cannot copy into itself', b)
      for (const c of [a, ...await children(a)]) { const r = await get(c); if (r) await put(b + c.slice(a.length), { ...r, v: (r.v ?? 0) + 1 }) }
    },
    async getMeta(path) { await init; return { ...(await need(normalize(path))).m } },
    async setMeta(path, meta) { await init; const p = normalize(path); const r = await need(p); await put(p, { ...r, m: { ...meta } }) },
    watch(): Unsubscribe { return () => {} },
  }
}
