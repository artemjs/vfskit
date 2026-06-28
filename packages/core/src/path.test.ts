import { describe, it, expect } from 'vitest'
import { normalize, join, dirname, basename, segments } from './path'

describe('path', () => {
  it('normalizes', () => {
    expect(normalize('/a/b/../c')).toBe('/a/c')
    expect(normalize('a/b')).toBe('/a/b')
    expect(normalize('')).toBe('/')
    expect(normalize('/')).toBe('/')
  })
  it('joins', () => {
    expect(join('/a', 'b', 'c')).toBe('/a/b/c')
  })
  it('dirname and basename', () => {
    expect(dirname('/a/b')).toBe('/a')
    expect(dirname('/a')).toBe('/')
    expect(basename('/a/b.txt')).toBe('b.txt')
    expect(basename('/')).toBe('')
  })
  it('segments', () => {
    expect(segments('/a/b')).toEqual(['a', 'b'])
    expect(segments('/')).toEqual([])
  })
})
