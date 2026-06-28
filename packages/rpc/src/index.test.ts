import { describe, it, expect } from 'vitest'
import { memory } from '@vfskit/memory'
import { encodeCall, decodeReply, handle } from './index'

describe('rpc', () => {
  it('round-trips write then read', async () => {
    const fs = memory()
    await handle(fs, encodeCall('write', '/a', [], new TextEncoder().encode('hi')))
    const r = decodeReply(await handle(fs, encodeCall('read', '/a')))
    expect(r.ok).toBe(true)
    expect(new TextDecoder().decode(r.data)).toBe('hi')
  })
  it('carries typed error codes', async () => {
    const r = decodeReply(await handle(memory(), encodeCall('read', '/nope')))
    expect(r.ok).toBe(false)
    expect(r.code).toBe('NOT_FOUND')
  })
})
