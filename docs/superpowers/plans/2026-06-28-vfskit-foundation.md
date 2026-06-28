# vfskit Foundation Implementation Plan (Part 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the vfskit core (one `VFS` interface, shared types, errors, path/bytes utils), a reusable conformance suite, an in-memory adapter that passes it, and an AES-GCM `encrypt` middleware that also passes it.

**Architecture:** A monorepo of small `@vfskit/*` packages. `@vfskit/core` holds the interface plus pure utilities and a behavioral conformance suite. Adapters and middleware implement/wrap the `VFS` interface and are validated by running the same conformance suite against them.

**Tech Stack:** TypeScript (strict, ESM), npm workspaces, vitest, WebCrypto (AES-GCM, PBKDF2).

## Global Constraints

- No comments in code.
- No watermarks in commits (no `Co-Authored-By`, no generated-by trailers); plain messages.
- Minimize lines, characters, and downloaded bytes; compact is the priority.
- TypeScript strict, ESM, English only.
- Adapters/middleware return plain object literals implementing `VFS` (so spread-delegation works).
- Streaming (`readStream`/`writeStream`) is deferred; the `streaming` capability stays `false` in v1.

---

### Task 1: Monorepo scaffold + core types + path utils

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `packages/core/package.json`
- Create: `packages/core/src/types.ts`
- Create: `packages/core/src/path.ts`
- Create: `packages/core/src/index.ts`
- Test: `packages/core/src/path.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: package `@vfskit/core` exporting the `VFS`, `Stat`, `Entry`, `Meta`, `BytesLike`, `ReadOpts`, `WriteOpts`, `ListOpts`, `MkdirOpts`, `RemoveOpts`, `Capabilities`, `WatchEvent`, `WatchCb`, `Unsubscribe`, `FileType` types and path fns `normalize(p)`, `join(...parts)`, `dirname(p)`, `basename(p)`, `segments(p)` (all `=> string`, `segments => string[]`).

- [ ] **Step 1: Write the failing test**

`packages/core/src/path.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { normalize, join, dirname, basename, segments } from './path'

describe('path', () => {
  it('normalizes', () => {
    expect(normalize('/a/b/../c')).toBe('/a/c')
    expect(normalize('a/b')).toBe('/a/b')
    expect(normalize('')).toBe('/')
    expect(normalize('/')).toBe('/')
  })
  it('joins', () => {
    expect(join('/a', 'b', 'c')).toBe('/a/b/c')
  })
  it('dirname and basename', () => {
    expect(dirname('/a/b')).toBe('/a')
    expect(dirname('/a')).toBe('/')
    expect(basename('/a/b.txt')).toBe('b.txt')
    expect(basename('/')).toBe('')
  })
  it('segments', () => {
    expect(segments('/a/b')).toEqual(['a', 'b'])
    expect(segments('/')).toEqual([])
  })
})
```

- [ ] **Step 2: Create scaffold files**

`package.json`:
```json
{
  "name": "vfskit-monorepo",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*", "facades/*"],
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "declaration": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "lib": ["ES2022", "DOM"],
    "types": []
  }
}
```

`tsconfig.json`:
```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["packages/*/src/**/*", "facades/*/src/**/*"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['packages/**/*.test.ts', 'facades/**/*.test.ts'] },
})
```

`packages/core/package.json`:
```json
{
  "name": "@vfskit/core",
  "version": "0.0.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./conformance": "./src/conformance.ts"
  }
}
```

`packages/core/src/types.ts`:
```ts
export type BytesLike = Uint8Array | ArrayBuffer | string
export type FileType = 'file' | 'dir'
export interface Meta { [k: string]: unknown }

export interface Stat {
  type: FileType
  size: number
  mtime: number
  ctime: number
  meta: Meta
}

export interface Entry {
  name: string
  path: string
  type: FileType
}

