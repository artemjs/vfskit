import type { WatchCb } from '@vfskit/core'
import type { Transport } from '@vfskit/remote'
import { wsPack, wsUnpack, EMPTY } from '@vfskit/rpc'

const enc = new TextEncoder()
const dec = new TextDecoder()

export interface SocketLike {
  send(data: Uint8Array): void
  readyState: number
  binaryType?: string
  onmessage: ((ev: { data: any }) => void) | null
  onopen?: ((ev?: any) => void) | null
  addEventListener?(type: string, cb: (ev?: any) => void): void
}

export function wsTransport(url: string, factory?: () => SocketLike): Transport {
  const sock = factory ? factory() : (new WebSocket(url) as unknown as SocketLike)
  try { sock.binaryType = 'arraybuffer' } catch {}
  const pending = new Map<number, (b: Uint8Array) => void>()
  const subs = new Map<number, WatchCb>()
  let counter = 0
  const ready = sock.readyState === 1
    ? Promise.resolve()
    : new Promise<void>((res) => { sock.addEventListener ? sock.addEventListener('open', () => res()) : (sock.onopen = () => res()) })
  sock.onmessage = (ev) => {
    const { type, id, payload } = wsUnpack(new Uint8Array(ev.data))
    if (type === 1) { pending.get(id)?.(payload); pending.delete(id) }
    else if (type === 4) subs.get(id)?.(JSON.parse(dec.decode(payload)))
  }
  return {
    async request(bytes) {
      await ready
      const id = ++counter
      return new Promise((res) => { pending.set(id, res); sock.send(wsPack(0, id, bytes)) })
    },
    watch(path, cb) {
      const id = ++counter
      subs.set(id, cb)
      ready.then(() => sock.send(wsPack(2, id, enc.encode(JSON.stringify({ path })))))
      return () => { subs.delete(id); ready.then(() => sock.send(wsPack(3, id, EMPTY))) }
    },
  }
}
