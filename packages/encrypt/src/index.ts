import { type VFS, type Capabilities, toBytes, concat, io } from '@vfskit/core'

export interface EncryptOpts { key?: Uint8Array; passphrase?: string }

const MAGIC = new Uint8Array([0x56, 0x4b, 0x01])
const subtle = globalThis.crypto.subtle

async function deriveKey(o: EncryptOpts): Promise<CryptoKey> {
  if (o.key) return subtle.importKey('raw', o.key.slice(), 'AES-GCM', false, ['encrypt', 'decrypt'])
  if (o.passphrase) {
    const base = await subtle.importKey('raw', new TextEncoder().encode(o.passphrase), 'PBKDF2', false, ['deriveKey'])
    return subtle.deriveKey(
      { name: 'PBKDF2', salt: new TextEncoder().encode('vfskit/v1'), iterations: 100000, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )
  }
  throw new Error('encrypt: key or passphrase required')
}

function randomIv(): Uint8Array<ArrayBuffer> {
  const iv = new Uint8Array(12)
  globalThis.crypto.getRandomValues(iv)
  return iv
}

export function encrypt(inner: VFS, opts: EncryptOpts): VFS {
  const keyP = deriveKey(opts)
  const caps: Capabilities = { ...inner.capabilities(), streaming: false, randomAccess: false }
  return {
    ...inner,
    capabilities: () => caps,
    async stat(path) {
      const s = await inner.stat(path)
      return s.type === 'file' ? { ...s, size: Math.max(0, s.size - 31) } : s
    },
    async write(path, data, o) {
      const key = await keyP
      const iv = randomIv()
      const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, toBytes(data).slice()))
      await inner.write(path, concat([MAGIC, iv, ct]), o)
    },
    async read(path, o) {
      const key = await keyP
      const raw = await inner.read(path, o)
      if (raw.length < 31 || raw[0] !== MAGIC[0] || raw[1] !== MAGIC[1] || raw[2] !== MAGIC[2]) throw io('invalid ciphertext', path)
      let pt: ArrayBuffer
      try {
        pt = await subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(3, 15) }, key, raw.slice(15))
      } catch {
        throw io('decryption failed', path)
      }
      return new Uint8Array(pt)
    },
  }
}
