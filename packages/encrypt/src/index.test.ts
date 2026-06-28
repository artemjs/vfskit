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
