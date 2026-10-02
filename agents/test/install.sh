#!/usr/bin/env bash
# The engine as a host project sees it. Packs this repository, installs the tarball into an empty project next to
# Playwright, and uses it there: init, doctor, a one-test suite through the configured command, the checks, an export,
# the MCP server. Anything that assumes the engine runs in its own repository fails here, not at a new job.
#
#   bash agents/test/install.sh         (needs the npm registry; takes about a minute)
set -euo pipefail

root=$(cd "$(dirname "$0")/../.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

say() { printf '\n== %s\n' "$*"; }
fail() { printf '\nFAILED: %s\n' "$*" >&2; exit 1; }

say "pack"
cd "$root"
tarball=$(npm pack --silent --pack-destination "$work")
test -f "$work/$tarball" || fail "npm pack wrote nothing"

say "install into an empty project"
mkdir "$work/host"
cd "$work/host"
git init -q
npm init -y >/dev/null
npm install --no-audit --no-fund --save-dev "$work/$tarball" @playwright/test typescript >/dev/null
test -x node_modules/.bin/agentic-qa || fail "the bin was not linked"

say "help and exit codes"
npx agentic-qa --help | head -1 | grep -q '^Usage: npx agentic-qa' || fail "--help"
if npx agentic-qa nope 2>/dev/null; then fail "an unknown command exited 0"; fi

say "init"
npx agentic-qa init | grep -q '^wrote  qa.config.json' || fail "init did not write the config"
for f in qa.config.json docs/product-brief.md docs/test-conventions.md docs/test-design.md \
         .github/workflows/qa-analysis.yml .github/workflows/qa-tests.yml .github/workflows/regression.yml \
         .github/workflows/qa-history.yml .github/ISSUE_TEMPLATE/requirement.yml .mcp.json fixtures/fault.ts; do
  test -f "$f" || fail "init did not write $f"
done
grep -q 'agentic-qa-playwright/.github/workflows/qa-analysis.yml@' .github/workflows/qa-analysis.yml || fail "the caller does not use the engine's workflow"
npx agentic-qa init | grep -q '^kept   qa.config.json' || fail "a second init overwrote the config"

say "a one-test suite in the shape the config expects"
mkdir -p tests pages
cat > fixtures/test.ts <<'TS'
export { test, expect } from '@playwright/test';
TS
cat > tests/smoke.spec.ts <<'TS'
import { expect, test } from '../fixtures/test.ts';

test.describe('Smoke', { tag: '@REQ-1' }, () => {
  test('the suite runs through the engine', { tag: '@AC-1' }, async () => {
    expect(1).toBe(1);
  });
});
TS
cat > playwright.config.ts <<'TS'
import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests', reporter: [['list'], ['json', { outputFile: 'test-results/results.json' }]] });
TS
cat > tsconfig.json <<'JSON'
{ "compilerOptions": { "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext", "strict": true, "noEmit": true, "skipLibCheck": true, "allowImportingTsExtensions": true, "types": [] }, "include": ["tests", "fixtures", "playwright.config.ts"] }
JSON
# No eslint in this project: the lint command is whatever the project says it is.
node -e "
const fs = require('node:fs');
const c = JSON.parse(fs.readFileSync('qa.config.json', 'utf8'));
c.app.name = 'Host'; c.app.baseUrl = 'http://127.0.0.1:9';
c.suite.commands.lint = 'echo lint';
fs.writeFileSync('qa.config.json', JSON.stringify(c, null, 2));
"

say "doctor reads the host config, not the engine's"
doctor=$(npx agentic-qa doctor || true)
printf '%s\n' "$doctor" | grep -q 'Host at http://127.0.0.1:9' || fail "doctor did not read the host config"
printf '%s\n' "$doctor" | grep -q '^ok    Suite commands' || fail "doctor did not accept the suite commands"
printf '%s\n' "$doctor" | grep -q '^ok    Writable folders' || fail "doctor did not see the writable folders"
printf '%s\n' "$doctor" | grep -q 'Agent instructions   1[0-9] roles' || fail "doctor did not find the prompts in the package"

say "suite, check, coverage and an export through the configured commands"
npx agentic-qa suite --list | grep -q 'Total: 1 test' || fail "suite --list"
check=$(npx agentic-qa check 2>&1) || { printf '%s\n' "$check"; fail "check failed"; }
printf '%s\n' "$check" | grep -q '^> echo lint' || { printf '%s\n' "$check"; fail "check did not run the configured lint"; }
npx agentic-qa suite --reporter=line >/dev/null || fail "the suite did not pass"
cov=$(npx agentic-qa coverage --export junit 2>&1) || { printf '%s\n' "$cov"; fail "coverage failed"; }
printf '%s\n' "$cov" | grep -q 'REQ-1' || { printf '%s\n' "$cov"; fail "coverage did not find the tag"; }
test -f qa-run/coverage.junit.xml || fail "no JUnit export"
grep -q 'name="criteria" value="AC-1"' qa-run/coverage.junit.xml || fail "the export lost the criteria"

say "the MCP server answers over stdio"
cat > "$work/mcp.mjs" <<'JS'
import { spawn } from 'node:child_process';
const p = spawn('npx', ['agentic-qa', 'mcp'], { stdio: ['pipe', 'pipe', 'ignore'] });
let out = '';
p.stdout.on('data', (d) => { out += d; if (out.includes('"qa_doctor"')) { p.kill(); console.log('ok'); process.exit(0); } });
const send = (o) => p.stdin.write(JSON.stringify(o) + '\n');
send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'install', version: '0' } } });
send({ jsonrpc: '2.0', method: 'notifications/initialized' });
send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
setTimeout(() => { p.kill(); console.error('no tools/list answer'); process.exit(1); }, 30000);
JS
node "$work/mcp.mjs" | grep -q '^ok' || fail "the MCP server did not list its tools"

say "installed and working"
