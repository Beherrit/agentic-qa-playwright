import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { exportAs, exportedTests, junitXml, testrailCsv, xrayJson } from '../lib/export.ts';
import { keyFor, validateRef } from '../lib/keys.ts';
import { splitTags, ticketFromWorkItem } from '../sources/azure.ts';
import { htmlToMarkdown, markdownToHtml } from '../sources/html.ts';
import { ticketFromIssue } from '../sources/linear.ts';

describe('Azure DevOps', () => {
  it('reads a work item as a ticket: HTML fields as markdown, tags as labels', () => {
    const ticket = ticketFromWorkItem({
      id: 42,
      fields: {
        'System.Title': 'Reset the cart',
        'System.Description': '<div>As a shopper I want to <b>reset</b> the cart.<br>So I can start over.</div>',
        'Microsoft.VSTS.Common.AcceptanceCriteria': '<ul><li>The badge disappears</li><li>The cart page is empty</li></ul>',
        'System.Tags': 'qa-pipeline; shop',
      },
      _links: { html: { href: 'https://dev.azure.com/o/p/_workitems/edit/42' } },
    });
    assert.equal(ticket.ref, '42');
    assert.equal(ticket.title, 'Reset the cart');
    assert.match(ticket.body, /As a shopper I want to \*\*reset\*\* the cart\.\nSo I can start over\./);
    assert.match(ticket.body, /## Acceptance criteria\n\n- The badge disappears\n- The cart page is empty/);
    assert.deepEqual(ticket.labels, ['qa-pipeline', 'shop']);
    assert.deepEqual(splitTags(undefined), []);
  });

  it('gets a key and checks its reference', () => {
    assert.equal(keyFor('azure', '42'), 'ADO-42');
    assert.throws(() => validateRef('azure', 'x'));
  });
});

describe('Linear', () => {
  it('reads an issue as a ticket and keeps its key', () => {
    const ticket = ticketFromIssue({
      id: 'uuid',
      identifier: 'ENG-123',
      title: 'Reset the cart',
      description: 'As a shopper...',
      url: 'https://linear.app/t/issue/ENG-123',
      labels: { nodes: [{ id: 'l1', name: 'qa-pipeline' }] },
    });
    assert.deepEqual(ticket, { ref: 'ENG-123', url: 'https://linear.app/t/issue/ENG-123', title: 'Reset the cart', body: 'As a shopper...', labels: ['qa-pipeline'] });
    assert.equal(keyFor('linear', 'ENG-123'), 'ENG-123');
    assert.throws(() => validateRef('linear', 'eng-123'));
  });
});

describe('HTML for Azure DevOps', () => {
  it('renders the shapes the reports use', () => {
    const html = markdownToHtml('# Analysis\n\n**Verdict: ready.** 3 of 3.\n\n| A | B |\n|---|---|\n| 1 | `x` |\n\n- one\n- two\n\n```\ncode < here\n```\n\nSee [the run](https://example.com/run).');
    assert.match(html, /<h1>Analysis<\/h1>/);
    assert.match(html, /<p><strong>Verdict: ready\.<\/strong> 3 of 3\.<\/p>/);
    assert.match(html, /<table><thead><tr><th>A<\/th><th>B<\/th><\/tr><\/thead><tbody><tr><td>1<\/td><td><code>x<\/code><\/td><\/tr><\/tbody><\/table>/);
    assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
    assert.match(html, /<pre><code>code &lt; here<\/code><\/pre>/);
    assert.match(html, /<a href="https:\/\/example\.com\/run">the run<\/a>/);
  });

  it('reads the shapes Azure writes back', () => {
    assert.equal(htmlToMarkdown('<h2>Why</h2><p>It &amp; that</p><p>Two<br>lines</p>'), '## Why\n\nIt & that\n\nTwo\nlines');
    assert.equal(htmlToMarkdown('<ol><li><strong>bold</strong> one</li><li><a href="https://x.y">link</a></li></ol>'), '- **bold** one\n- [link](https://x.y)');
  });
});

describe('exports for test management tools', () => {
  const report = {
    suites: [
      {
        title: 'cart.spec.ts',
        suites: [
          {
            title: 'Cart',
            specs: [
              { title: 'empties', file: 'cart.spec.ts', tags: ['@SHOP-12', '@AC-1', '@AC-2'], tests: [{ status: 'expected', expectedStatus: 'passed', results: [{ status: 'passed', duration: 1200 }] }] },
              { title: 'badge', file: 'cart.spec.ts', tags: ['@REQ-3'], tests: [{ status: 'unexpected', expectedStatus: 'passed', results: [{ status: 'failed', duration: 500, error: { message: 'expected "1"\nreceived "2"' } }] }] },
              { title: 'later', file: 'cart.spec.ts', tags: [], tests: [{ status: 'expected', expectedStatus: 'failed', results: [{ status: 'failed', duration: 100 }] }] },
            ],
          },
        ],
      },
    ],
  };
  const tests = exportedTests(report);

  it('keeps the requirement and criteria with each test', () => {
    assert.deepEqual(
      tests.map((t) => [t.name, t.requirement, t.criteria, t.outcome]),
      [
        ['Cart > empties', 'SHOP-12', ['AC-1', 'AC-2'], 'passed'],
        ['Cart > badge', 'REQ-3', [], 'failed'],
        ['Cart > later', null, [], 'expected-failure'],
      ],
    );
    assert.equal(tests[1].message, 'expected "1"');
  });

  it('writes JUnit with the tags as properties', () => {
    const out = junitXml(tests);
    assert.match(out, /<testsuites tests="3" failures="1">/);
    assert.match(out, /<property name="requirement" value="SHOP-12"\/><property name="criteria" value="AC-1 AC-2"\/>/);
    assert.match(out, /<failure message="expected &quot;1&quot;"\/>/);
  });

  it('writes Xray with a Jira requirement only for a Jira key', () => {
    const out = JSON.parse(xrayJson(tests)) as { tests: { testInfo: { requirementKeys?: string[] }; status: string }[] };
    assert.deepEqual(out.tests[0].testInfo.requirementKeys, ['SHOP-12']);
    assert.equal(out.tests[1].testInfo.requirementKeys, undefined);
    assert.deepEqual(out.tests.map((t) => t.status), ['PASSED', 'FAILED', 'PASSED']);
  });

  it('writes a TestRail CSV with references, and names the file per format', () => {
    assert.match(testrailCsv(tests), /^Title,Section,References,Type,Last result,Message\n"Cart > empties","cart\.spec\.ts","SHOP-12, AC-1, AC-2","Automated","passed",""/);
    assert.equal(exportAs('junit', tests).name, 'coverage.junit.xml');
    assert.throws(() => exportAs('nope', tests), /Unknown export format/);
  });
});
