# Performance: Swag Labs

Lighthouse over every route through the signed-in browser. `index.html` is the same as a page; serve this branch with GitHub Pages to see it.

## Last run: 2026-10-21 14:57 UTC

- **10** page audits in the last run (5 routes)
- **5** failing budgets or regressed
- **95** median performance score
- **3.23 s** worst LCP
- **16** console, page and request errors
- **1** runs recorded

| | Page | Score | LCP | CLS | TBT | Errors | Why |
|---|---|---|---|---|---|---|---|
| FAIL | mobile /inventory.html | 67 | 3.23 s | 0.727 | 0 ms | 2 | performance score 67, budget 90; LCP 3.23 s, budget 2.50 s; CLS 0.727, budget 0.100 |
| FAIL | mobile / | 91 | 2.88 s | 0.004 | 0 ms | 0 | LCP 2.88 s, budget 2.50 s |
| FAIL | mobile /cart.html | 91 | 2.88 s | 0.000 | 5 ms | 2 | LCP 2.88 s, budget 2.50 s |
| FAIL | mobile /checkout-step-one.html | 91 | 2.81 s | 0.002 | 5 ms | 2 | LCP 2.81 s, budget 2.50 s |
| FAIL | mobile /checkout-step-two.html | 91 | 2.89 s | 0.000 | 0 ms | 2 | LCP 2.89 s, budget 2.50 s |
| pass | desktop / | 99 | 0.71 s | 0.002 | 0 ms | 0 | - |
| pass | desktop /inventory.html | 99 | 0.78 s | 0.000 | 0 ms | 2 | - |
| pass | desktop /cart.html | 99 | 0.71 s | 0.000 | 0 ms | 2 | - |
| pass | desktop /checkout-step-one.html | 99 | 0.71 s | 0.001 | 0 ms | 2 | - |
| pass | desktop /checkout-step-two.html | 99 | 0.71 s | 0.000 | 0 ms | 2 | - |

## Runs

| Date (UTC) | Result | Median score | Worst LCP | Persona | Commit |
|---|---|---|---|---|---|
| [2026-10-21 14:57](https://github.com/Beherrit/agentic-qa-playwright/actions/runs/39620928103) | 5 of 10 failed | 95 | 3.23 s | standard_user | aaa13c6 |
