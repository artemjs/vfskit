import { concat } from '@vfskit/core'

function dom(name: string) { const e = new Error(name); e.name = name; return e }

export class MockFile {
  kind = 'file' as const
  constructor(public name: string, public data: Uint8Array = new Uint8Array(0)) {}
  async getFile() {
    const data = this.data
    return {
      size: data.length,
      async arrayBuffer() { return data.slice().buffer },
      async text() { return new TextDecoder().decode(data) },
      stream() { return new ReadableStream<Uint8Array>({ start(c) { c.enqueue(data.slice()); c.close() } }) },
    }
  }
  async createWritable() {
    const chunks: Uint8Array[] = []
    const self = this
    return new WritableStream<Uint8Array>({
      write(chunk) { chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk as ArrayBuffer)) },
      close() { self.data = concat(chunks) },
    })
  }
}

export class MockDir {
  kind = 'directory' as const
  children = new Map<string, MockDir | MockFile>()
  constructor(public name = '') {}
  async getDirectoryHandle(name: string, opts?: { create?: boolean }) {
    const e = this.children.get(name)
    if (e) { if (e.kind !== 'directory') throw dom('TypeMismatchError'); return e }
    if (opts?.create) { const d = new MockDir(name); this.children.set(name, d); return d }
    throw dom('NotFoundError')
  }
  async getFileHandle(name: string, opts?: { create?: boolean }) {
    const e = this.children.get(name)
    if (e) { if (e.kind !== 'file') throw dom('TypeMismatchError'); return e }
    if (opts?.create) { const f = new MockFile(name); this.children.set(name, f); return f }
    throw dom('NotFoundError')
  }
  async removeEntry(name: string, opts?: { recursive?: boolean }) {
    const e = this.children.get(name)
    if (!e) throw dom('NotFoundError')
    if (e.kind === 'directory' && e.children.size && !opts?.recursive) throw dom('InvalidModificationError')
    this.children.delete(name)
  }
  async *values() { yield* this.children.values() }
}
