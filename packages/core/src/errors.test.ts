import { describe, it, expect } from 'vitest'
import { notFound, io, isVfsError, VfsError } from './errors'

describe('errors', () => {
  it('builds typed errors', () => {
    const e = notFound('/x')
    expect(e).toBeInstanceOf(VfsError)
    expect(e).toBeInstanceOf(Error)
    expect(e.code).toBe('NOT_FOUND')
    expect(e.path).toBe('/x')
  })
  it('guards', () => {
    expect(isVfsError(notFound('/x'))).toBe(true)
    expect(isVfsError(new Error('plain'))).toBe(false)
    expect(io('disk fail').code).toBe('IO')
  })
})
