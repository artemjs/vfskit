import { type VFS, type Capabilities, toBytes, concat, io } from '@vfskit/core'

export interface EncryptOpts { key?: Uint8Array; passphrase?: string }

const MAGIC = new Uint8Array([0x56, 0x4b, 0x01])
const OVERHEAD = 47
const subtle = globalThis.crypto.subtle

function rand(n: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(n)
  globalThis.crypto.getRandomValues(b)
  return b
}

async function derivePass(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return subtle.deriveKey(
    { name: 'PBKDF2', salt: salt.slice(), iterations: 210000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export function encrypt(inner: VFS, opts: EncryptOpts): VFS {
  if (!opts.key && !opts.passphrase) throw new Error('encrypt: key or passphrase required')
  const rawKeyP = opts.key ? subtle.importKey('raw', opts.key.slice(), 'AES-GCM', false, ['encrypt', 'decrypt']) : null
  const getKey = (salt: Uint8Array) => rawKeyP ?? derivePass(opts.passphrase!, salt)
  const caps: Capabilities = { ...inner.capabilities(), streaming: false, randomAccess: false }
  return {
    ...inner,
    capabilities: () => caps,
    async stat(path) {
      const s = await inner.stat(path)
      return s.type === 'file' ? { ...s, size: Math.max(0, s.size - OVERHEAD) } : s
    },
    async write(path, data, o) {
      const salt = rand(16)
      const iv = rand(12)
      const key = await getKey(salt)
      const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, toBytes(data).slice()))
      await inner.write(path, concat([MAGIC, salt, iv, ct]), o)
    },
    async read(path, o) {
      const raw = await inner.read(path, o)
      if (raw.length < OVERHEAD || raw[0] !== MAGIC[0] || raw[1] !== MAGIC[1] || raw[2] !== MAGIC[2]) throw io('invalid ciphertext', path)
      const key = await getKey(raw.slice(3, 19))
      let pt: ArrayBuffer
      try {
        pt = await subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(19, 31) }, key, raw.slice(31))
      } catch {
        throw io('decryption failed', path)
      }
      return new Uint8Array(pt)
    },
  }
}
