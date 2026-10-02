import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ticketBody } from '../lib/draft.ts';
import type { TicketDraft } from '../lib/schemas.ts';
import { requirementsFromTicket, section, technicalNotes } from '../lib/ticket.ts';

const draft = (): TicketDraft => ({
  title: 'Save a wishlist',
  story: { asA: 'a shopper', iWant: 'to save products to a wishlist', soThat: 'I can buy them later' },
  why: 'Shoppers leave and forget what they wanted.',
  built: false,
  alreadyThere: 'There is a cart, but no wishlist.',
  criteria: [
    { id: 'AC-1', kind: 'happy', given: 'a signed-in shopper', when: 'they click the heart', then: 'the product appears on the wishlist page' },
    { id: 'AC-2', kind: 'negative', given: 'a signed-out visitor', when: 'they click the heart', then: 'they are sent to the login page' },
    { id: 'AC-3', kind: 'edge', given: 'a product already saved', when: 'they click the heart again', then: 'the product is removed from the wishlist' },
  ],
  assumptions: ['One wishlist per account.', 'Hearts persist after a reload.'],
  outOfScope: ['Sharing a wishlist.'],
  risk: 'high',
  riskReason: 'Shares the product card with the cart.',
  technical: {
    covered: [{ file: 'tests/cart.spec.ts', test: 'adding items updates the cart badge', covers: 'Badge count' }],
    pages: [{ file: 'pages/WishlistPage.ts', member: 'remove(name)', exists: false, note: 'New.' }],
    touches: [{ area: 'the cart badge', why: 'Same header', guardedBy: null }],
    related: [{ ref: '7', why: 'Also changes the card.' }],
    notes: 'Route is /inventory.html.',
  },
  duplicates: [],
  questions: [
    { question: 'Which accounts?', blocking: true, why: 'Changes the setup.' },
    { question: 'Is there a limit?', blocking: false, why: 'Edge.' },
  ],
});

const HAND_WRITTEN = `### What should the user be able to do?

As a shopper, I want to sort the list, so that I can find the cheapest item.

| | Kind | Given | When | Then |
|---|---|---|---|---|
| AC-1 | happy | a | b | c |
| AC-2 | negative | a | b | c |
| AC-3 | edge | a | b | c |

### Is the feature built yet?

No, write the tests first
`;

describe('section', () => {
  const body = '### One\n\nfirst\n\n### Two words\nsecond\nline\n\n### Three\n\nlast\n';

  it('returns the text under a heading up to the next one, trimmed', () => {
    assert.equal(section(body, 'One'), 'first');
    assert.equal(section(body, 'Two words'), 'second\nline');
    assert.equal(section(body, 'Three'), 'last');
  });

  it('ignores case and returns null when the heading is absent', () => {
    assert.equal(section(body, 'two WORDS'), 'second\nline');
    assert.equal(section(body, 'Four'), null);
  });
});

describe('technicalNotes', () => {
  it('returns the notes section, or null for a hand-written ticket', () => {
    assert.match(technicalNotes(ticketBody(draft())) ?? '', /^\*\*Already covered\*\*/);
    assert.equal(technicalNotes(HAND_WRITTEN), null);
  });
});

describe('requirementsFromTicket', () => {
  it('gives back the criteria, story and assumptions the writer put in', () => {
    const d = draft();
    const req = requirementsFromTicket(`Requirement: ${d.title}`, ticketBody(d));
    assert.ok(req);
    assert.equal(req.title, d.title);
    assert.deepEqual(req.story, d.story);
    assert.deepEqual(req.criteria, d.criteria);
    assert.deepEqual(req.assumptions, d.assumptions);
    assert.deepEqual(req.outOfScope, d.outOfScope);
    assert.equal(req.risk, 'high');
    assert.equal(req.riskReason, d.riskReason);
  });

  it('reads blocking and plain open questions', () => {
    const req = requirementsFromTicket('Requirement: x', ticketBody(draft()));
    assert.deepEqual(req?.openQuestions.map((q) => q.blocking), [true, false]);
    assert.ok(req?.openQuestions[0].question.startsWith('Which accounts?'));
  });

  it('keeps an escaped pipe inside its cell', () => {
    const d = draft();
    d.criteria[0] = { ...d.criteria[0], then: 'the list shows A | B' };
    assert.equal(requirementsFromTicket('x', ticketBody(d))?.criteria[0].then, 'the list shows A | B');
  });

  it('returns null for a ticket without technical notes', () => {
    assert.equal(requirementsFromTicket('Sort', HAND_WRITTEN), null);
  });

  it('returns null when the story or the criteria cannot be read whole', () => {
    const body = ticketBody(draft());
    assert.equal(requirementsFromTicket('x', body.replace(/^As .*$/m, 'Something else.')), null);
    assert.equal(requirementsFromTicket('x', body.replace(/^\| AC-3 .*\n/m, '')), null);
    assert.equal(requirementsFromTicket('x', body.replace('| edge |', '| odd |')), null);
  });

  it('falls back to a medium risk when the section is missing', () => {
    const body = ticketBody(draft()).replace(/### Risk\n\n.*\n\n/, '');
    const req = requirementsFromTicket('x', body);
    assert.equal(req?.risk, 'medium');
    assert.equal(req?.riskReason, 'Taken from the ticket.');
  });
});
