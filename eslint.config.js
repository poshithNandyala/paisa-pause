// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'android/*', 'ios/*'],
  },
  {
    rules: {
      // Apostrophes in React Native <Text> are plain text, not HTML entities.
      'react/no-unescaped-entities': 'off',
    },
  },
  {
    // Tests may use Node built-ins and loose typing for debugging helpers.
    files: ['**/__tests__/**', '**/__render__/**', 'jest.setup.js'],
    languageOptions: { globals: { jest: 'readonly' } },
  },
]);
