# vfskit Bridge + Facades + 1.0 Plan (Part 3 of 3)

**Goal:** Add the remote bridge (`serve`/`remote` + HTTP & WS transports) so a browser client drives any backend VFS, ship two branded facades, a runnable example, and prepare every package for npm 1.0.

## Packages

- `@vfskit/rpc` — transport-agnostic wire codec (`encodeCall`/`decodeReply`/`handle`) + WS frame helpers (`wsPack`/`wsUnpack`). Maps 1:1 to VFS methods; JSON header + binary payload.
- `@vfskit/server` — `serve(vfs)` → `{ handle, fetch, socket }`. `handle` is the core; `fetch` is HTTP (request/response); `socket(send)` is WS duplex incl. watch push.
- `@vfskit/remote` — `remote(transport)` → client `VFS`. Defines `Transport`. `watch` only when the transport supports it; else `Unsupported`.
- `@vfskit/transport-http` — `httpTransport(url, fetch?)` client (request/response; no watch).
- `@vfskit/transport-ws` — `wsTransport(url, factory?)` client (multiplexed by id; watch via event frames).

## Contract gate

The bridge passes the SAME `@vfskit/core/conformance` suite over three in-memory wirings (no network): loopback (`remote → server.handle`), HTTP (`remote → fake fetch → server.fetch`), WS (`remote → fake socket pair → server.socket`). WS wiring exercises real watch event push.

## Facades (branded as one `vfskit`)

- `vfskit` (npm/node): re-exports core, memory, node-fs, s3, encrypt, serve, remote, both transports.
- `vfskit-front` (npm + jsDelivr/browser): re-exports core, memory, encrypt, remote, both transports. No node/s3.

## Example

`examples/cloud-ide` — Monaco + `remote(wsTransport)` ↔ `serve(nodeFs(dir))` with per-user prefix isolation; switching to S3 is one line.

## npm 1.0 prep

Per published package: `version 1.0.0`, internal deps `^1.0.0`, `description`, `keywords`, `license: MIT`, `repository`, `files: ["dist"]`, `sideEffects: false`, exports → built `dist` (types + js), `build` script (tsc). Dev keeps using `src` via vitest alias + tsconfig paths. Root: LICENSE, README, build all, verify `npm pack --dry-run`.

## Open decisions (resolved)

- Facades: `vfskit` + `vfskit-front`.
- `watch`: WS only; HTTP transport reports `watch:false`.
- `remote` capabilities: best-effort static (`watch` reflects transport), overridable.
