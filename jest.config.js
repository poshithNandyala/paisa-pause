/** Render smoke tests for real screens (domain/data tests run with Vitest). */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/src/**/*.render.test.tsx'],
  setupFiles: ['<rootDir>/jest.setup.js'],
};
