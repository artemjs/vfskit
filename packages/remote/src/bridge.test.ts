import { describe, it, expect } from 'vitest'
import { runConformance } from '@vfskit/core/conformance'
import { memory } from '@vfskit/memory'
import { serve } from '@vfskit/server'
import { decodeCall } from '@vfskit/rpc'
import { httpTransport, type FetchLike } from '@vfskit/transport-http'
import { wsTransport, type SocketLike } from '@vfskit/transport-ws'
import { remote, type Transport } from './index'

describe('remote wire', () => {
  it('omits absent opts so server-side defaults survive', async () => {
    let seen: unknown = 'unset'
    const srv = serve(memory())
    const t: Transport = { request: (b) => { seen = decodeCall(b).args[0]; return srv.handle(b) } }
    const fs = remote(t)
    await fs.mkdir('/d')
    expect(seen).toBe(undefined)
    await fs.list('/d')
    expect(seen).toBe(undefined)
  })
})

runConformance(() => {
  const srv = serve(memory())
  return remote({ request: (b) => srv.handle(b) })
})

runConformance(() => {
  const srv = serve(memory())
  const f: FetchLike = (_url, init) => srv.fetch(new Request('http://x', { method: 'POST', body: init.body as unknown as BodyInit }))
  return remote(httpTransport('http://x', f))
})

runConformance(() => {
  const srv = serve(memory())
  const client: SocketLike = {
    readyState: 1,
    binaryType: 'arraybuffer',
    onopen: null,
    onmessage: null,
    send(b) { void server.message(b) },
  }
  const server = srv.socket((bytes) => { client.onmessage?.({ data: bytes }) })
  return remote(wsTransport('ws://x', () => client))
})
