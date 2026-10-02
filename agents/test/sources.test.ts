import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { artifactFor, branchFor, BRANCH, keyFor, validateRef } from '../lib/keys.ts';
import { adfToMarkdown, cells, inline, markdownToAdf } from '../sources/adf.ts';
import { formAnswer, modeOf } from '../sources/index.ts';

describe('keys', () => {
  it('derives a key per source', () => {
    assert.equal(keyFor('github', '12'), 'REQ-12');
    assert.equal(keyFor('jira', 'SHOP-123'), 'SHOP-123');
    assert.equal(keyFor('local', ''), 'REQ-0');
  });

  it('refuses references that could carry anything else', () => {
    assert.throws(() => validateRef('github', '12; rm -rf /'));
    assert.throws(() => validateRef('github', '0'));
    assert.throws(() => validateRef('jira', 'shop-12'));
    assert.throws(() => validateRef('jira', 'SHOP-12/../../admin'));
    assert.equal(validateRef('jira', 'SHOP_2-7'), 'SHOP_2-7');
  });

  it('names branches and artifacts the publish job will accept', () => {
    assert.equal(branchFor('SHOP-123'), 'qa/shop-123');
    assert.ok(BRANCH.test(branchFor('SHOP-123')));
    assert.ok(BRANCH.test(branchFor('REQ-7')));
    assert.ok(!BRANCH.test('main'));
    assert.equal(artifactFor('SHOP-123'), 'qa-analysis-shop-123');
  });
});

describe('mode', () => {
  const form = (answer: string): string =>
    `### What should the user be able to do?\n\nSort.\n\n### Is the feature built yet?\n\n${answer}\n\n### Anything already known\n\n_No response_`;

  it('reads the issue form answer', () => {
    assert.equal(formAnswer(form('Yes, test what is there'), 'Is the feature built yet?'), 'Yes, test what is there');
    assert.equal(modeOf({ labels: [], body: form('No, write the tests first') }), 'test-first');
    assert.equal(modeOf({ labels: [], body: form('Yes, test what is there') }), 'built');
  });

  it('takes the label on any tracker, and defaults to built', () => {
    assert.equal(modeOf({ labels: ['qa-test-first'], body: 'Plain Jira description' }), 'test-first');
    assert.equal(modeOf({ labels: [], body: 'Plain Jira description' }), 'built');
  });
});

describe('ADF to markdown', () => {
  const p = (...content: unknown[]) => ({ type: 'paragraph', content });
  const t = (text: string) => ({ type: 'text', text });

  it('reads a typical Jira description', () => {
    const doc = {
      type: 'doc',
      version: 1,
      content: [
        { type: 'heading', attrs: { level: 3 }, content: [t('Story')] },
        p(t('As a shopper '), { type: 'mention', attrs: { text: '@Lawrence' } }, { type: 'hardBreak' }, t('second line')),
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [p(t('by price'))] },
            { type: 'listItem', content: [p(t('by name'))] },
          ],
        },
        {
          type: 'table',
          content: [
            { type: 'tableRow', content: [{ type: 'tableHeader', content: [p(t('Given'))] }, { type: 'tableHeader', content: [p(t('Then'))] }] },
            { type: 'tableRow', content: [{ type: 'tableCell', content: [p(t('a | b'))] }, { type: 'tableCell', content: [p(t('sorted'))] }] },
          ],
        },
        { type: 'somethingNew', content: [p(t('kept'))] },
      ],
    };
    assert.equal(
      adfToMarkdown(doc),
      ['### Story', 'As a shopper @Lawrence\nsecond line', '- by price\n- by name', '| Given | Then |\n|---|---|\n| a \\| b | sorted |', 'kept'].join('\n\n'),
    );
  });

  it('copes with an empty description', () => {
    assert.equal(adfToMarkdown(null), '');
  });
});

describe('markdown to ADF', () => {
  it('turns bold, code, links and <br> into marks, and never leaves an empty text node', () => {
    assert.deepEqual(inline('**Risk:** high. See `qa-run` and [the run](https://example.com/r)<br>next'), [
      { type: 'text', text: 'Risk:', marks: [{ type: 'strong' }] },
      { type: 'text', text: ' high. See ' },
      { type: 'text', text: 'qa-run', marks: [{ type: 'code' }] },
      { type: 'text', text: ' and ' },
      { type: 'text', text: 'the run', marks: [{ type: 'link', attrs: { href: 'https://example.com/r' } }] },
      { type: 'hardBreak' },
      { type: 'text', text: 'next' },
    ]);
  });

  it('keeps a data row that starts with dashes, and never makes an empty code text node', () => {
    const doc = markdownToAdf('| a | b |\n|---|---|\n| -- | none |\n\n```\n\n```');
    assert.equal(doc.content[0].content!.length, 2);
    assert.equal(doc.content[0].content![1].content![0].content![0].content![0].text, '--');
    assert.deepEqual(doc.content[1], { type: 'codeBlock', content: [] });
  });

  it('splits table rows on unescaped pipes only', () => {
    assert.deepEqual(cells('| AC-1 | a \\| b | |'), ['AC-1', 'a \\| b', '']);
  });

  it('converts a report: headings, tables with a header row, lists, details', () => {
    const doc = markdownToAdf(
      [
        '## QA analysis: Sort (SHOP-12)',
        '',
        '| | Kind | Then |',
        '|---|---|---|',
        '| AC-1 | happy | cheapest first |',
        '',
        '- one',
        '- [ ] two',
        '',
        '<details><summary>Steps</summary>',
        '',
        '1. open',
        '2. sort',
        '',
        '</details>',
        'A paragraph',
        'over two lines.',
      ].join('\n'),
    );
    assert.equal(doc.version, 1);
    assert.deepEqual(
      doc.content.map((n) => n.type),
      ['heading', 'table', 'bulletList', 'paragraph', 'orderedList', 'paragraph'],
    );
    const table = doc.content[1];
    assert.equal(table.content!.length, 2, 'the separator row is dropped');
    assert.equal(table.content![0].content![0].type, 'tableHeader');
    assert.equal(table.content![1].content![2].content![0].content![0].text, 'cheapest first');
    assert.equal(doc.content[2].content![1].content![0].content![0].text, '☐ two');

    const empty = (nodes: unknown[]): boolean =>
      nodes.some((n) => {
        const node = n as { type: string; text?: string; content?: unknown[] };
        return (node.type === 'text' && !node.text) || empty(node.content ?? []);
      });
    assert.equal(empty(doc.content), false);
  });
});
