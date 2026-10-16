import type { CoConfig } from '../lib/config.ts';
import type { Identity } from '../lib/identity.ts';
import { ConfluenceDocs } from './confluence.ts';
import { GitHubRepo, GitHubTracker } from './github.ts';
import { GitLabRepo } from './gitlab.ts';
import { JiraTracker } from './jira.ts';
import { SlackChat } from './slack.ts';
import { TeamsChat } from './teams.ts';
import { TestRailCases, type TestCases } from './testrail.ts';
import type { Chat, Docs, Repo, Tracker } from './types.ts';

/** Builds the adapters the config names, with the tokens this identity holds. A missing token is a clear error. */

function need(identity: Identity, name: string): string {
  const value = identity.tokens[name];
  if (!value) throw new Error(`${name} is not available to ${identity.login}. At a terminal: co login --token ${name}=... In CI: give this job that secret.`);
  return value;
}

export function tracker(config: CoConfig, identity: Identity): Tracker {
  if (config.tracker === 'jira') return new JiraTracker(need(identity, 'JIRA_BASE_URL'), need(identity, 'JIRA_EMAIL'), need(identity, 'JIRA_TOKEN'), config.project.key ?? '');
  if (config.tracker === 'github') return new GitHubTracker(config.project.repo, need(identity, 'GITHUB_TOKEN'));
  throw new Error('GitLab issues as a tracker are not in this example. Use Jira, or add adapters/gitlab.ts#GitLabTracker.');
}

export function repo(config: CoConfig, identity: Identity): Repo {
  if (config.repoHost === 'gitlab') return new GitLabRepo(config.project.repo, need(identity, 'GITLAB_TOKEN'));
  return new GitHubRepo(config.project.repo, need(identity, 'GITHUB_TOKEN'));
}

export function docs(config: CoConfig, identity: Identity): Docs {
  if (config.docs === 'confluence') return new ConfluenceDocs(need(identity, 'CONFLUENCE_BASE_URL'), need(identity, 'JIRA_EMAIL'), need(identity, 'CONFLUENCE_TOKEN'), config.project.docsParentId ?? '');
  throw new Error('Documentation in the repository is written as a pull request by the workflow (workflows/github/release-document.yml), not by the CLI.');
}

export function testCases(config: CoConfig, identity: Identity): TestCases {
  if (!config.project.testrail) throw new Error('project.testrail (projectId, sectionId) is not set in co.config.json.');
  return new TestRailCases(need(identity, 'TESTRAIL_URL'), need(identity, 'TESTRAIL_USERNAME'), need(identity, 'TESTRAIL_API_KEY'));
}

export function chat(config: CoConfig, identity: Identity): Chat {
  if (config.chat === 'slack') return new SlackChat(need(identity, 'SLACK_BOT_TOKEN'));
  if (config.chat === 'teams') return new TeamsChat(need(identity, 'TEAMS_WEBHOOK_URL'));
  throw new Error('No chat tool is configured (chat: "none" in co.config.json).');
}
