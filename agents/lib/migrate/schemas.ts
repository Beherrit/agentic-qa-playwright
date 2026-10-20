import { z } from 'zod';

/**
 * What the two migration roles have to answer in. The settings migrator reads the old project's configuration and
 * answers with values, each with where it read it; code writes playwright.config.ts from that. The test migrator
 * writes code and answers with a map from every old test and assertion to the new one, which the parity gate
 * checks against the files it actually wrote.
 */

export const Settings = z.object({
  appName: z.string().describe('What the old project calls the app it tests (its README, a config key, the repository name). Empty when it never says'),
  baseUrl: z.string().describe('Where the app answers for tests. Empty when the old project reads it from the environment and gives no default'),
  browsers: z.array(z.enum(['chromium', 'firefox', 'webkit'])).min(1),
  headless: z.boolean(),
  timeoutMs: z.number().int().positive().describe('Per-test timeout. From the old suite\'s longest explicit wait or its runner timeout'),
  expectTimeoutMs: z.number().int().positive().describe('How long an assertion waits. The old explicit wait, usually'),
  retries: z.number().int().min(0).describe('Reruns of a failed test in CI. The old rerun or retry setting, or 0'),
  workers: z.number().int().positive().nullable().describe('Parallel workers: the old thread count, xdist -n or Grid max instances, or null for the default'),
  /** How the old suite ran on a Grid, for the record: Playwright gets its parallelism from workers, not a hub. */
  grid: z.object({ hubUrl: z.string().nullable(), maxInstances: z.number().int().positive().nullable(), note: z.string() }),
  viewport: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).nullable(),
  testIdAttribute: z.string().nullable().describe('The attribute the old locators use for test ids (data-test, data-testid), or null'),
  /** Every environment variable the old suite reads, so .env.example lists them all. */
  envVars: z.array(z.object({ name: z.string().min(1), purpose: z.string(), example: z.string() })),
  personas: z.object({ envVar: z.string(), default: z.string(), list: z.array(z.string()) }),
  auth: z.object({ how: z.string().describe('One or two sentences on how the old tests sign in'), sharedSession: z.boolean().describe('Whether the old suite signs in once and reuses the session') }),
  /**
   * Where each value above came from: the setting by its name here, a file and a key or line. A value with no
   * evidence is a guess and is dropped; `other` is for things worth recording that are not a field above.
   */
  evidence: z.array(
    z.object({
      setting: z.enum(['appName', 'baseUrl', 'browsers', 'headless', 'timeoutMs', 'expectTimeoutMs', 'retries', 'workers', 'viewport', 'testIdAttribute', 'envVars', 'personas', 'auth', 'grid', 'other']),
      file: z.string().min(1),
      where: z.string().min(1),
      value: z.string(),
    }),
  ),
  /** Old settings with no Playwright equivalent, named so a person can decide. */
  unmapped: z.array(z.object({ setting: z.string(), file: z.string(), note: z.string() })),
});
export type Settings = z.infer<typeof Settings>;

export const Kind = z.enum(['page', 'fixture', 'util', 'spec']);

export const Conversion = z.object({
  summary: z.string().min(1).describe('Two or three sentences: what was converted and what a reviewer should look at'),
  /** Every file written or changed, and the old files it came from. */
  files: z.array(z.object({ path: z.string().min(1), from: z.array(z.string()), kind: Kind })),
  /** One entry per old test. The assertion strings are quoted verbatim from both files; the gate looks them up. */
  tests: z.array(
    z.object({
      source: z.object({ file: z.string().min(1), name: z.string().min(1) }),
      target: z.object({ file: z.string().min(1), title: z.string().min(1) }),
      assertions: z.array(
        z.object({
          source: z.string().min(1).describe('The old assertion, one line, exactly as the old file has it'),
          target: z.string().min(1).describe('The new expect call, exactly as the new file has it, on one line'),
        }),
      ),
    }),
  ),
  /** Old tests not converted, each with the reason. Silence is not allowed: the gate counts them. */
  dropped: z.array(z.object({ source: z.object({ file: z.string().min(1), name: z.string().min(1) }), reason: z.string().min(1) })),
  gaps: z.array(z.string()).describe('What a person must check or decide'),
});
export type Conversion = z.infer<typeof Conversion>;
