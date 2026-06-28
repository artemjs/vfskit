export type BytesLike = Uint8Array | ArrayBuffer | string
export type FileType = 'file' | 'dir'
export interface Meta { [k: string]: unknown }

export interface Stat {
  type: FileType
  size: number
  mtime: number
  ctime: number
  meta: Meta
}

export interface Entry {
  name: string
  path: string
  type: FileType
}

export interface ReadOpts { signal?: AbortSignal }
export interface WriteOpts { meta?: Meta; signal?: AbortSignal }
export interface ListOpts { recursive?: boolean }
export interface MkdirOpts { recursive?: boolean }
export interface RemoveOpts { recursive?: boolean }

export interface Capabilities {
  streaming: boolean
  watch: boolean
  atomicMove: boolean
  nativeMeta: boolean
  randomAccess: boolean
}

export interface WatchEvent { type: 'create' | 'update' | 'remove'; path: string }
export type WatchCb = (e: WatchEvent) => void
export type Unsubscribe = () => void

export interface VFS {
  read(path: string, opts?: ReadOpts): Promise<Uint8Array>
  write(path: string, data: BytesLike, opts?: WriteOpts): Promise<void>
  list(path: string, opts?: ListOpts): Promise<Entry[]>
  stat(path: string): Promise<Stat>
  exists(path: string): Promise<boolean>
  mkdir(path: string, opts?: MkdirOpts): Promise<void>
  remove(path: string, opts?: RemoveOpts): Promise<void>
  move(from: string, to: string): Promise<void>
  copy(from: string, to: string): Promise<void>
  getMeta(path: string): Promise<Meta>
  setMeta(path: string, meta: Meta): Promise<void>
  watch(path: string, cb: WatchCb): Unsubscribe
  capabilities(): Capabilities
}
