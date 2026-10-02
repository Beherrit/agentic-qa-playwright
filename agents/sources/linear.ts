import type { NewTicket, OpenTicket, Source, Ticket } from './types.ts';

/**
 * Linear, through its GraphQL API. Needs two settings in the environment:
 *   LINEAR_API_KEY   a personal API key
 *   LINEAR_TEAM      the team key new tickets go in and open tickets are listed from (ENG in ENG-123)
 * Issue descriptions are markdown already, so nothing is converted.
 */

function settings(): { key: string; team: string } {
  const { LINEAR_API_KEY: key, LINEAR_TEAM: team } = process.env;
  if (!key || !team) throw new Error('Linear is not configured. Set LINEAR_API_KEY and LINEAR_TEAM (the team key, as in ENG-123).');
  return { key, team };
}

export async function graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { Authorization: settings().key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await response.json().catch(() => ({}))) as { data?: T; errors?: { message: string }[] };
  if (!response.ok || json.errors?.length) throw new Error(`Linear answered ${response.status}: ${(json.errors ?? []).map((e) => e.message).join('; ') || 'no data'}`);
  return json.data as T;
}

type Issue = { id: string; identifier: string; title: string; description: string | null; url: string; labels: { nodes: { id: string; name: string }[] } };

export function ticketFromIssue(issue: Issue): Ticket {
  return { ref: issue.identifier, url: issue.url, title: issue.title, body: issue.description ?? '', labels: issue.labels.nodes.map((l) => l.name) };
}

const ISSUE = 'id identifier title description url labels { nodes { id name } }';

async function issue(ref: string): Promise<Issue> {
  return (await graphql<{ issue: Issue }>(`query ($id: String!) { issue(id: $id) { ${ISSUE} } }`, { id: ref })).issue;
}

/** The label's id, made if it does not exist. */
async function labelId(name: string): Promise<string> {
  const found = await graphql<{ issueLabels: { nodes: { id: string }[] } }>(`query ($name: String!) { issueLabels(filter: { name: { eq: $name } }) { nodes { id } } }`, { name });
  if (found.issueLabels.nodes[0]) return found.issueLabels.nodes[0].id;
  const made = await graphql<{ issueLabelCreate: { issueLabel: { id: string } } }>(`mutation ($name: String!) { issueLabelCreate(input: { name: $name }) { issueLabel { id } } }`, { name });
  return made.issueLabelCreate.issueLabel.id;
}

export const linear: Source = {
  async read(ref) {
    return ticketFromIssue(await issue(ref));
  },

  async comment(ref, markdown) {
    const { id } = await issue(ref);
    await graphql(`mutation ($issueId: String!, $body: String!) { commentCreate(input: { issueId: $issueId, body: $body }) { success } }`, { issueId: id, body: markdown });
  },

  async label(ref, change) {
    const current = await issue(ref);
    const ids = new Set(current.labels.nodes.map((l) => l.id));
    for (const name of change.add ?? []) ids.add(await labelId(name));
    for (const name of change.remove ?? []) {
      const label = current.labels.nodes.find((l) => l.name === name);
      if (label) ids.delete(label.id);
    }
    await graphql(`mutation ($id: String!, $labelIds: [String!]!) { issueUpdate(id: $id, input: { labelIds: $labelIds }) { success } }`, { id: current.id, labelIds: [...ids] });
  },

  async list() {
    const { team } = settings();
    const data = await graphql<{ issues: { nodes: { identifier: string; title: string; url: string }[] } }>(
      `query ($team: String!) { issues(first: 100, filter: { team: { key: { eq: $team } }, state: { type: { nin: ["completed", "canceled"] } } }) { nodes { identifier title url } } }`,
      { team },
    );
    return data.issues.nodes.map((n): OpenTicket => ({ ref: n.identifier, title: n.title, url: n.url }));
  },

  async create(ticket: NewTicket) {
    const { team } = settings();
    const teams = await graphql<{ teams: { nodes: { id: string }[] } }>(`query ($key: String!) { teams(filter: { key: { eq: $key } }) { nodes { id } } }`, { key: team });
    const teamId = teams.teams.nodes[0]?.id;
    if (!teamId) throw new Error(`No Linear team with the key ${team}.`);
    const labelIds = [];
    for (const name of ticket.labels) labelIds.push(await labelId(name));
    const made = await graphql<{ issueCreate: { issue: { identifier: string; url: string } } }>(
      `mutation ($input: IssueCreateInput!) { issueCreate(input: $input) { issue { identifier url } } }`,
      { input: { teamId, title: ticket.title, description: ticket.body, labelIds } },
    );
    return { ref: made.issueCreate.issue.identifier, url: made.issueCreate.issue.url };
  },
};
