import shared from './config/eslint.shared.js';

// The Testkube frontend rules (see config/eslint.shared.js), plus the few
// adjustments this extension needs.
export default [
  ...shared,
  {
    ignores: ['config/**'],
  },
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    settings: {
      react: {version: '19.3'},
    },
  },
  // Node scripts (packaging): the shared config only declares browser-ish
  // globals for js/ts files.
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {console: 'readonly', process: 'readonly', URL: 'readonly'},
    },
  },
];
