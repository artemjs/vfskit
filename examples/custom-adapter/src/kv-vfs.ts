import {
  type VFS, type Entry, type Meta, type Capabilities,
  type ListOpts, type MkdirOpts, type RemoveOpts, type WriteOpts, type Unsubscribe,
  normalize, dirname, toBytes,
  notFound, alreadyExists, isADirectory, notADirectory, io,
} from 'vfskit'

export interface Kv {
  get(k: string): string | undefined
  set(k: string, v: string): void
  delete(k: string): void
  keys(): Iterable<string>
}

interface Node { type: 'file' | 'dir'; data: string; meta: Meta }

const caps: Capabilities = { streaming: false, watch: false, atomicMove: false, nativeMeta: true, randomAccess: false, conditionalWrite: false }
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

export function kvVfs(store: Kv): VFS {
  const K = (p: string) => 'vfs:' + p
  store.set(K('/'), JSON.stringify({ type: 'dir', data: '', meta: {} } satisfies Node))
  const get = (p: string): Node | undefined => { const r = store.get(K(p)); return r ? JSON.parse(r) : undefined }
  const put = (p: string, n: Node) => store.set(K(p), JSON.stringify(n))
  const within = (a: string, b: string) => b === a || b.startsWith(a === '/' ? '/' : a + '/')
  const children = (p: string) => [...store.keys()].map((k) => k.slice(4)).filter((c) => c !== p && within(p, c))
  const parentDir = (p: string) => { const d = get(dirname(p)); if (!d) throw notFound(dirname(p)); if (d.type !== 'dir') throw notADirectory(dirname(p)) }
  const need = (p: string) => { const n = get(p); if (!n) throw notFound(p); return n }

  return {
    capabilities: () => caps,
    async read(path) { const n = need(normalize(path)); if (n.type === 'dir') throw isADirectory(normalize(path)); return unb64(n.data) },
    async write(path, data, o?: WriteOpts) {
      const p = normalize(path); parentDir(p); const prev = get(p)
      if (prev?.type === 'dir') throw isADirectory(p)
      put(p, { type: 'file', data: b64(toBytes(data)), meta: o?.meta ?? prev?.meta ?? {} })
    },
    async list(path, o?: ListOpts) {
      const p = normalize(path); const n = need(p); if (n.type !== 'dir') throw notADirectory(p)
      const out: Entry[] = []
      for (const c of children(p)) {
        if (!o?.recursive && dirname(c) !== p) continue
        out.push({ name: c.slice(c.lastIndexOf('/') + 1), path: c, type: get(c)!.type })
      }
      return out
    },
    async stat(path) { const p = normalize(path); const n = need(p); return { type: n.type, size: n.type === 'file' ? unb64(n.data).length : 0, mtime: 0, ctime: 0, meta: { ...n.meta } } },
    async exists(path) { return !!get(normalize(path)) },
    async mkdir(path, o?: MkdirOpts) {
      const p = normalize(path)
      if (get(p)) { if (o?.recursive) return; throw alreadyExists(p) }
      if (o?.recursive) { let cur = ''; for (const s of p.split('/').filter(Boolean)) { cur += '/' + s; const e = get(cur); if (e?.type === 'file') throw notADirectory(cur); if (!e) put(cur, { type: 'dir', data: '', meta: {} }) } return }
      parentDir(p); put(p, { type: 'dir', data: '', meta: {} })
    },
    async remove(path, o?: RemoveOpts) {
      const p = normalize(path); need(p); const ch = children(p)
      if (ch.length && !o?.recursive) throw io('directory not empty', p)
      for (const c of [...ch, p]) store.delete(K(c))
    },
    async move(from, to) { await this.copy(from, to); await this.remove(from, { recursive: true }) },
    async copy(from, to) {
      const a = normalize(from), b = normalize(to); need(a); parentDir(b)
      if (get(b)) throw alreadyExists(b)
      if (within(a, b)) throw io('cannot copy into itself', b)
      for (const c of [a, ...children(a)]) put(b + c.slice(a.length), { ...get(c)! })
    },
    async getMeta(path) { return { ...need(normalize(path)).meta } },
    async setMeta(path, meta) { const p = normalize(path); const n = need(p); put(p, { ...n, meta: { ...meta } }) },
    watch(): Unsubscribe { return () => {} },
  }
}
