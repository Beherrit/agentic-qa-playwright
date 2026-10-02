import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkedDuplicates, readiness, ticketBody, ticketLabels, withAnswers } from '../lib/draft.ts';
import type { TicketDraft } from '../lib/schemas.ts';
import { formAnswer, modeOf } from '../sources/index.ts';

const ready = (): TicketDraft => ({
  title: 'Save a wishlist',
  story: { asA: 'a shopper', iWant: 'to save products to a wishlist', soThat: 'I can buy them later' },
  why: 'Shoppers leave and forget what they wanted.',
  built: false,
  alreadyThere: 'There is a cart, but no wishlist.',
  criteria: [
    { id: 'AC-1', kind: 'happy', given: 'a signed-in shopper on the list', when: 'they click the heart on a product', then: 'the product appears on the wishlist page' },
    { id: 'AC-2', kind: 'negative', given: 'a signed-out visitor', when: 'they click the heart', then: 'they are sent to the login page' },
    { id: 'AC-3', kind: 'edge', given: 'a product already saved', when: 'they click the heart again', then: 'the product is removed from the wishlist' },
  ],
  assumptions: ['One wishlist per account.'],
  outOfScope: ['Sharing a wishlist.'],
  duplicates: [],
  questions: [],
});

const withCriterion = (draft: TicketDraft, change: Partial<TicketDraft['criteria'][number]>): TicketDraft => ({
  ...draft,
  criteria: draft.criteria.map((c, i) => (i === 0 ? { ...c, ...change } : c)),
});

describe('readiness', () => {
  it('passes a complete draft', () => {
    assert.deepEqual(readiness(ready()), []);
  });

  it('wants at least 3 criteria', () => {
    const draft = { ...ready(), criteria: ready().criteria.slice(0, 2) };
    assert.ok(readiness(draft).some((p) => /Fewer than 3/.test(p)));
  });

  it('wants a negative criterion', () => {
    const draft = { ...ready(), criteria: ready().criteria.map((c) => ({ ...c, kind: 'happy' as const })) };
    assert.ok(readiness(draft).some((p) => /negative/.test(p)));
  });

  it('refuses an empty or vague Then', () => {
    assert.ok(readiness(withCriterion(ready(), { then: '  ' })).some((p) => /AC-1 has no outcome/.test(p)));
    for (const then of ['It Works Correctly', 'works as expected', 'the total is correct', 'shows the list as expected', 'saves properly']) {
      assert.ok(readiness(withCriterion(ready(), { then })).some((p) => /AC-1 has a vague Then/.test(p)), then);
    }
  });

  it('reports a blocking question but not a plain one', () => {
    const plain = { ...ready(), questions: [{ question: 'Is there a limit?', blocking: false, why: 'Affects an edge.' }] };
    assert.deepEqual(readiness(plain), []);
    const blocking = { ...ready(), questions: [{ question: 'What changes?', blocking: true, why: 'No outcome named.' }] };
    assert.ok(readiness(blocking).some((p) => /What changes\?/.test(p)));
  });

  it('reports a duplicate', () => {
    const draft = { ...ready(), duplicates: [{ ref: '7', reason: 'Same ask.' }] };
    assert.ok(readiness(draft).some((p) => /duplicate of 7/.test(p)));
  });
});

describe('checkedDuplicates', () => {
  it('drops a ticket that is not open', () => {
    const draft = { ...ready(), duplicates: [{ ref: '7', reason: 'Same.' }, { ref: '99', reason: 'Made up.' }, { ref: '#8', reason: 'Same.' }] };
    const open = [{ ref: '7' }, { ref: '8' }];
    assert.deepEqual(
      checkedDuplicates(draft, open).map((d) => d.ref),
      ['7', '#8'],
    );
  });
});

describe('ticketLabels', () => {
  it('marks a draft with problems as needing info, and an unbuilt one as test-first', () => {
    assert.deepEqual(ticketLabels(ready(), ['x']), ['qa-needs-info', 'qa-test-first']);
    assert.deepEqual(ticketLabels({ ...ready(), built: true }, ['x']), ['qa-needs-info']);
  });

  it('never adds the label that starts the analysis', () => {
    assert.deepEqual(ticketLabels({ ...ready(), built: true }, []), []);
    assert.ok(!ticketLabels(ready(), ['x']).includes('qa-pipeline'));
  });
});

describe('withAnswers', () => {
  it('puts the wish, then the questions, then the answers', () => {
    const text = withAnswers('Make search better.', ['What should change?', 'For whom?'], 'Results by price.');
    assert.ok(text.startsWith('Make search better.'));
    assert.ok(text.indexOf('1. What should change?') < text.indexOf('2. For whom?'));
    assert.ok(text.indexOf('For whom?') < text.indexOf('Results by price.'));
  });
});

describe('ticketBody', () => {
  it('reads back as test-first or built through the existing parsing', () => {
    const notBuilt = ticketBody(ready());
    assert.equal(modeOf({ labels: [], body: notBuilt }), 'test-first');
    assert.equal(modeOf({ labels: [], body: ticketBody({ ...ready(), built: true }) }), 'built');
    assert.equal(formAnswer(notBuilt, 'Is the feature built yet?'), 'No, write the tests first');
    assert.match(formAnswer(notBuilt, 'What should the user be able to do?') ?? '', /^As a shopper, I want to save products/);
  });

  it('keeps a pipe in a criterion inside its cell', () => {
    const body = ticketBody(withCriterion(ready(), { then: 'the list shows A | B' }));
    const row = body.split('\n').find((line) => line.startsWith('| AC-1')) ?? '';
    assert.ok(row.includes('A \\| B'));
    // Five cells: the escaped pipe does not count as a separator.
    assert.equal(row.split(/(?<!\\)\|/).length - 2, 5);
  });

  it('leaves out empty parts and shows open questions', () => {
    const bare = ticketBody({ ...ready(), alreadyThere: '', assumptions: [], outOfScope: [] });
    assert.ok(bare.includes('_No response_'));
    const asked = ticketBody({ ...ready(), questions: [{ question: 'Which accounts?', blocking: true, why: 'Changes the setup.' }] });
    assert.ok(asked.includes('**Open questions**'));
    assert.ok(!asked.includes('**Out of scope**\n\n- None'));
  });
});
