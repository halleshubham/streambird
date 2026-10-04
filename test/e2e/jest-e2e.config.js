/** End-to-end tests: real Postgres + the real app. Run with `npm run test:e2e` (needs E2E_DATABASE_URL). */
module.exports = {
  rootDir: '.',
  testRegex: '.*\\.e2e-spec\\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../../tsconfig.json', diagnostics: { warnOnly: false } }] },
  testEnvironment: 'node',
  testTimeout: 60000,
  maxWorkers: 1,
  // The test HTTP client keeps connections alive; don't wait for them to time out.
  forceExit: true,
};
