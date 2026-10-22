import { chromium } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { providerName } from './lib/agent.ts';
import { coverageRoots, inThisRepo } from './lib/layers.ts';
import { DEFAULT_TIER_MODELS, resolveModel, ROLE_TIERS, Tier } from './lib/tiers.ts';
import { config, PROMPTS_DIR, ROOT } from './lib/paths.ts';

/**
 * Checks that a checkout is ready to run the pipeline, before any agent is started.
 * It is the first thing to run after pointing the shell at a new app.
 *
 * Usage: npm run pipeline -- doctor
 */

type Level = 'ok' | 'warn' | 'fail';
export type Check = { name: string; level: Level; detail: string };

const ROLES = Object.keys(ROLE_TIERS);

const runs = (command: string): boolean => spawnSync(command, { cwd: ROOT, shell: true, stdio: 'ignore' }).status === 0;

type Loose = {
  app?: Partial<typeof config.app>;
  conventions?: string;
  writable?: string[];
  minPlanScore?: number;
  stabilityRuns?: number;
  sensitivity?: { targets?: { name: string }[] };
  suite?: { commands?: Partial<typeof config.suite.commands>; testImport?: string };
  auth?: { setup?: string | null; storageState?: string | null };
  budget?: { maxUsdPerRun?: number };
};