export interface ReadOpts { signal?: AbortSignal }
export interface WriteOpts { meta?: Meta; signal?: AbortSignal }
export interface ListOpts { recursive?: boolean }
export interface MkdirOpts { recursive?: boolean }
export interface RemoveOpts { recursive?: boolean }

export interface Capabilities {
  streaming: boolean
  watch: boolean
  atomicMove: boolean
  nativeMeta: boolean
  randomAccess: boolean
}

export interface WatchEvent { type: 'create' | 'update' | 'remove'; path: string }
export type WatchCb = (e: WatchEvent) => void
export type Unsubscribe = () => void

export interface VFS {
  read(path: string, opts?: ReadOpts): Promise<Uint8Array>
  write(path: string, data: BytesLike, opts?: WriteOpts): Promise<void>
  list(path: string, opts?: ListOpts): Promise<Entry[]>
  stat(path: string): Promise<Stat>
  exists(path: string): Promise<boolean>
  mkdir(path: string, opts?: MkdirOpts): Promise<void>
  remove(path: string, opts?: RemoveOpts): Promise<void>
  move(from: string, to: string): Promise<void>
  copy(from: string, to: string): Promise<void>
  getMeta(path: string): Promise<Meta>
  setMeta(path: string, meta: Meta): Promise<void>
  watch(path: string, cb: WatchCb): Unsubscribe
  capabilities(): Capabilities
}
```

`packages/core/src/path.ts`:
```ts
const SEP = '/'

export function normalize(p: string): string {
  const out: string[] = []
  for (const part of p.split(SEP)) {
    if (part === '' || part === '.') continue
    if (part === '..') { out.pop(); continue }
    out.push(part)
  }
  return SEP + out.join(SEP)
}

export function join(...parts: string[]): string {
  return normalize(parts.join(SEP))
}

export function dirname(p: string): string {
  const n = normalize(p)
  const i = n.lastIndexOf(SEP)
  return i <= 0 ? SEP : n.slice(0, i)
}

export function basename(p: string): string {
  const n = normalize(p)
  return n.slice(n.lastIndexOf(SEP) + 1)
}

export function segments(p: string): string[] {
  return normalize(p).split(SEP).filter(Boolean)
}
```

`packages/core/src/index.ts`:
```ts
export * from './types'
export * from './path'
```

- [ ] **Step 3: Install and run the test to verify it fails**

Run: `npm install && npx vitest run packages/core/src/path.test.ts`
Expected: FAIL initially only if path.ts is wrong; if it already passes, that is acceptable since path.ts is provided. If install fails, fix workspace config before continuing.

- [ ] **Step 4: Run the full check**

Run: `npm test && npm run typecheck`
Expected: path tests PASS, typecheck PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): monorepo scaffold, types and path utils"
```

---

### Task 2: Core errors

**Files:**
- Create: `packages/core/src/errors.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/errors.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `VfsError` class with `code: ErrorCode` and `path?: string`; `ErrorCode` union; factory fns `notFound(p)`, `alreadyExists(p)`, `notADirectory(p)`, `isADirectory(p)`, `permissionDenied(p)`, `unsupported(op)`, `io(message, path?)`; guard `isVfsError(e): e is VfsError`.

- [ ] **Step 1: Write the failing test**

`packages/core/src/errors.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { notFound, io, isVfsError, VfsError } from './errors'

