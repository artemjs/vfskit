import {
  type VFS, type WatchCb, type Unsubscribe, type Capabilities, type BytesLike, type ErrorCode,
  toBytes, VfsError, unsupported,
} from '@vfskit/core'
import { encodeCall, decodeReply, type DecodedReply } from '@vfskit/rpc'

export interface Transport {
  request(bytes: Uint8Array): Promise<Uint8Array>
  watch?(path: string, cb: WatchCb): Unsubscribe
}
export interface RemoteOpts { transport: Transport; capabilities?: Capabilities }

export function remote(opts: Transport | RemoteOpts): VFS {
  const t: Transport = (opts as Transport).request ? (opts as Transport) : (opts as RemoteOpts).transport
  const caps: Capabilities = (opts as RemoteOpts).capabilities
    ?? { streaming: false, watch: !!t.watch, atomicMove: false, nativeMeta: true, randomAccess: false }
  const call = async (method: string, path: string, args?: unknown[], data?: Uint8Array): Promise<DecodedReply> => {
    const a = args ? [...args] : []
    while (a.length && a[a.length - 1] === undefined) a.pop()
    const r = decodeReply(await t.request(encodeCall(method, path, a, data)))
    if (!r.ok) throw new VfsError(r.code as ErrorCode, r.message ?? '', r.path)
    return r
  }
  return {
    capabilities: () => caps,
    async read(path, ropts) { return (await call('read', path, [ropts])).data },
    async write(path, data: BytesLike, wopts) { await call('write', path, [wopts], toBytes(data)) },
    async list(path, lopts) { return (await call('list', path, [lopts])).value },
    async stat(path) { return (await call('stat', path)).value },
    async exists(path) { return (await call('exists', path)).value },
    async mkdir(path, mopts) { await call('mkdir', path, [mopts]) },
    async remove(path, rmopts) { await call('remove', path, [rmopts]) },
    async move(from, to) { await call('move', from, [to]) },
    async copy(from, to) { await call('copy', from, [to]) },
    async getMeta(path) { return (await call('getMeta', path)).value },
    async setMeta(path, meta) { await call('setMeta', path, [meta]) },
    watch(path, cb) { if (!t.watch) throw unsupported('watch'); return t.watch(path, cb) },
  }
}
