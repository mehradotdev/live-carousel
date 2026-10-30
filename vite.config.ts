import { defineConfig } from 'vite-plus';
export default defineConfig({
  fmt: {
    singleQuote: true,
    ignorePatterns: [
      'pnpm-lock.yaml',
      '**/.svelte-kit/**',
      '**/_generated/**',
      '**/build/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  lint: {
    ignorePatterns: [
      '**/.svelte-kit/**',
      '**/_generated/**',
      '**/build/**',
      '**/node_modules/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  staged: { '!(*.svelte)': 'vp check --fix', '*.svelte': ['prettier --write', 'eslint --fix'] },
  test: { include: ['apps/web/src/**/*.test.ts'], environment: 'node' },
});
