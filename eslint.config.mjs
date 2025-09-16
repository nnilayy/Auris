import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        // Browser/WebAudio + Chrome extension globals
        ...globals.browser,
        chrome: 'readonly',
        AudioContext: 'readonly',
      },
    },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      curly: ['error', 'all'],
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
    ignores: ['node_modules/**', 'icons/**', 'images/**', 'reference/**', 'pages/**', 'styles.css'],
  },
];
