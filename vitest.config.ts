import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      { find: 'vfskit/conformance', replacement: src('./packages/core/src/conformance.ts') },
      { find: 'vfskit-front/conformance', replacement: src('./packages/core/src/conformance.ts') },
      { find: /^vfskit$/, replacement: src('./facades/vfskit/src/index.ts') },
      { find: /^vfskit-front$/, replacement: src('./facades/vfskit-front/src/index.ts') },
    ],
  },
  test: { globals: true, include: ['packages/**/*.test.ts', 'facades/**/*.test.ts', 'examples/**/*.test.ts'] },
})
