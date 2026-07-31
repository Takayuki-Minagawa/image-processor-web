import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

const javascriptAndTypescriptFiles = ['**/*.{js,mjs,cjs,ts,tsx}']
const typescriptFiles = ['**/*.{ts,tsx}']

export default [
  {
    ignores: [
      'coverage/**',
      'dist/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  {
    ...js.configs.recommended,
    files: javascriptAndTypescriptFiles,
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: typescriptFiles,
  })),
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/exhaustive-deps': 'error',
      'react-hooks/rules-of-hooks': 'error',
    },
  },
  {
    files: ['src/**/*.tsx'],
    ...reactRefresh.configs.vite,
  },
  {
    files: [
      'e2e/**/*.ts',
      'scripts/**/*.mjs',
      '*.config.{js,mjs,ts}',
      'vite.config.ts',
    ],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    files: ['public/sw.js'],
    languageOptions: {
      globals: {
        ...globals.serviceworker,
        __PIXELWEAVE_PRECACHE__: 'readonly',
      },
    },
  },
  {
    files: ['src/lib/fileCore.ts', 'src/lib/files.ts'],
    rules: {
      // The control range is intentional: filenames are sanitized before save.
      'no-control-regex': 'off',
    },
  },
  prettier,
]
