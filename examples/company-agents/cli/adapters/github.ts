import { api, ticketKeysIn, type MergeRequest, type Repo, type Ticket, type Tracker } from './types.ts';

/** GitHub as the code host (pull requests) and, when the company has no Jira, as the tracker (issues). */

const API = 'https://api.github.com';

type PR = { number: number; html_url: string; title: string; body: string | null; user: { login: string }; head: { ref: string; sha: string }; base: { ref: string }; merged_at: string | null };
type Issue = { number: number; html_url: string; title: string; body: string | null; state: string; user: { login: string }; labels: { name: string }[]; pull_request?: unknown };
type IssueComment = { user: { login: string }; body: string; created_at: string };

export class GitHubRepo implements Repo {
  constructor(
    private repo: string,
    private token: string,
  ) {}

  private url(pathname: string): string {
    return `${API}/repos/${this.repo}${pathname}`;
  }

  async getMergeRequest(id: string): Promise<MergeRequest> {
    const pr = await api<PR>(this.url(`/pulls/${id}`), { token: this.token });
    const files = await api<{ filename: string }[]>(this.url(`/pulls/${id}/files?per_page=100`), { token: this.token });
    const diff = await api<string>(this.url(`/pulls/${id}`), { token: this.token, headers: { Accept: 'application/vnd.github.diff' } });
    const commits = await api<{ sha: string; commit: { message: string } }[]>(this.url(`/pulls/${id}/commits?per_page=100`), { token: this.token });
    const checks = await api<{ check_runs: { name: string; conclusion: string | null }[] }>(this.url(`/commits/${pr.head.sha}/check-runs`), { token: this.token });
    const failed = checks.check_runs.filter((c) => c.conclusion && c.conclusion !== 'success' && c.conclusion !== 'skipped' && c.conclusion !== 'neutral');
    const ci = checks.check_runs.length ? `${checks.check_runs.length - failed.length} checks passed${failed.length ? `, ${failed.length} failed: ${failed.map((c) => c.name).join(', ')}` : ''}` : 'no checks reported yet';
    const messages = commits.map((c) => c.commit.message);
    return {
      id: String(pr.number),
      url: pr.html_url,
      title: pr.title,
      body: pr.body ?? '',
      author: pr.user.login,
      source: pr.head.ref,
      target: pr.base.ref,
      files: files.map((f) => f.filename),
      diff,
      commits: commits.map((c) => ({ sha: c.sha.slice(0, 7), message: c.commit.message })),
      ci,
      merged: pr.merged_at !== null,
      ticketKeys: ticketKeysIn(pr.title, pr.body ?? '', pr.head.ref, ...messages),
    };
  }

  async listMerged(sinceIso: string): Promise<MergeRequest[]> {
    const q = encodeURIComponent(`repo:${this.repo} is:pr is:merged merged:>=${sinceIso.slice(0, 10)}`);
    const found = await api<{ items: { number: number }[] }>(`${API}/search/issues?q=${q}&per_page=100`, { token: this.token });
    return Promise.all(found.items.map((i) => this.getMergeRequest(String(i.number))));
  }

  async comment(id: string, body: string): Promise<string> {
    const made = await api<{ html_url: string }>(this.url(`/issues/${id}/comments`), { token: this.token, method: 'POST', body: JSON.stringify({ body }) });
    return made.html_url;
  }

  async setDescription(id: string, body: string): Promise<void> {
    await api(this.url(`/pulls/${id}`), { token: this.token, method: 'PATCH', body: JSON.stringify({ body }) });
  }

  async review(id: string, summary: string, comments: { file: string; line: number; body: string }[]): Promise<string> {
    // event: COMMENT. Never APPROVE or REQUEST_CHANGES: those are a person's.
    const made = await api<{ html_url: string }>(this.url(`/pulls/${id}/reviews`), {
      token: this.token,
      method: 'POST',
      body: JSON.stringify({ event: 'COMMENT', body: summary, comments: comments.map((c) => ({ path: c.file, line: c.line, side: 'RIGHT', body: c.body })) }),
    });
    return made.html_url;
  }
}

export class GitHubTracker implements Tracker {
  constructor(
    private repo: string,
    private token: string,
  ) {}

  private url(pathname: string): string {
    return `${API}/repos/${this.repo}${pathname}`;
  }

  private async toTicket(issue: Issue): Promise<Ticket> {
    const comments = await api<IssueComment[]>(this.url(`/issues/${issue.number}/comments?per_page=100`), { token: this.token });
    return {
      key: `#${issue.number}`,
      url: issue.html_url,
      title: issue.title,
      body: issue.body ?? '',
      status: issue.state,
      reporter: issue.user.login,
      labels: issue.labels.map((l) => l.name),
      comments: comments.map((c) => ({ author: c.user.login, body: c.body, at: c.created_at })),
    };
  }

  async getTicket(key: string): Promise<Ticket> {
    const issue = await api<Issue>(this.url(`/issues/${key.replace('#', '')}`), { token: this.token });
    if (issue.pull_request) throw new Error(`${key} is a pull request, not an issue`);
    return this.toTicket(issue);
  }

  async searchTickets(text: string, limit: number): Promise<Ticket[]> {
    const q = encodeURIComponent(`repo:${this.repo} is:issue ${text}`);
    const found = await api<{ items: Issue[] }>(`${API}/search/issues?q=${q}&per_page=${limit}`, { token: this.token });
    return Promise.all(found.items.slice(0, limit).map((i) => this.toTicket(i)));
  }

  async createTicket(title: string, body: string, labels: string[]): Promise<Ticket> {
    const issue = await api<Issue>(this.url('/issues'), { token: this.token, method: 'POST', body: JSON.stringify({ title, body, labels }) });
    return this.toTicket(issue);
  }

  async comment(key: string, body: string): Promise<string> {
    const made = await api<{ html_url: string }>(this.url(`/issues/${key.replace('#', '')}/comments`), { token: this.token, method: 'POST', body: JSON.stringify({ body }) });
    return made.html_url;
  }
}
