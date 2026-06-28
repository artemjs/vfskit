import type { VFS, ReadOpts, WriteOpts } from './types'
import { concat } from './bytes'

export async function readStream(vfs: VFS, path: string, opts?: ReadOpts): Promise<ReadableStream<Uint8Array>> {
  if (vfs.readStream) return vfs.readStream(path, opts)
  const data = await vfs.read(path, opts)
  return new ReadableStream({ start(c) { c.enqueue(data); c.close() } })
}

export async function writeStream(vfs: VFS, path: string, opts?: WriteOpts): Promise<WritableStream<Uint8Array>> {
  if (vfs.writeStream) return vfs.writeStream(path, opts)
  const chunks: Uint8Array[] = []
  return new WritableStream({
    write(c) { chunks.push(c) },
    async close() { await vfs.write(path, concat(chunks), opts) },
  })
}

export async function collect(s: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  const r = s.getReader()
  for (;;) { const { done, value } = await r.read(); if (done) break; if (value) chunks.push(value) }
  return concat(chunks)
}
