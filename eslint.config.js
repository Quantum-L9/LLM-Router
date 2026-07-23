import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'artifacts/**', 'coverage/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    files: ['src/**/*.ts'],
    ignores: ['src/index.ts', 'src/providers/**'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/providers/*', '**/providers/**'],
          message: 'Provider clients are an I/O boundary. Route production execution through src/index.ts.',
        }],
      }],
    },
  },
  {
    // CI hygiene: the repo's required ESLint check runs `eslint .` (whole
    // tree), not just src/. Allow the conventional underscore prefix for
    // intentionally-unused parameters and give Node scripts their globals.
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
      },
    },
  },
);
