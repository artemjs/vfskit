import {
  type VFS, type Entry, type Meta, type Capabilities,
  type ListOpts, type MkdirOpts, type RemoveOpts, type WriteOpts,
  type WatchCb, type WatchEvent, type Unsubscribe,
  normalize, dirname, toBytes,
  notFound, alreadyExists, notADirectory, isADirectory, io, conflict,
} from '@vfskit/core'

type FileNode = { type: 'file'; data: Uint8Array; meta: Meta; mtime: number; ctime: number; version: string }
type DirNode = { type: 'dir'; meta: Meta; mtime: number; ctime: number }
type Node = FileNode | DirNode

const caps: Capabilities = { streaming: false, watch: true, atomicMove: true, nativeMeta: true, randomAccess: false, conditionalWrite: true }

export function memory(): VFS {
  const t = () => Date.now()
  let seq = 0
  const ver = () => String(++seq)
  const nodes = new Map<string, Node>([['/', { type: 'dir', meta: {}, mtime: t(), ctime: t() }]])
  const watchers = new Set<{ base: string; cb: WatchCb }>()

  const within = (base: string, p: string) => p === base || p.startsWith(base === '/' ? '/' : base + '/')
  const emit = (type: WatchEvent['type'], path: string) => {
    for (const w of watchers) if (within(w.base, path)) w.cb({ type, path })
  }
  const need = (p: string): Node => {
    const n = nodes.get(p)
    if (!n) throw notFound(p)
    return n
  }
  const parentDir = (p: string) => {
    const d = dirname(p)
    const n = nodes.get(d)
    if (!n) throw notFound(d)
    if (n.type !== 'dir') throw notADirectory(d)
  }

  return {
    capabilities: () => caps,
    async read(path) {
      const p = normalize(path)
      const n = need(p)
      if (n.type === 'dir') throw isADirectory(p)
      return n.data.slice()
    },
    async write(path, data, opts?: WriteOpts) {
      const p = normalize(path)
      parentDir(p)
      const prev = nodes.get(p)
      if (prev && prev.type === 'dir') throw isADirectory(p)
      if (opts?.ifAbsent && prev) throw alreadyExists(p)
      if (opts?.ifMatch !== undefined && (prev as FileNode | undefined)?.version !== opts.ifMatch) throw conflict(p)
      const ctime = prev ? prev.ctime : t()
      nodes.set(p, {
        type: 'file',
        data: toBytes(data).slice(),
        meta: opts?.meta ? { ...opts.meta } : ((prev as FileNode | undefined)?.meta ?? {}),
        ctime,
        mtime: t(),
        version: ver(),
      })
      emit(prev ? 'update' : 'create', p)
    },
    async list(path, opts?: ListOpts) {
      const p = normalize(path)
      const n = need(p)
      if (n.type !== 'dir') throw notADirectory(p)
      const out: Entry[] = []
      for (const [k, v] of nodes) {
        if (k === p || !within(p, k)) continue
        if (!opts?.recursive && dirname(k) !== p) continue
        out.push({ name: k.slice(k.lastIndexOf('/') + 1), path: k, type: v.type })
      }
      return out
    },
    async stat(path) {
      const p = normalize(path)
      const n = need(p)
      return { type: n.type, size: n.type === 'file' ? n.data.length : 0, mtime: n.mtime, ctime: n.ctime, meta: { ...n.meta }, version: n.type === 'file' ? n.version : undefined }
    },
    async exists(path) {
      return nodes.has(normalize(path))
    },
    async mkdir(path, opts?: MkdirOpts) {
      const p = normalize(path)
      if (nodes.has(p)) {
        if (opts?.recursive) return
        throw alreadyExists(p)
      }
      if (opts?.recursive) {
        let cur = ''
        for (const part of p.split('/').filter(Boolean)) {
          cur += '/' + part
          const ex = nodes.get(cur)
          if (ex) { if (ex.type !== 'dir') throw notADirectory(cur); continue }
          nodes.set(cur, { type: 'dir', meta: {}, mtime: t(), ctime: t() }); emit('create', cur)
        }
        return
      }
      parentDir(p)
      nodes.set(p, { type: 'dir', meta: {}, mtime: t(), ctime: t() })
      emit('create', p)
    },
    async remove(path, opts?: RemoveOpts) {
      const p = normalize(path)
      need(p)
      const children = [...nodes.keys()].filter((k) => k !== p && within(p, k))
      if (children.length && !opts?.recursive) throw io('directory not empty', p)
      for (const k of [...children, p]) { nodes.delete(k); emit('remove', k) }
    },
    async move(from, to) {
      const a = normalize(from)
      const b = normalize(to)
      need(a)
      parentDir(b)
      if (nodes.has(b)) throw alreadyExists(b)
      if (within(a, b)) throw io('cannot move into itself', b)
      for (const k of [...nodes.keys()].filter((k) => k === a || within(a, k))) {
        const node = nodes.get(k)!
        nodes.delete(k)
        nodes.set(b + k.slice(a.length), node)
      }
      emit('remove', a)
      emit('create', b)
    },
    async copy(from, to) {
      const a = normalize(from)
      const b = normalize(to)
      need(a)
      parentDir(b)
      if (nodes.has(b)) throw alreadyExists(b)
      for (const k of [...nodes.keys()].filter((k) => k === a || within(a, k))) {
        const node = nodes.get(k)!
        nodes.set(
          b + k.slice(a.length),
          node.type === 'file'
            ? { type: 'file', data: node.data.slice(), meta: { ...node.meta }, mtime: node.mtime, ctime: node.ctime, version: ver() }
            : { type: 'dir', meta: { ...node.meta }, mtime: node.mtime, ctime: node.ctime },
        )
      }
      emit('create', b)
    },
    async getMeta(path) {
      return { ...need(normalize(path)).meta }
    },
    async setMeta(path, meta) {
      const n = need(normalize(path))
      n.meta = { ...meta }
      n.mtime = t()
    },
    watch(path, cb): Unsubscribe {
      const w = { base: normalize(path), cb }
      watchers.add(w)
      return () => { watchers.delete(w) }
    },
  }
}
