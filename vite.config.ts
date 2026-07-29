import { defineConfig } from 'vite'
import { builtinModules } from 'module'
import packageJson from './package.json'

export default defineConfig({
  define: {
    __PO_GENIE_VERSION__: JSON.stringify(packageJson.version),
  },
  build: {
    lib: {
      entry: {
        index: './src/index.ts',
        cli: './src/cli.ts',
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: [
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`),
        'ai',
        '@openrouter/ai-sdk-provider',
        'citty',
        'std-env',
        'dotenv',
        'gettext-parser',
        'zod',
      ],
      output: {
        entryFileNames: '[name].js',
        banner(chunk) {
          if (chunk.name === 'cli') return '#!/usr/bin/env node'
          return ''
        },
      },
    },
    target: 'node20',
    minify: false,
  },
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/cli.ts', 'src/**/*.d.ts'],
    },
  },
})
