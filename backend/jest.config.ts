import type { Config } from 'jest';

/**
 * All tests live in `z-test/`, mirroring how this project separates test intent:
 *   unit/    isolated logic, no I/O
 *   e2e/     the HTTP surface via supertest, real Nest app
 *   golden/  responses captured from the legacy backend, replayed here — the
 *            gate that proves the rewrite is behaviour-identical before the
 *            dashboard is pointed at it
 */
const config: Config = {
  rootDir: '.',
  testEnvironment: 'node',
  roots: ['<rootDir>/z-test'],
  testRegex: '.*\\.(spec|e2e-spec|golden-spec)\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.module.ts', '!src/main.ts'],
  coverageDirectory: 'coverage',
  // Golden comparisons hit a live legacy backend; the default 5s is too tight.
  testTimeout: 30_000,
  /**
   * One worker, so suites run in sequence.
   *
   * Every suite that authenticates uses the same account, and each login bumps
   * `token_version` — which revokes the token any concurrently running suite is
   * holding. In parallel that produces 401s that look like parity failures and
   * move around between runs.
   *
   * The alternative, an account per suite, would mean creating and deleting
   * users in a database shared with other work. Serial execution costs a few
   * seconds and keeps the suite honest.
   */
  maxWorkers: 1,
  /**
   * Loaded into every test file before it runs. Replaces `globalThis.fetch`
   * with one that throws on a request to a generative AI provider.
   *
   * The prohibition is absolute — that key bills a real account per token with
   * no ceiling — and six agents work this repo in parallel, so it cannot rest
   * on everyone remembering. See the file for what this layer does and does not
   * reach: it covers this process, not the two backend processes the golden
   * suite drives over HTTP.
   */
  /**
   * 🔴 `reflect-metadata` FIRST. `@Type(() => …)` from class-transformer reads
   * `design:type` at DECORATION time, so a spec that imports a DTO carrying one
   * dies with "Reflect.getMetadata is not a function" before a single
   * assertion runs — three suites did on 23/08, none of them about broadcasts.
   *
   * Nest loads this in `main.ts`; a unit spec has no `main.ts`, so the test
   * runner has to. เทสไม่มี main.ts ⇒ ต้องโหลดตรงนี้.
   */
  setupFiles: ['reflect-metadata', '<rootDir>/z-test/lib/test-env.ts', '<rootDir>/z-test/lib/no-ai-outbound.ts'],
};

export default config;
