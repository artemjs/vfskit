import { describe, it, expect } from 'vitest'
import { runConformance } from '@vfskit/core/conformance'
import { toText, readStream, collect } from '@vfskit/core'
import { opfs } from './index'
import { MockDir } from './mock'

const root = () => new MockDir() as unknown as FileSystemDirectoryHandle

runConformance(() => opfs(root()))

describe('opfs', () => {
  it('streams natively from a stored file', async () => {
    const fs = opfs(root())
    await fs.write('/a', 'hello opfs')
    expect(toText(await collect(await readStream(fs, '/a')))).toBe('hello opfs')
  })
  it('reports streaming capability', () => {
    expect(opfs(root()).capabilities().streaming).toBe(true)
  })
})
