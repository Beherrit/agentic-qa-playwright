import type { Page, TestInfo } from '@playwright/test';

/**
 * Fault injection for the sensitivity gate. When the pipeline runs the new tests against a target that carries a
 * fault, QA_FAULT holds it as JSON: a script to run on every page before the app's own, and requests to answer or
 * drop. The shared fixture calls `applyFault` on every page, so a broken version of the app exists for the length
 * of one run, with no broken account and no broken build. Outside the gate QA_FAULT is unset and nothing happens.
 *
 * This file is the same in every project the pipeline is installed in; `npx agentic-qa init` writes it. It uses no
 * Node types on purpose, so a project without @types/node compiles it too.
 */

/** The environment, without a dependency on Node's types. Empty where there is none. */
const env = (): Record<string, string | undefined> => (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};

export type Fault = {
  initScript?: string;
  routes: { url: string; abort: boolean; status?: number; body?: string; contentType?: string }[];
  /** A JavaScript expression, evaluated in the page, that is true when the breakage is visible. */
  probe?: string;
};

export function faultFromEnv(value: string | undefined = env().QA_FAULT): Fault | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<Fault>;
    const routes = Array.isArray(parsed.routes) ? parsed.routes.filter((r) => r && typeof r.url === 'string') : [];
    const initScript = typeof parsed.initScript === 'string' && parsed.initScript ? parsed.initScript : undefined;
    if (!initScript && routes.length === 0) return null;
    const probe = typeof parsed.probe === 'string' && parsed.probe ? parsed.probe : undefined;
    return { ...(initScript ? { initScript } : {}), routes: routes.map((r) => ({ ...r, abort: r.abort === true })), ...(probe ? { probe } : {}) };
  } catch {
    return null;
  }
}

export async function applyFault(page: Page, fault: Fault): Promise<void> {
  // A relative path is resolved against the working directory, which is the project root when Playwright runs.
  if (fault.initScript) await page.addInitScript({ path: fault.initScript });
  for (const route of fault.routes) {
    await page.route(route.url, (r) =>
      route.abort ? r.abort() : r.fulfill({ status: route.status ?? 200, body: route.body ?? '', contentType: route.contentType ?? 'application/json' }),
    );
  }
}

/**
 * Once the test is done, asks the page whether the breakage was there to see, and attaches the answer. The saboteur
 * gate needs it to tell a test that missed a fault from a fault the test never reached. A throwing probe counts as
 * false. Nothing happens without a probe, so outside that gate this is a no-op.
 */
export async function attachProbe(page: Page, testInfo: TestInfo, fault: Fault | null): Promise<void> {
  if (!fault?.probe || page.isClosed() || !page.url().startsWith('http')) return;
  let visible = false;
  try {
    visible = (await page.evaluate(fault.probe)) === true;
  } catch {
    // A probe that throws did not see the breakage.
  }
  await testInfo.attach('fault-probe', { contentType: 'application/json', body: JSON.stringify({ visible }) });
}