/** The checks that only look at the configuration, so they can be tested without a network or a browser. */
export function configChecks(cfg: Loose, has: (file: string) => boolean): Check[] {
  // The defaults the config schema fills in; a loose config in a test may leave them out.
  const commands = { test: 'npx playwright test', typecheck: 'npx tsc --noEmit', lint: 'npx eslint', ...cfg.suite?.commands };
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
      level: typeof score === 'number' && score >= 0 && score <= 100 && (cfg.stabilityRuns ?? 0) >= 1 ? 'ok' : 'fail',
      detail: `plan score ${score}, stability runs ${cfg.stabilityRuns}`,
    },
    {
      name: 'Sensitivity targets',
      level: cfg.sensitivity?.targets?.length ? 'ok' : 'warn',
      detail: cfg.sensitivity?.targets?.length
        ? cfg.sensitivity.targets.map((target) => target.name).join(', ')
        : 'none: new tests will not be tried against a known-broken version of the app',
    },
    {
      name: 'Suite commands',
      level: /\bplaywright test\b/.test(commands.test) ? 'ok' : 'fail',
      detail: /\bplaywright test\b/.test(commands.test)
        ? `test: ${commands.test}; typecheck: ${commands.typecheck}; lint: ${commands.lint}`
        : `suite.commands.test must run Playwright (the gates add flags to it): "${commands.test}"`,
    },
    {
      name: 'Test import',
      level: !cfg.suite?.testImport || cfg.suite.testImport === '@playwright/test' || has(cfg.suite.testImport) ? 'ok' : 'fail',
      detail: !cfg.suite?.testImport || cfg.suite.testImport === '@playwright/test' || has(cfg.suite.testImport)
        ? `specs import test from ${cfg.suite?.testImport ?? '@playwright/test'}`
        : `suite.testImport names ${cfg.suite.testImport}, which does not exist`,
    },
    {
      name: 'Sign-in',
      level: !cfg.auth?.setup ? 'ok' : cfg.auth.storageState ? 'ok' : 'fail',
      detail: !cfg.auth?.setup
        ? 'tests sign in through the app (no auth.setup)'
        : cfg.auth.storageState
          ? `${cfg.auth.setup} writes ${cfg.auth.storageState}, which the agents\' browser starts from`
          : 'auth.setup is set but auth.storageState is not: say which file the sign-in command writes',
    },
    {
      name: 'Budget',
      level: 'ok',
      detail: cfg.budget?.maxUsdPerRun ? `a run stops at $${cfg.budget.maxUsdPerRun.toFixed(2)} of agent cost` : 'no cap on what a run may spend (budget.maxUsdPerRun)',
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

/**
 * The test layers, the context the analysis reads, and the per-layer tasks. A layer repository that is not checked
 * out is a warning: the plan still names the layer, the architect just cannot search it for existing tests.
 */
export function layerChecks(
  cfg: Pick<typeof config, 'layers' | 'context' | 'tasks'>,
  root: string,
  exists: (dir: string) => boolean,
  env: NodeJS.ProcessEnv,
): Check[] {
  const withRepo = cfg.layers.filter((layer) => layer.repo && !inThisRepo(layer, root));
  const found = coverageRoots(cfg.layers, root, exists).map((r) => r.id);
  const missing = withRepo.filter((layer) => !found.includes(layer.id)).map((layer) => `${layer.id} (${layer.repo})`);
  return [
    {
      name: 'Test layers',
      level: missing.length ? 'warn' : 'ok',
      detail: `${cfg.layers.map((l) => l.id).join(', ')}${
        missing.length ? `; not checked out, so not searched for existing tests: ${missing.join(', ')}` : withRepo.length ? `; searching ${found.join(', ')} for existing tests` : ''
      }`,
    },
    {
      name: 'Context',
      level: 'ok',
      detail: !cfg.context.related
        ? 'reads the ticket alone (context.related is off)'
        : `reads up to ${cfg.context.maxRelated} related ticket(s)${cfg.context.figma ? (env.FIGMA_TOKEN ? ' and the Figma designs they link to' : '; Figma links are listed but not read without FIGMA_TOKEN') : ''}`,
    },
    {
      name: 'Per-layer tasks',
      level: 'ok',
      detail: cfg.tasks.enabled
        ? `filed with each analysis${cfg.tasks.layers.length ? ` for ${cfg.tasks.layers.join(', ')}` : ''} (GitHub sub-issues or Jira subtasks)`
        : 'on demand: npx agentic-qa tasks',
    },
  ];
}

/**
 * What each tier runs on, and whether a person overrode the tiers. An override for every role (`models["*"]` or
 * QA_AGENT_MODEL) is a warning: it is allowed, but the decide tier then runs on the same model as everything else.
 */
export function tierChecks(cfg: Pick<typeof config, 'models' | 'tiers'>, env: NodeJS.ProcessEnv): Check[] {
  const tiers = Tier.options.map((tier) => {
    const own = { ...DEFAULT_TIER_MODELS[tier], ...(cfg.tiers[tier] ?? {}) };
    return `${tier} ${own.model}${own.fallback ? ` (then ${own.fallback})` : ''}`;
  });
  const everyRole = cfg.models['*'] ? 'models["*"] in qa.config.json' : env.QA_AGENT_MODEL ? 'QA_AGENT_MODEL' : null;
  const perRole = Object.keys(cfg.models).filter((role) => role !== '*');
  const sample = resolveModel('plan-reconciler', cfg, env).model;
  return [
    {
      name: 'Model tiers',
      level: everyRole ? 'warn' : 'ok',
      detail: everyRole
        ? `every role runs on ${sample}, set by ${everyRole}; remove it to run each role on its tier (${tiers.join(', ')})`
        : `${tiers.join(', ')}${perRole.length ? `; set per role: ${perRole.join(', ')}` : ''}`,
    },
  ];
}

/** Every check, with no output. */
export async function doctorChecks(): Promise<Check[]> {
  const has = (file: string): boolean => fs.existsSync(path.join(ROOT, file));
  const [major, minor] = process.versions.node.split('.').map(Number);
  const missingPrompts = ROLES.filter((role) => !fs.existsSync(path.join(PROMPTS_DIR, `${role}.md`)));
  const token = Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY || process.env.QA_PROVIDER_ENV);
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
      detail: token ? `${providerName()}, from the environment` : 'none in the environment; a signed-in Claude Code CLI works too',
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
    ...layerChecks(config, ROOT, fs.existsSync, process.env),
    ...tierChecks(config, process.env),
    {
      name: 'Clean test folders',
      level: dirty ? 'warn' : 'ok',
      detail: dirty ? 'uncommitted changes in the writable folders: the scope gate will count them as part of a run' : 'nothing uncommitted',
    },
  ];

  return checks;
}

/** The checks as the terminal shows them, one per line, and the verdict at the end. */
export function doctorText(checks: Check[]): string {
  const label = { ok: 'ok  ', warn: 'warn', fail: 'FAIL' };
  const failed = checks.filter((check) => check.level === 'fail').length;
  const lines = checks.map((check) => `${label[check.level]}  ${check.name.padEnd(20)} ${check.detail}`);
  return `${lines.join('\n')}\n\n${failed ? `${failed} problem(s) to fix before the pipeline can run.` : 'Ready.'}`;
}

/** Prints the checks. True when nothing failed. */
export async function doctor(): Promise<boolean> {
  const checks = await doctorChecks();
  console.log(doctorText(checks));
  return checks.every((check) => check.level !== 'fail');
}
