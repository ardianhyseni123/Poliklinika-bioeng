import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // The old app (docs/) and the admin tools keep their own conventions until cutover.
  { ignores: ['dist/', 'docs/', 'node_modules/', 'tools/', 'tests/*.cjs'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.browser }
    }
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules
    }
  },
  {
    rules: {
      // Unused values are allowed when deliberately prefixed with an underscore.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
      // Fire-and-forget writes are intended: the write journal observes their outcome.
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }]
    }
  },
  {
    files: ['scripts/**/*.mjs', 'eslint.config.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: { ...globals.node } }
  }
);
