import type { Target } from './paths.ts';

/**
 * Fault injection: a known-broken version of the app made on the spot, so the sensitivity gate works on any app
 * and not only on one that ships broken accounts. The gate puts the fault in QA_FAULT; the suite's shared fixture
 * applies it to every page (fixtures/fault.ts). Only the parts that travel are here, so they can be tested.
 */

export type Fault = {
  /** A JavaScript file, relative to the project root, run on every page before the app's own scripts. */
  initScript?: string;
  /** Requests answered or dropped before they reach the server. */
  routes: { url: string; abort: boolean; status?: number; body?: string; contentType?: string }[];
};

/** The fault a target carries, or null when it is only a set of environment variables. */
export function faultOf(target: Pick<Target, 'initScript' | 'routes'>): Fault | null {
  if (!target.initScript && target.routes.length === 0) return null;
  return { ...(target.initScript ? { initScript: target.initScript } : {}), routes: target.routes };
}

/** The environment a target's run gets: its own variables, plus the fault as JSON when it has one. */
export function targetEnv(target: Target): Record<string, string> {
  const fault = faultOf(target);
  return { ...target.env, ...(fault ? { QA_FAULT: JSON.stringify(fault) } : {}) };
}

/** The fault in QA_FAULT, or null. Anything that is not the JSON the gate writes is ignored. */
export function faultFromEnv(value: string | undefined): Fault | null {
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
