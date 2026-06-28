import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll } from 'vitest'
import { runConformance } from '@vfskit/core/conformance'
import { nodeFs } from './index'

const roots: string[] = []

runConformance(() => {
  const r = mkdtempSync(join(tmpdir(), 'vfskit-'))
  roots.push(r)
  return nodeFs(r)
})

afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})
