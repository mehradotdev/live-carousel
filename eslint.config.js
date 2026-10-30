import svelte from 'eslint-plugin-svelte';
import ts from 'typescript-eslint';
export default [
  { ignores: ['**/.svelte-kit/**', '**/_generated/**', '**/build/**', '**/node_modules/**'] },
  ...svelte.configs.recommended,
  { files: ['**/*.svelte'], languageOptions: { parserOptions: { parser: ts.parser } } },
];
