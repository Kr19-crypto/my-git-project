import js from '@eslint/js'
import globals from 'globals'

export default [
  {
    ignores: ['dist/', 'node_modules/', 'test/*.test.mjs'],
  },
  js.configs.recommended,
  {
    files: ['src/**/*.ts', 'dsh/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
        window: 'readonly',
        document: 'readonly',
        EventSource: 'readonly',
        localStorage: 'readonly',
        navigator: 'readonly',
        fetch: 'readonly',
        console: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': 'warn',
      'no-undef': 'off',
    },
  },
]
