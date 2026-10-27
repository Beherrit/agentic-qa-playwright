import tseslint from 'typescript-eslint';
import playwright from 'eslint-plugin-playwright';

export default tseslint.config(
  // qa-run-second-host and perf-history are local run folders; the perf fixtures are deliberately plain page scripts.
  // .claude holds the desktop app's session worktrees: whole checkouts whose tsconfig would otherwise make the parser's root ambiguous.
  { ignores: ['node_modules', 'playwright-report', 'test-results', 'qa-run', 'qa-run-second-host', 'perf-history', 'agents/evals/fixtures/perf', '.claude'] },
  ...tseslint.configs.recommended,
  {
    files: ['tests/**/*.ts'],
    ...playwright.configs['flat/recommended'],
    rules: {
      ...playwright.configs['flat/recommended'].rules,
      // The things a reviewer ends up flagging by hand if the linter doesn't.
      'playwright/no-wait-for-timeout': 'error',
      'playwright/no-focused-test': 'error',
      'playwright/no-skipped-test': 'error',
      'playwright/no-force-option': 'error',
      'playwright/no-element-handle': 'error',
      'playwright/no-conditional-in-test': 'error',
      'playwright/prefer-web-first-assertions': 'error',
      'playwright/expect-expect': 'error',
    },
  },
);
