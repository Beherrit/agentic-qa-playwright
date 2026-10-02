# Test conventions

The rules the suite follows. People and agents are held to the same ones, and the code review stage checks against
this page.

## Layout

| Folder | Holds |
|---|---|
| `tests/` | Spec files, one per feature: `tests/<feature>.spec.ts` |
| `pages/` | Page objects, one class per page: `pages/<Name>Page.ts` |
| `fixtures/` | `test.ts` (the `test` and `expect` every spec imports) and shared test data |

Specs import `test` and `expect` from `fixtures/test.ts`, never straight from `@playwright/test`. A new page object
gets a fixture there, so tests receive it as an argument instead of constructing it.

## Page objects

- Signed-in pages extend `BasePage`.
- Locators are `readonly` fields set in the constructor. Methods are actions a user would recognise
  (`addToCart`, `signIn`).
- No assertions in page objects. A page object says how to do something; the test decides what should be true.
- Reuse what exists. Add a locator or method to an existing page object before writing a new class.

## Locators

In order of preference:

1. Role and accessible name: `getByRole('button', { name: 'Checkout' })`
2. Label or placeholder: `getByPlaceholder('First Name')`
3. Test id: `getByTestId('shopping-cart-badge')` (the config maps this to the app's `data-test` attribute)

No XPath. No CSS classes or DOM structure (`.btn_primary`, `div > span:nth-child(2)`). They break when styling
changes and say nothing about what the user sees.

## Tests

- A title states the behaviour in plain words: `sorting by price shows the cheapest product first`.
- One behaviour per test. If the title needs "and", it is probably two tests.
- Every test stands alone: it does its own setup and passes when run by itself, in any order, in parallel.
- Assert on what the user can observe, using web-first assertions (`await expect(locator).toHaveText(...)`).
  They retry until the page settles.
- Never `waitForTimeout`, never `{ force: true }`, no `test.only`, `test.skip` or `test.fixme`.
- No `if` or `try/catch` inside a test. A test that branches is hiding which path it checked.
- Expected values are written out or come from named test data. Do not compute the expected result with the same
  logic the app uses; if the test sorts the list to see whether the app sorted the list, compare against a known
  order as well.
- A negative test proves the bad thing did not happen, not only that an error appeared. After a rejected login,
  check the user is still on the login page.
- Existing spec files only grow. New tests go in their own `describe` block; lines someone else wrote stay as they
  are.

## Expected failures

`test.fail()` turns a failing test green, so it is used for exactly two reasons, written as the first line of the
test and always with the reason:

```ts
test.fail(true, 'bug: AC-3 the total ignores tax');   // the app disagrees with a criterion; report it as a bug
test.fail(true, 'not built yet: SHOP-12');           // test-first: written before the feature exists
```

Either way the test asserts the correct behaviour and must fail because of the app (an assertion that does not hold,
an element that is not there), never because of a mistake in the test. When the bug is fixed or the feature lands,
Playwright reports "expected to fail, but passed" and the marker comes off.

## Traceability

Tests written for a tracked requirement carry two tags, so a failure in six months can be traced back to why the
test exists:

```ts
test.describe('Product sorting', { tag: '@REQ-12' }, () => {
  test('sorting by price low to high shows the cheapest product first', { tag: '@AC-2' }, async ({ signedIn }) => {
    // ...
  });
});
```

`@REQ-<n>` is a GitHub issue (issue 12 is `@REQ-12`); a Jira ticket keeps its own key (`@SHOP-123`). `@AC-<n>` is
the acceptance criterion the test checks. A test may carry more than one `@AC` tag.

## Before a change is done

```
npm run typecheck
npm run lint
npm test
```
