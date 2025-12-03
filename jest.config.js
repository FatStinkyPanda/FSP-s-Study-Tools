module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  // Skip integration tests that require native modules
  // These tests require real SQLite and should run in Electron environment
  testPathIgnorePatterns: [
    '/node_modules/',
    'DatabaseManager\\.test\\.ts$',
    'SemanticIndexer\\.test\\.ts$',
    'ProgressManager\\.test\\.ts$',  // Depends on DatabaseManager
    'ContentChunker\\.test\\.ts$',   // Memory-intensive, causes heap exhaustion
    'TestGenerator\\.test\\.ts$',    // Depends on DatabaseManager
  ],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/*.test.ts',
    '!src/**/*.spec.ts',
    '!src/__mocks__/**',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // Mock native modules that cause issues in Jest
    '^better-sqlite3$': '<rootDir>/src/__mocks__/better-sqlite3.ts',
  },
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  verbose: true,
  // Memory optimization settings
  maxWorkers: 2,  // Limit parallel workers to reduce memory usage
  workerIdleMemoryLimit: '512MB',  // Restart workers when they exceed memory limit
  testTimeout: 30000,  // 30 second timeout for tests
  // Force garbage collection between tests
  logHeapUsage: true,
};
