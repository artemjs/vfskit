import { describe, it } from 'vitest'
import { conformanceCases } from 'vfskit/conformance'
import { kvVfs, type Kv } from './kv-vfs'

function makeKv(): Kv {
  const m = new Map<string, string>()
  return { get: (k) => m.get(k), set: (k, v) => void m.set(k, v), delete: (k) => void m.delete(k), keys: () => m.keys() }
}

describe('custom kv adapter passes vfskit conformance', () => {
  for (const c of conformanceCases) it(c.name, () => c.run(() => kvVfs(makeKv())))
})
