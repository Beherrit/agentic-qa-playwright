import { chromium } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config, PROMPTS_DIR, ROOT } from './lib/paths.ts';

/**
 * Checks that a checkout is ready to run the pipeline, before any agent is started.
 * It is the first thing to run after pointing the shell at a new app.
 *
 * Usage: npm run pipeline -- doctor
 */

type Level = 'ok' | 'warn' | 'fail';
export type Check = { name: string; level: Level; detail: string };

const ROLES = [
  'requirements-analyst',
  'technical-reviewer',
  'test-architect',
  'plan-critic',
  'plan-reconciler',
  'automation-engineer',
  'code-reviewer',
  'failure-triager',
  'test-healer',
  'ticket-writer',
];

const runs = (command: string): boolean => spawnSync(command, { cwd: ROOT, shell: true, stdio: 'ignore' }).status === 0;

/** The checks that only look at the configuration, so they can be tested without a network or a browser. */
export function configChecks(cfg: typeof config, has: (file: string) => boolean): Check[] {
  const missingDocs = [cfg.app?.brief, cfg.conventions, 'docs/test-design.md'].filter((file) => !file || !has(file));
  const missingDirs = (cfg.writable ?? []).filter((dir) => !has(dir));
  const badDirs = (cfg.writable ?? []).filter((dir) => !dir.endsWith('/'));
  const score = cfg.minPlanScore;
  return [
    {
      name: 'App under test',
      level: /^https?:\/\/\S+$/.test(cfg.app?.baseUrl ?? '') && cfg.app?.name ? 'ok' : 'fail',
      detail: cfg.app?.name ? `${cfg.app.name} at ${cfg.app.baseUrl}` : 'qa.config.json needs app.name and app.baseUrl',
    },
    {
      name: 'Project documents',
      level: missingDocs.length ? 'fail' : 'ok',
      detail: missingDocs.length ? `missing: ${missingDocs.join(', ')}` : 'product brief, conventions and test design notes found',
    },
    {
      name: 'Writable folders',
      level: !cfg.writable?.length || missingDirs.length || badDirs.length ? 'fail' : 'ok',
      detail: !cfg.writable?.length
        ? 'qa.config.json lists no writable folders'
        : badDirs.length
          ? `each folder must end with "/": ${badDirs.join(', ')}`
          : missingDirs.length
            ? `missing: ${missingDirs.join(', ')}`
            : cfg.writable.join(', '),
    },
    {
      name: 'Pass mark',
      level: typeof score === 'number' && score >= 0 && score <= 100 && cfg.stabilityRuns >= 1 ? 'ok' : 'fail',
      detail: `plan score ${score}, stability runs ${cfg.stabilityRuns}`,
    },
    {
      name: 'Sensitivity targets',
      level: cfg.sensitivity?.targets?.length ? 'ok' : 'warn',
      detail: cfg.sensitivity?.targets?.length
        ? cfg.sensitivity.targets.map((target) => target.name).join(', ')
        : 'none: new tests will not be tried against a known-broken version of the app',
    },
  ];
}

async function reachable(url: string): Promise<Check> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    return { name: 'App reachable', level: response.status < 500 ? 'ok' : 'fail', detail: `${url} answered ${response.status}` };
  } catch (error) {
    return { name: 'App reachable', level: 'fail', detail: `${url}: ${error instanceof Error ? error.message : error}` };
  }
}

export async function doctor(): Promise<boolean> {
  const has = (file: string): boolean => fs.existsSync(path.join(ROOT, file));
  const [major, minor] = process.versions.node.split('.').map(Number);
  const missingPrompts = ROLES.filter((role) => !fs.existsSync(path.join(PROMPTS_DIR, `${role}.md`)));
  const token = Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY);
  const jira = Boolean(process.env.JIRA_BASE_URL && process.env.JIRA_EMAIL && process.env.JIRA_API_TOKEN);
  const dirty = spawnSync('git', ['status', '--porcelain', '--', ...(config.writable ?? [])], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();

  const checks: Check[] = [
    ...configChecks(config, has),
    {
      name: 'Agent instructions',
      level: missingPrompts.length ? 'fail' : 'ok',
      detail: missingPrompts.length ? `missing in agents/prompts: ${missingPrompts.join(', ')}` : `${ROLES.length} roles`,
    },
    {
      name: 'Node',
      level: major > 22 || (major === 22 && minor >= 18) ? 'ok' : 'fail',
      detail: `${process.versions.node} (22.18 or newer is needed)`,
    },
    {
      name: 'Browser',
      level: fs.existsSync(chromium.executablePath()) ? 'ok' : 'fail',
      detail: fs.existsSync(chromium.executablePath()) ? 'Chromium is installed' : 'run: npx playwright install chromium',
    },
    await reachable(config.app.baseUrl),
    {
      name: 'Claude credentials',
      level: token ? 'ok' : 'warn',
      detail: token ? 'found in the environment' : 'none in the environment; a signed-in Claude Code CLI works too',
    },
    {
      name: 'GitHub issues',
      level: runs('gh --version') ? 'ok' : 'warn',
      detail: runs('gh --version') ? 'gh is installed' : 'gh is not installed: only needed to read GitHub issues from this machine',
    },
    {
      name: 'Jira',
      level: jira ? 'ok' : 'warn',
      detail: jira ? process.env.JIRA_BASE_URL! : 'not configured: only needed for Jira tickets',
    },
    {
      name: 'Clean test folders',
      level: dirty ? 'warn' : 'ok',
      detail: dirty ? 'uncommitted changes in the writable folders: the scope gate will count them as part of a run' : 'nothing uncommitted',
    },
  ];

  const label = { ok: 'ok  ', warn: 'warn', fail: 'FAIL' };
  for (const check of checks) console.log(`${label[check.level]}  ${check.name.padEnd(20)} ${check.detail}`);
  const failed = checks.filter((check) => check.level === 'fail').length;
  console.log(failed ? `\n${failed} problem(s) to fix before the pipeline can run.` : '\nReady.');
  return failed === 0;
}
