import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: { resolve: true },
  platform: 'node',
  clean: true,
  minify: true,
  noExternal: [/^@vfskit\//],
})
