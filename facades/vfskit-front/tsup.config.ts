import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/conformance.ts'],
  format: ['esm'],
  dts: { resolve: true },
  platform: 'browser',
  clean: true,
  minify: true,
  splitting: false,
  noExternal: [/^@vfskit\//],
})
