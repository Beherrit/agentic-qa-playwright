import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkedRisks, ticketBody } from '../lib/draft.ts';
import { requirementsMd, technicalMd } from '../lib/render.ts';
import type { Request, Requirements, TicketDraft } from '../lib/schemas.ts';
import {
  checkTechnical,
  hasTitle,
  inRepo,
  mergeRisks,
  parseGuard,
  riskFromTicket,
  specTitles,
  technicalFromTicket,
  type Repo,
  type TechnicalResult,
} from '../lib/technical.ts';

const CART_SPEC = `import { test, expect } from '../fixtures/test';

test.describe('Cart', () => {
  test('adding items updates the cart badge', async ({ signedIn }) => {
    test.fail(true, 'bug: AC-1 the badge is wrong');
    await expect(signedIn.badge).toHaveText('1');
  });
  test("removing an item. Then the badge drops", async () => {});
  test(\`the cart starts empty\`, async () => {});
});
`;

const repo: Repo = {
  fileExists: (file) => ['tests/cart.spec.ts', 'pages/CartPage.ts'].includes(file),
  titlesIn: (file) => (file === 'tests/cart.spec.ts' ? specTitles(CART_SPEC) : null),
};

const draft = (): TicketDraft => ({
  title: 'Save a wishlist',
  story: { asA: 'a shopper', iWant: 'to save products to a wishlist', soThat: 'I can buy them later' },
  why: 'Shoppers forget what they wanted.',
  built: false,
  alreadyThere: 'There is a cart, but no wishlist.',
  criteria: [
    { id: 'AC-1', kind: 'happy', given: 'a', when: 'b', then: 'the product appears on the wishlist page' },
    { id: 'AC-2', kind: 'negative', given: 'a', when: 'b', then: 'they are sent to the login page' },
    { id: 'AC-3', kind: 'edge', given: 'a', when: 'b', then: 'the product is removed' },
  ],
  assumptions: [],
  outOfScope: [],
  risk: 'high',
  riskReason: 'Shares the product card with the cart.',
  technical: {
    covered: [
      { file: 'tests/cart.spec.ts', test: 'adding items updates the cart badge', covers: 'The badge count' },
      { file: 'tests/cart.spec.ts', test: 'removing an item. Then the badge drops', covers: 'Removal' },
    ],
    pages: [
      { file: 'pages/CartPage.ts', member: 'cartBadge', exists: true, note: 'Reads the count.' },
      { file: 'pages/WishlistPage.ts', member: 'remove(name)', exists: false, note: 'A | new page.' },
    ],
    touches: [
      { area: 'the cart badge', why: 'Same header', guardedBy: 'tests/cart.spec.ts: adding items updates the cart badge' },
      { area: 'the product card', why: 'Same button row', guardedBy: null },
    ],
    related: [{ ref: '7', why: 'Also changes the card.' }],
    notes: 'Route is /inventory.html.',
  },
  duplicates: [],
  questions: [],
});

describe('specTitles', () => {
  it('reads test and describe titles in any quote style, and not a marker reason', () => {
    assert.deepEqual(specTitles(CART_SPEC), ['Cart', 'adding items updates the cart badge', 'removing an item. Then the badge drops', 'the cart starts empty']);
  });

  it('matches a bare title or one given with its describe path', () => {
    const titles = specTitles(CART_SPEC);
    assert.ok(hasTitle(titles, 'the cart starts empty'));
    assert.ok(hasTitle(titles, 'Cart > the cart starts empty'));
    assert.ok(!hasTitle(titles, 'the cart starts full'));
  });
});

describe('guards and paths', () => {
  it('splits a guard into file and title', () => {
    assert.deepEqual(parseGuard('tests/cart.spec.ts: the cart starts empty'), { file: 'tests/cart.spec.ts', title: 'the cart starts empty' });
    assert.equal(parseGuard('the cart test'), null);
    assert.equal(parseGuard(null), null);
  });

  it('never looks outside the repository', () => {
    assert.ok(inRepo('tests/cart.spec.ts'));
    for (const file of ['../secrets.spec.ts', '/etc/passwd', 'C:\\x.spec.ts', 'tests/../../x', '']) assert.ok(!inRepo(file), file);
  });

  it('counts a regression guard only when the test is really in the file', () => {
    const risks = ['tests/cart.spec.ts: adding items updates the cart badge', 'tests/cart.spec.ts: a test nobody wrote', 'tests/gone.spec.ts: x'].map(
      (guardedBy) => ({ area: 'a', why: 'w', guardedBy }),
    );
    assert.deepEqual(
      checkedRisks(risks, repo.fileExists, repo.titlesIn).map((r) => r.guardedBy),
      ['tests/cart.spec.ts: adding items updates the cart badge', null, null],
    );
    // Without a way to read titles, the file alone decides, as before.
    assert.deepEqual(checkedRisks(risks, repo.fileExists).map((r) => r.guardedBy !== null), [true, true, false]);
  });
});

