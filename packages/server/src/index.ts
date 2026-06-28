import { type VFS, type Unsubscribe } from '@vfskit/core'
import { handle, wsPack, wsUnpack } from '@vfskit/rpc'

const enc = new TextEncoder()
const dec = new TextDecoder()

export interface Socket { message(bytes: Uint8Array): Promise<void>; close(): void }
export interface Server {
  handle(bytes: Uint8Array): Promise<Uint8Array>
  fetch(req: Request): Promise<Response>
  socket(send: (bytes: Uint8Array) => void): Socket
}

export function serve(vfs: VFS): Server {
  return {
    handle: (bytes) => handle(vfs, bytes),
    async fetch(req) {
      const body = new Uint8Array(await req.arrayBuffer())
      return new Response(await handle(vfs, body) as unknown as BodyInit, { headers: { 'content-type': 'application/octet-stream' } })
    },
    socket(send) {
      const subs = new Map<number, Unsubscribe>()
      return {
        async message(bytes) {
          const { type, id, payload } = wsUnpack(bytes)
          if (type === 0) send(wsPack(1, id, await handle(vfs, payload)))
          else if (type === 2) {
            const { path } = JSON.parse(dec.decode(payload))
            subs.set(id, vfs.watch(path, (e) => send(wsPack(4, id, enc.encode(JSON.stringify(e))))))
          } else if (type === 3) { subs.get(id)?.(); subs.delete(id) }
        },
        close() { for (const o of subs.values()) o(); subs.clear() },
      }
    },
  }
}
