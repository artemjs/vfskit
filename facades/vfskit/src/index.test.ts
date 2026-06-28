import { describe, it, expect } from 'vitest'
import { memory, encrypt, serve, remote, toText } from './index'

describe('vfskit facade', () => {
  it('composes adapter + encryption + bridge end-to-end', async () => {
    const srv = serve(encrypt(memory(), { key: new Uint8Array(32).fill(1) }))
    const fs = remote({ request: (b) => srv.handle(b) })
    await fs.write('/a', 'hi')
    expect(toText(await fs.read('/a'))).toBe('hi')
  })
})
