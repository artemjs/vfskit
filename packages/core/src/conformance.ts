import { describe, it, expect } from 'vitest'
import type { VFS } from './types'
import { toText } from './bytes'
import { isVfsError } from './errors'

export function runConformance(make: () => VFS): void {
  describe('vfs conformance', () => {
    it('writes and reads a file', async () => {
      const fs = make()
      await fs.write('/a.txt', 'hello')
      expect(toText(await fs.read('/a.txt'))).toBe('hello')
    })
    it('reports existence', async () => {
      const fs = make()
      expect(await fs.exists('/a.txt')).toBe(false)
      await fs.write('/a.txt', 'x')
      expect(await fs.exists('/a.txt')).toBe(true)
    })
    it('stats a file', async () => {
      const fs = make()
      await fs.write('/a.txt', 'hello')
      const s = await fs.stat('/a.txt')
      expect(s.type).toBe('file')
      expect(s.size).toBeGreaterThan(0)
    })
    it('throws NOT_FOUND for missing read', async () => {
      const fs = make()
      let err: unknown
      try { await fs.read('/nope') } catch (e) { err = e }
      expect(isVfsError(err) && err.code).toBe('NOT_FOUND')
    })
    it('lists directory children', async () => {
      const fs = make()
      await fs.mkdir('/d')
      await fs.write('/d/a', '1')
      await fs.write('/d/b', '2')
      const names = (await fs.list('/d')).map((e) => e.name).sort()
      expect(names).toEqual(['a', 'b'])
    })
    it('lists recursively', async () => {
      const fs = make()
      await fs.mkdir('/d')
      await fs.mkdir('/d/sub')
      await fs.write('/d/sub/a', '1')
      const paths = (await fs.list('/d', { recursive: true })).map((e) => e.path).sort()
      expect(paths).toContain('/d/sub/a')
    })
    it('removes a file', async () => {
      const fs = make()
      await fs.write('/a', '1')
      await fs.remove('/a')
      expect(await fs.exists('/a')).toBe(false)
    })
    it('requires recursive to remove a non-empty dir', async () => {
      const fs = make()
      await fs.mkdir('/d')
      await fs.write('/d/a', '1')
      let err: unknown
      try { await fs.remove('/d') } catch (e) { err = e }
      expect(err).toBeTruthy()
      await fs.remove('/d', { recursive: true })
      expect(await fs.exists('/d')).toBe(false)
    })
    it('moves a file', async () => {
      const fs = make()
      await fs.write('/a', '1')
      await fs.move('/a', '/b')
      expect(await fs.exists('/a')).toBe(false)
      expect(toText(await fs.read('/b'))).toBe('1')
    })
    it('copies a file', async () => {
      const fs = make()
      await fs.write('/a', '1')
      await fs.copy('/a', '/b')
      expect(toText(await fs.read('/a'))).toBe('1')
      expect(toText(await fs.read('/b'))).toBe('1')
    })
    it('stores and reads metadata', async () => {
      const fs = make()
      await fs.write('/a', '1', { meta: { tag: 'x' } })
      expect((await fs.getMeta('/a')).tag).toBe('x')
      await fs.setMeta('/a', { tag: 'y' })
      expect((await fs.getMeta('/a')).tag).toBe('y')
    })
    it('emits watch events when supported', async () => {
      const fs = make()
      if (!fs.capabilities().watch) return
      const events: string[] = []
      const off = fs.watch('/', (e) => events.push(e.type + ':' + e.path))
      await fs.write('/a', '1')
      off()
      expect(events).toContain('create:/a')
    })
    it('moves a directory subtree', async () => {
      const fs = make()
      await fs.mkdir('/d')
      await fs.mkdir('/d/sub')
      await fs.write('/d/sub/a', '1')
      await fs.move('/d', '/e')
      expect(await fs.exists('/d')).toBe(false)
      expect(toText(await fs.read('/e/sub/a'))).toBe('1')
    })
    it('copies a directory subtree deeply', async () => {
      const fs = make()
      await fs.mkdir('/d')
      await fs.write('/d/a', '1')
      await fs.copy('/d', '/e')
      await fs.write('/e/a', '2')
      expect(toText(await fs.read('/d/a'))).toBe('1')
      expect(toText(await fs.read('/e/a'))).toBe('2')
    })
    it('isolates returned read buffers from the store', async () => {
      const fs = make()
      await fs.write('/a', 'abc')
      const buf = await fs.read('/a')
      buf[0] = 0
      expect(toText(await fs.read('/a'))).toBe('abc')
    })
    it('does not confuse sibling prefixes', async () => {
      const fs = make()
      await fs.mkdir('/d')
      await fs.mkdir('/dx')
      await fs.write('/dx/a', '1')
      expect((await fs.list('/d')).map((e) => e.name)).not.toContain('a')
    })
    it('reports byte size matching written content', async () => {
      const fs = make()
      await fs.write('/a', 'hello')
      expect((await fs.stat('/a')).size).toBe(5)
    })
    it('throws ALREADY_EXISTS creating an existing dir without recursive', async () => {
      const fs = make()
      await fs.mkdir('/d')
      let err: unknown
      try { await fs.mkdir('/d') } catch (e) { err = e }
      expect(isVfsError(err) && err.code).toBe('ALREADY_EXISTS')
    })
    it('preserves metadata when overwriting content without new meta', async () => {
      const fs = make()
      await fs.write('/a', '1', { meta: { tag: 'x' } })
      await fs.write('/a', '2')
      expect((await fs.getMeta('/a')).tag).toBe('x')
    })
    it('throws NOT_A_DIRECTORY creating a directory under a file', async () => {
      const fs = make()
      await fs.write('/f', '1')
      let err: unknown
      try { await fs.mkdir('/f/sub', { recursive: true }) } catch (e) { err = e }
      expect(isVfsError(err) && err.code).toBe('NOT_A_DIRECTORY')
    })
  })
}
