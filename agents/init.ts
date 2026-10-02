import fs from 'node:fs';
import path from 'node:path';
import { PKG_ROOT } from './lib/pkg.ts';

/**
 * Sets a project up to run the pipeline: the config, the two documents the agents read, the workflows that call
 * the engine's, the issue form and the MCP registration. Nothing here reads a config, because there is none yet.
 * Files that exist are left alone unless `force` is given.
 */

const TEMPLATES = path.join(PKG_ROOT, 'templates', 'host');

/** Each file written into the project, and where its content comes from, relative to the package root. */
export const FILES: { to: string; from: string }[] = [
  { to: 'qa.config.json', from: 'templates/host/qa.config.json' },
  { to: 'docs/product-brief.md', from: 'templates/host/docs/product-brief.md' },
  { to: 'docs/test-conventions.md', from: 'templates/host/docs/test-conventions.md' },
  { to: 'docs/test-design.md', from: 'docs/test-design.md' },
  { to: '.github/workflows/qa-analysis.yml', from: 'templates/host/.github/workflows/qa-analysis.yml' },
  { to: '.github/workflows/qa-tests.yml', from: 'templates/host/.github/workflows/qa-tests.yml' },
  { to: '.github/workflows/regression.yml', from: 'templates/host/.github/workflows/regression.yml' },
  { to: '.github/workflows/qa-history.yml', from: 'templates/host/.github/workflows/qa-history.yml' },
  { to: '.github/ISSUE_TEMPLATE/requirement.yml', from: 'templates/host/.github/ISSUE_TEMPLATE/requirement.yml' },
  { to: '.mcp.json', from: 'templates/host/.mcp.json' },
];

export type InitResult = { root: string; written: string[]; kept: string[] };

export function initProject(root: string, options: { force?: boolean } = {}, pkg: string = PKG_ROOT): InitResult {
  if (path.resolve(root) === path.resolve(pkg)) throw new Error('This is the engine itself. Run init in the project the tests belong to.');
  const result: InitResult = { root, written: [], kept: [] };
  for (const file of FILES) {
    const target = path.join(root, file.to);
    if (fs.existsSync(target) && !options.force) {
      result.kept.push(file.to);
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(pkg, file.from), target);
    result.written.push(file.to);
  }
  return result;
}

/** What was done and what to do next, for the terminal. */
export function nextSteps(result: InitResult): string {
  const lines = [
    ...result.written.map((file) => `wrote  ${file}`),
    ...result.kept.map((file) => `kept   ${file} (exists; --force overwrites)`),
    '',
    'Next:',
    '  1. npx agentic-qa survey      an agent reads your suite and drafts the brief, the conventions and the config',
    '  2. Edit qa.config.json: the app name and address, the writable folders, how to sign in',
    '  3. npx agentic-qa doctor      checks everything the pipeline needs',
    '  4. Add the secrets: CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY on an environment named POC (or QA_PROVIDER_ENV',
    '     for Bedrock or Vertex), and an environment named TRACKER (empty for GitHub issues)',
    '  5. Create the labels qa-pipeline, qa-generate and qa-test-first, then label an issue qa-pipeline',
  ];
  return lines.join('\n');
}

export { TEMPLATES };