describe('errors', () => {
  it('builds typed errors', () => {
    const e = notFound('/x')
    expect(e).toBeInstanceOf(VfsError)
    expect(e).toBeInstanceOf(Error)
    expect(e.code).toBe('NOT_FOUND')
    expect(e.path).toBe('/x')
  })
  it('guards', () => {
    expect(isVfsError(notFound('/x'))).toBe(true)
    expect(isVfsError(new Error('plain'))).toBe(false)
    expect(io('disk fail').code).toBe('IO')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/src/errors.test.ts`
Expected: FAIL with cannot find module `./errors`.

- [ ] **Step 3: Write minimal implementation**

`packages/core/src/errors.ts`:
```ts
export type ErrorCode =
  | 'NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'NOT_A_DIRECTORY'
  | 'IS_A_DIRECTORY'
  | 'PERMISSION_DENIED'
  | 'UNSUPPORTED'
  | 'IO'

export class VfsError extends Error {
  code: ErrorCode
  path?: string
  constructor(code: ErrorCode, message: string, path?: string) {
    super(message)
    this.name = 'VfsError'
    this.code = code
    this.path = path
  }
}

export const notFound = (p: string) => new VfsError('NOT_FOUND', `not found: ${p}`, p)
export const alreadyExists = (p: string) => new VfsError('ALREADY_EXISTS', `already exists: ${p}`, p)
export const notADirectory = (p: string) => new VfsError('NOT_A_DIRECTORY', `not a directory: ${p}`, p)
export const isADirectory = (p: string) => new VfsError('IS_A_DIRECTORY', `is a directory: ${p}`, p)
export const permissionDenied = (p: string) => new VfsError('PERMISSION_DENIED', `permission denied: ${p}`, p)
export const unsupported = (op: string) => new VfsError('UNSUPPORTED', `unsupported: ${op}`)
export const io = (message: string, path?: string) => new VfsError('IO', message, path)

export function isVfsError(e: unknown): e is VfsError {
  return e instanceof VfsError
}
```

Modify `packages/core/src/index.ts` to add:
```ts
export * from './errors'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/src/errors.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): typed error hierarchy"
```

---

### Task 3: Core bytes utils

**Files:**
- Create: `packages/core/src/bytes.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/bytes.test.ts`

**Interfaces:**
- Consumes: `BytesLike` from `./types`.
- Produces: `toBytes(d: BytesLike): Uint8Array`, `toText(d: Uint8Array): string`, `concat(parts: Uint8Array[]): Uint8Array`.

- [ ] **Step 1: Write the failing test**

`packages/core/src/bytes.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { toBytes, toText, concat } from './bytes'

describe('bytes', () => {
  it('round-trips text', () => {
    expect(toText(toBytes('héllo'))).toBe('héllo')
  })
  it('passes through Uint8Array', () => {
    const u = new Uint8Array([1, 2, 3])
    expect(toBytes(u)).toBe(u)
  })
  it('concats', () => {
    expect([...concat([new Uint8Array([1]), new Uint8Array([2, 3])])]).toEqual([1, 2, 3])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/src/bytes.test.ts`
Expected: FAIL with cannot find module `./bytes`.

- [ ] **Step 3: Write minimal implementation**

`packages/core/src/bytes.ts`:
```ts
import type { BytesLike } from './types'

const enc = new TextEncoder()
const dec = new TextDecoder()

export function toBytes(d: BytesLike): Uint8Array {
  if (typeof d === 'string') return enc.encode(d)
  if (d instanceof Uint8Array) return d
  return new Uint8Array(d)
}

export function toText(d: Uint8Array): string {
  return dec.decode(d)
}

export function concat(parts: Uint8Array[]): Uint8Array {
  let n = 0
  for (const p of parts) n += p.length
  const out = new Uint8Array(n)
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}
```

Modify `packages/core/src/index.ts` to add:
```ts
export * from './bytes'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/src/bytes.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): bytes and text utils"
```

---

### Task 4: Conformance suite + Memory adapter

**Files:**
- Create: `packages/core/src/conformance.ts`
- Create: `packages/memory/package.json`
- Create: `packages/memory/src/index.ts`
- Test: `packages/memory/src/index.test.ts`

**Interfaces:**
- Consumes: `VFS` and utils from `@vfskit/core`; `runConformance` from `@vfskit/core/conformance`.
- Produces: `runConformance(make: () => VFS): void` (registers vitest suite); `memory(): VFS` factory. Memory capabilities: `{ streaming: false, watch: true, atomicMove: true, nativeMeta: true, randomAccess: false }`.

- [ ] **Step 1: Write the conformance suite (the failing test harness)**

`packages/core/src/conformance.ts`:
```ts
import { describe, it, expect } from 'vitest'
import type { VFS } from './types'
import { toText } from './bytes'
import { isVfsError } from './errors'

export function runConformance(make: () => VFS): void {
  describe('vfs conformance', () => {
    it('writes and reads a file', async () => {
      const fs = make()
      await fs.write('/a.txt', 'hello')
      expect(toText(await fs.read('/a.txt'))).toBe('hello')
    })
    it('reports existence', async () => {
      const fs = make()
      expect(await fs.exists('/a.txt')).toBe(false)
      await fs.write('/a.txt', 'x')
      expect(await fs.exists('/a.txt')).toBe(true)
    })
    it('stats a file', async () => {
      const fs = make()
      await fs.write('/a.txt', 'hello')
      const s = await fs.stat('/a.txt')
      expect(s.type).toBe('file')
      expect(s.size).toBeGreaterThan(0)
    })
    it('throws NOT_FOUND for missing read', async () => {
      const fs = make()
      let err: unknown
      try { await fs.read('/nope') } catch (e) { err = e }
      expect(isVfsError(err) && err.code).toBe('NOT_FOUND')
    })
    it('lists directory children', async () => {
      const fs = make()
      await fs.mkdir('/d')
      await fs.write('/d/a', '1')
      await fs.write('/d/b', '2')
      const names = (await fs.list('/d')).map((e) => e.name).sort()
      expect(names).toEqual(['a', 'b'])
    })
    it('lists recursively', async () => {
      const fs = make()
      await fs.mkdir('/d')
      await fs.mkdir('/d/sub')
      await fs.write('/d/sub/a', '1')
      const paths = (await fs.list('/d', { recursive: true })).map((e) => e.path).sort()
      expect(paths).toContain('/d/sub/a')
    })
    it('removes a file', async () => {
      const fs = make()
      await fs.write('/a', '1')
      await fs.remove('/a')
      expect(await fs.exists('/a')).toBe(false)
    })
    it('requires recursive to remove a non-empty dir', async () => {
      const fs = make()
      await fs.mkdir('/d')
      await fs.write('/d/a', '1')
      let err: unknown
      try { await fs.remove('/d') } catch (e) { err = e }
      expect(err).toBeTruthy()
      await fs.remove('/d', { recursive: true })
      expect(await fs.exists('/d')).toBe(false)
    })
    it('moves a file', async () => {
      const fs = make()
      await fs.write('/a', '1')
      await fs.move('/a', '/b')
      expect(await fs.exists('/a')).toBe(false)
      expect(toText(await fs.read('/b'))).toBe('1')
    })
    it('copies a file', async () => {
      const fs = make()
      await fs.write('/a', '1')
      await fs.copy('/a', '/b')
      expect(toText(await fs.read('/a'))).toBe('1')
      expect(toText(await fs.read('/b'))).toBe('1')
    })
    it('stores and reads metadata', async () => {
      const fs = make()
      await fs.write('/a', '1', { meta: { tag: 'x' } })
      expect((await fs.getMeta('/a')).tag).toBe('x')
      await fs.setMeta('/a', { tag: 'y' })
      expect((await fs.getMeta('/a')).tag).toBe('y')
    })
    it('emits watch events when supported', async () => {
      const fs = make()
      if (!fs.capabilities().watch) return
      const events: string[] = []
      const off = fs.watch('/', (e) => events.push(e.type + ':' + e.path))
      await fs.write('/a', '1')
      off()
      expect(events).toContain('create:/a')
    })
  })
}
```

`packages/memory/package.json`:
```json
{
  "name": "@vfskit/memory",
  "version": "0.0.0",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "@vfskit/core": "0.0.0" }
}
```

`packages/memory/src/index.test.ts`:
```ts
import { runConformance } from '@vfskit/core/conformance'
import { memory } from './index'

runConformance(() => memory())
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm install && npx vitest run packages/memory/src/index.test.ts`
Expected: FAIL with cannot find module `./index` (memory not implemented).

- [ ] **Step 3: Write minimal implementation**

`packages/memory/src/index.ts`:
```ts
import {
  type VFS, type Entry, type Meta, type Capabilities,
  type ListOpts, type MkdirOpts, type RemoveOpts, type WriteOpts,
  type WatchCb, type WatchEvent, type Unsubscribe,
  normalize, dirname, toBytes,
  notFound, alreadyExists, notADirectory, isADirectory, io,
} from '@vfskit/core'

type FileNode = { type: 'file'; data: Uint8Array; meta: Meta; mtime: number; ctime: number }
type DirNode = { type: 'dir'; meta: Meta; mtime: number; ctime: number }
type Node = FileNode | DirNode

const caps: Capabilities = { streaming: false, watch: true, atomicMove: true, nativeMeta: true, randomAccess: false }

export function memory(): VFS {
  const t = () => Date.now()
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
      const ctime = prev ? prev.ctime : t()
      nodes.set(p, {
        type: 'file',
        data: toBytes(data).slice(),
        meta: opts?.meta ?? (prev as FileNode | undefined)?.meta ?? {},
        ctime,
        mtime: t(),
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
      return { type: n.type, size: n.type === 'file' ? n.data.length : 0, mtime: n.mtime, ctime: n.ctime, meta: { ...n.meta } }
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
          if (!nodes.has(cur)) { nodes.set(cur, { type: 'dir', meta: {}, mtime: t(), ctime: t() }); emit('create', cur) }
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
            ? { type: 'file', data: node.data.slice(), meta: { ...node.meta }, mtime: node.mtime, ctime: node.ctime }
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/memory/src/index.test.ts && npm run typecheck`
Expected: PASS (all conformance cases green).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core,memory): conformance suite and in-memory adapter"
```

---

### Task 5: Encrypt middleware

**Files:**
- Create: `packages/encrypt/package.json`
- Create: `packages/encrypt/src/index.ts`
- Test: `packages/encrypt/src/index.test.ts`

**Interfaces:**
- Consumes: `VFS`, `Capabilities`, `toBytes`, `concat` from `@vfskit/core`; `memory` from `@vfskit/memory` (dev/test only); `runConformance` from `@vfskit/core/conformance`.
- Produces: `encrypt(inner: VFS, opts: EncryptOpts): VFS`; `EncryptOpts = { key?: Uint8Array; passphrase?: string }`. Encrypted capabilities force `streaming: false`, `randomAccess: false`. Envelope = `MAGIC(3) || iv(12) || ciphertext+tag`.

- [ ] **Step 1: Write the failing test**

`packages/encrypt/src/index.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { runConformance } from '@vfskit/core/conformance'
import { toText } from '@vfskit/core'
import { memory } from '@vfskit/memory'
import { encrypt } from './index'

const KEY = new Uint8Array(32).fill(7)

runConformance(() => encrypt(memory(), { key: KEY }))

describe('encrypt', () => {
  it('stores ciphertext, not plaintext', async () => {
    const inner = memory()
    const fs = encrypt(inner, { key: KEY })
    await fs.write('/a', 'secret')
    const raw = await inner.read('/a')
    expect(toText(raw).includes('secret')).toBe(false)
    expect(toText(await fs.read('/a'))).toBe('secret')
  })
  it('round-trips via passphrase', async () => {
    const inner = memory()
    const fs = encrypt(inner, { passphrase: 'pw' })
    await fs.write('/a', 'secret')
    expect(toText(await fs.read('/a'))).toBe('secret')
  })
  it('fails to decrypt tampered data', async () => {
    const inner = memory()
    const fs = encrypt(inner, { key: KEY })
    await fs.write('/a', 'secret')
    const raw = await inner.read('/a')
    raw[20] ^= 0xff
    await inner.write('/a', raw)
    let err: unknown
    try { await fs.read('/a') } catch (e) { err = e }
    expect(err).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/encrypt/src/index.test.ts`
Expected: FAIL with cannot find module `./index`.

- [ ] **Step 3: Write minimal implementation**

`packages/encrypt/package.json`:
```json
{
  "name": "@vfskit/encrypt",
  "version": "0.0.0",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "@vfskit/core": "0.0.0" },
  "devDependencies": { "@vfskit/memory": "0.0.0" }
}
```

`packages/encrypt/src/index.ts`:
```ts
import { type VFS, type Capabilities, toBytes, concat } from '@vfskit/core'

export interface EncryptOpts { key?: Uint8Array; passphrase?: string }

const MAGIC = new Uint8Array([0x56, 0x4b, 0x01])
const subtle = globalThis.crypto.subtle

async function deriveKey(o: EncryptOpts): Promise<CryptoKey> {
  if (o.key) return subtle.importKey('raw', o.key, 'AES-GCM', false, ['encrypt', 'decrypt'])
  if (o.passphrase) {
    const base = await subtle.importKey('raw', new TextEncoder().encode(o.passphrase), 'PBKDF2', false, ['deriveKey'])
    return subtle.deriveKey(
      { name: 'PBKDF2', salt: new TextEncoder().encode('vfskit/v1'), iterations: 100000, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )
  }
  throw new Error('encrypt: key or passphrase required')
}

function randomIv(): Uint8Array {
  const iv = new Uint8Array(12)
  globalThis.crypto.getRandomValues(iv)
  return iv
}

export function encrypt(inner: VFS, opts: EncryptOpts): VFS {
  const keyP = deriveKey(opts)
  const caps: Capabilities = { ...inner.capabilities(), streaming: false, randomAccess: false }
  return {
    ...inner,
    capabilities: () => caps,
    async write(path, data, o) {
      const key = await keyP
      const iv = randomIv()
      const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, toBytes(data)))
      await inner.write(path, concat([MAGIC, iv, ct]), o)
    },
    async read(path) {
      const key = await keyP
      const raw = await inner.read(path)
      const pt = await subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(3, 15) }, key, raw.slice(15))
      return new Uint8Array(pt)
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm install && npx vitest run packages/encrypt/src/index.test.ts && npm test && npm run typecheck`
Expected: PASS (encrypt unit tests + conformance via encrypt(memory) + all prior tests + typecheck).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(encrypt): aes-gcm middleware"
```

---

## Self-Review

**Spec coverage (Part 1 scope):**
- One `VFS` interface - Task 1 (`types.ts`). ✔
- Path/bytes utils - Tasks 1, 3. ✔
- Typed error hierarchy with codes - Task 2. ✔
- Capabilities + conformance suite - Task 4. ✔
- Memory adapter (conformance reference) - Task 4. ✔
- First-class metadata (`getMeta`/`setMeta`, `write({meta})`) - Tasks 1, 4 (memory), conformance asserts it. ✔
- Encryption (AES-GCM, key or passphrase, per-file IV, tamper detection, composable) - Task 5. ✔
- Compact, comment-free, English, ESM, strict - enforced by Global Constraints. ✔
- Deferred to later parts: node-fs, s3 (Part 2); remote/serve, transports, facades, example (Part 3). Streaming deferred entirely (capability stays false).

**Placeholder scan:** No TBD/TODO; every code step contains complete code. ✔

**Type consistency:** `VFS` method names and signatures in `types.ts` match memory and encrypt implementations and the conformance suite. Error factory names (`notFound`, `io`, etc.) match memory usage. `runConformance(make)` signature matches all call sites. `EncryptOpts` matches test usage. ✔

## Notes for the executor

- Internal cross-package imports resolve via npm workspaces symlinks + each package's `exports` map pointing at `./src/*.ts`. vitest (esbuild) and `tsc` (Bundler resolution) both read these.
- `Date.now()` is used in the memory adapter; that is fine in project code.
- Keep `conformance.ts` out of the core runtime barrel (`index.ts`) so consumers never pull `vitest` into production; it is exposed only via the `@vfskit/core/conformance` subpath.
