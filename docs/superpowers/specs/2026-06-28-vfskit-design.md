# vfskit — Design (v1)

## Summary

`vfskit` is a universal abstraction over any kind of virtual file system: in-memory,
real disk, S3, and (later) IndexedDB/OPFS, databases, blobs, wasm-vfs, and more. Every
backend is exposed through a single `VFS` interface, so application code works with
files, folders, and metadata the same way regardless of where data physically lives.

The project ships in two faces under one brand:

- **`vfskit`** (backend, npm) — the full kit: core + node-fs + s3 + server + remote + encrypt.
- **`vfskit-front`** (frontend, jsDelivr ESM) — browser-safe subset: core + remote client +
  transports + encrypt.

Both expose identical API names, so user code looks the same on either side. The frontend
is a client that talks to a backend over a transport; the backend exposes any `VFS` over
the wire. Encryption is a composable middleware, so `encrypt(remote(transport))` yields
end-to-end encryption where the server only ever sees ciphertext.

## Goals

- One `VFS` interface that every backend implements.
- Composition over monolith: adapters + middleware decorators + a remote bridge.
- Dual publish (npm backend + jsDelivr frontend) under a single brand.
- Encryption as an opt-in middleware, usable for at-rest and end-to-end.
- First-class metadata so arbitrary data can be wrapped into a structured FS.
- A conformance suite so any new adapter "just works" once it passes.
- Compact, comment-free, English-only TypeScript (strict, ESM).

## Non-Goals (v1)

- IndexedDB/OPFS, DB, blob, wasm-vfs adapters (planned, not in v1).
- Caching/index/readonly middleware (architecture leaves room; not implemented in v1).
- Multi-writer conflict resolution / CRDT sync.

## Architecture: "everything is a VFS"

Layered and composable:

- **Core** — the `VFS` interface plus shared types, errors, path utilities, capabilities.
- **Adapters** — implement `VFS` over a concrete backend: `Memory`, `NodeFS`, `S3`.
- **Middleware decorators** — take a `VFS` and return a `VFS`. v1 ships `encrypt(vfs, opts)`.
  The shape leaves room for `cache` / `readonly` / `index` later.
- **Bridge** — `serve(vfs)` exposes a `VFS` over a transport; `remote(transport)` returns a
  client `VFS` whose calls are serialized to the server.

Composition examples:

```ts
const store = encrypt(s3(bucket), { passphrase })          // at-rest encryption on S3
serve(store, { auth })                                       // expose it

const fs = encrypt(remote({ transport: ws(url) }), { key }) // E2E: server sees ciphertext
await fs.write('/notes/todo.md', bytes)
```

## Packages: monorepo + two facades

Internal scoped packages (npm workspaces):

- `@vfskit/core` — interface, types, errors, path utils, capabilities, conformance suite.
- `@vfskit/encrypt` — AES-GCM middleware.
- `@vfskit/memory` — in-memory adapter (conformance reference).
- `@vfskit/node-fs` — real disk adapter (node).
- `@vfskit/s3` — S3 adapter (node).
- `@vfskit/remote` — `remote()` client VFS.
- `@vfskit/server` — `serve()` server handlers.
- `@vfskit/transport-http`, `@vfskit/transport-ws` — transport implementations.

Public facades (what users install), branded as one `vfskit`:

- **`vfskit`** (npm, node): re-exports core + memory + node-fs + s3 + server + remote +
  encrypt + both transports.
- **`vfskit-front`** (npm + jsDelivr, browser): re-exports core + memory + remote + encrypt +
  both client transports. No node/s3 dependencies; browser-safe build.

Both facades export identical API names. Heavy node-only deps (S3 SDK) are optional/peer so
the browser build never pulls them. Stack: TypeScript strict, ESM, no comments, compact.

## VFS interface

```ts
interface VFS {
  read(path: string, opts?: ReadOpts): Promise<Uint8Array>
  write(path: string, data: BytesLike, opts?: WriteOpts): Promise<void>
  list(path: string, opts?: ListOpts): Promise<Entry[]>        // readdir; recursive opt
  stat(path: string): Promise<Stat>                            // type,size,mtime,ctime,meta
  exists(path: string): Promise<boolean>
  mkdir(path: string, opts?: MkdirOpts): Promise<void>
  remove(path: string, opts?: RemoveOpts): Promise<void>       // recursive opt
  move(from: string, to: string): Promise<void>
  copy(from: string, to: string): Promise<void>
  getMeta(path: string): Promise<Meta>
  setMeta(path: string, meta: Meta): Promise<void>
  watch(path: string, cb: WatchCb): Unsubscribe
  readStream(path: string, opts?: ReadOpts): ReadableStream<Uint8Array>
  writeStream(path: string, opts?: WriteOpts): WritableStream<Uint8Array>
  capabilities(): Capabilities
}
```

