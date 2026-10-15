import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

const noUnused = ['error', { vars: 'all', args: 'none', caughtErrors: 'none' }];

export default [
  { ignores: ['node_modules/**', 'test/.evidence/**', 'prompts/**', 'session/**'] },
  {
    // The app: browser ES modules (script.js + src/*.js).
    files: ['script.js', 'src/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.browser } },
    rules: { ...js.configs.recommended.rules, 'no-unused-vars': noUnused }
  },
  {
    // Node test harness; browser.js references app globals that exist only in the page.
    files: ['test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.node,
        ...globals.browser,
        App: 'readonly',
        State: 'readonly',
        UI: 'readonly',
        Exporter: 'readonly'
      }
    },
    rules: { ...js.configs.recommended.rules, 'no-unused-vars': noUnused }
  },
  // Turn off ESLint rules that conflict with Prettier's formatting.
  prettier
];
