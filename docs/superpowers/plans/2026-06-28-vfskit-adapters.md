# vfskit Backend Adapters Implementation Plan (Part 2 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two backend adapters - `@vfskit/node-fs` (real disk via `node:fs/promises`) and `@vfskit/s3` (S3 object storage via an injected client port) - each passing the existing `@vfskit/core/conformance` suite.

**Architecture:** Both adapters implement the same `VFS` interface and are validated by the shared conformance suite. Node-FS roots a base directory and stores arbitrary metadata in a hidden sidecar manifest (`/.vfskit/meta.json`). S3 talks to a minimal `S3Like` port (so tests inject an in-memory fake, no AWS needed) and emulates POSIX directories with `key/` marker objects; it uses native S3 user-metadata.

**Tech Stack:** TypeScript (strict, ESM), npm workspaces, vitest, `node:fs/promises`, `node:os`, `node:path`.

## Global Constraints

- No comments in code.
- No watermarks in commits (no `Co-Authored-By`, no generated-by trailers); plain messages.
- Minimize lines, characters, and downloaded bytes; compact is the priority.
- TypeScript strict, ESM, English only.
- Adapters return plain object literals implementing `VFS`.
- Streaming stays deferred (`streaming` capability `false`).
- A new adapter is "done" only when `@vfskit/core/conformance`'s `runConformance(make)` passes against it (run via `npm test`), and `npm run typecheck` is green.

---

### Task 1: Node-FS adapter

**Files:**
- Create: `packages/node-fs/package.json`
- Create: `packages/node-fs/src/index.ts`
- Test: `packages/node-fs/src/index.test.ts`

**Interfaces:**
- Consumes: `VFS`, `Entry`, `Meta`, `Capabilities`, opts types, `normalize`, `toBytes`, and errors (`notFound`, `alreadyExists`, `isADirectory`, `notADirectory`, `io`) from `@vfskit/core`; `runConformance` from `@vfskit/core/conformance`.
- Produces: `nodeFs(root: string): VFS`. Capabilities: `{ streaming: false, watch: false, atomicMove: true, nativeMeta: false, randomAccess: false }`. Metadata persisted in `<root>/.vfskit/meta.json`, hidden from `list`.

- [ ] **Step 1: Write the failing test**

`packages/node-fs/src/index.test.ts`:
```ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll } from 'vitest'
import { runConformance } from '@vfskit/core/conformance'
import { nodeFs } from './index'

const roots: string[] = []

runConformance(() => {
  const r = mkdtempSync(join(tmpdir(), 'vfskit-'))
  roots.push(r)
  return nodeFs(r)
})

afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})
```

`packages/node-fs/package.json`:
```json
{
  "name": "@vfskit/node-fs",
  "version": "0.0.0",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "@vfskit/core": "0.0.0" }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm install && npx vitest run packages/node-fs/src/index.test.ts`
Expected: FAIL with cannot find module `./index`.

- [ ] **Step 3: Write minimal implementation**

`packages/node-fs/src/index.ts`:
```ts
import { promises as fs } from 'node:fs'
import { join as pjoin, dirname as pdirname } from 'node:path'
import {
  type VFS, type Entry, type Meta, type Capabilities,
  type ListOpts, type MkdirOpts, type RemoveOpts, type WriteOpts,
  type Unsubscribe,
  normalize, dirname, toBytes,
  notFound, alreadyExists, isADirectory, notADirectory, io,
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
```

Note for the implementer: `dirname` is imported from `@vfskit/core` but only `pdirname` (node) is used above; if `dirname` ends up unused, remove it from the import to satisfy strict/no-unused settings. Keep imports to exactly what is referenced.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/node-fs/src/index.test.ts && npm test && npm run typecheck`
Expected: PASS - node-fs runs the full conformance suite (18 cases), whole suite + typecheck green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(node-fs): real-disk adapter with sidecar metadata"
```

---

### Task 2: S3 adapter (port + in-memory fake + adapter)

**Files:**
- Create: `packages/s3/package.json`
- Create: `packages/s3/src/index.ts`
- Test: `packages/s3/src/index.test.ts`

**Interfaces:**
- Consumes: `VFS`, `Entry`, `Meta`, `Capabilities`, opts types, `normalize`, `dirname`, `toBytes`, errors (`notFound`, `alreadyExists`, `isADirectory`, `notADirectory`, `io`) from `@vfskit/core`; `runConformance` from `@vfskit/core/conformance`.
- Produces:
  - `S3Object`, `S3Like`, `S3Opts` interfaces.
  - `s3(opts: S3Opts): VFS`. Capabilities: `{ streaming: false, watch: false, atomicMove: false, nativeMeta: true, randomAccess: false }`. Directories emulated with `key/` marker objects; metadata stored in the object's native meta.
  - `memoryS3(): S3Like` - an in-memory fake of the port (used by the test and reusable).

