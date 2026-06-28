import { describe, it, expect } from 'vitest'
import { memory, encrypt, toText } from './index'

describe('vfskit-front facade', () => {
  it('round-trips encrypted in-memory storage', async () => {
    const fs = encrypt(memory(), { passphrase: 'pw' })
    await fs.write('/a', 'secret')
    expect(toText(await fs.read('/a'))).toBe('secret')
  })
})
