import type { Options } from '@anthropic-ai/claude-agent-sdk';
import type { CoConfig } from './config.ts';
import type { Identity } from './identity.ts';

/**
 * MCP servers an agent may be given, and the tools on each it may call. Three servers, three rules:
 *
 *   - every server runs in its read-only mode where it has one (GitHub: GITHUB_READ_ONLY=1), and
 *   - every tool is allowlisted by name here, so a write tool is refused even if a server exposes it, and
 *   - the token a server gets is a read token: the agent job in CI holds GITHUB_TOKEN with read permissions and
 *     the Atlassian and TestRail API tokens of a read-only service account. Never a token the post stage uses.
 *
 * With MCP the agent can look things up on its own (the enricher searches Jira for the history, the reviewer reads
 * the linked issue, the test case writer reads what TestRail already has) instead of only what the fetch stage put
 * in the task. Writing still happens in code, after validation and confirmation, through cli/adapters.
 *
 * Servers:
 *   github     github.com/github/github-mcp-server. Docker image ghcr.io/github/github-mcp-server, a binary from its
 *              releases, or the hosted endpoint https://api.githubcopilot.com/mcp/. Toolsets repos, issues,
 *              pull_requests, users.
 *   atlassian  github.com/atlassian/atlassian-mcp-server: the official hosted server at
 *              https://mcp.atlassian.com/v2/mcp. API-token auth (Basic email:token) must be enabled by an Atlassian
 *              admin; OAuth is the alternative for a person at a terminal (claude mcp add --transport http ...).
 *              ?tools=all exposes the tools as one flat list so they can be allowlisted by name.
 *   testrail   npm @bun913/mcp-testrail (TESTRAIL_URL, TESTRAIL_USERNAME, TESTRAIL_API_KEY). No read-only mode of its
 *              own, so the allowlist below is the only thing between the agent and addCase. The package's repository
 *              was archived in July 2026; it still runs, and cli/adapters/testrail.ts is the durable path for writes.
 */

export type McpName = 'github' | 'atlassian' | 'testrail' | 'figma';

/*
 *   figma      github.com/figma/mcp-server-guide. The hosted server at https://mcp.figma.com/mcp authenticates with
 *              OAuth; the Figma desktop app also serves Dev Mode MCP locally at http://127.0.0.1:3845/mcp for a person
 *              at a terminal with Figma open. Read tools only: the server's write tools (upload_assets, writing to the
 *              canvas) are not on the list. Rate limits apply to the read tools; a role that reads a design reads it
 *              once and keeps the result in its task.
 */

export const READ_TOOLS: Record<McpName, string[]> = {
  github: ['issue_read', 'list_issues', 'search_issues', 'pull_request_read', 'list_pull_requests', 'search_pull_requests', 'get_file_contents', 'list_commits', 'get_commit', 'search_code', 'list_branches', 'get_me'],
  atlassian: ['getAccessibleAtlassianResources', 'getJiraIssue', 'searchJiraIssuesUsingJql', 'getJiraIssueRemoteIssueLinks', 'getTransitionsForJiraIssue', 'getConfluenceContent', 'searchConfluence', 'getConfluenceSpaces', 'getPagesInConfluenceSpace'],
  testrail: ['getProjects', 'getProject', 'getSuites', 'getSuite', 'getSections', 'getSection', 'getCases', 'getCase', 'getCaseTypes', 'getCaseFields', 'getCaseHistory', 'getBdd', 'getRuns', 'getRun', 'getResults', 'getResultsForCase', 'getResultsForRun', 'getMilestones', 'getSharedSteps'],
  figma: ['get_design_context', 'get_metadata', 'get_screenshot', 'get_variable_defs'],
};

/** A tool name that would write, whatever server it is on. Checked in the tests against READ_TOOLS. */
export const WRITE_SHAPED = /^(?:add|create|update|delete|remove|move|copy|write|merge|transition|assign|push|edit|set|close|reopen)/i;

export type McpSetup = { servers: NonNullable<Options['mcpServers']>; tools: string[] };

function need(identity: Identity, name: string): string {
  const value = identity.tokens[name];
  if (!value) throw new Error(`${name} is needed for the MCP server but is not available to ${identity.login}.`);
  return value;
}

