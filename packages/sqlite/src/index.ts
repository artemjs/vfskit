import { createRequire } from 'node:module'
import {
  type VFS, type Entry, type Meta, type Capabilities,
  type ListOpts, type MkdirOpts, type RemoveOpts, type WriteOpts, type Unsubscribe,
  normalize, dirname, toBytes,
  notFound, alreadyExists, isADirectory, notADirectory, io, conflict,
} from '@vfskit/core'

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')

const caps: Capabilities = { streaming: false, watch: false, atomicMove: false, nativeMeta: true, randomAccess: false, conditionalWrite: true }

interface Row { path: string; type: 'file' | 'dir'; data: Uint8Array | null; meta: string; version: number }

const likeEsc = (s: string) => s.replace(/[\\%_]/g, (c) => '\\' + c)

export function sqlite(filename: string): VFS {
  const db = new DatabaseSync(filename)
  db.exec("CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, type TEXT NOT NULL, data BLOB, meta TEXT NOT NULL DEFAULT '{}', version INTEGER NOT NULL DEFAULT 0)")
  db.prepare("INSERT OR IGNORE INTO files (path, type) VALUES ('/', 'dir')").run()

  const qGet = db.prepare('SELECT path, type, data, meta, version FROM files WHERE path = ?')
  const qPut = db.prepare('INSERT INTO files (path, type, data, meta, version) VALUES (?, ?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET type=excluded.type, data=excluded.data, meta=excluded.meta, version=excluded.version')
  const qDel = db.prepare('DELETE FROM files WHERE path = ?')
  const qChildren = db.prepare("SELECT path, type FROM files WHERE path LIKE ? ESCAPE '\\'")

  const get = (p: string): Row | undefined => (qGet.get(p) as Row | undefined)
  const put = (p: string, type: 'file' | 'dir', data: Uint8Array | null, meta: Meta, version: number) =>
    qPut.run(p, type, data, JSON.stringify(meta), version)
  const within = (a: string, b: string) => b === a || b.startsWith(a === '/' ? '/' : a + '/')
  const childRows = (p: string) => (qChildren.all((p === '/' ? '/' : p + '/') + '%') as { path: string; type: 'file' | 'dir' }[])
    .filter((r) => within(p, r.path) && r.path !== p)
  const need = (p: string): Row => { const r = get(p); if (!r) throw notFound(p); return r }
  const parentDir = (p: string) => { const d = dirname(p); const r = get(d); if (!r) throw notFound(d); if (r.type !== 'dir') throw notADirectory(d) }
  const bytes = (r: Row) => (r.data ? new Uint8Array(r.data) : new Uint8Array(0))

  return {
    capabilities: () => caps,
    async read(path) { const p = normalize(path); const r = need(p); if (r.type === 'dir') throw isADirectory(p); return bytes(r) },
    async write(path, data, o?: WriteOpts) {
      const p = normalize(path); parentDir(p); const prev = get(p)
      if (prev?.type === 'dir') throw isADirectory(p)
      if (o?.ifAbsent && prev) throw alreadyExists(p)
      if (o?.ifMatch !== undefined && String(prev?.version ?? '') !== o.ifMatch) throw conflict(p)
      const meta = o?.meta ?? (prev ? JSON.parse(prev.meta) : {})
      put(p, 'file', toBytes(data), meta, (prev?.version ?? 0) + 1)
    },
    async list(path, o?: ListOpts) {
      const p = normalize(path); const r = need(p); if (r.type !== 'dir') throw notADirectory(p)
      const out: Entry[] = []
      for (const c of childRows(p)) {
        if (!o?.recursive && dirname(c.path) !== p) continue
        out.push({ name: c.path.slice(c.path.lastIndexOf('/') + 1), path: c.path, type: c.type })
      }
      return out
    },
    async stat(path) {
      const p = normalize(path); const r = need(p)
      return { type: r.type, size: r.type === 'file' ? bytes(r).length : 0, mtime: 0, ctime: 0, meta: JSON.parse(r.meta), version: r.type === 'file' ? String(r.version) : undefined }
    },
    async exists(path) { return !!get(normalize(path)) },
    async mkdir(path, o?: MkdirOpts) {
      const p = normalize(path); const ex = get(p)
      if (ex) { if (o?.recursive) return; throw alreadyExists(p) }
      if (o?.recursive) {
        let cur = ''
        for (const seg of p.split('/').filter(Boolean)) { cur += '/' + seg; const e = get(cur); if (e?.type === 'file') throw notADirectory(cur); if (!e) put(cur, 'dir', null, {}, 0) }
        return
      }
      parentDir(p); put(p, 'dir', null, {}, 0)
    },
    async remove(path, o?: RemoveOpts) {
      const p = normalize(path); need(p); const ch = childRows(p)
      if (ch.length && !o?.recursive) throw io('directory not empty', p)
      for (const c of ch) qDel.run(c.path)
      qDel.run(p)
    },
    async move(from, to) { await this.copy(from, to); await this.remove(from, { recursive: true }) },
    async copy(from, to) {
      const a = normalize(from), b = normalize(to); need(a); parentDir(b)
      if (get(b)) throw alreadyExists(b)
      if (within(a, b)) throw io('cannot copy into itself', b)
      for (const c of [a, ...childRows(a).map((r) => r.path)]) {
        const r = need(c)
        put(b + c.slice(a.length), r.type, r.data ? new Uint8Array(r.data) : null, JSON.parse(r.meta), (r.version ?? 0) + 1)
      }
    },
    async getMeta(path) { return JSON.parse(need(normalize(path)).meta) },
    async setMeta(path, meta) { const p = normalize(path); const r = need(p); put(p, r.type, r.data ? new Uint8Array(r.data) : null, meta, r.version) },
    watch(): Unsubscribe { return () => {} },
  }
}
