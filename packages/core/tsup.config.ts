import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/github-api.ts',
    'src/mask-sensitive.ts',
    'src/template.ts',
    'src/types.ts',
    'src/cli-types.ts',
  ],
  format: ['esm'],
  dts: true,
  target: 'node22',
  platform: 'node',
  clean: true,
  // Externalize dynamic imports from cli-types.ts to reduce bundle size
  external: ['@actions/core'],
})
