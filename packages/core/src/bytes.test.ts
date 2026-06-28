import { describe, it, expect } from 'vitest'
import { toBytes, toText, concat } from './bytes'

describe('bytes', () => {
  it('round-trips text', () => {
    expect(toText(toBytes('héllo'))).toBe('héllo')
  })
  it('passes through Uint8Array', () => {
    const u = new Uint8Array([1, 2, 3])
    expect(toBytes(u)).toBe(u)
  })
  it('concats', () => {
    expect([...concat([new Uint8Array([1]), new Uint8Array([2, 3])])]).toEqual([1, 2, 3])
  })
})
