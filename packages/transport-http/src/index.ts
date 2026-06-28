import type { Transport } from '@vfskit/remote'

export type FetchLike = (url: string, init: { method: string; body: Uint8Array }) => Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>

export function httpTransport(url: string, fetchImpl?: FetchLike): Transport {
  const f: FetchLike = fetchImpl ?? ((u, init) => fetch(u, init as RequestInit))
  return {
    async request(bytes) {
      const res = await f(url, { method: 'POST', body: bytes })
      return new Uint8Array(await res.arrayBuffer())
    },
  }
}