- [ ] **Step 1: Write the failing test**

`packages/s3/src/index.test.ts`:
```ts
import { runConformance } from '@vfskit/core/conformance'
import { s3, memoryS3 } from './index'

runConformance(() => s3({ client: memoryS3() }))
```

`packages/s3/package.json`:
```json
{
  "name": "@vfskit/s3",
  "version": "0.0.0",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "@vfskit/core": "0.0.0" }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm install && npx vitest run packages/s3/src/index.test.ts`
Expected: FAIL with cannot find module `./index`.

- [ ] **Step 3: Write minimal implementation**

`packages/s3/src/index.ts`:
```ts
import {
  type VFS, type Entry, type Meta, type Capabilities,
  type ListOpts, type MkdirOpts, type RemoveOpts, type WriteOpts,
  type Unsubscribe,
  normalize, dirname, toBytes,
  notFound, alreadyExists, isADirectory, notADirectory, io,
} from '@vfskit/core'

export interface S3Object { body: Uint8Array; meta: Meta; size: number; mtime: number }
export interface S3Like {
  get(key: string): Promise<S3Object | null>
  put(key: string, body: Uint8Array, meta: Meta): Promise<void>
  del(key: string): Promise<void>
  head(key: string): Promise<{ size: number; mtime: number; meta: Meta } | null>
  list(prefix: string): Promise<{ key: string; size: number; mtime: number }[]>
}
export interface S3Opts { client: S3Like; prefix?: string }

const caps: Capabilities = { streaming: false, watch: false, atomicMove: false, nativeMeta: true, randomAccess: false }
const EMPTY = new Uint8Array(0)

export function memoryS3(): S3Like {
  const m = new Map<string, { body: Uint8Array; meta: Meta; mtime: number }>()
  return {
    async get(k) { const o = m.get(k); return o ? { body: o.body.slice(), meta: { ...o.meta }, size: o.body.length, mtime: o.mtime } : null },
    async put(k, body, meta) { m.set(k, { body: body.slice(), meta: { ...meta }, mtime: Date.now() }) },
    async del(k) { m.delete(k) },
    async head(k) { const o = m.get(k); return o ? { size: o.body.length, mtime: o.mtime, meta: { ...o.meta } } : null },
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
      await c.put(key(p), toBytes(data), wopts?.meta ?? {})
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
        return { type: 'file', size: h?.size ?? 0, mtime: h?.mtime ?? 0, ctime: h?.mtime ?? 0, meta: h?.meta ?? {} }
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
        for (const s of segs) { cur += '/' + s; if ((await kind(cur)) === null) await c.put(marker(cur), EMPTY, {}) }
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
    watch(): Unsubscribe { return () => {} },
  }
}
```

Note for the implementer: `move` uses `this.copy`/`this.remove`. Because the returned object is a plain literal, `this` refers to that literal at call time - this is intentional and required; do not refactor it into closures that drop `this`. If strict `noImplicitThis` complains, keep the methods as shown (object-literal method shorthand provides a typed `this`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/s3/src/index.test.ts && npm test && npm run typecheck`
Expected: PASS - s3 runs the full conformance suite (18 cases) against `memoryS3()`, whole suite + typecheck green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(s3): object-storage adapter over an injectable client port"
```

---

## Self-Review

**Spec coverage (Part 2 scope):**
- Node-FS adapter implementing `VFS` over real disk - Task 1. ✔
- S3 adapter implementing `VFS` over object storage - Task 2. ✔
- Each passes the shared conformance suite (the Part-1 contract gate) - Tasks 1 & 2 run `runConformance`. ✔
- Metadata first-class on adapters without native meta (node-fs sidecar manifest) and with native meta (s3 object metadata). ✔
- S3 tested without AWS via an injected in-memory port fake (`memoryS3`). ✔
- Compact, comment-free, English, ESM, strict - Global Constraints. ✔
- Deferred to Part 3: `remote`/`serve`, transports, facades, Monaco example. Streaming stays deferred.

**Placeholder scan:** No TBD/TODO; every code step contains complete code. ✔

**Type consistency:** Both adapters implement the exact `VFS` signatures from `@vfskit/core`'s `types.ts` (Part 1). Error factory names match Part-1 exports. `runConformance(make)` matches Part-1. `S3Like`/`S3Object`/`S3Opts` are internally consistent between `memoryS3` and `s3`. Capability records use the `Capabilities` shape from Part 1. ✔

## Notes for the executor

- New packages need `npm install` (run before their tests) so workspace symlinks resolve.
- `node:fs` `cp`/`rm` require Node 18+ (already the project floor).
- Node-FS path safety: `normalize` collapses `..` and can never traverse above root, so `pjoin(root, normalizedPath)` stays within `root`.
- The S3 directory emulation depends on consistently using trailing-slash prefixes (`key/`), which is what prevents sibling-prefix confusion (`/d` vs `/dx`).
