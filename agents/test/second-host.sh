#!/usr/bin/env bash
# The engine against an app that is not the demo shop. Everything in this repository was first built against Swag
# Labs, a client-side shop with no API and no real sign-in; portability is a claim until a different stack goes
# through init, doctor, analysis and generation. OWASP Juice Shop is that stack: an Angular single-page app over a
# REST API with JWT sign-in, run from a container so nothing public is leaned on.
#
#   docker run -d --rm -p 3000:3000 --name juice bkimminich/juice-shop
#   bash agents/test/second-host.sh              the pipeline end to end (runs agents; needs Claude credentials)
#   SECOND_HOST_DRY=1 bash agents/test/second-host.sh   pack, install, init, doctor and a smoke test; no agent, no cost
#
# The second-host workflow runs the full form weekly; the dry form is what a pull request and a laptop can afford.
set -euo pipefail

root=$(cd "$(dirname "$0")/../.." && pwd)
app=${SECOND_HOST_URL:-http://localhost:3000}
work=$(mktemp -d)
# Whatever happens, the run folder comes home before the temp dir goes: a failed gate is the interesting case.
keep() { [ -d "$work/host/qa-run" ] && rm -rf "$root/qa-run-second-host" && cp -r "$work/host/qa-run" "$root/qa-run-second-host" && echo "Run folder kept at qa-run-second-host/"; rm -rf "$work"; }
trap keep EXIT

say() { printf '\n== %s\n' "$*"; }
fail() { printf '\nFAILED: %s\n' "$*" >&2; exit 1; }

say "the app answers at $app"
for _ in $(seq 1 60); do
  curl -fsS "$app/rest/admin/application-version" >/dev/null 2>&1 && break
  sleep 2
done
curl -fsS "$app/rest/admin/application-version" || fail "Juice Shop is not answering at $app"

say "pack and install into an empty project"
cd "$root"
tarball=$(npm pack --silent --pack-destination "$work")
mkdir "$work/host"
cd "$work/host"
git init -q
npm init -y >/dev/null
npm install --no-audit --no-fund --save-dev "$work/$tarball" @playwright/test typescript @types/node >/dev/null
npx agentic-qa init | grep -q '^wrote  qa.config.json' || fail "init did not write the config"

say "configure it for Juice Shop"
APP="$app" node -e "
const fs = require('node:fs');
const c = JSON.parse(fs.readFileSync('qa.config.json', 'utf8'));
c.app = { name: 'OWASP Juice Shop', baseUrl: process.env.APP, brief: 'docs/product-brief.md' };
c.suite.commands.lint = 'echo lint';
c.sabotage.required = false;
c.sensitivity.required = false;
c.budget = { maxUsdPerRun: Number(process.env.SECOND_HOST_BUDGET || 4) };
if (process.env.SECOND_HOST_MODEL) c.models = { '*': process.env.SECOND_HOST_MODEL };
fs.writeFileSync('qa.config.json', JSON.stringify(c, null, 2));
"
cat > docs/product-brief.md <<'MD'
# OWASP Juice Shop

An online shop for juice, built as a deliberately insecure practice application. Visitors browse a product grid on
the home page, open a product for its description and reviews, and search for products from the magnifying-glass
icon in the top bar, which reveals a search field; the grid then shows only matching products, and a term that
matches nothing shows a "No results found" message. Customers register and sign in with email and password to add
items to the basket and check out. The page shows a cookie-consent banner and a welcome dialog on first visit, both
with a dismiss button; the app remembers the dismissal in local storage and a cookie, so a fixture that sets those skips both.

Personas: a visitor needs no account. Registration is open: any email and a password of at least five characters.
Known broken by design: this is a security training app, so many inputs accept things a real shop would reject;
treat that as the product's behaviour, not as bugs to file.
MD
# Juice Shop's test ids are its own; the generated page objects use roles and text first, as the conventions say.
sed -i.bak "s/testIdAttribute: 'data-testid'/testIdAttribute: 'data-test'/" playwright.config.ts && rm -f playwright.config.ts.bak
cat > tests/smoke.spec.ts <<'TS'
import { expect, test } from '../fixtures/test.ts';

test.describe('Smoke', { tag: '@REQ-0' }, () => {
  test('the home page shows the product grid once the welcome dialog is dismissed', { tag: '@AC-1' }, async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Close Welcome Banner' }).click();
    await page.getByRole('button', { name: 'dismiss cookie message' }).click();
    await expect(page.getByText('All Products')).toBeVisible();
  });
});
TS

say "doctor and the smoke test"
npx agentic-qa doctor || fail "doctor is not happy"
npx playwright install chromium >/dev/null 2>&1 || true
npx agentic-qa suite --reporter=line || fail "the smoke test did not pass against Juice Shop"

if [ "${SECOND_HOST_DRY:-}" = "1" ]; then
  say "dry run: stopping before the agents"
  exit 0
fi

# A real project has a history. Without a commit, the scope gate sees every file as a change outside the writable folders.
git add -A && git -c user.name=second-host -c user.email=second-host@example.invalid commit -q -m "Scaffold from npx agentic-qa init"

say "the whole pipeline on one requirement"
npx agentic-qa all \
  --title "Search for products from the top bar" \
  --text "As a visitor, I want to search for products by a word in their name so that I find what I want without scrolling.
Clicking the magnifying-glass icon in the top bar reveals a search field. Typing a term and pressing Enter shows only the products whose name contains the term, case-insensitively. Searching for a term that matches no product shows the message 'No results found'. Clearing the search shows the full grid again."

test -f qa-run/analysis.md || fail "no analysis was written"
test -f qa-run/gates.md || fail "no gate report was written"
grep -q '"passed": *true' qa-run/gates.json || { cat qa-run/gates.md; fail "the generated tests did not pass the gates"; }
count=$(find tests -name '*.spec.ts' | wc -l)
[ "$count" -ge 2 ] || fail "no spec was generated"
say "second host: analysed, generated and gated. Run folder copied to qa-run-second-host/"
