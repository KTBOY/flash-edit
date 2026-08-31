import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import prettier from 'eslint-config-prettier'

// TS 编译器负责未定义变量检查，no-undef 在 TS 文件中关闭（typescript-eslint 官方建议）
const NODE_GLOBALS = {
  console: 'readonly',
  process: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  Buffer: 'readonly'
}

export default tseslint.config(
  { ignores: ['out/', 'dist/', 'node_modules/', 'src/renderer/public/'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: NODE_GLOBALS },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ],
      '@typescript-eslint/consistent-type-imports': ['warn', { fixStyle: 'inline-type-imports' }],
      'no-console': ['warn', { allow: ['log', 'warn', 'error'] }]
    }
  },
  {
    files: ['**/*.mjs'],
    languageOptions: { globals: { ...NODE_GLOBALS, fetch: 'readonly', WebSocket: 'readonly' } }
  },
  prettier
)
