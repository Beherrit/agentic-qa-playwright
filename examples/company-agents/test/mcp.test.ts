import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CoConfig } from '../cli/lib/config.ts';
import type { Identity } from '../cli/lib/identity.ts';
import { mcpFor, READ_TOOLS, WRITE_SHAPED } from '../cli/lib/mcp.ts';

const identity: Identity = {
  login: 'lawrence',
  source: 'login',
  tokens: { GITHUB_TOKEN: 'ghp_test', JIRA_EMAIL: 'l@acme.example', JIRA_TOKEN: 'jt', TESTRAIL_URL: 'https://acme.testrail.io', TESTRAIL_USERNAME: 'l@acme.example', TESTRAIL_API_KEY: 'tk', FIGMA_TOKEN: 'ft' },
};

const config = CoConfig.parse({
  company: 'test',
  tracker: 'jira',
  repoHost: 'github',
  docs: 'confluence',
  project: { repo: 'acme/shop', key: 'SHOP' },
  mcp: { github: { mode: 'docker' }, atlassian: { enabled: true }, testrail: { enabled: true }, figma: { mode: 'remote' } },
});

test('no allowlisted MCP tool is write-shaped, on any server', () => {
  for (const [server, tools] of Object.entries(READ_TOOLS)) {
    for (const tool of tools) assert.ok(!WRITE_SHAPED.test(tool), `${server}: ${tool} looks like a write tool`);
  }
});

test('the GitHub server is always started read-only, and tools are allowlisted with the mcp__ prefix', () => {
  const setup = mcpFor(config, identity, ['github']);
  const github = setup.servers.github as { type: string; env?: Record<string, string>; args?: string[] };
  assert.equal(github.type, 'stdio');
  assert.equal(github.env?.GITHUB_READ_ONLY, '1');
  assert.ok(setup.tools.includes('mcp__github__pull_request_read'));
  assert.ok(!setup.tools.some((t) => /create|merge|write/.test(t)));
});

test('the hosted servers get the identity tokens and nothing else', () => {
  const setup = mcpFor(config, identity, ['atlassian', 'figma']);
  const atlassian = setup.servers.atlassian as { type: string; url: string; headers?: Record<string, string> };
  assert.equal(atlassian.type, 'http');
  assert.ok(atlassian.url.startsWith('https://mcp.atlassian.com/v2/mcp'));
  assert.ok(atlassian.headers?.Authorization.startsWith('Basic '));
  const figma = setup.servers.figma as { url: string; headers?: Record<string, string> };
  assert.equal(figma.url, 'https://mcp.figma.com/mcp');
  assert.equal(figma.headers?.Authorization, 'Bearer ft');
});

test('a server a role lists but the config has off is simply not attached', () => {
  const off = CoConfig.parse({ ...config, mcp: { github: { mode: 'off' } } });
  const setup = mcpFor(off, identity, ['github']);
  assert.deepEqual(setup.servers, {});
  assert.deepEqual(setup.tools, []);
});

test('a missing read token is a clear error, not a server started without one', () => {
  assert.throws(() => mcpFor(config, { ...identity, tokens: {} }, ['testrail']), /TESTRAIL_URL/);
});