describe('checkTechnical', () => {
  it('keeps what holds and says what it took out', () => {
    const t = draft().technical;
    t.covered.push({ file: 'tests/cart.spec.ts', test: 'a title from memory', covers: 'x' }, { file: 'tests/gone.spec.ts', test: 'x', covers: 'y' });
    t.pages.push({ file: 'pages/GonePage.ts', member: 'x', exists: true, note: '' });
    t.touches.push({ area: 'checkout', why: 'w', guardedBy: 'tests/checkout.spec.ts: totals add up' });
    t.related.push({ ref: '#99', why: 'made up' });
    const { technical, dropped } = checkTechnical(t, repo, ['7', '8']);
    assert.equal(technical.covered.length, 2);
    assert.deepEqual(technical.pages.map((p) => p.exists), [true, false, false]);
    assert.deepEqual(technical.touches.map((x) => x.guardedBy === null), [false, true, true]);
    assert.deepEqual(technical.related.map((r) => r.ref), ['7']);
    assert.equal(dropped.length, 5);
    assert.ok(dropped.some((d) => d.includes('a title from memory')));
    assert.ok(dropped.some((d) => d.includes('#99')));
  });

  it('leaves clean notes alone', () => {
    const { technical, dropped } = checkTechnical(draft().technical, repo, ['7']);
    assert.deepEqual(technical, draft().technical);
    assert.deepEqual(dropped, []);
  });
});

describe('mergeRisks', () => {
  it('starts from the review and adds only what the architect found that it did not', () => {
    const touches = [{ area: 'The cart badge', why: 'review', guardedBy: null }];
    const risks = [
      { area: 'the  cart badge', why: 'architect', guardedBy: 'tests/cart.spec.ts: x' },
      { area: 'sorting', why: 'architect', guardedBy: null },
    ];
    assert.deepEqual(mergeRisks(touches, risks).map((r) => `${r.area}/${r.why}`), ['The cart badge/review', 'sorting/architect']);
  });
});

describe('technicalFromTicket', () => {
  it("reads the writer's notes back whole, including a title with a full stop in it", () => {
    const d = draft();
    const read = technicalFromTicket(ticketBody(d), repo.titlesIn);
    assert.ok(read);
    assert.deepEqual(read.covered, d.technical.covered);
    assert.deepEqual(read.pages, d.technical.pages);
    assert.deepEqual(read.touches, d.technical.touches);
    assert.deepEqual(read.related, d.technical.related);
    assert.equal(read.notes, d.technical.notes);
    assert.equal(read.risk, 'high');
    assert.equal(read.riskReason, d.riskReason);
  });

  it('splits at the first full stop when the titles cannot be read', () => {
    const read = technicalFromTicket(ticketBody(draft()));
    assert.equal(read?.covered[1].test, 'removing an item');
  });

  it('returns null for a hand-written ticket or empty notes', () => {
    assert.equal(technicalFromTicket('### What should the user be able to do?\n\nSort things.\n'), null);
    assert.equal(technicalFromTicket('### Technical notes\n\n_No response_\n'), null);
  });

  it('keeps free text as notes and falls back to a medium risk', () => {
    const read = technicalFromTicket('### Technical notes\n\nThe sort control is a select with data-test="product-sort-container".\n');
    assert.equal(read?.notes, 'The sort control is a select with data-test="product-sort-container".');
    assert.equal(read?.risk, 'medium');
    assert.deepEqual(riskFromTicket('### Risk\n\n**low.** Cosmetic.\n'), { risk: 'low', riskReason: 'Cosmetic.' });
  });
});

describe('technicalMd', () => {
  const request: Request = { key: 'REQ-3', source: 'github', ref: '3', url: null, title: 't', body: 'b', mode: 'built' };
  const requirements: Requirements = {
    title: 't',
    story: { asA: 'a', iWant: 'to b', soThat: 'c' },
    criteria: draft().criteria,
    assumptions: [],
    outOfScope: [],
    openQuestions: [],
    risk: 'low',
    riskReason: 'r',
  };
  const result = (by: TechnicalResult['by'], dropped: string[] = []): TechnicalResult => ({ ...draft().technical, risk: 'high', riskReason: 'Shared card.', by, dropped });

  it('says who wrote the notes and what the checks took out', () => {
    const writer = technicalMd(result('ticket-writer'));
    assert.match(writer, /^### Technical review/);
    assert.match(writer, /ticket writer's notes and checked against the repository\. No reviewer run\./);
    assert.match(writer, /1 of 2 nearby behaviours unguarded/);
    assert.match(writer, /\*\*Technical risk:\*\* high\. Shared card\./);
    assert.doesNotMatch(writer, /Taken out by the checks/);
    const reviewer = technicalMd(result('technical-reviewer', ['Related: #99 is not an open ticket.']));
    assert.match(reviewer, /Written by the technical reviewer/);
    assert.match(reviewer, /<summary>Taken out by the checks \(1\)<\/summary>[\s\S]*#99/);
  });

  it('is part of the requirements section when there is one', () => {
    assert.doesNotMatch(requirementsMd(request, requirements), /Technical review/);
    assert.match(requirementsMd(request, requirements, result('technical-reviewer')), /### Technical review[\s\S]*Page objects and locators/);
  });
});
