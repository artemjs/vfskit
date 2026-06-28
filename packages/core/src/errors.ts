export type ErrorCode =
  | 'NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'NOT_A_DIRECTORY'
  | 'IS_A_DIRECTORY'
  | 'PERMISSION_DENIED'
  | 'UNSUPPORTED'
  | 'IO'

export class VfsError extends Error {
  code: ErrorCode
  path?: string
  constructor(code: ErrorCode, message: string, path?: string) {
    super(message)
    this.name = 'VfsError'
    this.code = code
    this.path = path
  }
}

export const notFound = (p: string) => new VfsError('NOT_FOUND', `not found: ${p}`, p)
export const alreadyExists = (p: string) => new VfsError('ALREADY_EXISTS', `already exists: ${p}`, p)
export const notADirectory = (p: string) => new VfsError('NOT_A_DIRECTORY', `not a directory: ${p}`, p)
export const isADirectory = (p: string) => new VfsError('IS_A_DIRECTORY', `is a directory: ${p}`, p)
export const permissionDenied = (p: string) => new VfsError('PERMISSION_DENIED', `permission denied: ${p}`, p)
export const unsupported = (op: string) => new VfsError('UNSUPPORTED', `unsupported: ${op}`)
export const io = (message: string, path?: string) => new VfsError('IO', message, path)

export function isVfsError(e: unknown): e is VfsError {
  return e instanceof VfsError
}
