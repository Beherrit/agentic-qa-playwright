import { api, ticketKeysIn, type MergeRequest, type Repo } from './types.ts';

/** GitLab as the code host. `project` is the numeric id or the URL-encoded "group/name" path. */

type MR = {
  iid: number;
  web_url: string;
  title: string;
  description: string | null;
  author: { username: string };
  source_branch: string;
  target_branch: string;
  sha: string;
  merged_at: string | null;
  diff_refs: { base_sha: string; head_sha: string; start_sha: string };
};

export class GitLabRepo implements Repo {
  constructor(
    private project: string,
    private token: string,
    private base: string = 'https://gitlab.com',
  ) {}

  private url(pathname: string): string {
    return `${this.base}/api/v4/projects/${encodeURIComponent(this.project)}${pathname}`;
  }

  private headers(): Record<string, string> {
    return { 'PRIVATE-TOKEN': this.token };
  }

  async getMergeRequest(id: string): Promise<MergeRequest> {
    const mr = await api<MR>(this.url(`/merge_requests/${id}`), { headers: this.headers() });
    const changes = await api<{ changes: { new_path: string; old_path: string; diff: string }[] }>(this.url(`/merge_requests/${id}/changes`), { headers: this.headers() });
    const commits = await api<{ short_id: string; message: string }[]>(this.url(`/merge_requests/${id}/commits?per_page=100`), { headers: this.headers() });
    const pipelines = await api<{ status: string }[]>(this.url(`/merge_requests/${id}/pipelines`), { headers: this.headers() });
    const diff = changes.changes.map((c) => `--- a/${c.old_path}\n+++ b/${c.new_path}\n${c.diff}`).join('\n');
    return {
      id: String(mr.iid),
      url: mr.web_url,
      title: mr.title,
      body: mr.description ?? '',
      author: mr.author.username,
      source: mr.source_branch,
      target: mr.target_branch,
      files: changes.changes.map((c) => c.new_path),
      diff,
      commits: commits.map((c) => ({ sha: c.short_id, message: c.message })),
      ci: pipelines.length ? `latest pipeline: ${pipelines[0].status}` : 'no pipeline yet',
      merged: mr.merged_at !== null,
      ticketKeys: ticketKeysIn(mr.title, mr.description ?? '', mr.source_branch, ...commits.map((c) => c.message)),
    };
  }

  async listMerged(sinceIso: string): Promise<MergeRequest[]> {
    const list = await api<{ iid: number }[]>(this.url(`/merge_requests?state=merged&updated_after=${encodeURIComponent(sinceIso)}&per_page=100`), { headers: this.headers() });
    return Promise.all(list.map((m) => this.getMergeRequest(String(m.iid))));
  }

  async comment(id: string, body: string): Promise<string> {
    const note = await api<{ id: number }>(this.url(`/merge_requests/${id}/notes`), { headers: this.headers(), method: 'POST', body: JSON.stringify({ body }) });
    return `${this.base}/${this.project}/-/merge_requests/${id}#note_${note.id}`;
  }

  async setDescription(id: string, body: string): Promise<void> {
    await api(this.url(`/merge_requests/${id}`), { headers: this.headers(), method: 'PUT', body: JSON.stringify({ description: body }) });
  }

  async review(id: string, summary: string, comments: { file: string; line: number; body: string }[]): Promise<string> {
    const mr = await api<MR>(this.url(`/merge_requests/${id}`), { headers: this.headers() });
    for (const c of comments) {
      await api(this.url(`/merge_requests/${id}/discussions`), {
        headers: this.headers(),
        method: 'POST',
        body: JSON.stringify({
          body: c.body,
          position: { position_type: 'text', base_sha: mr.diff_refs.base_sha, head_sha: mr.diff_refs.head_sha, start_sha: mr.diff_refs.start_sha, new_path: c.file, old_path: c.file, new_line: c.line },
        }),
      });
    }
    // No approval call. Approvals belong to people.
    return this.comment(id, summary);
  }
}
