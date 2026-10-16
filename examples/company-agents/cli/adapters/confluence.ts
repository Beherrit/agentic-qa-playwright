import { api, type Docs, type DraftTarget, type Page } from './types.ts';

/**
 * Confluence Cloud as the documentation tool. Reads pages in storage format. Writes only drafts: a proposed update is
 * saved as a new page next to the page it would replace, labelled agent-draft, with a link to the original at the top.
 * The live page is never written. A documentation owner compares and merges, then deletes the draft.
 */

type V2Page = { id: string; title: string; version: { number: number }; parentId: string | null; body?: { storage?: { value: string } }; _links: { webui: string } };

export class ConfluenceDocs implements Docs {
  constructor(
    private base: string,
    private email: string,
    private token: string,
    private spaceId: string,
  ) {}

  private get auth(): string {
    return `${this.email}:${this.token}`;
  }

  async getPage(id: string): Promise<Page> {
    const page = await api<V2Page>(`${this.base}/wiki/api/v2/pages/${id}?body-format=storage`, { basic: this.auth });
    return { id: page.id, title: page.title, url: `${this.base}/wiki${page._links.webui}`, body: page.body?.storage?.value ?? '', version: page.version.number, parentId: page.parentId };
  }

  async search(text: string, limit: number): Promise<Page[]> {
    const cql = encodeURIComponent(`type=page AND space.id=${this.spaceId} AND text ~ ${JSON.stringify(text)}`);
    const found = await api<{ results: { id: string }[] }>(`${this.base}/wiki/rest/api/content/search?cql=${cql}&limit=${limit}`, { basic: this.auth });
    return Promise.all(found.results.map((r) => this.getPage(r.id)));
  }

  async saveDraft(target: DraftTarget, body: string, format: 'confluence-storage' | 'markdown'): Promise<string> {
    const storage = format === 'confluence-storage' ? body : `<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">markdown</ac:parameter><ac:plain-text-body><![CDATA[${body}]]></ac:plain-text-body></ac:structured-macro>`;
    let parentId = target.parentId;
    let title = `[agent draft] ${target.title}`;
    let preface = '';
    if (target.action === 'update' && target.pageId) {
      const original = await this.getPage(target.pageId);
      parentId = original.parentId ?? parentId;
      title = `[agent draft] ${original.title} (proposed update)`;
      preface = `<p><strong>Proposed update to <a href="${original.url}">${escapeXml(original.title)}</a> (version ${original.version}). Compare, merge what is right, then delete this page.</strong></p>`;
    }
    const made = await api<V2Page>(`${this.base}/wiki/api/v2/pages`, {
      basic: this.auth,
      method: 'POST',
      body: JSON.stringify({ spaceId: this.spaceId, status: 'current', title, parentId, body: { representation: 'storage', value: preface + storage } }),
    });
    await api(`${this.base}/wiki/rest/api/content/${made.id}/label`, { basic: this.auth, method: 'POST', body: JSON.stringify([{ prefix: 'global', name: 'agent-draft' }]) });
    return `${this.base}/wiki${made._links.webui}`;
  }
}

function escapeXml(text: string): string {
  return text.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c] as string);
}
