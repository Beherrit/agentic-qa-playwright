import type { Page } from '@playwright/test';

/**
 * Which pages get audited: the routes the config names, the sitemap, and a bounded crawl of same-origin links.
 * The parsing is pure so agents/test/ can check it; only `crawl` touches a browser.
 */

const SKIP_EXTENSIONS = /\.(png|jpe?g|gif|svg|webp|ico|css|js|mjs|json|xml|pdf|zip|woff2?|ttf|mp4|webm|mp3)$/i;
/** A link that would end the session or do something, not show something. */
const SKIP_WORDS = /log-?out|sign-?out|delete|remove|unsubscribe/i;

/** The route (path and query) a link points at inside the app, or null when it leads elsewhere or is not a page. */
export function normalizeRoute(href: string, baseUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(href, baseUrl);
  } catch {
    return null;
  }
  const base = new URL(baseUrl);
  if (url.origin !== base.origin || !/^https?:$/.test(url.protocol)) return null;
  if (SKIP_EXTENSIONS.test(url.pathname) || SKIP_WORDS.test(url.pathname + url.search)) return null;
  url.hash = '';
  const route = `${url.pathname}${url.search}`;
  return route.startsWith('/') ? route : `/${route}`;
}

/** The routes a sitemap lists, in order. Only `<loc>` is read; a sitemap index's children are not followed. */
export function parseSitemap(xml: string, baseUrl: string): string[] {
  const out: string[] = [];
  for (const match of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
    const route = normalizeRoute(match[1].replace(/&amp;/g, '&'), baseUrl);
    if (route && !/sitemap.*\.xml$/i.test(route)) out.push(route);
  }
  return dedupe(out);
}

export const dedupe = (routes: string[]): string[] => [...new Set(routes)];

/** The audit list: configured routes first, then what the sitemap and the crawl added, capped. */
export function planRoutes(configured: string[], found: string[], max: number): string[] {
  const base = dedupe(configured.map((r) => (r.startsWith('/') ? r : `/${r}`)));
  const extra = dedupe(found).filter((r) => !base.includes(r));
  return [...base, ...extra.slice(0, Math.max(0, max))];
}

export async function fetchSitemap(baseUrl: string): Promise<string[]> {
  try {
    const response = await fetch(new URL('/sitemap.xml', baseUrl), { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return [];
    return parseSitemap(await response.text(), baseUrl);
  } catch {
    return [];
  }
}

/**
 * Breadth-first over same-origin links from the starting routes, visiting at most `maxPages` new pages. The page
 * is the signed-in one, so pages behind a login are found too. Returns the new routes in the order they were found.
 */
export async function crawl(page: Page, baseUrl: string, start: string[], maxPages: number): Promise<string[]> {
  const seen = new Set(start);
  const found: string[] = [];
  const queue = [...start];
  let visits = 0;
  while (queue.length && visits < maxPages + start.length) {
    const route = queue.shift()!;
    visits += 1;
    let hrefs: string[] = [];
    try {
      await page.goto(new URL(route, baseUrl).href, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      await page.waitForLoadState('load', { timeout: 10_000 }).catch(() => {});
      hrefs = await page.$$eval('a[href]', (links) => links.map((a) => (a as HTMLAnchorElement).href));
    } catch {
      continue;
    }
    // The address the page settled on counts too: a redirect target is a page of its own.
    hrefs.unshift(page.url());
    for (const href of hrefs) {
      const next = normalizeRoute(href, baseUrl);
      if (!next || seen.has(next) || found.length >= maxPages) continue;
      seen.add(next);
      found.push(next);
      queue.push(next);
    }
  }
  return found;
}
