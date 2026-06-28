# vfskit

Universal abstraction over any virtual file system - in-memory, real disk, S3, and (soon)
IndexedDB/OPFS, databases, blobs, wasm-vfs. One `VFS` interface, composable adapters,
encryption middleware, and a remote bridge so a browser client can drive any backend.

Two faces, one brand:

- **`vfskit`** (npm, Node) - the full kit: core + memory + node-fs + s3 + encrypt + serve + remote.
- **`vfskit-front`** (npm + jsDelivr, browser) - core + memory + encrypt + a remote client.

Both expose identical API names, so your code looks the same on either side.

## Install

```sh
npm i vfskit              # backend / Node
```

```js
// browser, no build step
import { remote, wsTransport } from 'https://cdn.jsdelivr.net/npm/vfskit-front/+esm'
```

## Everything is a VFS

```ts
interface VFS {
  read(path): Promise<Uint8Array>
  write(path, data, opts?): Promise<void>
  list(path, opts?): Promise<Entry[]>
  stat(path): Promise<Stat>
  exists(path): Promise<boolean>
  mkdir(path, opts?): Promise<void>
  remove(path, opts?): Promise<void>
  move(from, to): Promise<void>
  copy(from, to): Promise<void>
  getMeta(path): Promise<Meta>
  setMeta(path, meta): Promise<void>
  watch(path, cb): Unsubscribe
  capabilities(): Capabilities
}
```

- **Adapters** implement `VFS` over a backend: `memory()`, `nodeFs(dir)`, `s3({ client })`.
- **Middleware** wraps a `VFS` and returns a `VFS`: `encrypt(vfs, { passphrase })`.
- **Bridge** connects them across the wire: `serve(vfs)` on the server, `remote(transport)` on the client.

Compose freely. `encrypt(remote(transport))` is end-to-end encryption - the server only ever
stores ciphertext.

## Quick start

```ts
import { memory, nodeFs, encrypt, serve, remote, toText } from 'vfskit'

const store = encrypt(nodeFs('./data'), { passphrase: 'hunter2' })
await store.write('/notes/todo.md', '# buy milk', { meta: { tag: 'home' } })
console.log(toText(await store.read('/notes/todo.md')))
```

Expose a backend, drive it from anywhere:

```ts
// server
const server = serve(nodeFs('./data'))
// wire server.fetch (HTTP) or server.socket (WebSocket) into your runtime
```

```ts
// client (browser or Node)
import { remote, wsTransport } from 'vfskit-front'
const fs = remote(wsTransport('ws://localhost:3000'))
await fs.write('/hello.txt', 'hi')
```

## Adapters

| Adapter | Where | Metadata | Notes |
| --- | --- | --- | --- |
| `memory()` | anywhere | native | reference implementation |
| `nodeFs(dir)` | Node | sidecar `.vfskit/meta.json` | rooted at `dir` |
| `s3({ client, prefix? })` | Node | native object metadata | inject any `S3Like` client; POSIX dirs emulated with markers |

Every adapter passes the same conformance suite, so a new one "just works" once it does too.

## Encryption

AES-256-GCM via WebCrypto. A raw key, or a passphrase derived per file with PBKDF2 (random
salt, 210k iterations). Tamper fails closed with a typed error. Content is encrypted by
default; metadata stays as the backend stores it.

```ts
const vault = encrypt(memory(), { passphrase: 'open sesame' })
```

## Transports

- `httpTransport(url)` - request/response; works on serverless/edge. No `watch`.
- `wsTransport(url)` - multiplexed; enables `watch`/events.

## Example

`examples/cloud-ide` - Monaco editing files on a real-disk VFS over a WebSocket bridge, with
per-user isolation. Swapping the backend to S3 is one line.

## License

MIT
