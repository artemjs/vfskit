import { type VFS, type BytesLike, normalize, toBytes } from '@vfskit/core'

export interface CacheStore {
  get(k: string): { data: Uint8Array; exp: number } | undefined
  set(k: string, v: { data: Uint8Array; exp: number }): void
  delete(k: string): void
  keys(): Iterable<string>
}
export interface CacheOpts { store?: CacheStore; ttlMs?: number }

export function cache(inner: VFS, opts: CacheOpts = {}): VFS {
  const store: CacheStore = opts.store ?? new Map()
  const ttl = opts.ttlMs ?? 0
  const now = () => (ttl ? Date.now() : 0)
  const exp = () => (ttl ? Date.now() + ttl : Infinity)
  const within = (a: string, b: string) => b === a || b.startsWith(a === '/' ? '/' : a + '/')
  const drop = (p: string) => { for (const k of [...store.keys()]) if (within(p, k)) store.delete(k) }

  return {
    ...inner,
    readStream: undefined,
    writeStream: undefined,
    async read(path, ropts) {
      const p = normalize(path)
      const hit = store.get(p)
      if (hit && hit.exp > now()) return hit.data.slice()
      const data = await inner.read(p, ropts)
      store.set(p, { data: data.slice(), exp: exp() })
      return data.slice()
    },
    async write(path, data: BytesLike, wopts) {
      const p = normalize(path)
      const bytes = toBytes(data).slice()
      await inner.write(p, bytes, wopts)
      store.set(p, { data: bytes, exp: exp() })
    },
    async remove(path, rmopts) { const p = normalize(path); await inner.remove(p, rmopts); drop(p) },
    async move(from, to) { const a = normalize(from), b = normalize(to); await inner.move(a, b); drop(a); drop(b) },
    async copy(from, to) { const a = normalize(from), b = normalize(to); await inner.copy(a, b); drop(b) },
  }
}
