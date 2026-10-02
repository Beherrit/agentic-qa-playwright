import type { Page } from '@playwright/test';

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
};

export function faultFromEnv(value: string | undefined = env().QA_FAULT): Fault | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<Fault>;
    const routes = Array.isArray(parsed.routes) ? parsed.routes.filter((r) => r && typeof r.url === 'string') : [];
    const initScript = typeof parsed.initScript === 'string' && parsed.initScript ? parsed.initScript : undefined;
    if (!initScript && routes.length === 0) return null;
    return { ...(initScript ? { initScript } : {}), routes: routes.map((r) => ({ ...r, abort: r.abort === true })) };
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
