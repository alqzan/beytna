// إعداد ESLint بسيط (flat config) — يغطي app.js وملفات Node المساعدة.
// index.html غير مشمول هنا (لا يدعم ESLint السكربتات المضمّنة في HTML مباشرة)؛
// يُفحص يدوياً + عبر build-check.mjs. هذا محدود عن قصد حتى نرحّل لـ TypeScript/Vite في P2.
export default [
  {
    ignores: ['node_modules/**', 'migration/tmp/**'],
  },
  {
    files: ['app.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        navigator: 'readonly',
        console: 'readonly',
        React: 'readonly',
        ReactDOM: 'readonly',
        htm: 'readonly',
        crypto: 'readonly',
        Blob: 'readonly',
        URL: 'readonly',
        FileReader: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': 'warn',
      'no-undef': 'error',
    },
  },
  {
    files: ['scripts/**/*.mjs', 'tests/**/*.mjs', 'migration/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': 'warn',
    },
  },
]
