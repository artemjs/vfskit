import { type VFS, unsupported, io, VfsError } from '@vfskit/core'

const enc = new TextEncoder()
const dec = new TextDecoder()
export const EMPTY = new Uint8Array(0)

function frame(header: unknown, data: Uint8Array = EMPTY): Uint8Array {
  const h = enc.encode(JSON.stringify(header))
  const out = new Uint8Array(4 + h.length + data.length)
  new DataView(out.buffer).setUint32(0, h.length)
  out.set(h, 4)
  out.set(data, 4 + h.length)
  return out
}

function unframe(bytes: Uint8Array): { header: any; data: Uint8Array } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const n = dv.getUint32(0)
  return { header: JSON.parse(dec.decode(bytes.subarray(4, 4 + n))), data: bytes.subarray(4 + n) }
}

export function encodeCall(method: string, path: string, args: unknown[] = [], data?: Uint8Array): Uint8Array {
  return frame({ m: method, p: path, a: args }, data)
}

export interface DecodedCall { method: string; path: string; args: any[]; data: Uint8Array }
export function decodeCall(bytes: Uint8Array): DecodedCall {
  const { header, data } = unframe(bytes)
  return { method: header.m, path: header.p, args: header.a ?? [], data }
}

export interface DecodedReply { ok: boolean; value?: any; data: Uint8Array; code?: string; message?: string; path?: string }
export function decodeReply(bytes: Uint8Array): DecodedReply {
  const { header, data } = unframe(bytes)
  if (header.ok) return { ok: true, value: header.v, data }
  return { ok: false, data: EMPTY, code: header.c, message: header.e, path: header.p }
}

export async function handle(vfs: VFS, bytes: Uint8Array): Promise<Uint8Array> {
  const { method, path, args, data } = decodeCall(bytes)
  try {
    switch (method) {
      case 'read': return frame({ ok: true }, await vfs.read(path, args[0]))
      case 'write': await vfs.write(path, data, args[0]); return frame({ ok: true })
      case 'list': return frame({ ok: true, v: await vfs.list(path, args[0]) })
      case 'stat': return frame({ ok: true, v: await vfs.stat(path) })
      case 'exists': return frame({ ok: true, v: await vfs.exists(path) })
      case 'mkdir': await vfs.mkdir(path, args[0]); return frame({ ok: true })
      case 'remove': await vfs.remove(path, args[0]); return frame({ ok: true })
      case 'move': await vfs.move(path, args[0]); return frame({ ok: true })
      case 'copy': await vfs.copy(path, args[0]); return frame({ ok: true })
      case 'getMeta': return frame({ ok: true, v: await vfs.getMeta(path) })
      case 'setMeta': await vfs.setMeta(path, args[0]); return frame({ ok: true })
      default: throw unsupported(method)
    }
  } catch (e) {
    const err = e instanceof VfsError ? e : io(String((e as Error)?.message ?? e), path)
    return frame({ ok: false, c: err.code, e: err.message, p: err.path })
  }
}

export function wsPack(type: number, id: number, payload: Uint8Array = EMPTY): Uint8Array {
  const out = new Uint8Array(5 + payload.length)
  out[0] = type
  new DataView(out.buffer).setUint32(1, id)
  out.set(payload, 5)
  return out
}

export function wsUnpack(bytes: Uint8Array): { type: number; id: number; payload: Uint8Array } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { type: bytes[0], id: dv.getUint32(1), payload: bytes.subarray(5) }
}