- **Paths** are POSIX strings, normalized, root `/`. Path utilities live in core.
- **Data** is `Uint8Array`; text helpers (`readText` / `writeText`) wrap encoding.
- **Metadata is first-class.** `getMeta` / `setMeta` store arbitrary user metadata. Adapters
  without native metadata persist it in a sidecar manifest under `/.vfskit/`. This is what
  lets vfskit wrap arbitrary data into files + metadata to form a structured FS.

## Capabilities + conformance

Each adapter declares a `Capabilities` record: `streaming`, `watch`, `atomicMove`,
`nativeMeta`, `randomAccess`. Callers can branch on capabilities; middleware passes them
through (or amends, e.g. encrypt disables `randomAccess`).

The shared **conformance suite** in `@vfskit/core` runs the same behavioral battery against
any `VFS`. `Memory` is the reference implementation. Any new adapter that passes the suite
is considered correct. The suite skips checks for capabilities an adapter doesn't declare.

## Encryption

- **Algorithm**: AES-256-GCM via WebCrypto (works on node 18+ and browsers).
- **Key**: a raw key (imported once), or a passphrase derived via PBKDF2-SHA256 at 210000
  iterations using a per-file random salt.
- **Per-file**: random salt and random IV; the envelope `magic(3) + salt(16) + iv(12) +
  ciphertext+tag` is the stored blob (47 bytes overhead). `stat().size` reports plaintext size.
- **Tamper detection**: GCM auth tag fails closed; a bad envelope or failed decrypt raises a
  typed `VfsError('IO')`.
- **Key handling**: raw-key mode derives once and caches; passphrase mode derives per file
  from that file's salt (secure but per-op cost — prefer raw-key for high-frequency I/O).
- **Scope**: content is encrypted by default; filename obfuscation (path → HMAC) is opt-in.
- **Composition**: as a middleware it wraps any VFS; wrapping `remote(...)` gives E2E so the
  server stores only ciphertext.

Encryption changes capabilities (no random access; streaming deferred).

## Bridge protocol

RPC that maps 1:1 to `VFS` methods. Control messages are JSON (`method`, `path`, `opts`);
content travels as binary frames.

- **HTTP** (`@vfskit/transport-http`): one request per call; content streamed in the body.
  Works on serverless/edge. No `watch` (or long-poll fallback).
- **WS** (`@vfskit/transport-ws`): multiplexed, framed messages; enables `watch`/events and
  bidirectional streaming.

`serve(vfs, { auth })` returns handlers for both a node `http` server and a fetch-style
handler. `remote({ transport })` builds the client VFS. Errors serialize by stable code and
re-throw as the same typed error on the client.

## Errors

Typed hierarchy with stable wire codes:

`VfsError` → `NotFound`, `AlreadyExists`, `NotADirectory`, `IsADirectory`,
`PermissionDenied`, `Unsupported` (capability missing), `Io` (catch-all backend failure).

Adapters normalize native errors (node `errno`, S3 status codes) into this hierarchy. The
bridge serializes `{ code, message }` and reconstructs the typed error on the client.

## Testing strategy

- **Conformance suite** run against each adapter (Memory, NodeFS, S3).
- **Unit**: encrypt round-trip + tamper detection; path utils; error mapping per adapter.
- **Bridge integration**: `remote(memory)` ↔ `serve(memory)` over both HTTP and WS,
  including an E2E-encrypt path that asserts the server-side bytes are ciphertext.
- **S3**: a local mock (in-memory S3 or minio) so CI needs no AWS credentials.

## Proof of concept / examples

vfskit is a single abstract layer that many products sit on top of. Documented examples:

- **Dropbox-like storage** — folders, metadata, sharing-by-prefix, optional encryption.
- **Encrypted vault** — `encrypt(remote(...))` for end-to-end private storage.
- **App-embedded structured storage** — wrap arbitrary app data into a structured FS.

The runnable v1 example is a **Monaco-based editor over the real FS** (cheaper than S3, no
external deps): `remote(ws)` → `serve(nodeFs)`, editing and saving files in a local folder
with per-user prefix isolation. Switching the backend to S3 is a one-line change
(`nodeFs(dir)` → `s3(bucket)`), which demonstrates the power of the abstraction.

## Open questions

- Final facade naming: confirm `vfskit` + `vfskit-front` vs. a single package with a
  `vfskit/front` browser subpath served by jsDelivr.
- Whether `watch` over HTTP should long-poll or simply be unsupported (capability off).
