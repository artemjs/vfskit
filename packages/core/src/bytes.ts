import type { BytesLike } from './types'

const enc = new TextEncoder()
const dec = new TextDecoder()

export function toBytes(d: BytesLike): Uint8Array {
  if (typeof d === 'string') return enc.encode(d)
  if (d instanceof Uint8Array) return d
  return new Uint8Array(d)
}

export function toText(d: Uint8Array): string {
  return dec.decode(d)
}

export function concat(parts: Uint8Array[]): Uint8Array {
  let n = 0
  for (const p of parts) n += p.length
  const out = new Uint8Array(n)
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}
