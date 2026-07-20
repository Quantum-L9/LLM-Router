// @ts-check
import tseslint from 'typescript-eslint';

// ESLint v9 flat config. This repo is ESM (`"type": "module"`), TypeScript-only
// (src/ + tests/), with no runtime bundler config to lint.
export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'src/docs/**'],
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      // Router config objects intentionally cast a resolved model string back
      // onto a typed field when applying a budget downgrade (see src/index.ts).
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