/** The servers a role asked for, with their read tokens, and the allowed tool names for the SDK. */
export function mcpFor(config: CoConfig, identity: Identity, names: McpName[]): McpSetup {
  const servers: McpSetup['servers'] = {};
  const tools: string[] = [];
  for (const name of names) {
    const server = serverFor(config, identity, name);
    if (!server) continue;
    servers[name] = server;
    tools.push(...READ_TOOLS[name].map((tool) => `mcp__${name}__${tool}`));
  }
  return { servers, tools };
}

function serverFor(config: CoConfig, identity: Identity, name: McpName): McpSetup['servers'][string] | null {
  const mcp = config.mcp;
  if (name === 'github') {
    const token = need(identity, 'GITHUB_TOKEN');
    const toolsets = mcp.github.toolsets.join(',');
    switch (mcp.github.mode) {
      case 'off':
        return null;
      case 'docker':
        return { type: 'stdio', command: 'docker', args: ['run', '-i', '--rm', '-e', 'GITHUB_PERSONAL_ACCESS_TOKEN', '-e', 'GITHUB_READ_ONLY', '-e', 'GITHUB_TOOLSETS', 'ghcr.io/github/github-mcp-server'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: token, GITHUB_READ_ONLY: '1', GITHUB_TOOLSETS: toolsets } };
      case 'binary':
        return { type: 'stdio', command: mcp.github.binary, args: ['stdio', '--read-only'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: token, GITHUB_READ_ONLY: '1', GITHUB_TOOLSETS: toolsets } };
      case 'remote':
        // The hosted server has no read-only switch of its own: the token's scopes and the allowlist above are it.
        return { type: 'http', url: 'https://api.githubcopilot.com/mcp/', headers: { Authorization: `Bearer ${token}`, 'X-MCP-Toolsets': toolsets } };
    }
  }
  if (name === 'atlassian') {
    if (!mcp.atlassian.enabled) return null;
    const basic = Buffer.from(`${need(identity, 'JIRA_EMAIL')}:${need(identity, 'JIRA_TOKEN')}`).toString('base64');
    return { type: 'http', url: mcp.atlassian.url, headers: { Authorization: `Basic ${basic}` } };
  }
  if (name === 'figma') {
    switch (mcp.figma.mode) {
      case 'off':
        return null;
      case 'desktop':
        // The Figma desktop app, open on this machine, with Dev Mode MCP enabled in its preferences. From inside the
        // onboarding container the app is on the host, and docker-compose.yml sets CO_FIGMA_DESKTOP_URL to reach it.
        return { type: 'http', url: process.env.CO_FIGMA_DESKTOP_URL ?? mcp.figma.desktopUrl };
      case 'remote':
        // A bearer token from Figma's OAuth flow (what `claude mcp add --transport http figma https://mcp.figma.com/mcp`
        // followed by /mcp stores for a person). For CI, mint one for a service user and keep it as FIGMA_TOKEN.
        return { type: 'http', url: 'https://mcp.figma.com/mcp', headers: { Authorization: `Bearer ${need(identity, 'FIGMA_TOKEN')}` } };
    }
  }
  if (name === 'testrail') {
    if (!mcp.testrail.enabled) return null;
    return {
      type: 'stdio',
      command: 'npx',
      args: ['-y', `@bun913/mcp-testrail@${mcp.testrail.version}`],
      env: { TESTRAIL_URL: need(identity, 'TESTRAIL_URL'), TESTRAIL_USERNAME: need(identity, 'TESTRAIL_USERNAME'), TESTRAIL_API_KEY: need(identity, 'TESTRAIL_API_KEY') },
    };
  }
  return null;
}

/** The tokens each server needs, for the doctor. */
export const MCP_TOKENS: Record<McpName, string[]> = {
  github: ['GITHUB_TOKEN'],
  atlassian: ['JIRA_EMAIL', 'JIRA_TOKEN'],
  testrail: ['TESTRAIL_URL', 'TESTRAIL_USERNAME', 'TESTRAIL_API_KEY'],
  figma: [],
};
