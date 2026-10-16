import { api } from './types.ts';

/**
 * TestRail through its REST API, for the post stage: the test case writer's cases are added to one section that the
 * config names, never anywhere else, and nothing is updated or deleted. Reading on demand is the MCP server's job
 * (cli/lib/mcp.ts); this adapter reads only what the fetch stage needs to tell the agent what already exists.
 */

export type TestRailCase = { id: number; title: string; refs: string | null; section_id: number };

export type NewCase = {
  title: string;
  refs: string;
  preconditions: string;
  steps: { action: string; expected: string }[];
};

export interface TestCases {
  listCases(projectId: number, suiteId: number | null, sectionId: number): Promise<TestRailCase[]>;
  /** Returns the new case's URL. */
  addCase(sectionId: number, c: NewCase): Promise<string>;
}

export class TestRailCases implements TestCases {
  constructor(
    private base: string,
    private username: string,
    private apiKey: string,
  ) {}

  private url(call: string): string {
    return `${this.base.replace(/\/$/, '')}/index.php?/api/v2/${call}`;
  }

  private get auth(): string {
    return `${this.username}:${this.apiKey}`;
  }

  async listCases(projectId: number, suiteId: number | null, sectionId: number): Promise<TestRailCase[]> {
    const query = `get_cases/${projectId}&section_id=${sectionId}${suiteId ? `&suite_id=${suiteId}` : ''}`;
    const result = await api<{ cases: TestRailCase[] } | TestRailCase[]>(this.url(query), { basic: this.auth });
    return Array.isArray(result) ? result : result.cases;
  }

  async addCase(sectionId: number, c: NewCase): Promise<string> {
    const made = await api<{ id: number }>(this.url(`add_case/${sectionId}`), {
      basic: this.auth,
      method: 'POST',
      body: JSON.stringify({
        title: c.title,
        refs: c.refs,
        custom_preconds: c.preconditions,
        // Template 2, "Test Case (Steps)". A project on another template ignores the field; the steps then go in
        // the preconditions text so nothing is lost.
        template_id: 2,
        custom_steps_separated: c.steps.map((s) => ({ content: s.action, expected: s.expected })),
      }),
    });
    return `${this.base.replace(/\/$/, '')}/index.php?/cases/view/${made.id}`;
  }
}
