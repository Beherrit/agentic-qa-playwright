import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CoConfig } from './config.ts';
import { policyFor } from './config.ts';

/**
 * Who is asking, and may they ask this role?
 *
 * At a terminal the identity comes from `co login`, which stores the person's own tracker token and login under
 * ~/.co/credentials.json (mode 0600; on macOS and Windows a keychain is the better home and this file is where to swap
 * it in). Everything the CLI posts is posted as that person, with their permissions, so the CLI can never do what
 * they could not do themselves. In CI the identity is the workflow, and the tokens are the job's secrets.
 */

export type Identity = { login: string; source: 'login' | 'ci'; tokens: Record<string, string> };

const HOME = path.join(os.homedir(), '.co');
const CREDENTIALS = path.join(HOME, 'credentials.json');

export function whoAmI(env: NodeJS.ProcessEnv = process.env): Identity {
  if (env.GITHUB_ACTIONS === 'true') return { login: `ci:${env.GITHUB_WORKFLOW ?? 'github'}`, source: 'ci', tokens: fromEnv(env) };
  if (env.GITLAB_CI === 'true') return { login: `ci:${env.CI_JOB_NAME ?? 'gitlab'}`, source: 'ci', tokens: fromEnv(env) };
  if (!fs.existsSync(CREDENTIALS)) throw new Error('Not logged in. Run: co login');
  const stored = JSON.parse(fs.readFileSync(CREDENTIALS, 'utf8')) as { login?: string; tokens?: Record<string, string> };
  if (!stored.login) throw new Error('The credential file has no login. Run: co login');
  return { login: stored.login, source: 'login', tokens: stored.tokens ?? {} };
}

/** The tokens a CI job may hold, by name. A job holds the ones it needs and no others (see the workflows). */
function fromEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const names = ['GITHUB_TOKEN', 'GITLAB_TOKEN', 'JIRA_TOKEN', 'JIRA_EMAIL', 'JIRA_BASE_URL', 'CONFLUENCE_TOKEN', 'CONFLUENCE_BASE_URL', 'SLACK_BOT_TOKEN', 'TEAMS_WEBHOOK_URL', 'TESTRAIL_URL', 'TESTRAIL_USERNAME', 'TESTRAIL_API_KEY', 'FIGMA_TOKEN'];
  const tokens: Record<string, string> = {};
  for (const name of names) if (env[name]) tokens[name] = env[name];
  return tokens;
}

export function saveLogin(login: string, tokens: Record<string, string>): string {
  fs.mkdirSync(HOME, { recursive: true, mode: 0o700 });
  fs.writeFileSync(CREDENTIALS, JSON.stringify({ login, tokens }, null, 2), { mode: 0o600 });
  return CREDENTIALS;
}

/** Whether this actor may start this role. Denied wins over allowed; "*" allows anyone who is logged in. */
export function mayRun(config: CoConfig, role: string, identity: Identity): { ok: true } | { ok: false; reason: string } {
  if (!config.enabled) return { ok: false, reason: 'All agents are switched off (enabled: false in co.config.json).' };
  const policy = policyFor(config, role);
  if (!policy.enabled) return { ok: false, reason: `The ${role} role is switched off.` };
  if (policy.denied.includes(identity.login)) return { ok: false, reason: `${identity.login} may not run ${role}.` };
  if (policy.allowed.includes('*') || policy.allowed.includes(identity.login)) return { ok: true };
  if (identity.source === 'ci' && policy.allowed.some((a) => a === 'ci:*')) return { ok: true };
  return { ok: false, reason: `${identity.login} is not on the list for ${role}. Ask an owner of co.config.json.` };
}
