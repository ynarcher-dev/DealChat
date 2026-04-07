// node_modules는 Google Drive 밖(C:/DealChat-deps)에 설치됨
// 실행: node C:/DealChat-deps/node_modules/jest-cli/bin/jest.js
const DEPS = 'C:/DealChat-deps/node_modules';

module.exports = {
  testEnvironment: `${DEPS}/jest-environment-jsdom`,
  setupFiles: ['<rootDir>/tests/setup.js'],
  testMatch: ['**/*.test.js'],
  testPathIgnorePatterns: [],
  transform: {
    '^.+\\.js$': `${DEPS}/babel-jest`
  }
};
